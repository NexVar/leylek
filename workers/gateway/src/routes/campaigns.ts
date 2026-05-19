/**
 * Campaign routes — CRUD + manual optimizer trigger + agent log feed.
 *
 * The gateway orchestrates: content-agent generates ads, we persist them, then
 * publisher-agent pushes them to the (sim) platform. Optimize-now is a
 * two-step (analytics refresh → optimizer) chain so the optimizer's Gemini
 * call sees fresh aggregates.
 *
 * Transaction note: D1 doesn't expose multi-statement transactions to Workers,
 * and Service Bindings are HTTP-like — calls can fail independently. See the
 * comment block on `POST /` for the explicit failure stance we take.
 */

import { schema } from '@leylek/db';
import { CampaignMode, ContentAgentOutput, CreateCampaignRequest } from '@leylek/shared-types';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import { z } from 'zod';

import type { Env } from '../env';
import { type AuthVariables, requireAuth } from '../middleware/auth';

export const campaignRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

campaignRoutes.use('*', requireAuth);

// ---------------------------------------------------------------------------
// POST /api/campaigns — full create + analyze + publish chain
// ---------------------------------------------------------------------------
campaignRoutes.post('/', async (c) => {
  const userId = Number(c.get('userId'));

  let body: ReturnType<typeof CreateCampaignRequest.parse>;
  try {
    body = CreateCampaignRequest.parse(await c.req.json());
  } catch (err) {
    return c.json(
      { error: 'invalid_request', detail: err instanceof Error ? err.message : 'bad body' },
      400,
    );
  }

  // 1. content-agent.analyze — Gemini generates 3 ad variants.
  const analyzeRes = await c.env.CONTENT_AGENT.fetch('https://internal/internal/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      productUrl: body.productUrl,
      dailyBudgetKurus: body.dailyBudgetKurus,
    }),
  });
  if (!analyzeRes.ok) {
    const detail = await analyzeRes.text().catch(() => '');
    console.error('[gateway/campaigns] content-agent failed', analyzeRes.status, detail);
    return c.json({ error: 'content_agent_failed', upstream: analyzeRes.status }, 502);
  }
  const analyzeJson = (await analyzeRes.json()) as {
    output: unknown;
    imageR2Keys?: (string | null)[];
    geminiRequestId?: string;
    sourceMode?: string;
  };
  const parsedOutput = ContentAgentOutput.safeParse(analyzeJson.output);
  if (!parsedOutput.success) {
    return c.json({ error: 'content_agent_invalid_output' }, 502);
  }
  const { variants } = parsedOutput.data;
  const geminiRequestId = analyzeJson.geminiRequestId;
  const imageR2Keys = analyzeJson.imageR2Keys ?? variants.map(() => null);

  // 2. Persist campaign + 3 ad rows. We accept that this multi-statement
  //    write isn't a real D1 transaction (see file header).
  const db = drizzle(c.env.DB, { schema });
  const campaignInsert = await db
    .insert(schema.campaigns)
    .values({
      userId,
      productUrl: body.productUrl,
      mode: body.mode,
      dailyBudgetKurus: body.dailyBudgetKurus,
      status: 'active',
    })
    .returning({ id: schema.campaigns.id });
  const campaignRow = campaignInsert[0];
  if (!campaignRow) {
    return c.json({ error: 'campaign insert failed' }, 500);
  }
  const campaignId = campaignRow.id;

  const adInserts = await db
    .insert(schema.ads)
    .values(
      variants.map((v, i) => ({
        campaignId,
        strategyType: v.strategyType,
        adText: v.adText,
        imagePrompt: v.imagePrompt,
        imageR2Key: imageR2Keys[i] ?? null,
        status: 'pending' as const,
      })),
    )
    .returning({
      id: schema.ads.id,
      strategyType: schema.ads.strategyType,
      adText: schema.ads.adText,
      imagePrompt: schema.ads.imagePrompt,
      imageR2Key: schema.ads.imageR2Key,
      status: schema.ads.status,
    });

  // 3. agent_logs — one row per variant attributing creation to content-agent.
  await db.insert(schema.agentLogs).values(
    adInserts.map((ad) => ({
      campaignId,
      agentName: 'content',
      actionTaken: 'CREATED_AD',
      targetRef: String(ad.id),
      reason: `İçerik üretildi (${ad.strategyType}) — Gemini 2.5 Pro`,
      confidence: 1.0,
      geminiRequestId: geminiRequestId ?? null,
    })),
  );

  // 4. publisher-agent.publish — push to the (sim) ad platform.
  const publishRes = await c.env.PUBLISHER_AGENT.fetch('https://internal/internal/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      campaignId,
      userId,
      productUrl: body.productUrl,
      dailyBudgetKurus: body.dailyBudgetKurus,
      variants: variants.map((v) => ({
        strategyType: v.strategyType,
        adText: v.adText,
        imagePrompt: v.imagePrompt,
      })),
    }),
  });
  if (!publishRes.ok) {
    const detail = await publishRes.text().catch(() => '');
    console.error('[gateway/campaigns] publisher-agent failed', publishRes.status, detail);
    // Conscious decision: campaign + ads stay in D1 with `pending` status. The
    // user can retry publish (Faz 2 endpoint) or archive the campaign. We do
    // not roll back the rows — content-agent burned a Gemini call and the
    // generated variants are valuable; deleting them silently would hide a
    // real upstream failure from the dashboard.
    return c.json(
      {
        error: 'publisher_agent_failed',
        upstream: publishRes.status,
        campaignId,
        ads: adInserts,
      },
      502,
    );
  }

  // Re-read the updated rows so the response carries the platform ids.
  const finalAds = await db.query.ads.findMany({
    where: eq(schema.ads.campaignId, campaignId),
  });
  const finalCampaign = await db.query.campaigns.findFirst({
    where: eq(schema.campaigns.id, campaignId),
  });

  return c.json({ campaign: finalCampaign, ads: finalAds }, 201);
});

