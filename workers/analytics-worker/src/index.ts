/**
 * analytics-worker — periodic metric ingestion from Meta + Google Ads.
 *
 * Cron every 15 minutes:
 *   1. Iterate active campaigns in D1
 *   2. For each, pull recent metrics from Meta Marketing API (insights endpoint)
 *      and Google Ads API (search query)
 *   3. Upsert into metric_snapshots
 *   4. Update ads.spend_kurus / cpa_kurus / ctr_basis_points (cached aggregate)
 *
 * Optional Gemini 2.5 Flash weekly summary endpoint (not on cron path).
 */

import { Hono } from 'hono';

import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ status: 'ok', service: 'analytics-worker' }));

app.post('/internal/refresh/:campaignId', async (c) => {
  const campaignId = c.req.param('campaignId');
  // TODO: force a metric refresh for a single campaign (used by demo flow)
  return c.json({ todo: 'force metric refresh', campaignId });
});

export default {
  fetch: app.fetch.bind(app),
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    // TODO:
    //   1. Select campaigns where status = 'active'
    //   2. For each, fetch Meta insights + Google Ads metrics in parallel
    //   3. Insert metric_snapshots batch
    //   4. Recompute and store ads cached aggregates
    console.log('[analytics-worker] cron fired', new Date().toISOString());
  },
};
