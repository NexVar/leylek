/**
 * Ad lifecycle handlers.
 *
 *   POST /v21.0/act_:adAccountId/ads  -> create
 *   POST /v21.0/:adId                 -> status update (delegated here
 *                                         from the shared dispatcher in
 *                                         `index.ts` once it's resolved
 *                                         the id refers to an ad)
 *
 * Meta keeps two parallel status fields on every Ad object:
 *   - `status`           — what the advertiser set
 *   - `effective_status` — what's actually live (could differ if e.g.
 *                          the parent adset is paused, the ad is in
 *                          policy review, etc.)
 * For the mock we keep them in lockstep; the future
 * `RealMetaAdsClient.pauseAd` reads `effective_status` so we surface it.
 *
 * KV layout written by this module:
 *   meta:ad:<aaId>:<id>   -> StoredAd JSON
 *   meta:adType:<id>      -> 'ad'
 *   meta:adAccount:<id>   -> '<aaId>'
 */
import type { Context } from 'hono';
import { z } from 'zod';

import type { Env } from '../env';
import { genMetaId } from '../util/ids';
import { jitter } from '../util/jitter';

const CreativeInline = z.object({
  name: z.string().optional(),
  object_story_spec: z.unknown().optional(),
});

const CreativeRef = z.object({
  creative_id: z.string().min(1),
});

const AdCreate = z.object({
  name: z.string().min(1),
  adset_id: z.string().min(1),
  creative: z.union([CreativeRef, CreativeInline]),
  status: z.enum(['PAUSED', 'ACTIVE']).default('PAUSED'),
});

const AdStatusUpdate = z.object({
  status: z.enum(['PAUSED', 'ACTIVE']),
});

export interface StoredAd {
  id: string;
  account_id: string;
  adset_id: string;
  name: string;
  creative: unknown;
  status: 'PAUSED' | 'ACTIVE';
  effective_status: 'PAUSED' | 'ACTIVE';
  created_time: string;
}

export async function createAd(c: Context<{ Bindings: Env }>, aaId: string): Promise<Response> {
  await jitter();

  let body: z.infer<typeof AdCreate>;
  try {
    body = AdCreate.parse(await c.req.json());
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
  const stored: StoredAd = {
    id,
    account_id: `act_${aaId}`,
    adset_id: body.adset_id,
    name: body.name,
    creative: body.creative,
    status: body.status,
    effective_status: body.status,
    created_time: new Date().toISOString(),
  };

  await Promise.all([
    c.env.KV.put(`meta:ad:${aaId}:${id}`, JSON.stringify(stored)),
    c.env.KV.put(`meta:adType:${id}`, 'ad'),
    c.env.KV.put(`meta:adAccount:${id}`, aaId),
  ]);

  return c.json({ id });
}

/**
 * Dispatched by `index.ts` once it has confirmed the id refers to an
 * ad (via `meta:adType:<id>`) and that the id's ad account is known
 * (via `meta:adAccount:<id>`).
 *
 * Idempotent: pausing an already-paused ad is a no-op success.
 */
export async function updateAdStatus(
  c: Context<{ Bindings: Env }>,
  adId: string,
  aaId: string,
  body: unknown,
): Promise<Response> {
  let parsed: z.infer<typeof AdStatusUpdate>;
  try {
    parsed = AdStatusUpdate.parse(body);
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

  const key = `meta:ad:${aaId}:${adId}`;
  const raw = await c.env.KV.get(key);
  if (!raw) {
    return c.json(
      {
        error: { message: `Unknown ad id ${adId}`, type: 'GraphMethodException', code: 100 },
      },
      404,
    );
  }
  const stored = JSON.parse(raw) as StoredAd;
  stored.status = parsed.status;
  stored.effective_status = parsed.status;
  await c.env.KV.put(key, JSON.stringify(stored));
  return c.json({ success: true });
}
