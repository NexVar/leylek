/**
 * 50-200 ms artificial latency, matching `SimulatedAdsClient` so callers
 * (and demo viewers) get the same "real network feel" against the mock
 * as they will against the real Google Ads API.
 */
export async function jitter(): Promise<void> {
  const ms = 50 + Math.floor(Math.random() * 150);
  await new Promise((resolve) => setTimeout(resolve, ms));
}
