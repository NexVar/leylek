/**
 * Campaign routes — CRUD + manual optimizer trigger + agent log feed.
 *
 * Heavy lifting is delegated to the specialised agent Workers via
 * Service Bindings. The gateway only orchestrates and persists.
 */

import { Hono } from 'hono';

import type { Env } from '../env';

export const campaignRoutes = new Hono<{ Bindings: Env }>();

// --- CRUD ------------------------------------------------------------------
campaignRoutes.post('/', (c) =>
  c.text('TODO: parse CreateCampaignRequest -> content-agent.analyze -> publisher-agent.publish'),
);
campaignRoutes.get('/', (c) => c.json({ todo: 'list current user campaigns' }));
campaignRoutes.get('/:id', (c) => c.json({ todo: 'campaign detail with ads + recent metrics' }));

// --- Demo manual trigger ---------------------------------------------------
campaignRoutes.post('/:id/optimize-now', (c) =>
  c.text('TODO: call optimizer-agent.run(campaignId) to force a decision cycle'),
);

// --- Agent log feed --------------------------------------------------------
campaignRoutes.get('/:id/logs', (c) => c.json({ todo: 'agent_logs newest-first for campaign id' }));

// --- Co-Pilot proposal approval --------------------------------------------
campaignRoutes.post('/:id/notifications/:notificationId/approve', (c) =>
  c.text('TODO: approve a Co-Pilot proposal -> publisher-agent.execute'),
);
campaignRoutes.post('/:id/notifications/:notificationId/reject', (c) =>
  c.text('TODO: mark proposal rejected'),
);