// ---------------------------------------------------------------------------
// GET /api/campaigns — list user's campaigns + ads
// ---------------------------------------------------------------------------
campaignRoutes.get('/', async (c) => {
  const userId = Number(c.get('userId'));
  const db = drizzle(c.env.DB, { schema });

  const campaigns = await db.query.campaigns.findMany({
    where: eq(schema.campaigns.userId, userId),
    orderBy: [desc(schema.campaigns.createdAt)],
  });
  if (campaigns.length === 0) {
    return c.json({ campaigns: [] });
  }

  const ads = await db.query.ads.findMany({
    where: inArray(
      schema.ads.campaignId,
      campaigns.map((cmp) => cmp.id),
    ),
  });
  const adsByCampaign = new Map<number, typeof ads>();
  for (const ad of ads) {
    const list = adsByCampaign.get(ad.campaignId) ?? [];
    list.push(ad);
    adsByCampaign.set(ad.campaignId, list);
  }

  return c.json({
    campaigns: campaigns.map((cmp) => ({
      ...cmp,
      ads: adsByCampaign.get(cmp.id) ?? [],
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /api/campaigns/:id — detail + ads + last 50 agent_logs
// ---------------------------------------------------------------------------
campaignRoutes.get('/:id', async (c) => {
  const userId = Number(c.get('userId'));
  const campaignId = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return c.json({ error: 'invalid campaign id' }, 400);
  }
  const db = drizzle(c.env.DB, { schema });

  const campaign = await db.query.campaigns.findFirst({
    where: and(eq(schema.campaigns.id, campaignId), eq(schema.campaigns.userId, userId)),
  });
  if (!campaign) {
    return c.json({ error: 'not found' }, 404);
  }

  const ads = await db.query.ads.findMany({
    where: eq(schema.ads.campaignId, campaignId),
  });
  const logs = await db
    .select()
    .from(schema.agentLogs)
    .where(eq(schema.agentLogs.campaignId, campaignId))
    .orderBy(desc(schema.agentLogs.createdAt))
    .limit(50);

  return c.json({ campaign, ads, logs });
});

// ---------------------------------------------------------------------------
// POST /api/campaigns/:id/optimize-now — demo "Şimdi Optimize Et"
// ---------------------------------------------------------------------------
campaignRoutes.post('/:id/optimize-now', async (c) => {
  const userId = Number(c.get('userId'));
  const campaignId = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return c.json({ error: 'invalid campaign id' }, 400);
  }

  const db = drizzle(c.env.DB, { schema });
  const owned = await db.query.campaigns.findFirst({
    where: and(eq(schema.campaigns.id, campaignId), eq(schema.campaigns.userId, userId)),
  });
  if (!owned) {
    return c.json({ error: 'not found' }, 404);
  }

  // 1. analytics-worker refresh — recompute aggregates from latest snapshots
  //    before the optimizer reads. We don't bail on failure here; the
  //    optimizer can still decide using whatever is currently in D1, and a
  //    transient analytics blip shouldn't block the demo flow.
  const refreshRes = await c.env.ANALYTICS_WORKER.fetch(
    `https://internal/internal/refresh/${campaignId}`,
    { method: 'POST' },
  );
  if (!refreshRes.ok) {
    console.warn(
      `[gateway/campaigns] analytics refresh non-2xx for campaign ${campaignId}: ${refreshRes.status}`,
    );
  }

  // 2. optimizer-agent — stream the DO body straight back.
  const optimizeRes = await c.env.OPTIMIZER_AGENT.fetch(
    `https://internal/internal/optimize/${campaignId}`,
    { method: 'POST' },
  );
  // Re-package headers but pass through status + body unchanged so the
  // frontend can read `reasoningStreamLine` without re-buffering.
  const headers = new Headers(optimizeRes.headers);
  return new Response(optimizeRes.body, {
    status: optimizeRes.status,
    headers,
  });
});

// ---------------------------------------------------------------------------
// GET /api/campaigns/:id/logs — agent_logs newest-first, max 100
// ---------------------------------------------------------------------------
campaignRoutes.get('/:id/logs', async (c) => {
  const userId = Number(c.get('userId'));
  const campaignId = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return c.json({ error: 'invalid campaign id' }, 400);
  }
  const db = drizzle(c.env.DB, { schema });

  const owned = await db.query.campaigns.findFirst({
    where: and(eq(schema.campaigns.id, campaignId), eq(schema.campaigns.userId, userId)),
  });
  if (!owned) {
    return c.json({ error: 'not found' }, 404);
  }

  const logs = await db
    .select()
    .from(schema.agentLogs)
    .where(eq(schema.agentLogs.campaignId, campaignId))
    .orderBy(desc(schema.agentLogs.createdAt))
    .limit(100);

  return c.json({ logs });
});

// ---------------------------------------------------------------------------
// PATCH /api/campaigns/:id — mid-demo mode flip (OTOPILOT <-> COPILOT)
//
// Intentionally narrow: only `mode` is mutable here. Other shape changes go
// through dedicated endpoints (publish, optimize, etc.) so the audit trail
// stays meaningful. Each successful flip writes a MODE_CHANGED log so the
// jury timeline shows that operator-initiated mode swaps are first-class.
// ---------------------------------------------------------------------------
const PatchCampaignBody = z.object({ mode: CampaignMode });

campaignRoutes.patch('/:id', async (c) => {
  const userId = Number(c.get('userId'));
  const campaignId = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return c.json({ error: 'invalid campaign id' }, 400);
  }

  let body: z.infer<typeof PatchCampaignBody>;
  try {
    body = PatchCampaignBody.parse(await c.req.json());
  } catch (err) {
    return c.json(
      { error: 'invalid_request', detail: err instanceof Error ? err.message : 'bad body' },
      400,
    );
  }

  const db = drizzle(c.env.DB, { schema });
  const owned = await db.query.campaigns.findFirst({
    where: and(eq(schema.campaigns.id, campaignId), eq(schema.campaigns.userId, userId)),
  });
  if (!owned) {
    return c.json({ error: 'not found' }, 404);
  }

  const previousMode = owned.mode;
  if (previousMode === body.mode) {
    // No-op flip — return current row without burning a log line.
    return c.json({ campaign: owned });
  }

  const nowIso = new Date().toISOString();
  await db
    .update(schema.campaigns)
    .set({ mode: body.mode, updatedAt: nowIso })
    .where(eq(schema.campaigns.id, campaignId));

  await db.insert(schema.agentLogs).values({
    campaignId,
    agentName: 'optimizer',
    actionTaken: 'MODE_CHANGED',
    targetRef: String(campaignId),
    reason: `Yönetim modu ${previousMode} -> ${body.mode} olarak değiştirildi.`,
    confidence: 1.0,
  });

  const updated = await db.query.campaigns.findFirst({
    where: eq(schema.campaigns.id, campaignId),
  });
  return c.json({ campaign: updated });
});

// ---------------------------------------------------------------------------
// Co-Pilot notification flow (PRD §7, §8)
//
// `payload_json` on a Co-Pilot proposal carries the action shape the optimizer
// would have executed directly in Otopilot mode. Approve = dispatch through
// publisher-agent + log the publisher's action as a `*_BY_COPILOT` variant
// (so the timeline distinguishes "user-approved" from "fully autonomous").
// Reject = mark resolved + log the rejection (no publisher call).
// ---------------------------------------------------------------------------
const NotificationPayloadSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('PAUSE_AD'),
    targetAdId: z.number().int().positive(),
    reason: z.string(),
  }),
  z.object({
    action: z.literal('REALLOCATE_BUDGET'),
    sourceAdId: z.number().int().positive(),
    targetAdId: z.number().int().positive(),
    budgetDeltaKurus: z.number().int().positive(),
    reason: z.string(),
  }),
]);

