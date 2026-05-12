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
import { ContentAgentOutput, CreateCampaignRequest } from '@leylek/shared-types';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';

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
    geminiRequestId?: string;
    sourceMode?: string;
  };
  const parsedOutput = ContentAgentOutput.safeParse(analyzeJson.output);
  if (!parsedOutput.success) {
    return c.json({ error: 'content_agent_invalid_output' }, 502);
  }
  const { variants } = parsedOutput.data;
  const geminiRequestId = analyzeJson.geminiRequestId;

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
      variants.map((v) => ({
        campaignId,
        strategyType: v.strategyType,
        adText: v.adText,
        imagePrompt: v.imagePrompt,
        status: 'pending' as const,
      })),
    )
    .returning({
      id: schema.ads.id,
      strategyType: schema.ads.strategyType,
      adText: schema.ads.adText,
      imagePrompt: schema.ads.imagePrompt,
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
// Co-Pilot notification approve/reject — stubs for Faz 2 per AGENT_DECISIONS §9
// ---------------------------------------------------------------------------
campaignRoutes.post('/:id/notifications/:notificationId/approve', (c) =>
  c.json({ error: 'CoPilot Faz 2' }, 501),
);
campaignRoutes.post('/:id/notifications/:notificationId/reject', (c) =>
  c.json({ error: 'CoPilot Faz 2' }, 501),
);
