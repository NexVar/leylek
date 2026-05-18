/**
 * POST /v17/customers/:cid/campaignBudgets:mutate
 *
 * Accepts the create-budget operation that `RealGoogleAdsClient.createCampaign`
 * sends as step 1. Persists the budget under `gads:budget:<cid>:<id>` so a
 * follow-up `googleAds:search` (budget lookup) can resolve it.
 */
import type { Context } from 'hono';

import type { Env } from '../env';
import { genId } from '../util/ids';
import { jitter } from '../util/jitter';

interface BudgetCreate {
  name?: string;
  amount_micros?: number;
  delivery_method?: string;
}

interface BudgetOperation {
  create?: BudgetCreate;
}

interface BudgetMutateBody {
  operations?: BudgetOperation[];
}

interface BudgetRecord {
  resourceName: string;
  name: string;
  amountMicros: number;
  deliveryMethod: string;
  createdAt: string;
}

export async function campaignBudgetsMutate(c: Context<{ Bindings: Env }>): Promise<Response> {
  await jitter();

  const cid = c.req.param('cid');
  if (!cid) {
    return c.json({ error: 'missing customer id' }, 400);
  }
  let body: BudgetMutateBody;
  try {
    body = (await c.req.json()) as BudgetMutateBody;
  } catch {
    return c.json({ error: 'invalid json body' }, 400);
  }

  const op = body.operations?.[0];
  const create = op?.create;
  if (!body.operations || body.operations.length === 0 || !create || !create.name) {
    return c.json({ error: 'operations[0].create.name is required' }, 400);
  }

  const id = genId();
  const resourceName = `customers/${cid}/campaignBudgets/${id}`;
  const record: BudgetRecord = {
    resourceName,
    name: create.name,
    amountMicros: Number(create.amount_micros ?? 0),
    deliveryMethod: create.delivery_method ?? 'STANDARD',
    createdAt: new Date().toISOString(),
  };

  await c.env.KV.put(`gads:budget:${cid}:${id}`, JSON.stringify(record));

  return c.json({ results: [{ resourceName }] });
}
