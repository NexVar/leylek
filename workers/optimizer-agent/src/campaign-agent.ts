/**
 * CampaignAgent Durable Object — per-campaign agent state + decision engine.
 *
 * One DO instance per campaign, named `campaign-<id>`. PRD §5 / §7:
 *
 *   - Loads campaign + ads from D1
 *   - Aggregates last-48h metrics from metric_snapshots
 *   - Calls Gemini 2.5 Pro (structured output -> OptimizerDecision)
 *   - Delegates atomic actions to publisher-agent via Service Binding
 *   - Persists agent_logs row + rolling decision history
 *
 * DO atomic execution guarantees no two cron fires race on the same campaign:
 *   "one campaign = one decision chain = one DO" (PRD §5).
 */

import { DurableObject } from 'cloudflare:workers';
import { GoogleGenAI, Type } from '@google/genai';
import { schema } from '@leylek/db';
import { OPTIMIZER_AGENT_SYSTEM, OPTIMIZER_AGENT_USER } from '@leylek/prompts';
import { type AgentAction, OptimizerDecision } from '@leylek/shared-types';
import { and, eq, gte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import type { Env } from './env';

// ---------------------------------------------------------------------------
// DO storage shape
// ---------------------------------------------------------------------------
interface DecisionHistoryEntry {
  at: string;
  action: string;
  targetAdId: number | null;
  reason: string;
  confidence: number;
}

interface CampaignState {
  campaignId: number;
  decisionHistory: DecisionHistoryEntry[];
  lastMetricsAt: string | null;
}

const HISTORY_LIMIT = 20;
const METRIC_WINDOW_HOURS = 48;
// Free tier has zero quota on gemini-2.5-pro right now; Flash carries the
// structured decision well enough and is the PRD §16 fallback path.
const GEMINI_MODEL = 'gemini-2.5-flash';

// ---------------------------------------------------------------------------
// Aggregated ad metrics passed into the prompt
// ---------------------------------------------------------------------------
interface AdMetrics {
  adId: number;
  strategy: string;
  status: string;
  impressions: number;
  clicks: number;
  conversions: number;
  spendKurus: number;
  cpaKurus: number | null;
}

interface PromptMetricsPayload {
  windowHours: number;
  campaignMedianCpaKurus: number | null;
  ads: AdMetrics[];
}

// ---------------------------------------------------------------------------
// Gemini responseSchema — mirrors OptimizerDecision Zod schema.
// `nullable: true` on targetAdId / sourceAdId so the model can emit null for KEEP.
// ---------------------------------------------------------------------------
const OPTIMIZER_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  required: ['action', 'targetAdId', 'reason', 'confidence'],
  properties: {
    action: {
      type: Type.STRING,
      enum: ['PAUSE_AD', 'RESUME_AD', 'REALLOCATE_BUDGET', 'KEEP'],
    },
    targetAdId: {
      type: Type.INTEGER,
      nullable: true,
      description: 'Ad to act on; null when action=KEEP.',
    },
    sourceAdId: {
      type: Type.INTEGER,
      nullable: true,
      description: 'For REALLOCATE_BUDGET: the loser ad losing budget.',
    },
    budgetDeltaKurus: {
      type: Type.INTEGER,
      description: 'For REALLOCATE_BUDGET: kurus to shift from source to target.',
    },
    reason: {
      type: Type.STRING,
      description: 'Turkish-language reasoning, 1-3 sentences, citing numbers.',
    },
    confidence: {
      type: Type.NUMBER,
      description: 'Self-reported confidence 0.0-1.0.',
    },
  },
  propertyOrdering: [
    'action',
    'targetAdId',
    'sourceAdId',
    'budgetDeltaKurus',
    'reason',
    'confidence',
  ],
};