/**
 * Resolve a notification row that must belong to a campaign owned by the
 * current user. Returns `{notification, campaign}` on hit, or a 404/409 JSON
 * response when the row is missing, foreign, or already resolved.
 */
async function loadPendingNotification(
  // biome-ignore lint/suspicious/noExplicitAny: Hono context type sits behind generics that vary per route
  c: any,
  campaignId: number,
  notificationId: number,
) {
  const userId = Number(c.get('userId'));
  const db = drizzle(c.env.DB, { schema });

  const campaign = await db.query.campaigns.findFirst({
    where: and(eq(schema.campaigns.id, campaignId), eq(schema.campaigns.userId, userId)),
  });
  if (!campaign) {
    return { error: c.json({ error: 'not found' }, 404) };
  }

  const notification = await db.query.notifications.findFirst({
    where: and(
      eq(schema.notifications.id, notificationId),
      eq(schema.notifications.campaignId, campaignId),
      eq(schema.notifications.userId, userId),
    ),
  });
  if (!notification) {
    return { error: c.json({ error: 'not found' }, 404) };
  }
  if (notification.status !== 'pending') {
    return {
      error: c.json({ error: 'notification_already_resolved', status: notification.status }, 409),
    };
  }
  return { db, notification, campaign };
}

campaignRoutes.post('/:id/notifications/:notificationId/approve', async (c) => {
  const campaignId = Number.parseInt(c.req.param('id'), 10);
  const notificationId = Number.parseInt(c.req.param('notificationId'), 10);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return c.json({ error: 'invalid campaign id' }, 400);
  }
  if (!Number.isInteger(notificationId) || notificationId <= 0) {
    return c.json({ error: 'invalid notification id' }, 400);
  }

  const loaded = await loadPendingNotification(c, campaignId, notificationId);
  if ('error' in loaded) return loaded.error;
  const { db, notification } = loaded;

  // Parse the payload the optimizer wrote when it proposed the action.
  let payload: z.infer<typeof NotificationPayloadSchema>;
  try {
    payload = NotificationPayloadSchema.parse(JSON.parse(notification.payloadJson));
  } catch (err) {
    console.error('[gateway/campaigns] notification payload malformed', notification.id, err);
    return c.json({ error: 'notification_payload_malformed' }, 500);
  }

  // Dispatch to publisher-agent — mirrors the optimizer DO's wiring so the
  // execution path is identical to Otopilot mode.
  const dispatchPath =
    payload.action === 'PAUSE_AD' ? '/internal/pause-ad' : '/internal/reallocate-budget';
  const dispatchBody =
    payload.action === 'PAUSE_AD'
      ? {
          adId: payload.targetAdId,
          reason: `Kullanıcı onayıyla (Co-Pilot): ${payload.reason}`,
        }
      : {
          sourceAdId: payload.sourceAdId,
          targetAdId: payload.targetAdId,
          deltaKurus: payload.budgetDeltaKurus,
          reason: `Kullanıcı onayıyla (Co-Pilot): ${payload.reason}`,
        };

  const dispatchRes = await c.env.PUBLISHER_AGENT.fetch(`https://internal${dispatchPath}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(dispatchBody),
  });
  if (!dispatchRes.ok) {
    const detail = await dispatchRes.text().catch(() => '');
    console.error(
      `[gateway/campaigns] publisher dispatch failed (${dispatchRes.status}): ${detail}`,
    );
    return c.json({ error: 'publisher_dispatch_failed', upstream: dispatchRes.status }, 502);
  }

  // Approval-side accounting — mark resolved + drop an attribution log.
  // publisher-agent already wrote a PAUSED_AD / REALLOCATED_BUDGET row; the
  // log we insert here is the "kullanıcı onayıyla" audit breadcrumb that
  // ties the action to the Co-Pilot approval (jury-critical).
  const resolvedAt = new Date().toISOString();
  await db
    .update(schema.notifications)
    .set({ status: 'approved', resolvedAt })
    .where(eq(schema.notifications.id, notification.id));

  const targetRef =
    payload.action === 'PAUSE_AD'
      ? String(payload.targetAdId)
      : `${payload.sourceAdId}->${payload.targetAdId}`;
  const inserted = await db
    .insert(schema.agentLogs)
    .values({
      campaignId,
      agentName: 'publisher',
      actionTaken: 'COPILOT_APPROVED',
      targetRef,
      reason: `Kullanıcı onayıyla ${payload.action} uygulandı. Orijinal gerekçe: "${payload.reason}"`,
      confidence: 1.0,
    })
    .returning({ id: schema.agentLogs.id });

  const refreshed = await db.query.notifications.findFirst({
    where: eq(schema.notifications.id, notification.id),
  });
  // biome-ignore lint/style/noNonNullAssertion: drizzle .returning() yields one row on a single-value insert
  return c.json({ notification: refreshed, agentLogId: inserted[0]!.id });
});

campaignRoutes.post('/:id/notifications/:notificationId/reject', async (c) => {
  const campaignId = Number.parseInt(c.req.param('id'), 10);
  const notificationId = Number.parseInt(c.req.param('notificationId'), 10);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return c.json({ error: 'invalid campaign id' }, 400);
  }
  if (!Number.isInteger(notificationId) || notificationId <= 0) {
    return c.json({ error: 'invalid notification id' }, 400);
  }

  const loaded = await loadPendingNotification(c, campaignId, notificationId);
  if ('error' in loaded) return loaded.error;
  const { db, notification } = loaded;

  // Parse for the target_ref + original reason; tolerate a malformed payload
  // by still recording the rejection without ad-specific context.
  const parsed = NotificationPayloadSchema.safeParse(JSON.parse(notification.payloadJson));
  const originalReason = parsed.success ? parsed.data.reason : '(payload okunamadı)';
  const targetRef = parsed.success
    ? parsed.data.action === 'PAUSE_AD'
      ? String(parsed.data.targetAdId)
      : `${parsed.data.sourceAdId}->${parsed.data.targetAdId}`
    : String(notification.id);

  const resolvedAt = new Date().toISOString();
  await db
    .update(schema.notifications)
    .set({ status: 'rejected', resolvedAt })
    .where(eq(schema.notifications.id, notification.id));

  await db.insert(schema.agentLogs).values({
    campaignId,
    agentName: 'optimizer',
    actionTaken: 'COPILOT_REJECTED',
    targetRef,
    reason: `Kullanıcı öneriyi reddetti. Orijinal Gemini gerekçesi: "${originalReason}"`,
    confidence: 1.0,
  });

  const refreshed = await db.query.notifications.findFirst({
    where: eq(schema.notifications.id, notification.id),
  });
  return c.json({ notification: refreshed });
});

// ---------------------------------------------------------------------------
// GET /api/campaigns/:id/notifications — list newest first, max 50, owner only
// ---------------------------------------------------------------------------
campaignRoutes.get('/:id/notifications', async (c) => {
  const userId = Number(c.get('userId'));
  const campaignId = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return c.json({ error: 'invalid campaign id' }, 400);
  }
  const db = drizzle(c.env.DB, { schema });

  const owned = await db.query.campaigns.findFirst({
    where: and(eq(schema.campaigns.id, campaignId), eq(schema.campaigns.userId, userId)),
  });
  if (!owned) {
    return c.json({ error: 'not found' }, 404);
  }

  const rows = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.campaignId, campaignId))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(50);

  return c.json({ notifications: rows });
});
