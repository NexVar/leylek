/**
 * publisher-agent Worker — Meta Marketing API + Google Ads API action layer.
 *
 * Owns ALL outbound calls to ad platforms. Other workers never touch
 * Meta or Google directly — they ask publisher-agent to act.
 *
 * Wiring (post-mockdata.md): single code path. The factory builds a
 * `RealGoogleAdsClient` or `RealMetaAdsClient` per ad-account provider;
 * `GOOGLE_ADS_BASE_URL` + `META_ADS_BASE_URL` env vars decide whether
 * the request lands on a `leylek-*-mock` Worker (sandbox) or on the real
 * Google/Meta endpoint (prod). No sim/real branch in this Worker.
 *
 * Persistence:
 *   - `campaigns.do_id` stores the external (platform) campaign id.
 *     The PRD §5/§8 originally reserved that column for the Durable
 *     Object name, but the publisher needs a stable per-campaign external
 *     id to talk to the platform, and `do_id` is the only TEXT column on
 *     `campaigns` we can reuse without a schema migration. The
 *     optimizer-agent and analytics-worker both read this same field.
 *   - `ads.google_ad_id` for Google ads, `ads.meta_ad_id` for Meta ads.
 *     The provider switch on `pause`/`resume`/`reallocate` reads whichever
 *     column is populated.
 */

import { schema } from '@leylek/db';
import { type AdPlatformClient, AdPlatformError } from '@leylek/shared-types';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import { z } from 'zod';

import { type AdPlatformProvider, makeAdPlatformClient } from './clients';
import type { Env } from './env';

/**
 * Placeholder demo credentials — matches the values the seed script writes
 * into `connected_accounts` for the Demlik Pro demo user. Real production
 * pulls these per-request from D1 via the gateway's AES-256-GCM helper,
 * keyed by the user owning the action (PRD §10, Faz 2). The mock Workers
 * don't validate any of these, so the demo flow runs end-to-end with
 * fixed placeholders. Customer / ad-account ids are numeric strings so
 * Google's GAQL `WHERE campaign.id = <n>` regex matches and Meta's
 * `act_<n>` URL segment is well-formed.
 */
const DEMO_CREDENTIALS = {
  refreshToken: '',
  customerId: '1234567890',
  accessToken: '',
  adAccountId: '9876543210',
} as const;

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get('/api/health', (c) =>
  c.json({
    status: 'ok',
    service: 'publisher-agent',
    googleAdsBaseUrl: c.env.GOOGLE_ADS_BASE_URL,
    metaAdsBaseUrl: c.env.META_ADS_BASE_URL,
    metaApiVersion: c.env.META_API_VERSION,
  }),
);

// ---------------------------------------------------------------------------
// Factory helper — builds a per-provider AdPlatformClient.
//
// `DEMO_CREDENTIALS` keeps the demo flow self-contained; real production
// fetches per-user credentials from `connected_accounts` (decrypted via
// the gateway's AES-256-GCM helper) and passes them through this function
// instead. The factory does not care which.
// ---------------------------------------------------------------------------
function getClient(env: Env, provider: AdPlatformProvider): AdPlatformClient {
  return makeAdPlatformClient({
    provider,
    credentials: DEMO_CREDENTIALS,
    env: {
      GOOGLE_ADS_BASE_URL: env.GOOGLE_ADS_BASE_URL,
      GOOGLE_ADS_OAUTH_URL: env.GOOGLE_ADS_OAUTH_URL,
      META_ADS_BASE_URL: env.META_ADS_BASE_URL,
      GOOGLE_ADS_DEVELOPER_TOKEN: env.GOOGLE_ADS_DEVELOPER_TOKEN,
      GOOGLE_ADS_LOGIN_CUSTOMER_ID: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
      GOOGLE_OAUTH_CLIENT_ID: env.GOOGLE_OAUTH_CLIENT_ID,
      GOOGLE_OAUTH_CLIENT_SECRET: env.GOOGLE_OAUTH_CLIENT_SECRET,
      META_API_VERSION: env.META_API_VERSION,
    },
  });
}

