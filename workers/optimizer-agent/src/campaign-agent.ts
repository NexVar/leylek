/**
 * CampaignAgent Durable Object — per-campaign agent state.
 *
 * One DO instance per campaign. Holds:
 *   - decision_history: recent decisions made for this campaign
 *   - queued_actions: actions awaiting execution
 *   - last_known_metrics: reference to most recent snapshot
 *   - agent_context: rolling Gemini context for continuity
 *
 * DO's atomic execution guarantees no two cron fires can race on the
 * same campaign — "one campaign = one decision chain = one DO".
 *
 * Storage layout (DO transactional storage):
 *   - `state` -> { decision_history, queued_actions, last_known_metrics }
 *   - `context` -> rolling Gemini summary
 */

import { DurableObject } from 'cloudflare:workers';

import type { Env } from './env';

interface CampaignState {
  campaignId: string;
  decisionHistory: Array<{
    at: string;
    action: string;
    reason: string;
    confidence: number;
  }>;
  queuedActions: Array<{
    action: string;
    targetRef: string;
    payload: unknown;
  }>;
  lastMetricsAt: string | null;
}

export class CampaignAgent extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/run-optimization') {
      const body = (await request.json()) as { campaignId: string };
      const state = await this.loadState(body.campaignId);

      // TODO:
      //   1. Read recent metric_snapshots from D1 (last 6-24h window)
      //   2. Call Gemini 2.5 Pro with OPTIMIZER_AGENT_SYSTEM + OPTIMIZER_AGENT_USER
      //   3. Validate response against OptimizerDecision schema
      //   4. If action != KEEP, call publisher-agent via Service Binding
      //   5. Insert agent_logs row
      //   6. Append to state.decisionHistory, persist

      return Response.json({
        status: 'todo',
        campaignId: body.campaignId,
        currentHistoryLength: state.decisionHistory.length,
      });
    }

    if (url.pathname === '/state') {
      // TODO: return current state (for diagnostics / UI timeline)
      return Response.json({ todo: 'state read' });
    }

    return new Response('Not found', { status: 404 });
  }

  private async loadState(campaignId: string): Promise<CampaignState> {
    const stored = await this.ctx.storage.get<CampaignState>('state');
    if (stored) return stored;
    const fresh: CampaignState = {
      campaignId,
      decisionHistory: [],
      queuedActions: [],
      lastMetricsAt: null,
    };
    await this.ctx.storage.put('state', fresh);
    return fresh;
  }
}
