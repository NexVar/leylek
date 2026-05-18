/**
 * POST /v17/customers/:cid/googleAds:search
 *
 * GAQL endpoint — parses the two query shapes `RealGoogleAdsClient` issues:
 *
 *   1. Budget lookup: `SELECT campaign.campaign_budget FROM campaign
 *      WHERE campaign.id = <id>` → returns the campaign's stored budget
 *      resource name. 404 if the campaign isn't in KV.
 *
 *   2. Metrics fetch: `SELECT metrics.impressions, metrics.clicks,
 *      metrics.conversions, metrics.cost_micros FROM ad_group_ad
 *      WHERE ad_group_ad.ad.id = <id> AND segments.date BETWEEN ...` →
 *      returns the seeded metrics row if present, all-zeros otherwise.
 *      The real Google API returns metric values as strings (`'1000'`,
 *      not `1000`); the client does `Number(m.impressions)` so the mock
 *      must keep them as strings or the client's parse path is bypassed.
 *
 * Anything else → 400 `unsupported GAQL`.
 *
 * Metrics-key lookup quirk: the client and the seed script will both
 * use the bare `<adId>` (the tail after `~`) when writing metrics, so
 * the search key is `gads:metrics:<cid>:<adId>`. If the seed writes
 * under a different shape (e.g. `<adGroupId>~<adId>`) we fall back to
 * a prefix list to find a match — see `loadMetrics` below.
 */
import type { Context } from 'hono';

import type { Env } from '../env';
import { parseGaql } from '../gaql';
import { jitter } from '../util/jitter';

interface SearchBody {
  query?: string;
}

interface CampaignRecord {
  resourceName: string;
  campaignBudget: string;
}

interface MetricsRecord {
  impressions?: number | string;
  clicks?: number | string;
  conversions?: number | string;
  costMicros?: number | string;
  // Tolerate snake_case too in case the seed writes Google's wire form.
  cost_micros?: number | string;
}

export async function googleAdsSearch(c: Context<{ Bindings: Env }>): Promise<Response> {
  await jitter();

  const cid = c.req.param('cid');
  if (!cid) {
    return c.json({ error: 'missing customer id' }, 400);
  }
  let body: SearchBody;
  try {
    body = (await c.req.json()) as SearchBody;
  } catch {
    return c.json({ error: 'invalid json body' }, 400);
  }
  if (!body.query) {
    return c.json({ error: 'query is required' }, 400);
  }

  const parsed = parseGaql(body.query);

  if (parsed.kind === 'budget') {
    const raw = await findCampaignByShortId(c.env.KV, cid, parsed.campaignId);
    if (!raw) {
      return c.json({ error: 'campaign not found', campaignId: parsed.campaignId }, 404);
    }
    const camp = JSON.parse(raw) as CampaignRecord;
    return c.json({
      results: [{ campaign: { campaignBudget: camp.campaignBudget } }],
    });
  }

  if (parsed.kind === 'metrics') {
    const metrics = await loadMetrics(c.env.KV, cid, parsed.adId);
    return c.json({ results: [{ metrics }] });
  }

  return c.json({ error: 'unsupported GAQL', query: body.query }, 400);
}

/**
 * The client passes whatever it stored as the campaign's `externalId`,
 * which today is the tail of the resource name (a 16-char hex string).
 * We treat that as the lookup id; the GAQL syntax `WHERE campaign.id = <num>`
 * is regex-validated as `\d+` so a hex id won't match — but the same
 * upstream code path is exercised. If the upstream eventually swaps to
 * a numeric mock id, the prefix scan still finds it.
 */
async function findCampaignByShortId(
  kv: KVNamespace,
  cid: string,
  shortId: string,
): Promise<string | null> {
  // First try the direct key — works when `shortId` is the full hex tail.
  const direct = await kv.get(`gads:campaign:${cid}:${shortId}`);
  if (direct) return direct;

  // Fallback: scan campaign keys under this customer and match by suffix.
  // KV `list` with prefix is fine for our demo cardinality (handful of
  // campaigns); in production we never reach this branch anyway.
  const listing = await kv.list({ prefix: `gads:campaign:${cid}:` });
  for (const k of listing.keys) {
    if (k.name.endsWith(`:${shortId}`)) {
      return kv.get(k.name);
    }
  }
  return null;
}

async function loadMetrics(
  kv: KVNamespace,
  cid: string,
  adId: string,
): Promise<{
  impressions: string;
  clicks: string;
  conversions: string;
  costMicros: string;
}> {
  const raw = await readMetricsRaw(kv, cid, adId);
  if (!raw) {
    return zeroMetrics();
  }

  let parsed: MetricsRecord;
  try {
    parsed = JSON.parse(raw) as MetricsRecord;
  } catch {
    return zeroMetrics();
  }

  return {
    impressions: stringifyMetric(parsed.impressions),
    clicks: stringifyMetric(parsed.clicks),
    conversions: stringifyMetric(parsed.conversions),
    costMicros: stringifyMetric(parsed.costMicros ?? parsed.cost_micros),
  };
}

async function readMetricsRaw(kv: KVNamespace, cid: string, adId: string): Promise<string | null> {
  // Primary key: `gads:metrics:<cid>:<adId>` (spec).
  const direct = await kv.get(`gads:metrics:${cid}:${adId}`);
  if (direct) return direct;

  // Tolerate seeds that key by the full `<adGroupId>~<adId>` leaf —
  // suffix match is cheap at demo scale.
  const listing = await kv.list({ prefix: `gads:metrics:${cid}:` });
  for (const k of listing.keys) {
    if (k.name.endsWith(`~${adId}`)) {
      const value = await kv.get(k.name);
      if (value) return value;
    }
  }
  return null;
}

function stringifyMetric(value: number | string | undefined): string {
  if (value === undefined || value === null) return '0';
  return String(value);
}

function zeroMetrics(): {
  impressions: string;
  clicks: string;
  conversions: string;
  costMicros: string;
} {
  return { impressions: '0', clicks: '0', conversions: '0', costMicros: '0' };
}
