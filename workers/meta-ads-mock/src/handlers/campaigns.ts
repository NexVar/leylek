/**
 * POST /v21.0/act_:adAccountId/campaigns — Meta campaign create.
 *
 * Body shape:
 *   {
 *     name: string,
 *     objective: 'OUTCOME_TRAFFIC' | 'OUTCOME_SALES' | ...,
 *     status: 'PAUSED' | 'ACTIVE',
 *     special_ad_categories: '[]' | string[]
 *   }
 *
 * Meta has a long-standing API quirk: `special_ad_categories` may arrive
 * as either a JSON-encoded string (`'[]'`, `'["HOUSING"]'`) or as an
 * actual array. We accept both and normalise to an array in storage.
 *
 * Response: `{ id: '<numeric-string>' }` — Meta returns plain `{id}`
 * for creates, NOT a `{data: [...]}` envelope.
 *
 * Side effects (KV):
 *   - `meta:campaign:<aaId>:<id>` -> full Campaign JSON
 *   - `meta:adType:<id>` -> 'campaign' (lets the `POST /v21.0/:id`
 *     dispatcher figure out what kind of object an id refers to)
 *   - `meta:adAccount:<id>` -> '<aaId>' (reverse index so handlers that
 *     receive just an id can find the account it lives under)
 */
import type { Context } from 'hono';
import { z } from 'zod';

import type { Env } from '../env';
import { genMetaId } from '../util/ids';
import { jitter } from '../util/jitter';

const SpecialAdCategories = z.union([
  z.string(), // typically the literal '[]' or a JSON-encoded array
  z.array(z.string()),
]);

const CampaignCreate = z.object({
  name: z.string().min(1),
  objective: z.string().min(1),
  status: z.enum(['PAUSED', 'ACTIVE']).default('PAUSED'),
  special_ad_categories: SpecialAdCategories.optional(),
});

interface StoredCampaign {
  id: string;
  account_id: string;
  name: string;
  objective: string;
  status: 'PAUSED' | 'ACTIVE';
  special_ad_categories: string[];
  created_time: string;
}

function normaliseCategories(raw: string | string[] | undefined): string[] {
  if (raw === undefined) return [];
  if (Array.isArray(raw)) return raw;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '[]') return [];
  // Best-effort JSON parse — Meta SDKs serialize as JSON for this field.
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed.map((v) => String(v));
  } catch {
    // fall through
  }
  // Single-value fallback (e.g. "HOUSING")
  return [trimmed];
}

export async function createCampaign(
  c: Context<{ Bindings: Env }>,
  aaId: string,
): Promise<Response> {
  await jitter();

  let body: z.infer<typeof CampaignCreate>;
  try {
    body = CampaignCreate.parse(await c.req.json());
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
  const stored: StoredCampaign = {
    id,
    account_id: `act_${aaId}`,
    name: body.name,
    objective: body.objective,
    status: body.status,
    special_ad_categories: normaliseCategories(body.special_ad_categories),
    created_time: new Date().toISOString(),
  };

  await Promise.all([
    c.env.KV.put(`meta:campaign:${aaId}:${id}`, JSON.stringify(stored)),
    c.env.KV.put(`meta:adType:${id}`, 'campaign'),
    c.env.KV.put(`meta:adAccount:${id}`, aaId),
  ]);

  return c.json({ id });
}
