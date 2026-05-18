/**
 * AdPlatformClient — port for outbound calls to ad platforms.
 *
 * `RealGoogleAdsClient` and `RealMetaAdsClient` implement this interface.
 * `SimulatedAdsClient` is preserved in the repo for one-line rollback
 * but no longer dispatched to by the factory (mockdata.md).
 *
 * The factory builds one of the real clients per provider; `*_BASE_URL`
 * env vars decide whether traffic lands on a `leylek-*-mock` Worker
 * (sandbox) or on the actual Google/Meta endpoint (prod).
 *
 * PRD §10.
 */

import { z } from 'zod';

export const AdPlatformRuntime = z.enum(['sim', 'real']);
export type AdPlatformRuntime = z.infer<typeof AdPlatformRuntime>;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------
export const CreateCampaignInput = z.object({
  name: z.string().min(1),
  /** Daily budget in kurus (TRY * 100) */
  dailyBudgetKurus: z.number().int().positive(),
});
export type CreateCampaignInput = z.infer<typeof CreateCampaignInput>;

export const CreateAdInput = z.object({
  campaignExternalId: z.string().min(1),
  strategyType: z.enum(['AGGRESSIVE', 'STORY', 'TECHNICAL']),
  adText: z.string().min(1),
  imagePrompt: z.string().min(1),
});
export type CreateAdInput = z.infer<typeof CreateAdInput>;

export const MetricWindow = z.object({
  externalAdId: z.string(),
  windowStart: z.string(), // ISO-8601
  windowEnd: z.string(),
  impressions: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  conversions: z.number().int().nonnegative(),
  /** Spend over the window, in kurus */
  spendKurus: z.number().int().nonnegative(),
});
export type MetricWindow = z.infer<typeof MetricWindow>;

export const AdStatus = z.enum(['active', 'paused']);
export type AdStatus = z.infer<typeof AdStatus>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export class AdPlatformError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(code: string, message: string, opts: { retryable?: boolean; cause?: unknown } = {}) {
    super(`[${code}] ${message}`);
    this.name = 'AdPlatformError';
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.cause = opts.cause;
  }
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------
export interface AdPlatformClient {
  readonly runtime: AdPlatformRuntime;

  /**
   * Create a campaign on the platform. Returns the external ID we should
   * persist on `campaigns.do_id` / metadata to reference it later.
   */
  createCampaign(input: CreateCampaignInput): Promise<{ externalId: string }>;

  /**
   * Create one ad creative under an existing campaign. Returns the external
   * ad ID; the publisher-agent persists it to `ads.google_ad_id` (or
   * `ads.meta_ad_id` once Meta lands).
   */
  createAd(input: CreateAdInput): Promise<{ externalId: string }>;

  /**
   * Pause an ad at the platform. Idempotent — calling twice is fine.
   * Throws `AdPlatformError` if the platform rejects the call.
   */
  pauseAd(externalAdId: string, reason: string): Promise<void>;

  /**
   * Resume a previously-paused ad. Idempotent.
   */
  resumeAd(externalAdId: string): Promise<void>;

  /**
   * Set a new daily budget (kurus) on a campaign.
   */
  updateBudget(externalCampaignId: string, newBudgetKurus: number): Promise<void>;

  /**
   * Fetch the most recent metric window for an ad. `windowHours` controls how
   * far back the platform aggregates; agents typically ask for 6, 24, or 48.
   */
  fetchMetrics(externalAdId: string, windowHours: number): Promise<MetricWindow>;
}
