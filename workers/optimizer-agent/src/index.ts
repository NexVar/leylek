/**
 * optimizer-agent Worker — Gemini 2.5 Pro powered budget decision agent.
 *
 * Two entry points:
 *   - cron (every 6h prod): iterate active campaigns, ping each Campaign DO
 *   - manual /internal/optimize/:campaignId: gateway-triggered (demo)
 *
 * The actual decision-making lives in the CampaignAgent Durable Object,
 * one instance per campaign, so race conditions are impossible.
 */

import { Hono } from 'hono';

import { CampaignAgent } from './campaign-agent';
import type { Env } from './env';

export { CampaignAgent };

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) =>
  c.json({ status: 'ok', service: 'optimizer-agent', model: 'gemini-2.5-pro' }),
);

app.post('/internal/optimize/:campaignId', async (c) => {
  const campaignId = c.req.param('campaignId');
  const doStub = c.env.CAMPAIGN_AGENT.get(c.env.CAMPAIGN_AGENT.idFromName(`campaign-${campaignId}`));
  const response = await doStub.fetch('https://internal/run-optimization', {
    method: 'POST',
    body: JSON.stringify({ campaignId }),
  });
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
});

export default {
  fetch: app.fetch.bind(app),
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    // TODO:
    //   1. Query D1 for all active campaigns
    //   2. For each, instantiate Campaign DO and fire optimization
    //   3. Log fan-out metrics
    console.log('[optimizer-agent] cron fired', new Date().toISOString());
  },
};
