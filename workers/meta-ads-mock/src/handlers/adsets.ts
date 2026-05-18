/**
 * AdSet lifecycle handlers.
 *
 *   POST /v21.0/act_:adAccountId/adsets   -> create
 *   POST /v21.0/:adsetId                  -> budget update (delegated here
 *                                            from the shared dispatcher in
 *                                            `index.ts` once it's resolved
 *                                            the id refers to an adset)
 *
 * KV layout written by this module:
 *   meta:adset:<aaId>:<id>            -> StoredAdSet JSON
 *   meta:campaignAdsets:<campaignId>  -> JSON string[] of adset ids
 *                                        (used by the adset-lookup endpoint
 *                                        so `RealMetaAdsClient.updateBudget`
 *                                        can locate the adset under a
 *                                        campaign without scanning)
 *   meta:adType:<id>                  -> 'adset'
 *   meta:adAccount:<id>               -> '<aaId>'
 */
import type { Context } from 'hono';
import { z } from 'zod';

import type { Env } from '../env';
import { genMetaId } from '../util/ids';
import { jitter } from '../util/jitter';

const AdSetCreate = z.object({
  name: z.string().min(1),
  campaign_id: z.string().min(1),
  // Meta sends daily_budget either as a number or as a string of digits
  // depending on the SDK; accept both and coerce to number internally.
  daily_budget: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]),
  billing_event: z.string().optional(),
  optimization_goal: z.string().optional(),
  targeting: z.unknown().optional(),
  status: z.enum(['PAUSED', 'ACTIVE']).default('PAUSED'),
});

const AdSetBudgetUpdate = z.object({
  daily_budget: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]),
});

export interface StoredAdSet {
  id: string;
  account_id: string;
  campaign_id: string;
  name: string;
  daily_budget: number;
  billing_event: string;
  optimization_goal: string;
  targeting: unknown;
  status: 'PAUSED' | 'ACTIVE';
  created_time: string;
}

function toNumericBudget(raw: number | string): number {
  return typeof raw === 'number' ? raw : Number.parseInt(raw, 10);
}

export async function createAdSet(c: Context<{ Bindings: Env }>, aaId: string): Promise<Response> {
  await jitter();

  let body: z.infer<typeof AdSetCreate>;
  try {
    body = AdSetCreate.parse(await c.req.json());
  } catch (err) {
    return c.json(
      {
        error: {
          message: err instanceof Error ? err.message : 'Invalid request body',
          type: 'GraphMethodException',
          code: 100,
        },
      },
      400,
    );
  }

  const id = genMetaId();
  const stored: StoredAdSet = {
    id,
    account_id: `act_${aaId}`,
    campaign_id: body.campaign_id,
    name: body.name,
    daily_budget: toNumericBudget(body.daily_budget),
    billing_event: body.billing_event ?? 'IMPRESSIONS',
    optimization_goal: body.optimization_goal ?? 'LINK_CLICKS',
    targeting: body.targeting ?? {},
    status: body.status,
    created_time: new Date().toISOString(),
  };

  // Append to the campaign->adsets reverse index. Reading the existing
  // value, mutating, and writing back is a tiny race window but fine for
  // demo-scale traffic: there's no concurrent adset create per campaign
  // in the happy path (the publisher-agent serialises them).
  const indexKey = `meta:campaignAdsets:${body.campaign_id}`;
  const existingRaw = await c.env.KV.get(indexKey);
  const existing: string[] = existingRaw ? (JSON.parse(existingRaw) as string[]) : [];
  existing.push(id);

  await Promise.all([
    c.env.KV.put(`meta:adset:${aaId}:${id}`, JSON.stringify(stored)),
    c.env.KV.put(`meta:adType:${id}`, 'adset'),
    c.env.KV.put(`meta:adAccount:${id}`, aaId),
    c.env.KV.put(indexKey, JSON.stringify(existing)),
  ]);

  return c.json({ id });
}

/**
 * Dispatched by `index.ts` once it has confirmed the id refers to an
 * adset (via `meta:adType:<id>`) and that the id's ad account is
 * known (via `meta:adAccount:<id>`).
 */
export async function updateAdSetBudget(
  c: Context<{ Bindings: Env }>,
  adsetId: string,
  aaId: string,
  body: unknown,
): Promise<Response> {
  let parsed: z.infer<typeof AdSetBudgetUpdate>;
  try {
    parsed = AdSetBudgetUpdate.parse(body);
  } catch (err) {
    return c.json(
      {
        error: {
          message: err instanceof Error ? err.message : 'Invalid request body',
          type: 'GraphMethodException',
          code: 100,
        },
      },
      400,
    );
  }

  const key = `meta:adset:${aaId}:${adsetId}`;
  const raw = await c.env.KV.get(key);
  if (!raw) {
    return c.json(
      {
        error: {
          message: `Unknown adset id ${adsetId}`,
          type: 'GraphMethodException',
          code: 100,
        },
      },
      404,
    );
  }
  const stored = JSON.parse(raw) as StoredAdSet;
  stored.daily_budget = toNumericBudget(parsed.daily_budget);
  await c.env.KV.put(key, JSON.stringify(stored));
  return c.json({ success: true });
}