function dbFrom(env: Env) {
  return drizzle(env.DB, { schema });
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeHostname(url: string): string {
  try {
    return new URL(url).host || 'Leylek campaign';
  } catch {
    return 'Leylek campaign';
  }
}

// ---------------------------------------------------------------------------
// POST /internal/publish — gateway hands us a campaign + 3 variants
// ---------------------------------------------------------------------------
const PublishRequest = z.object({
  campaignId: z.number().int().positive(),
  userId: z.number().int().positive(),
  productUrl: z.string().url(),
  dailyBudgetKurus: z.number().int().positive(),
  variants: z.array(
    z.object({
      strategyType: z.enum(['AGGRESSIVE', 'STORY', 'TECHNICAL']),
      adText: z.string(),
      imagePrompt: z.string(),
    }),
  ),
});

app.post('/internal/publish', async (c) => {
  const body = PublishRequest.parse(await c.req.json());
  const db = dbFrom(c.env);

  // Demo always speaks Google Ads. Faz 2 will route per
  // `connected_accounts.provider` once Meta credentials land.
  const client = getClient(c.env, 'google_ads');

  // 1. Make sure gateway-inserted campaign + ads rows are there.
  const campaign = await db.query.campaigns.findFirst({
    where: eq(schema.campaigns.id, body.campaignId),
  });
  if (!campaign) {
    return c.json({ error: 'campaign not found', campaignId: body.campaignId }, 404);
  }
  const adRows = await db.query.ads.findMany({
    where: eq(schema.ads.campaignId, body.campaignId),
  });
  if (adRows.length === 0) {
    return c.json({ error: 'no ads found for campaign', campaignId: body.campaignId }, 404);
  }

  // 2. Create the platform-side campaign.
  const campaignName = safeHostname(body.productUrl);
  const { externalId: campaignExternalId } = await client.createCampaign({
    name: campaignName,
    dailyBudgetKurus: body.dailyBudgetKurus,
  });

  // 4a. Persist external campaign id onto `campaigns.do_id` (see file header).
  await db
    .update(schema.campaigns)
    .set({ doId: campaignExternalId, updatedAt: nowIso() })
    .where(eq(schema.campaigns.id, body.campaignId));

  // 3. + 4b. Create each variant ad and persist its external id.
  const results: Array<{ adId: number; externalId: string; status: 'active' }> = [];
  for (const variant of body.variants) {
    const adRow =
      adRows.find((a) => a.strategyType === variant.strategyType) ??
      adRows[results.length] ??
      adRows[0];
    if (!adRow) {
      // Defensive: PublishRequest may carry more variants than rows; gateway
      // should always insert 3-to-3 but we don't trust that here.
      throw new AdPlatformError(
        'AD_ROW_MISSING',
        `no ad row to attach ${variant.strategyType} variant to`,
        {},
      );
    }
    const { externalId } = await client.createAd({
      campaignExternalId,
      strategyType: variant.strategyType,
      adText: variant.adText,
      imagePrompt: variant.imagePrompt,
    });
    await db
      .update(schema.ads)
      .set({ googleAdId: externalId, status: 'active', updatedAt: nowIso() })
      .where(eq(schema.ads.id, adRow.id));

    // 5. agent_logs row for this publish event.
    await db.insert(schema.agentLogs).values({
      campaignId: body.campaignId,
      agentName: 'publisher',
      actionTaken: 'CREATED_AD',
      targetRef: String(adRow.id),
      reason: `Yayına alındı (${client.runtime}/${variant.strategyType})`,
      confidence: 1.0,
    });
    results.push({ adId: adRow.id, externalId, status: 'active' });
  }

  return c.json({ campaignExternalId, ads: results });
});

// ---------------------------------------------------------------------------
// POST /internal/pause-ad — optimizer hands us an adId to pause
// ---------------------------------------------------------------------------
const PauseAdRequest = z.object({
  adId: z.number().int().positive(),
  reason: z.string(),
});

app.post('/internal/pause-ad', async (c) => {
  const body = PauseAdRequest.parse(await c.req.json());
  const db = dbFrom(c.env);

  const ad = await db.query.ads.findFirst({ where: eq(schema.ads.id, body.adId) });
  if (!ad) return c.json({ error: 'ad not found', adId: body.adId }, 404);

  // Prefer google_ad_id today; meta_ad_id path lands in Faz 2.
  const externalAdId = ad.googleAdId ?? ad.metaAdId;
  if (!externalAdId) {
    return c.json({ error: 'ad has no external id; never published?', adId: body.adId }, 409);
  }

  const provider: AdPlatformProvider = ad.metaAdId && !ad.googleAdId ? 'meta' : 'google_ads';
  const client = getClient(c.env, provider);

  try {
    await runWithRetry(() => client.pauseAd(externalAdId, body.reason));
  } catch (err) {
    return adPlatformErrorResponse(c, err);
  }

  await db
    .update(schema.ads)
    .set({ status: 'paused', updatedAt: nowIso() })
    .where(eq(schema.ads.id, body.adId));

  await db.insert(schema.agentLogs).values({
    campaignId: ad.campaignId,
    agentName: 'publisher',
    actionTaken: 'PAUSED_AD',
    targetRef: String(body.adId),
    reason: body.reason,
    confidence: 1.0,
  });

  return c.json({ adId: body.adId, status: 'paused' });
});

// ---------------------------------------------------------------------------
// POST /internal/resume-ad — symmetric to pause
// ---------------------------------------------------------------------------
const ResumeAdRequest = z.object({
  adId: z.number().int().positive(),
});

app.post('/internal/resume-ad', async (c) => {
  const body = ResumeAdRequest.parse(await c.req.json());
  const db = dbFrom(c.env);

  const ad = await db.query.ads.findFirst({ where: eq(schema.ads.id, body.adId) });
  if (!ad) return c.json({ error: 'ad not found', adId: body.adId }, 404);

  const externalAdId = ad.googleAdId ?? ad.metaAdId;
  if (!externalAdId) {
    return c.json({ error: 'ad has no external id; never published?', adId: body.adId }, 409);
  }

  const provider: AdPlatformProvider = ad.metaAdId && !ad.googleAdId ? 'meta' : 'google_ads';
  const client = getClient(c.env, provider);

  try {
    await runWithRetry(() => client.resumeAd(externalAdId));
  } catch (err) {
    return adPlatformErrorResponse(c, err);
  }

  await db
    .update(schema.ads)
    .set({ status: 'active', updatedAt: nowIso() })
    .where(eq(schema.ads.id, body.adId));

  await db.insert(schema.agentLogs).values({
    campaignId: ad.campaignId,
    agentName: 'publisher',
    actionTaken: 'RESUMED_AD',
    targetRef: String(body.adId),
    reason: `Resumed via publisher-agent (${client.runtime})`,
    confidence: 1.0,
  });

  return c.json({ adId: body.adId, status: 'active' });
});

// ---------------------------------------------------------------------------
// POST /internal/reallocate-budget — optimizer asks us to shift budget
//
// Tension: the optimizer thinks in per-ad terms (source / target adId), but the
// Google Ads API exposes daily budget on the *campaign*, not per ad. For the
// demo we resolve the source ad's parent campaign, apply `-deltaKurus` to its
// current sim budget, and persist the result via `client.updateBudget`. We
// then log the intent end-to-end in `agent_logs` so the dashboard can show
// "source→target" even though only the source-side campaign budget changed.
// PRD §10 acknowledges this simplification (sim mode persists via KV).
// ---------------------------------------------------------------------------
const ReallocateBudgetRequest = z.object({
  sourceAdId: z.number().int().positive(),
  targetAdId: z.number().int().positive(),
  deltaKurus: z.number().int().positive(),
  reason: z.string(),
});

app.post('/internal/reallocate-budget', async (c) => {
  const body = ReallocateBudgetRequest.parse(await c.req.json());
  const db = dbFrom(c.env);

  const sourceAd = await db.query.ads.findFirst({
    where: eq(schema.ads.id, body.sourceAdId),
  });
  const targetAd = await db.query.ads.findFirst({
    where: eq(schema.ads.id, body.targetAdId),
  });
  if (!sourceAd || !targetAd) {
    return c.json(
      {
        error: 'source or target ad not found',
        sourceAdId: body.sourceAdId,
        targetAdId: body.targetAdId,
      },
      404,
    );
  }
  if (sourceAd.campaignId !== targetAd.campaignId) {
    return c.json({ error: 'source/target ads belong to different campaigns' }, 400);
  }

  const campaign = await db.query.campaigns.findFirst({
    where: eq(schema.campaigns.id, sourceAd.campaignId),
  });
  if (!campaign?.doId) {
    return c.json(
      { error: 'campaign has no external id; never published?', campaignId: sourceAd.campaignId },
      409,
    );
  }

  // Simplification (documented above): apply delta only to the source campaign's
  // daily budget. In a Faz-2 multi-campaign Meta world the target campaign
  // would receive +delta in the same call; for the sim/Google-only demo,
  // source and target share a campaign so the net is the same.
  const newSourceBudgetKurus = Math.max(0, campaign.dailyBudgetKurus - body.deltaKurus);

  const provider: AdPlatformProvider =
    sourceAd.metaAdId && !sourceAd.googleAdId ? 'meta' : 'google_ads';
  const client = getClient(c.env, provider);

  try {
    await runWithRetry(() => client.updateBudget(campaign.doId ?? '', newSourceBudgetKurus));
  } catch (err) {
    return adPlatformErrorResponse(c, err);
  }

  await db
    .update(schema.campaigns)
    .set({ dailyBudgetKurus: newSourceBudgetKurus, updatedAt: nowIso() })
    .where(eq(schema.campaigns.id, campaign.id));

  await db.insert(schema.agentLogs).values({
    campaignId: campaign.id,
    agentName: 'publisher',
    actionTaken: 'REALLOCATED_BUDGET',
    targetRef: `${body.sourceAdId}->${body.targetAdId}`,
    reason: body.reason,
    confidence: 1.0,
  });

  return c.json({
    sourceAdId: body.sourceAdId,
    targetAdId: body.targetAdId,
    campaignId: campaign.id,
    newSourceBudgetKurus,
  });
});

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------
async function runWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AdPlatformError && err.retryable) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return await fn();
    }
    throw err;
  }
}

// biome-ignore lint/suspicious/noExplicitAny: Hono context shape varies per route
function adPlatformErrorResponse(c: any, err: unknown) {
  if (err instanceof AdPlatformError) {
    return c.json({ error: err.message, code: err.code, retryable: err.retryable }, 502);
  }
  console.error('[publisher-agent] unexpected error', err);
  return c.json({ error: 'internal_error' }, 500);
}

app.onError((err, c) => {
  if (err instanceof AdPlatformError) {
    return c.json({ error: err.message, code: err.code, retryable: err.retryable }, 502);
  }
  console.error('[publisher-agent] unhandled', err);
  return c.json({ error: 'internal_error' }, 500);
});

export default app;