export class CampaignAgent extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/run-optimization' && request.method === 'POST') {
      return this.handleRunOptimization(request);
    }

    if (url.pathname === '/state' && request.method === 'GET') {
      const state = await this.ctx.storage.get<CampaignState>('state');
      return Response.json(state ?? { uninitialized: true });
    }

    return new Response('Not found', { status: 404 });
  }

  // -------------------------------------------------------------------------
  // POST /run-optimization
  // -------------------------------------------------------------------------
  private async handleRunOptimization(request: Request): Promise<Response> {
    let campaignId: number;
    try {
      const body = (await request.json()) as { campaignId: number };
      if (typeof body.campaignId !== 'number' || !Number.isInteger(body.campaignId)) {
        return Response.json({ error: 'campaignId must be an integer' }, { status: 400 });
      }
      campaignId = body.campaignId;
    } catch {
      return Response.json({ error: 'invalid JSON body' }, { status: 400 });
    }

    const db = drizzle(this.env.DB, { schema });

    // 1. Load campaign + its ads.
    const campaign = await db.query.campaigns.findFirst({
      where: eq(schema.campaigns.id, campaignId),
    });
    if (!campaign) {
      return Response.json({ error: `campaign ${campaignId} not found` }, { status: 404 });
    }

    const ads = await db.query.ads.findMany({
      where: eq(schema.ads.campaignId, campaignId),
    });
    if (ads.length === 0) {
      return Response.json({ error: 'campaign has no ads' }, { status: 422 });
    }

    // 2. Aggregate last 48h metrics per ad.
    const since = new Date(Date.now() - METRIC_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const adMetrics: AdMetrics[] = [];
    for (const ad of ads) {
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
            gte(schema.metricSnapshots.snapshotAt, since),
          ),
        );

      const sums = rows.reduce(
        (acc, r) => {
          acc.impressions += r.impressions;
          acc.clicks += r.clicks;
          acc.conversions += r.conversions;
          acc.spendKurus += r.spendKurus;
          return acc;
        },
        { impressions: 0, clicks: 0, conversions: 0, spendKurus: 0 },
      );

      const cpaKurus = sums.conversions > 0 ? Math.round(sums.spendKurus / sums.conversions) : null;

      adMetrics.push({
        adId: ad.id,
        strategy: ad.strategyType,
        status: ad.status,
        impressions: sums.impressions,
        clicks: sums.clicks,
        conversions: sums.conversions,
        spendKurus: sums.spendKurus,
        cpaKurus,
      });
    }

    const campaignMedianCpaKurus = median(
      adMetrics.map((m) => m.cpaKurus).filter((v): v is number => v != null),
    );

    // 3. Build prompt payload.
    const payload: PromptMetricsPayload = {
      windowHours: METRIC_WINDOW_HOURS,
      campaignMedianCpaKurus,
      ads: adMetrics,
    };
    const metricsJson = JSON.stringify(payload, null, 2);

    // 4. Call Gemini with structured output. Retry once on parse failure.
    const { decision, geminiRequestId, geminiError } = await this.callGeminiWithRetry(
      campaignId,
      metricsJson,
    );

    if (!decision) {
      // 5b. Persist failure into agent_logs and bail.
      await db.insert(schema.agentLogs).values({
        campaignId,
        agentName: 'optimizer',
        actionTaken: 'OPTIMIZER_FAILED',
        targetRef: null,
        reason: geminiError ?? 'Gemini structured output failed twice',
        confidence: null,
        geminiRequestId: geminiRequestId ?? null,
      });
      return Response.json(
        { error: 'optimizer failed', detail: geminiError ?? 'parse failure' },
        { status: 502 },
      );
    }

    // 6. Branch on campaign.mode for non-KEEP decisions.
    //    - KEEP             → log only, no side effect (both modes).
    //    - OTOPILOT         → dispatch atomic action to publisher + log decision.action.
    //                         Preserved verbatim from the pre-COPILOT codepath: the log
    //                         keeps using the imperative `PAUSE_AD` / `REALLOCATE_BUDGET`
    //                         / `RESUME_AD` strings, not the AgentAction past-tense form.
    //    - COPILOT          → write notifications row + log PROPOSED_* action; do NOT dispatch.
    //                         The full OptimizerDecision is serialised into
    //                         notifications.payloadJson so the gateway's
    //                         /:id/notifications/:notificationId/approve endpoint can
    //                         re-execute the exact same dispatch without another Gemini call.
    let notificationId: number | null = null;
    let loggedAction: string = decision.action;

    if (decision.action !== 'KEEP') {
      if (campaign.mode === 'COPILOT') {
        const proposal = mapDecisionToProposal(decision);
        const notifInsert = await db
          .insert(schema.notifications)
          .values({
            userId: campaign.userId,
            campaignId,
            type: proposal.notificationType,
            payloadJson: JSON.stringify(decision),
            status: 'pending',
          })
          .returning({ id: schema.notifications.id });
        notificationId = notifInsert[0]?.id ?? null;
        loggedAction = proposal.proposedAction;
      } else {
        // OTOPILOT (and any other mode value falls through here to preserve behaviour):
        // fire the publisher-agent now and log the imperative action verbatim.
        await this.dispatchAction(decision);
      }
    }

    // 7. agent_logs row — same shape regardless of mode; only actionTaken differs.
    const inserted = await db
      .insert(schema.agentLogs)
      .values({
        campaignId,
        agentName: 'optimizer',
        actionTaken: loggedAction,
        targetRef: decision.targetAdId != null ? String(decision.targetAdId) : null,
        reason: decision.reason,
        confidence: decision.confidence,
        geminiRequestId: geminiRequestId ?? null,
      })
      .returning({ id: schema.agentLogs.id });

    const agentLogId = inserted[0]?.id ?? null;

    // 8. Update DO storage — rolling history (last 20), last metrics timestamp.
    //    History records the Gemini decision verbatim, not the side-effect choice, so
    //    OTOPILOT and COPILOT campaigns produce comparable decision chains for audit.
    const state = await this.loadState(campaignId);
    state.decisionHistory.push({
      at: new Date().toISOString(),
      action: decision.action,
      targetAdId: decision.targetAdId,
      reason: decision.reason,
      confidence: decision.confidence,
    });
    if (state.decisionHistory.length > HISTORY_LIMIT) {
      state.decisionHistory = state.decisionHistory.slice(-HISTORY_LIMIT);
    }
    state.lastMetricsAt = new Date().toISOString();
    await this.ctx.storage.put('state', state);

    // 9. Return shape for the gateway / frontend streaming line.
    //    notificationId is non-null only for COPILOT proposals — the frontend uses it to
    //    render an Approve / Reject CTA without a follow-up fetch.
    return Response.json({
      decision,
      reasoningStreamLine: decision.reason,
      agentLogId,
      notificationId,
    });
  }

  // -------------------------------------------------------------------------
  // Gemini call with one retry
  // -------------------------------------------------------------------------
  private async callGeminiWithRetry(
    campaignId: number,
    metricsJson: string,
  ): Promise<{
    decision: OptimizerDecision | null;
    geminiRequestId: string | null;
    geminiError: string | null;
  }> {
    const ai = new GoogleGenAI({ apiKey: this.env.GEMINI_API_KEY });
    let lastError: string | null = null;
    let lastRequestId: string | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: OPTIMIZER_AGENT_USER(campaignId, METRIC_WINDOW_HOURS, metricsJson),
          config: {
            systemInstruction: OPTIMIZER_AGENT_SYSTEM,
            temperature: 0.2,
            responseMimeType: 'application/json',
            responseSchema: OPTIMIZER_RESPONSE_SCHEMA,
          },
        });

        lastRequestId = response.responseId ?? null;
        const text = response.text;
        if (!text) {
          lastError = 'Gemini returned empty text';
          continue;
        }

        const parsed = JSON.parse(text);
        const decision = OptimizerDecision.parse(parsed);
        return { decision, geminiRequestId: lastRequestId, geminiError: null };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.warn(
          `[campaign-agent] Gemini attempt ${attempt + 1}/2 failed for campaign ${campaignId}:`,
          lastError,
        );
      }
    }

    return { decision: null, geminiRequestId: lastRequestId, geminiError: lastError };
  }

  // -------------------------------------------------------------------------
  // publisher-agent dispatch
  // -------------------------------------------------------------------------
  private async dispatchAction(decision: OptimizerDecision): Promise<void> {
    if (decision.action === 'PAUSE_AD' && decision.targetAdId != null) {
      await this.callPublisher('/internal/pause-ad', {
        adId: decision.targetAdId,
        reason: decision.reason,
      });
      return;
    }

    if (decision.action === 'REALLOCATE_BUDGET') {
      if (
        decision.sourceAdId == null ||
        decision.targetAdId == null ||
        decision.budgetDeltaKurus == null
      ) {
        console.warn(
          '[campaign-agent] REALLOCATE_BUDGET missing source/target/delta — skipping dispatch',
          decision,
        );
        return;
      }
      await this.callPublisher('/internal/reallocate-budget', {
        sourceAdId: decision.sourceAdId,
        targetAdId: decision.targetAdId,
        deltaKurus: decision.budgetDeltaKurus,
        reason: decision.reason,
      });
      return;
    }

    if (decision.action === 'RESUME_AD' && decision.targetAdId != null) {
      // /internal/resume-ad lands in parallel work — pass through and tolerate 404.
      const ok = await this.callPublisher(
        '/internal/resume-ad',
        { adId: decision.targetAdId, reason: decision.reason },
        { tolerateNotFound: true },
      );
      if (!ok) {
        console.warn(
          '[campaign-agent] /internal/resume-ad not implemented yet; decision logged only',
        );
      }
      return;
    }
  }

  private async callPublisher(
    path: string,
    body: Record<string, unknown>,
    opts: { tolerateNotFound?: boolean } = {},
  ): Promise<boolean> {
    try {
      const res = await this.env.PUBLISHER_AGENT.fetch(`https://internal${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-leylek-ad-platform': this.env.LEYLEK_AD_PLATFORM,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (opts.tolerateNotFound && res.status === 404) return false;
        const text = await res.text().catch(() => '');
        console.warn(`[campaign-agent] publisher ${path} returned ${res.status}: ${text}`);
        return false;
      }
      return true;
    } catch (err) {
      console.warn(
        `[campaign-agent] publisher ${path} threw:`,
        err instanceof Error ? err.message : err,
      );
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // DO storage helpers
  // -------------------------------------------------------------------------
  private async loadState(campaignId: number): Promise<CampaignState> {
    const stored = await this.ctx.storage.get<CampaignState>('state');
    if (stored) return stored;
    const fresh: CampaignState = {
      campaignId,
      decisionHistory: [],
      lastMetricsAt: null,
    };
    await this.ctx.storage.put('state', fresh);
    return fresh;
  }
}

// ---------------------------------------------------------------------------
// Decision → COPILOT proposal mapping.
//
// Produces the pair of strings written for a COPILOT proposal:
//   - notifications.type  — consumed by the frontend to pick the right CTA
//   - agent_logs.action_taken — `PROPOSED_*` form so analytics distinguish a
//     proposal from an executed action.
//
// Note on `PROPOSED_RESUME`: the `AgentAction` Zod enum in @leylek/shared-types
// currently lists `PROPOSED_PAUSE` and `PROPOSED_BUDGET_SHIFT` but not yet
// `PROPOSED_RESUME`. The agent_logs.action_taken column is `text NOT NULL`
// with no enum constraint at the DB level, so writing the string is safe;
// a future shared-types update should add the missing member for parity with
// the executed-side `RESUMED_AD`.
// ---------------------------------------------------------------------------
type ProposedAction = AgentAction | 'PROPOSED_RESUME';

interface ProposalMapping {
  notificationType: 'STOP_LOSS_PROPOSAL' | 'BUDGET_SHIFT_PROPOSAL' | 'RESUME_PROPOSAL';
  proposedAction: ProposedAction;
}

function mapDecisionToProposal(decision: OptimizerDecision): ProposalMapping {
  switch (decision.action) {
    case 'PAUSE_AD':
      return { notificationType: 'STOP_LOSS_PROPOSAL', proposedAction: 'PROPOSED_PAUSE' };
    case 'REALLOCATE_BUDGET':
      return {
        notificationType: 'BUDGET_SHIFT_PROPOSAL',
        proposedAction: 'PROPOSED_BUDGET_SHIFT',
      };
    case 'RESUME_AD':
      return { notificationType: 'RESUME_PROPOSAL', proposedAction: 'PROPOSED_RESUME' };
    case 'KEEP':
      // Unreachable — caller guards `decision.action !== 'KEEP'` before invoking.
      throw new Error('mapDecisionToProposal called with KEEP decision');
  }
}

// ---------------------------------------------------------------------------
// median over an integer list — used for campaign-level CPA reference
// ---------------------------------------------------------------------------
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const a = sorted[mid - 1] ?? 0;
    const b = sorted[mid] ?? 0;
    return Math.round((a + b) / 2);
  }
  return sorted[mid] ?? null;
}
