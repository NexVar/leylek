/**
 * analytics-worker — periodic metric ingestion and ads-table aggregate refresh.
 *
 * PRD §5 / §7 Step 7 / §10. Single code path post-mockdata.md — the cron
 * always asks the platform (real Google/Meta in prod, the `leylek-*-mock`
 * Workers in sandbox) for the freshest window, then aggregates. No
 * sim/real branch.
 *
 * Cron every 15 minutes (prod):
 *   1. Iterate active campaigns in D1.
 *   2. For each ad in the campaign:
 *      - Fetch a fresh 48 h window via `AdPlatformClient.fetchMetrics`
 *        and insert a new `metric_snapshots` row.
 *      - Aggregate `metric_snapshots` over the last 48 h.
 *      - Recompute `ads.spend_kurus`, `ads.cpa_kurus`, `ads.ctr_basis_points`.
 *   3. Update `ads` rows with the cached aggregates so the dashboard reads
 *      directly from `ads` without expensive time-series scans.
 *
 * Manual trigger: `POST /internal/refresh/:campaignId` — same logic, scoped
 * to one campaign. The demo flow ("Şimdi Optimize Et") relies on this.
 *
 * TODO(shared-client): publisher-agent owns `makeAdPlatformClient` today;
 * we import via relative path. Move to `packages/ads-clients` when a third
 * consumer settles.
 */

import { schema } from '@leylek/db';
import { and, eq, gt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';

// Shared ad-platform clients live in publisher-agent today; relative-path
// import keeps Wrangler's per-worker bundling happy. See file-level TODO above.
import { makeAdPlatformClient } from '../../publisher-agent/src/clients/make-client';

import type { Env } from './env';

/**
 * Same demo-credential placeholder as publisher-agent uses. Real
 * production loads these from `connected_accounts` per-campaign.
 */
const DEMO_CREDENTIALS = {
  refreshToken: '',
  customerId: 'sim_customer_demlik',
  accessToken: '',
  adAccountId: 'sim_account_demlik',
} as const;

const WINDOW_HOURS = 48;
const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000;

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) =>
  c.json({
    status: 'ok',
    service: 'analytics-worker',
    googleAdsBaseUrl: c.env.GOOGLE_ADS_BASE_URL,
    metaAdsBaseUrl: c.env.META_ADS_BASE_URL,
  }),
);

/**
 * Force-refresh aggregates for one campaign.
 * Used by the gateway / demo "Şimdi Optimize Et" path.
 */
app.post('/internal/refresh/:campaignId', async (c) => {
  const campaignIdRaw = c.req.param('campaignId');
  const campaignId = Number.parseInt(campaignIdRaw, 10);
  if (!Number.isFinite(campaignId) || campaignId <= 0) {
    return c.json({ error: 'invalid campaignId' }, 400);
  }

  const result = await refreshCampaign(c.env, campaignId);
  return c.json(result);
});

export default {
  fetch: app.fetch.bind(app),
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCron(env));
  },
};

