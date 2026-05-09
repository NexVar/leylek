/**
 * MetaAdsClient — Faz-2 stub.
 *
 * PRD §10 / §17 ships the Meta integration in Faz 2. The interface is
 * here today so the `PlatformRouter` (publisher-agent + analytics-worker)
 * can already route by `provider: 'meta'` without code changes when the
 * real implementation lands.
 *
 * Every method throws a typed `AdPlatformError` with code
 * `META_NOT_IMPLEMENTED` so callers see a meaningful failure mode rather
 * than a silent no-op.
 */

import {
  type AdPlatformClient,
  AdPlatformError,
  type CreateAdInput,
  type CreateCampaignInput,
  type MetricWindow,
} from '@leylek/shared-types';

export class MetaAdsClient implements AdPlatformClient {
  readonly runtime = 'real' as const;

  async createCampaign(_input: CreateCampaignInput): Promise<{ externalId: string }> {
    throw this.notImpl('createCampaign');
  }

  async createAd(_input: CreateAdInput): Promise<{ externalId: string }> {
    throw this.notImpl('createAd');
  }

  async pauseAd(_externalAdId: string, _reason: string): Promise<void> {
    throw this.notImpl('pauseAd');
  }

  async resumeAd(_externalAdId: string): Promise<void> {
    throw this.notImpl('resumeAd');
  }

  async updateBudget(_externalCampaignId: string, _newBudgetKurus: number): Promise<void> {
    throw this.notImpl('updateBudget');
  }

  async fetchMetrics(_externalAdId: string, _windowHours: number): Promise<MetricWindow> {
    throw this.notImpl('fetchMetrics');
  }

  private notImpl(method: string): AdPlatformError {
    return new AdPlatformError(
      'META_NOT_IMPLEMENTED',
      `Meta Marketing API integration ships in Faz 2 (${method}). Track in PRD §17.`,
      {},
    );
  }
}
