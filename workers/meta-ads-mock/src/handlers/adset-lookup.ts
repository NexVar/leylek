/**
 * GET /v21.0/:campaignId/adsets — list adsets under a campaign.
 *
 * Powers `RealMetaAdsClient.updateBudget`: the publisher-agent only
 * holds the *campaign* external id, but Meta keeps daily_budget on the
 * **AdSet** (not the Campaign), so the client first lists the campaign's
 * adsets, picks the first one, then POSTs to that adset id.
 *
 * Real Meta returns an edge-listing envelope:
 *   { data: [{ id, daily_budget, ... }, ...], paging: { cursors: {...} } }
 *
 * We honour the documented `fields` query param by projecting to the
 * requested subset; if `fields` is missing we return id + daily_budget
 * (which is what the publisher-agent asks for in practice).
 *
 * State source: `meta:campaignAdsets:<campaignId>` reverse index written
 * by `adsets.ts` at create time. For each id in the index we look up the
 * full StoredAdSet via `meta:adAccount:<id>` → `meta:adset:<aaId>:<id>`.
 * Orphans (index entries whose adset KV is gone) are silently skipped.
 */
import type { Context } from 'hono';

import type { Env } from '../env';
import { jitter } from '../util/jitter';
import type { StoredAdSet } from './adsets';

const DEFAULT_FIELDS: ReadonlyArray<keyof StoredAdSet> = ['id', 'daily_budget'];
const ALLOWED_FIELDS = new Set<keyof StoredAdSet>([
  'id',
  'account_id',
  'campaign_id',
  'name',
  'daily_budget',
  'billing_event',
  'optimization_goal',
  'targeting',
  'status',
  'created_time',
]);

function project(
  adset: StoredAdSet,
  fields: ReadonlyArray<keyof StoredAdSet>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    out[f] = adset[f];
  }
  return out;
}

export async function listCampaignAdsets(c: Context<{ Bindings: Env }>): Promise<Response> {
  await jitter();

  const campaignId = c.req.param('campaignId');
  if (!campaignId) {
    return c.json(
      { error: { message: 'Missing campaign id', type: 'GraphMethodException', code: 100 } },
      400,
    );
  }

  const fieldsParam = c.req.query('fields');
  const fields: ReadonlyArray<keyof StoredAdSet> = fieldsParam
    ? fieldsParam
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is keyof StoredAdSet => ALLOWED_FIELDS.has(s as keyof StoredAdSet))
    : DEFAULT_FIELDS;

  const effectiveFields = fields.length > 0 ? fields : DEFAULT_FIELDS;

  const indexRaw = await c.env.KV.get(`meta:campaignAdsets:${campaignId}`);
  const adsetIds: string[] = indexRaw ? (JSON.parse(indexRaw) as string[]) : [];

  const rows: Record<string, unknown>[] = [];
  for (const adsetId of adsetIds) {
    const aaId = await c.env.KV.get(`meta:adAccount:${adsetId}`);
    if (!aaId) continue; // orphan — index entry survived a wipe
    const stored = await c.env.KV.get(`meta:adset:${aaId}:${adsetId}`);
    if (!stored) continue;
    rows.push(project(JSON.parse(stored) as StoredAdSet, effectiveFields));
  }

  return c.json({
    data: rows,
    paging: {
      cursors: {
        before: 'MAZDZD',
        after: 'MAZDZD',
      },
    },
  });
}
