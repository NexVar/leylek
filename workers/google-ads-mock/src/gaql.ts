/**
 * Minimal GAQL parser — recognises the two query shapes that
 * `RealGoogleAdsClient` issues:
 *
 *   1. Budget lookup
 *      `SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = <id>`
 *
 *   2. Metrics fetch
 *      `SELECT metrics.impressions, metrics.clicks, metrics.conversions,
 *              metrics.cost_micros
 *         FROM ad_group_ad
 *        WHERE ad_group_ad.ad.id = <id>
 *          AND segments.date BETWEEN '<d1>' AND '<d2>'`
 *
 * Anything else returns `kind: 'unsupported'` and the handler 400s.
 * This is intentional — the mock only needs to mirror what the real
 * client sends today; if the client grows new query shapes, this
 * parser grows with it.
 */
export interface BudgetLookup {
  kind: 'budget';
  campaignId: string;
}

export interface MetricsFetch {
  kind: 'metrics';
  adId: string;
  dateFrom: string;
  dateTo: string;
}

export interface UnsupportedGaql {
  kind: 'unsupported';
}

export type ParsedGaql = BudgetLookup | MetricsFetch | UnsupportedGaql;

const BUDGET_RE =
  /SELECT\s+campaign\.campaign_budget\s+FROM\s+campaign\s+WHERE\s+campaign\.id\s*=\s*(\d+)/i;

const METRICS_RE =
  /FROM\s+ad_group_ad\s+WHERE\s+ad_group_ad\.ad\.id\s*=\s*(\d+)\s+AND\s+segments\.date\s+BETWEEN\s+'([^']+)'\s+AND\s+'([^']+)'/i;

export function parseGaql(query: string): ParsedGaql {
  const normalized = query.replace(/\s+/g, ' ').trim();

  const budgetMatch = normalized.match(BUDGET_RE);
  if (budgetMatch?.[1]) {
    return { kind: 'budget', campaignId: budgetMatch[1] };
  }

  const metricsMatch = normalized.match(METRICS_RE);
  if (metricsMatch?.[1] && metricsMatch[2] && metricsMatch[3]) {
    return {
      kind: 'metrics',
      adId: metricsMatch[1],
      dateFrom: metricsMatch[2],
      dateTo: metricsMatch[3],
    };
  }

  return { kind: 'unsupported' };
}
