/**
 * SimulatedAdsClient — in-memory `AdPlatformClient` for demo / E2E.
 *
 * State persistence:
 *   - All sim state lives in KV under `sim:campaign:*` and `sim:ad:*` keys.
 *   - Pre-seeded metric curves are written by `scripts/seed-demo-data.ts`.
 *
 * Realism choices:
 *   - 50–200 ms artificial latency on every call so the optimizer's
 *     "stream Gemini reasoning" demo doesn't feel suspiciously fast.
 *   - 0.3 % synthetic error rate on `pauseAd` so the publisher-agent's
 *     retry path gets exercised even in sim mode.
 *
 * PRD §10 contract: this class behaves like the real platform externally so
 * upstream code paths (publisher-agent route handlers, optimizer DO,
 * analytics worker) are identical in sim and real modes — only the factory
 * decides which client is wired in.
 */

import {
  type AdPlatformClient,
  AdPlatformError,
  type CreateAdInput,
  type CreateCampaignInput,
  type MetricWindow,
} from '@leylek/shared-types';

interface SimCampaign {
  externalId: string;
  name: string;
  dailyBudgetKurus: number;
  createdAt: string;
}

interface SimAd {
  externalId: string;
  campaignExternalId: string;
  strategyType: 'AGGRESSIVE' | 'STORY' | 'TECHNICAL';
  adText: string;
  imagePrompt: string;
  status: 'active' | 'paused';
  createdAt: string;
  pausedAt?: string;
  pausedReason?: string;
}

/**
 * KV layout
 *   sim:campaign:<extId>       -> SimCampaign JSON
 *   sim:ad:<extId>             -> SimAd JSON
 *   sim:metrics:<extAdId>      -> last MetricWindow JSON (aggregated by seed)
 */
export class SimulatedAdsClient implements AdPlatformClient {
  readonly runtime = 'sim' as const;

  constructor(private readonly kv: KVNamespace) {}

  async createCampaign(input: CreateCampaignInput): Promise<{ externalId: string }> {
    await this.jitter();
    const externalId = `sim_camp_${cryptoRandomId()}`;
    const value: SimCampaign = {
      externalId,
      name: input.name,
      dailyBudgetKurus: input.dailyBudgetKurus,
      createdAt: new Date().toISOString(),
    };
    await this.kv.put(`sim:campaign:${externalId}`, JSON.stringify(value));
    return { externalId };
  }

  async createAd(input: CreateAdInput): Promise<{ externalId: string }> {
    await this.jitter();
    const externalId = `sim_ad_${cryptoRandomId()}`;
    const value: SimAd = {
      externalId,
      campaignExternalId: input.campaignExternalId,
      strategyType: input.strategyType,
      adText: input.adText,
      imagePrompt: input.imagePrompt,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    await this.kv.put(`sim:ad:${externalId}`, JSON.stringify(value));
    return { externalId };
  }

  async pauseAd(externalAdId: string, reason: string): Promise<void> {
    await this.jitter();
    if (Math.random() < 0.003) {
      throw new AdPlatformError('SIM_TRANSIENT_FAILURE', 'simulated 0.3% pause failure', {
        retryable: true,
      });
    }
    const ad = await this.readAd(externalAdId);
    if (!ad) throw new AdPlatformError('NOT_FOUND', `ad ${externalAdId} unknown`, {});
    if (ad.status === 'paused') return; // idempotent
    const next: SimAd = {
      ...ad,
      status: 'paused',
      pausedAt: new Date().toISOString(),
      pausedReason: reason,
    };
    await this.kv.put(`sim:ad:${externalAdId}`, JSON.stringify(next));
  }

  async resumeAd(externalAdId: string): Promise<void> {
    await this.jitter();
    const ad = await this.readAd(externalAdId);
    if (!ad) throw new AdPlatformError('NOT_FOUND', `ad ${externalAdId} unknown`, {});
    if (ad.status === 'active') return;
    const next: SimAd = { ...ad, status: 'active', pausedAt: undefined, pausedReason: undefined };
    await this.kv.put(`sim:ad:${externalAdId}`, JSON.stringify(next));
  }

  async updateBudget(externalCampaignId: string, newBudgetKurus: number): Promise<void> {
    await this.jitter();
    const raw = await this.kv.get(`sim:campaign:${externalCampaignId}`);
    if (!raw) throw new AdPlatformError('NOT_FOUND', `campaign ${externalCampaignId} unknown`, {});
    const camp = JSON.parse(raw) as SimCampaign;
    camp.dailyBudgetKurus = newBudgetKurus;
    await this.kv.put(`sim:campaign:${externalCampaignId}`, JSON.stringify(camp));
  }

  async fetchMetrics(externalAdId: string, windowHours: number): Promise<MetricWindow> {
    await this.jitter();
    const raw = await this.kv.get(`sim:metrics:${externalAdId}`);
    if (raw) {
      const persisted = JSON.parse(raw) as MetricWindow;
      // Seeded snapshots are authoritative — the optimizer reads from D1 anyway;
      // this path exists so analytics-worker can "re-fetch" and produce identical
      // numbers, mirroring the real-mode behaviour of asking Google again.
      return persisted;
    }
    // Cold ad → zero metrics over the window.
    const end = new Date();
    const start = new Date(end.getTime() - windowHours * 3600 * 1000);
    return {
      externalAdId,
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      impressions: 0,
      clicks: 0,
      conversions: 0,
      spendKurus: 0,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  private async readAd(externalAdId: string): Promise<SimAd | null> {
    const raw = await this.kv.get(`sim:ad:${externalAdId}`);
    return raw ? (JSON.parse(raw) as SimAd) : null;
  }

  private async jitter(): Promise<void> {
    const ms = 50 + Math.floor(Math.random() * 150);
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function cryptoRandomId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
