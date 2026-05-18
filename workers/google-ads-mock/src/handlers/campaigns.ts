/**
 * POST /v17/customers/:cid/campaigns:mutate
 *
 * Only the `create` op is implemented — `RealGoogleAdsClient` doesn't
 * issue campaign-level updates today. The persisted record carries the
 * budget resource name verbatim so the budget-lookup GAQL query can
 * resolve it without a second hop.
 */
import type { Context } from 'hono';

import type { Env } from '../env';
import { genId } from '../util/ids';
import { jitter } from '../util/jitter';

interface CampaignNetworkSettings {
  target_google_search?: boolean;
  target_search_network?: boolean;
  target_content_network?: boolean;
}

interface CampaignCreate {
  name?: string;
  status?: 'PAUSED' | 'ENABLED' | string;
  advertising_channel_type?: string;
  campaign_budget?: string;
  network_settings?: CampaignNetworkSettings;
}

interface CampaignOperation {
  create?: CampaignCreate;
}

interface CampaignMutateBody {
  operations?: CampaignOperation[];
}

interface CampaignRecord {
  resourceName: string;
  name: string;
  status: string;
  campaignBudget: string;
  advertisingChannelType: string;
  networkSettings: CampaignNetworkSettings | null;
  createdAt: string;
}

export async function campaignsMutate(c: Context<{ Bindings: Env }>): Promise<Response> {
  await jitter();

  const cid = c.req.param('cid');
  if (!cid) {
    return c.json({ error: 'missing customer id' }, 400);
  }
  let body: CampaignMutateBody;
  try {
    body = (await c.req.json()) as CampaignMutateBody;
  } catch {
    return c.json({ error: 'invalid json body' }, 400);
  }

  const op = body.operations?.[0];
  const create = op?.create;
  if (!body.operations || body.operations.length === 0 || !create || !create.name) {
    return c.json({ error: 'operations[0].create.name is required' }, 400);
  }

  const id = genId();
  const resourceName = `customers/${cid}/campaigns/${id}`;
  const record: CampaignRecord = {
    resourceName,
    name: create.name,
    status: create.status ?? 'PAUSED',
    campaignBudget: create.campaign_budget ?? '',
    advertisingChannelType: create.advertising_channel_type ?? 'SEARCH',
    networkSettings: create.network_settings ?? null,
    createdAt: new Date().toISOString(),
  };

  await c.env.KV.put(`gads:campaign:${cid}:${id}`, JSON.stringify(record));

  return c.json({ results: [{ resourceName }] });
}
