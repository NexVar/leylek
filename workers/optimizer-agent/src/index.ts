/**
 * optimizer-agent Worker — Gemini 3.1 Flash Lite powered budget decision agent.
 *
 * Two entry points (PRD §5 / §7):
 *   - cron (every 6h prod): iterate active campaigns, ping each Campaign DO
 *   - manual POST /internal/optimize/:campaignId: gateway-triggered (demo)
 *
 * Per-campaign decision logic lives in CampaignAgent (Durable Object); this
 * file is just routing + fan-out.
 */

import { schema } from '@leylek/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';

import { CampaignAgent } from './campaign-agent';
import type { Env } from './env';

export { CampaignAgent };

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) =>
  c.json({ status: 'ok', service: 'optimizer-agent', model: 'gemini-3.1-flash-lite' }),
);

app.post('/internal/optimize/:campaignId', async (c) => {
  const campaignIdRaw = c.req.param('campaignId');
  const campaignId = Number.parseInt(campaignIdRaw, 10);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return c.json({ error: 'campaignId must be a positive integer' }, 400);
  }

  const doStub = c.env.CAMPAIGN_AGENT.get(
    c.env.CAMPAIGN_AGENT.idFromName(`campaign-${campaignId}`),
  );
  const response = await doStub.fetch('https://internal/run-optimization', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ campaignId }),
  });

  // Stream the DO's body back unchanged so the gateway/frontend can render the
  // reasoningStreamLine without re-buffering.
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
});

export default {
  fetch: app.fetch.bind(app),

  /**
   * Cron fan-out — every 6h.
   *
   * Walks D1 campaigns where status='active' and pokes each campaign's
   * Durable Object. We deliberately fire-and-await per campaign instead of
   * Promise.all — keeps Gemini quota usage predictable and one slow campaign
   * doesn't blow the worker's CPU budget for the others.
   */
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const startedAt = new Date().toISOString();
    console.log('[optimizer-agent] cron fan-out start', startedAt);

    const work = (async () => {
      const db = drizzle(env.DB, { schema });
      const activeCampaigns = await db
        .select({ id: schema.campaigns.id })
        .from(schema.campaigns)
        .where(eq(schema.campaigns.status, 'active'));

      let ok = 0;
      let failed = 0;
      for (const row of activeCampaigns) {
        try {
          const doStub = env.CAMPAIGN_AGENT.get(
            env.CAMPAIGN_AGENT.idFromName(`campaign-${row.id}`),
          );
          const res = await doStub.fetch('https://internal/run-optimization', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ campaignId: row.id }),
          });
          if (res.ok) {
            ok++;
          } else {
            failed++;
            console.warn(`[optimizer-agent] DO returned ${res.status} for campaign ${row.id}`);
          }
        } catch (err) {
          failed++;
          console.warn(
            `[optimizer-agent] DO call threw for campaign ${row.id}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      console.log(
        `[optimizer-agent] cron fan-out done — startedAt=${startedAt} total=${activeCampaigns.length} ok=${ok} failed=${failed}`,
      );
    })();

    ctx.waitUntil(work);
  },
};
