/**
 * POST /v17/customers/:cid/adGroupAds:mutate
 *
 * Two shapes — create and status update — keyed off whether the first
 * operation carries `create` or `update`. The real Google API allows
 * mixed batches; the client only ever sends one op per request, and the
 * mock matches that.
 *
 * Resource name leaf is `<adGroupId>~<adId>` (Google's tilde join). The
 * client extracts the trailing segment with `split('~').pop()` so the
 * mock's adId becomes the `externalId` it carries around in D1.
 */
import type { Context } from 'hono';

import type { Env } from '../env';
import { genId } from '../util/ids';
import { jitter } from '../util/jitter';

interface AdCreative {
  final_urls?: string[];
  responsive_search_ad?: {
    headlines?: Array<{ text: string }>;
    descriptions?: Array<{ text: string }>;
  };
}

interface AdGroupAdCreate {
  ad_group?: string;
  status?: string;
  ad?: AdCreative;
}

interface AdGroupAdUpdate {
  resource_name?: string;
  status?: 'ENABLED' | 'PAUSED' | string;
}

interface AdGroupAdOperation {
  create?: AdGroupAdCreate;
  update?: AdGroupAdUpdate;
  update_mask?: string;
}

interface AdGroupAdMutateBody {
  operations?: AdGroupAdOperation[];
}

interface AdGroupAdRecord {
  resourceName: string;
  adGroup: string;
  status: string;
  ad: AdCreative;
  createdAt: string;
  updatedAt?: string;
}

export async function adGroupAdsMutate(c: Context<{ Bindings: Env }>): Promise<Response> {
  await jitter();

  const cid = c.req.param('cid');
  if (!cid) {
    return c.json({ error: 'missing customer id' }, 400);
  }
  let body: AdGroupAdMutateBody;
  try {
    body = (await c.req.json()) as AdGroupAdMutateBody;
  } catch {
    return c.json({ error: 'invalid json body' }, 400);
  }

  const op = body.operations?.[0];
  if (!body.operations || body.operations.length === 0 || !op) {
    return c.json({ error: 'operations[0] is required' }, 400);
  }

  if (op.create) {
    return handleCreate(c, cid, op.create);
  }
  if (op.update) {
    return handleUpdate(c, cid, op.update);
  }
  return c.json({ error: 'operations[0] must carry `create` or `update`' }, 400);
}

async function handleCreate(
  c: Context<{ Bindings: Env }>,
  cid: string,
  create: AdGroupAdCreate,
): Promise<Response> {
  if (!create.ad_group) {
    return c.json({ error: 'create.ad_group is required' }, 400);
  }

  // The leaf is `<adGroupId>~<adId>`. Extract the adGroupId from the
  // `customers/<cid>/adGroups/<id>` resource so analytics' future ad-id
  // lookup can map back to the right ad group key.
  const adGroupId = create.ad_group.split('/').pop() ?? genId();
  const adId = genId();
  const leaf = `${adGroupId}~${adId}`;
  const resourceName = `customers/${cid}/adGroupAds/${leaf}`;

  const record: AdGroupAdRecord = {
    resourceName,
    adGroup: create.ad_group,
    status: create.status ?? 'ENABLED',
    ad: create.ad ?? {},
    createdAt: new Date().toISOString(),
  };

  await c.env.KV.put(`gads:ad:${cid}:${leaf}`, JSON.stringify(record));

  return c.json({ results: [{ resourceName }] });
}

async function handleUpdate(
  c: Context<{ Bindings: Env }>,
  cid: string,
  update: AdGroupAdUpdate,
): Promise<Response> {
  if (!update.resource_name) {
    return c.json({ error: 'update.resource_name is required' }, 400);
  }

  const leaf = update.resource_name.split('/').pop() ?? '';
  if (!leaf.includes('~')) {
    return c.json({ error: 'update.resource_name must end with <adGroupId>~<adId>' }, 400);
  }

  const key = `gads:ad:${cid}:${leaf}`;
  const raw = await c.env.KV.get(key);
  if (!raw) {
    return c.json({ error: `ad ${leaf} not found` }, 404);
  }
  const existing = JSON.parse(raw) as AdGroupAdRecord;

  const next: AdGroupAdRecord = {
    ...existing,
    status: update.status ?? existing.status,
    updatedAt: new Date().toISOString(),
  };
  await c.env.KV.put(key, JSON.stringify(next));

  return c.json({ results: [{ resourceName: update.resource_name }] });
}
