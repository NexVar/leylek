/**
 * RealGoogleAdsClient — production `AdPlatformClient` against the
 * Google Ads REST API. **Ships in repo per PRD §10.**
 *
 * Activation: set `GOOGLE_ADS_BASE_URL` + `GOOGLE_ADS_OAUTH_URL` on the
 * publisher-agent + analytics-worker (mock Worker in sandbox, real Google
 * endpoints in prod), plus provide:
 *   - `GOOGLE_ADS_DEVELOPER_TOKEN`
 *   - `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (10-digit MCC ID, no dashes)
 *   - `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`
 *   - per-user refresh token (decrypted from `connected_accounts`)
 *
 * The constructor takes the runtime essentials; per-call methods accept
 * the encrypted refresh token + customer ID belonging to the action's
 * owning user (decryption is done by the publisher-agent route handler
 * before delegating to this client).
 *
 * Endpoints used (Google Ads API v17, REST surface):
 *   POST https://googleads.googleapis.com/v17/customers/{cid}:mutate
 *   POST https://googleads.googleapis.com/v17/customers/{cid}/googleAds:search
 *
 * Auth flow per request:
 *   1. POST oauth2.googleapis.com/token with refresh_token grant
 *   2. Use returned access_token in Authorization header
 *   3. Include developer-token + login-customer-id headers
 *
 * Errors are normalised to `AdPlatformError`. Network / 5xx => retryable.
 */

import {
  type AdPlatformClient,
  AdPlatformError,
  type CreateAdInput,
  type CreateCampaignInput,
  type MetricWindow,
} from '@leylek/shared-types';

export interface RealGoogleAdsConfig {
  developerToken: string;
  loginCustomerId: string;
  customerId: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  apiVersion?: string;
  /**
   * Ads REST root. Defaults to the production Google URL; mockdata.md Faz 1
   * exists so we can point this at `leylek-google-ads-mock.workers.dev`
   * in sandbox without touching the client. Trailing slash optional.
   */
  baseUrl?: string;
  /**
   * OAuth base. Defaults to the production Google OAuth host. Client
   * appends `/token` itself so the env var stays a base URL — same
   * shape as `baseUrl` above.
   */
  oauthUrl?: string;
}

const GOOGLE_ADS_ROOT_DEFAULT = 'https://googleads.googleapis.com';
const OAUTH_BASE_DEFAULT = 'https://oauth2.googleapis.com';

export class RealGoogleAdsClient implements AdPlatformClient {
  readonly runtime = 'real' as const;
  private accessTokenCache: { token: string; expiresAt: number } | null = null;

  constructor(private readonly cfg: RealGoogleAdsConfig) {}

  async createCampaign(input: CreateCampaignInput): Promise<{ externalId: string }> {
    const access = await this.accessToken();
    const dailyMicros = Math.round((input.dailyBudgetKurus / 100) * 1_000_000);

    // Step 1: create the campaign-level budget resource.
    const budgetResp = await this.adsFetch<{ results: Array<{ resourceName: string }> }>(
      `/customers/${this.cfg.customerId}/campaignBudgets:mutate`,
      access,
      {
        operations: [
          {
            create: {
              name: `${input.name} budget`,
              amount_micros: dailyMicros,
              delivery_method: 'STANDARD',
            },
          },
        ],
      },
    );
    const budgetResource = budgetResp.results?.[0]?.resourceName;
    if (!budgetResource) {
      throw new AdPlatformError('CAMPAIGN_BUDGET_FAILED', 'budget mutate returned no result', {});
    }

    // Step 2: create the campaign that points at that budget.
    const campResp = await this.adsFetch<{ results: Array<{ resourceName: string }> }>(
      `/customers/${this.cfg.customerId}/campaigns:mutate`,
      access,
      {
        operations: [
          {
            create: {
              name: input.name,
              status: 'PAUSED',
              advertising_channel_type: 'SEARCH',
              campaign_budget: budgetResource,
              network_settings: {
                target_google_search: true,
                target_search_network: false,
                target_content_network: false,
              },
            },
          },
        ],
      },
    );
    const resource = campResp.results?.[0]?.resourceName;
    if (!resource) throw new AdPlatformError('CAMPAIGN_CREATE_FAILED', 'no result from mutate', {});
    return { externalId: resource.split('/').pop() ?? resource };
  }

  async createAd(input: CreateAdInput): Promise<{ externalId: string }> {
    const access = await this.accessToken();

    // We need a per-campaign ad group; create one named after the strategy.
    const groupResp = await this.adsFetch<{ results: Array<{ resourceName: string }> }>(
      `/customers/${this.cfg.customerId}/adGroups:mutate`,
      access,
      {
        operations: [
          {
            create: {
              name: `${input.strategyType} group`,
              campaign: `customers/${this.cfg.customerId}/campaigns/${input.campaignExternalId}`,
              status: 'ENABLED',
              type: 'SEARCH_STANDARD',
              cpc_bid_micros: 1_000_000, // 1 TRY-equivalent placeholder
            },
          },
        ],
      },
    );
    const groupResource = groupResp.results?.[0]?.resourceName;
    if (!groupResource) {
      throw new AdPlatformError('ADGROUP_CREATE_FAILED', 'no result from adGroups mutate', {});
    }

    const [headline, ...bodyParts] = input.adText.split('\n');
    const body = bodyParts.join(' ').trim() || input.adText;

    const adResp = await this.adsFetch<{ results: Array<{ resourceName: string }> }>(
      `/customers/${this.cfg.customerId}/adGroupAds:mutate`,
      access,
      {
        operations: [
          {
            create: {
              ad_group: groupResource,
              status: 'ENABLED',
              ad: {
                final_urls: ['https://example.com'],
                responsive_search_ad: {
                  headlines: [
                    { text: (headline || 'Leylek').slice(0, 30) },
                    { text: input.strategyType.slice(0, 30) },
                    { text: 'Leylek AI Reklam' },
                  ],
                  descriptions: [
                    { text: body.slice(0, 90) },
                    { text: 'Otonom AI reklam yönetimi' },
                  ],
                },
              },
            },
          },
        ],
      },
    );
    const resource = adResp.results?.[0]?.resourceName;
    if (!resource) throw new AdPlatformError('AD_CREATE_FAILED', 'no result from mutate', {});
    // Google's resource leaf is `<adGroupId>~<adId>` — keep the full leaf so
    // `pauseAd`/`resumeAd` can rebuild a valid `resource_name`. `fetchMetrics`
    // splits the leaf to get the numeric ad id GAQL expects.
    return { externalId: resource.split('/').pop() ?? resource };
  }

