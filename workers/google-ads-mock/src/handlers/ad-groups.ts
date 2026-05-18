/**
 * POST /v17/customers/:cid/adGroups:mutate
 *
 * Create-only path: `RealGoogleAdsClient.createAd` spins up a fresh ad
 * group per strategy variant before attaching the responsive search ad,
 * so the mock only needs to cover create.
 */
import type { Context } from 'hono';

import type { Env } from '../env';
import { genId } from '../util/ids';
import { jitter } from '../util/jitter';

interface AdGroupCreate {
  name?: string;
  campaign?: string;
  status?: string;
  type?: string;
  cpc_bid_micros?: number;
}

interface AdGroupOperation {
  create?: AdGroupCreate;
}

interface AdGroupMutateBody {
  operations?: AdGroupOperation[];
}

interface AdGroupRecord {
  resourceName: string;
  name: string;
  campaign: string;
  status: string;
  type: string;
  cpcBidMicros: number;
  createdAt: string;
}

export async function adGroupsMutate(c: Context<{ Bindings: Env }>): Promise<Response> {
  await jitter();

  const cid = c.req.param('cid');
  if (!cid) {
    return c.json({ error: 'missing customer id' }, 400);
  }
  let body: AdGroupMutateBody;
  try {
    body = (await c.req.json()) as AdGroupMutateBody;
  } catch {
    return c.json({ error: 'invalid json body' }, 400);
  }

  const op = body.operations?.[0];
  const create = op?.create;
  if (!body.operations || body.operations.length === 0 || !create || !create.name) {
    return c.json({ error: 'operations[0].create.name is required' }, 400);
  }

  const id = genId();
  const resourceName = `customers/${cid}/adGroups/${id}`;
  const record: AdGroupRecord = {
    resourceName,
    name: create.name,
    campaign: create.campaign ?? '',
    status: create.status ?? 'ENABLED',
    type: create.type ?? 'SEARCH_STANDARD',
    cpcBidMicros: Number(create.cpc_bid_micros ?? 0),
    createdAt: new Date().toISOString(),
  };

  await c.env.KV.put(`gads:adGroup:${cid}:${id}`, JSON.stringify(record));

  return c.json({ results: [{ resourceName }] });
}
