/**
 * RealMetaAdsClient — production `AdPlatformClient` against the
 * Meta Marketing API v21.0.
 *
 * Designed so the `baseUrl` config is injectable: sandbox tests point
 * it at `leylek-meta-ads-mock.workers.dev`, production points it at
 * `https://graph.facebook.com`. The wire format is identical either way.
 *
 * Meta's data model differs from Google's in two ways that this client
 * papers over so the rest of Leylek can keep thinking in
 * "campaign with a daily budget":
 *   1. Meta has no campaign-level daily budget; budgets live on AdSets.
 *      `createCampaign` therefore creates a Campaign **and** a default
 *      AdSet under it, returning only the Campaign id. `updateBudget`
 *      walks the campaign->adsets edge to find the AdSet to patch.
 *   2. Meta requires an `image_hash` reference for image creatives;
 *      Leylek doesn't actually upload images (Faz-3 scope), so we
 *      synthesise a deterministic SHA-256 of the `imagePrompt` string.
 *      The mock accepts any opaque string; real Meta would reject this
 *      until we ship image upload (PRD §17).
 *
 * Errors are normalised to `AdPlatformError`. Non-2xx => 'META_4XX' /
 * 'META_5XX' with `retryable` set for 5xx. Domain-level edge cases get
 * dedicated codes (`META_ADSET_NOT_FOUND`, `META_BUDGET_NO_ADSET`).
 */

import {
  type AdPlatformClient,
  AdPlatformError,
  type CreateAdInput,
  type CreateCampaignInput,
  type MetricWindow,
} from '@leylek/shared-types';

export interface RealMetaAdsConfig {
  /**
   * Meta Marketing API root. Sandbox: leylek-meta-ads-mock.workers.dev,
   * prod: https://graph.facebook.com. Trailing slash optional.
   */
  baseUrl: string;
  /** Long-lived user access token (60 days) — decrypted from connected_accounts. */
  accessToken: string;
  /** Ad account ID **without** the `act_` prefix. The client adds it. */
  adAccountId: string;
  /** API version. Default 'v21.0'. */
  apiVersion?: string;
  /**
   * App credentials, used only for OAuth token refresh. Optional today
   * because long-lived tokens are valid 60 days and the publisher-agent
   * runs much shorter than that; surface as optional so missing
   * credentials don't fail every action — only `refreshAccessToken`.
   */
  clientId?: string;
  clientSecret?: string;
}

const DEFAULT_API_VERSION = 'v21.0';
const CONVERSION_ACTION_TYPES = new Set([
  'offsite_conversion',
  'omni_purchase',
  'purchase',
  'lead',
]);

interface MetaInsightAction {
  action_type: string;
  value: string;
}

interface MetaInsightRow {
  impressions?: string;
  clicks?: string;
  spend?: string;
  actions?: MetaInsightAction[];
  date_start?: string;
  date_stop?: string;
}

interface MetaEdgeEnvelope<T> {
  data: T[];
  paging?: unknown;
}

export class RealMetaAdsClient implements AdPlatformClient {
  readonly runtime = 'real' as const;

  constructor(private readonly cfg: RealMetaAdsConfig) {}

  async createCampaign(input: CreateCampaignInput): Promise<{ externalId: string }> {
    // Step 1: create the Meta Campaign (no budget at this level).
    const campResp = await this.metaFetch<{ id: string }>(
      `/act_${this.cfg.adAccountId}/campaigns`,
      'POST',
      {
        name: input.name,
        objective: 'OUTCOME_TRAFFIC',
        status: 'PAUSED',
        special_ad_categories: '[]',
      },
    );
    if (!campResp.id) {
      throw new AdPlatformError(
        'META_CAMPAIGN_CREATE_FAILED',
        'campaign create returned no id',
        {},
      );
    }

    // Step 2: create a default AdSet to host the actual budget. Internal
    // Leylek code only ever knows the Campaign id; `updateBudget` walks
    // the campaign->adsets edge to find this AdSet later.
    const adsetResp = await this.metaFetch<{ id: string }>(
      `/act_${this.cfg.adAccountId}/adsets`,
      'POST',
      {
        name: `${input.name} default adset`,
        campaign_id: campResp.id,
        daily_budget: input.dailyBudgetKurus,
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'LINK_CLICKS',
        targeting: { geo_locations: { countries: ['TR'] } },
        status: 'PAUSED',
      },
    );
    if (!adsetResp.id) {
      throw new AdPlatformError(
        'META_ADSET_CREATE_FAILED',
        'default adset create returned no id',
        {},
      );
    }

    return { externalId: campResp.id };
  }