// ---------------------------------------------------------------------------
// Cron
// ---------------------------------------------------------------------------
async function runCron(env: Env): Promise<void> {
  const startedAt = new Date().toISOString();
  console.log('[analytics-worker] cron start', {
    startedAt,
    googleAdsBaseUrl: env.GOOGLE_ADS_BASE_URL,
    metaAdsBaseUrl: env.META_ADS_BASE_URL,
  });

  const db = drizzle(env.DB, { schema });
  const activeCampaigns = await db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.status, 'active'));

  let okCount = 0;
  let failCount = 0;
  for (const { id } of activeCampaigns) {
    try {
      await refreshCampaign(env, id);
      okCount++;
    } catch (err) {
      failCount++;
      console.error('[analytics-worker] campaign refresh failed', {
        campaignId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const endedAt = new Date().toISOString();
  console.log('[analytics-worker] cron end', {
    startedAt,
    endedAt,
    totalCampaigns: activeCampaigns.length,
    okCount,
    failCount,
  });
}

// ---------------------------------------------------------------------------
// Per-campaign refresh
// ---------------------------------------------------------------------------
interface AdRefreshResult {
  adId: number;
  spendKurus: number;
  cpaKurus: number | null;
  ctrBp: number | null;
}

async function refreshCampaign(
  env: Env,
  campaignId: number,
): Promise<{ campaignId: number; ads: AdRefreshResult[] }> {
  const db = drizzle(env.DB, { schema });

  const campaignAds = await db
    .select({
      id: schema.ads.id,
      googleAdId: schema.ads.googleAdId,
      metaAdId: schema.ads.metaAdId,
    })
    .from(schema.ads)
    .where(eq(schema.ads.campaignId, campaignId));

  // Pull a fresh 48-h window from the platform and persist a new snapshot
  // before we aggregate. Sandbox: hits the mock Workers (which return
  // seed-pinned curves); prod: hits real Google/Meta.
  await ingestFreshSnapshots(env, campaignAds);

  const refreshed: AdRefreshResult[] = [];
  const cutoffIso = new Date(Date.now() - WINDOW_MS).toISOString();
  const nowIso = new Date().toISOString();

  for (const ad of campaignAds) {
    const rows = await db
      .select({
        impressions: schema.metricSnapshots.impressions,
        clicks: schema.metricSnapshots.clicks,
        conversions: schema.metricSnapshots.conversions,
        spendKurus: schema.metricSnapshots.spendKurus,
      })
      .from(schema.metricSnapshots)
      .where(
        and(
          eq(schema.metricSnapshots.adId, ad.id),
          gt(schema.metricSnapshots.snapshotAt, cutoffIso),
        ),
      );

    let impressions = 0;
    let clicks = 0;
    let conversions = 0;
    let spendKurus = 0;
    for (const row of rows) {
      impressions += row.impressions;
      clicks += row.clicks;
      conversions += row.conversions;
      spendKurus += row.spendKurus;
    }

    // Judgement: "no data yet" = spend 0, CPA / CTR null. Avoids div-by-zero
    // and lets the UI / optimizer distinguish "no signal" from "0 % CTR".
    const cpaKurus = conversions > 0 ? Math.round(spendKurus / conversions) : null;
    const ctrBp = impressions > 0 ? Math.round((clicks / impressions) * 10000) : null;

    await db
      .update(schema.ads)
      .set({
        spendKurus,
        cpaKurus,
        ctrBasisPoints: ctrBp,
        updatedAt: nowIso,
      })
      .where(eq(schema.ads.id, ad.id));

    refreshed.push({ adId: ad.id, spendKurus, cpaKurus, ctrBp });
  }

  return { campaignId, ads: refreshed };
}

// ---------------------------------------------------------------------------
// Snapshot ingestion (always-on)
// ---------------------------------------------------------------------------
async function ingestFreshSnapshots(
  env: Env,
  ads: Array<{ id: number; googleAdId: string | null; metaAdId: string | null }>,
): Promise<void> {
  const db = drizzle(env.DB, { schema });

  const factoryEnv = {
    GOOGLE_ADS_BASE_URL: env.GOOGLE_ADS_BASE_URL,
    GOOGLE_ADS_OAUTH_URL: env.GOOGLE_ADS_OAUTH_URL,
    META_ADS_BASE_URL: env.META_ADS_BASE_URL,
    GOOGLE_ADS_DEVELOPER_TOKEN: env.GOOGLE_ADS_DEVELOPER_TOKEN,
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    GOOGLE_OAUTH_CLIENT_ID: env.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: env.GOOGLE_OAUTH_CLIENT_SECRET,
    META_API_VERSION: env.META_API_VERSION,
  };

  for (const ad of ads) {
    const externalId = ad.googleAdId ?? ad.metaAdId;
    if (!externalId) continue;
    const provider = ad.metaAdId && !ad.googleAdId ? 'meta' : 'google_ads';
    const client = makeAdPlatformClient({
      provider,
      credentials: DEMO_CREDENTIALS,
      env: factoryEnv,
    });
    const window = await client.fetchMetrics(externalId, WINDOW_HOURS);
    await db.insert(schema.metricSnapshots).values({
      adId: ad.id,
      snapshotAt: window.windowEnd,
      impressions: window.impressions,
      clicks: window.clicks,
      conversions: window.conversions,
      spendKurus: window.spendKurus,
    });
  }
}