  async pauseAd(externalAdId: string, _reason: string): Promise<void> {
    const access = await this.accessToken();
    await this.adsFetch(`/customers/${this.cfg.customerId}/adGroupAds:mutate`, access, {
      operations: [
        {
          update: {
            resource_name: `customers/${this.cfg.customerId}/adGroupAds/${externalAdId}`,
            status: 'PAUSED',
          },
          update_mask: 'status',
        },
      ],
    });
  }

  async resumeAd(externalAdId: string): Promise<void> {
    const access = await this.accessToken();
    await this.adsFetch(`/customers/${this.cfg.customerId}/adGroupAds:mutate`, access, {
      operations: [
        {
          update: {
            resource_name: `customers/${this.cfg.customerId}/adGroupAds/${externalAdId}`,
            status: 'ENABLED',
          },
          update_mask: 'status',
        },
      ],
    });
  }

  async updateBudget(externalCampaignId: string, newBudgetKurus: number): Promise<void> {
    const access = await this.accessToken();
    const micros = Math.round((newBudgetKurus / 100) * 1_000_000);
    // Resolve the budget resource attached to the campaign.
    const search = await this.adsFetch<{
      results: Array<{ campaign: { campaignBudget: string } }>;
    }>(`/customers/${this.cfg.customerId}/googleAds:search`, access, {
      query: `SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = ${externalCampaignId}`,
    });
    const budgetResource = search.results?.[0]?.campaign?.campaignBudget;
    if (!budgetResource) {
      throw new AdPlatformError('BUDGET_LOOKUP_FAILED', 'campaign has no budget resource', {});
    }
    await this.adsFetch(`/customers/${this.cfg.customerId}/campaignBudgets:mutate`, access, {
      operations: [
        {
          update: { resource_name: budgetResource, amount_micros: micros },
          update_mask: 'amount_micros',
        },
      ],
    });
  }

  async fetchMetrics(externalAdId: string, windowHours: number): Promise<MetricWindow> {
    const access = await this.accessToken();
    const startDate = new Date(Date.now() - windowHours * 3600_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    // GAQL `ad_group_ad.ad.id` is the numeric ad id alone — strip the
    // `<adGroupId>~` prefix carried in our externalAdId convention.
    const numericAdId = externalAdId.split('~').pop() ?? externalAdId;
    const query = `
      SELECT metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros
      FROM ad_group_ad
      WHERE ad_group_ad.ad.id = ${numericAdId}
        AND segments.date BETWEEN '${startDate}' AND '${today}'
    `;
    const resp = await this.adsFetch<{
      results: Array<{
        metrics: { impressions: string; clicks: string; conversions: string; costMicros: string };
      }>;
    }>(`/customers/${this.cfg.customerId}/googleAds:search`, access, { query });

    const m = resp.results?.[0]?.metrics ?? {
      impressions: '0',
      clicks: '0',
      conversions: '0',
      costMicros: '0',
    };
    return {
      externalAdId,
      windowStart: `${startDate}T00:00:00Z`,
      windowEnd: `${today}T23:59:59Z`,
      impressions: Number(m.impressions),
      clicks: Number(m.clicks),
      conversions: Number(m.conversions),
      spendKurus: Math.round((Number(m.costMicros) / 1_000_000) * 100),
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------
  private async adsFetch<T>(path: string, accessToken: string, body: unknown): Promise<T> {
    const version = this.cfg.apiVersion ?? 'v17';
    const root = (this.cfg.baseUrl ?? GOOGLE_ADS_ROOT_DEFAULT).replace(/\/$/, '');
    const resp = await fetch(`${root}/${version}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': this.cfg.developerToken,
        'login-customer-id': this.cfg.loginCustomerId,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new AdPlatformError(
        resp.status >= 500 ? 'GOOGLE_ADS_5XX' : 'GOOGLE_ADS_4XX',
        `${resp.status} ${resp.statusText}: ${text.slice(0, 240)}`,
        { retryable: resp.status >= 500 },
      );
    }
    return (await resp.json()) as T;
  }

  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessTokenCache && this.accessTokenCache.expiresAt - 30_000 > now) {
      return this.accessTokenCache.token;
    }
    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      refresh_token: this.cfg.refreshToken,
      grant_type: 'refresh_token',
    });
    const oauthBase = (this.cfg.oauthUrl ?? OAUTH_BASE_DEFAULT).replace(/\/$/, '');
    const resp = await fetch(`${oauthBase}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new AdPlatformError('OAUTH_REFRESH_FAILED', `${resp.status} ${text.slice(0, 240)}`, {
        retryable: resp.status >= 500,
      });
    }
    const json = (await resp.json()) as { access_token: string; expires_in: number };
    this.accessTokenCache = {
      token: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    return json.access_token;
  }
}