  async createAd(input: CreateAdInput): Promise<{ externalId: string }> {
    // Resolve the AdSet under the Campaign. createCampaign always made
    // exactly one; we take data[0].
    const adsetList = await this.metaFetch<MetaEdgeEnvelope<{ id: string }>>(
      `/${input.campaignExternalId}/adsets`,
      'GET',
      undefined,
      { fields: 'id,daily_budget' },
    );
    const adsetId = adsetList.data?.[0]?.id;
    if (!adsetId) {
      throw new AdPlatformError(
        'META_ADSET_NOT_FOUND',
        `no adset found under campaign ${input.campaignExternalId}`,
        {},
      );
    }

    const imageHash = await this.sha256Hex(input.imagePrompt);

    const adResp = await this.metaFetch<{ id: string }>(
      `/act_${this.cfg.adAccountId}/ads`,
      'POST',
      {
        name: `${input.strategyType} variant`,
        adset_id: adsetId,
        creative: {
          name: `${input.strategyType} creative`,
          object_story_spec: {
            page_id: 'leylek-placeholder',
            link_data: {
              message: input.adText,
              link: 'https://leylek.nexvar.io',
              image_hash: imageHash,
            },
          },
        },
        status: 'ACTIVE',
      },
    );
    if (!adResp.id) {
      throw new AdPlatformError('META_AD_CREATE_FAILED', 'ad create returned no id', {});
    }
    return { externalId: adResp.id };
  }

  async pauseAd(externalAdId: string, _reason: string): Promise<void> {
    // Meta tolerates redundant status updates; no pre-read needed.
    await this.metaFetch(`/${externalAdId}`, 'POST', { status: 'PAUSED' });
  }

  async resumeAd(externalAdId: string): Promise<void> {
    await this.metaFetch(`/${externalAdId}`, 'POST', { status: 'ACTIVE' });
  }

  async updateBudget(externalCampaignId: string, newBudgetKurus: number): Promise<void> {
    const adsetList = await this.metaFetch<MetaEdgeEnvelope<{ id: string }>>(
      `/${externalCampaignId}/adsets`,
      'GET',
      undefined,
      { fields: 'id,daily_budget' },
    );
    const adsetId = adsetList.data?.[0]?.id;
    if (!adsetId) {
      throw new AdPlatformError(
        'META_BUDGET_NO_ADSET',
        `no adset under campaign ${externalCampaignId} to update budget on`,
        {},
      );
    }
    await this.metaFetch(`/${adsetId}`, 'POST', { daily_budget: newBudgetKurus });
  }

  async fetchMetrics(externalAdId: string, windowHours: number): Promise<MetricWindow> {
    const datePreset = pickDatePreset(windowHours);
    const resp = await this.metaFetch<MetaEdgeEnvelope<MetaInsightRow>>(
      `/${externalAdId}/insights`,
      'GET',
      undefined,
      { date_preset: datePreset, fields: 'impressions,clicks,spend,actions' },
    );

    const row = resp.data?.[0];
    if (!row) {
      // No insight rows yet — return a zeroed window matching the request.
      const now = new Date();
      const start = new Date(now.getTime() - windowHours * 3_600_000);
      return {
        externalAdId,
        windowStart: start.toISOString(),
        windowEnd: now.toISOString(),
        impressions: 0,
        clicks: 0,
        conversions: 0,
        spendKurus: 0,
      };
    }

    const impressions = parseIntSafe(row.impressions);
    const clicks = parseIntSafe(row.clicks);
    const spendKurus = parseSpendToKurus(row.spend);
    const conversions = sumConversions(row.actions);

    const dateStart = row.date_start ?? new Date().toISOString().slice(0, 10);
    const dateStop = row.date_stop ?? new Date().toISOString().slice(0, 10);

    return {
      externalAdId,
      windowStart: `${dateStart}T00:00:00Z`,
      windowEnd: `${dateStop}T23:59:59Z`,
      impressions,
      clicks,
      conversions,
      spendKurus,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------
  private async metaFetch<T>(
    path: string,
    method: 'GET' | 'POST',
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<T> {
    const version = this.cfg.apiVersion ?? DEFAULT_API_VERSION;
    const root = this.cfg.baseUrl.replace(/\/$/, '');
    const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
    const url = `${root}/${version}${path}${qs}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.accessToken}`,
    };
    let requestBody: string | undefined;
    if (method === 'POST') {
      headers['content-type'] = 'application/json';
      requestBody = JSON.stringify(body ?? {});
    }

    const resp = await fetch(url, {
      method,
      headers,
      body: requestBody,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new AdPlatformError(
        resp.status >= 500 ? 'META_5XX' : 'META_4XX',
        `${resp.status} ${resp.statusText}: ${text.slice(0, 240)}`,
        { retryable: resp.status >= 500 },
      );
    }
    return (await resp.json()) as T;
  }

  private async sha256Hex(s: string): Promise<string> {
    const buf = new TextEncoder().encode(s);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const bytes = new Uint8Array(digest);
    let hex = '';
    for (const b of bytes) {
      hex += b.toString(16).padStart(2, '0');
    }
    return hex;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — kept module-private (not on the class) since they don't
// need `this`. Easier to reason about than methods that look like they
// could touch state but don't.
// ---------------------------------------------------------------------------

function pickDatePreset(windowHours: number): string {
  if (windowHours <= 24) return 'today';
  if (windowHours <= 48) return 'yesterday';
  if (windowHours <= 72) return 'last_3_days';
  if (windowHours <= 168) return 'last_7_days';
  return 'last_30_days';
}

function parseIntSafe(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function parseSpendToKurus(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function sumConversions(actions: MetaInsightAction[] | undefined): number {
  if (!actions || actions.length === 0) return 0;
  let total = 0;
  for (const a of actions) {
    if (CONVERSION_ACTION_TYPES.has(a.action_type)) {
      const v = Number(a.value);
      if (Number.isFinite(v)) {
        total += Math.trunc(v);
      }
    }
  }
  return total;
}
