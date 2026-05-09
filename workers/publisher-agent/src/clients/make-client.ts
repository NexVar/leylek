/**
 * Factory: pick the AdPlatformClient at runtime.
 *
 * `LEYLEK_AD_PLATFORM=sim` (default for demo) returns SimulatedAdsClient
 * backed by KV. `=real` returns RealGoogleAdsClient configured from
 * Workers Secrets and a per-user refresh token decrypted from
 * `connected_accounts`.
 *
 * The Meta stub is wired through `provider` so that a future
 * `LEYLEK_AD_PLATFORM=real` deploy can route per ad-account provider
 * without code changes.
 */

import type { AdPlatformClient } from '@leylek/shared-types';

import { MetaAdsClient } from './meta-ads';
import { RealGoogleAdsClient } from './real-google-ads';
import { SimulatedAdsClient } from './simulated-ads';

export type AdPlatformProvider = 'google_ads' | 'meta';

export interface RealCredentials {
  /** Decrypted OAuth refresh token belonging to the user we are acting for. */
  refreshToken: string;
  /** Google Ads customer ID (10-digit, no dashes). */
  customerId: string;
}

export interface MakeClientInput {
  runtime: 'sim' | 'real';
  provider: AdPlatformProvider;
  kv: KVNamespace;
  realConfig?: {
    developerToken: string;
    loginCustomerId: string;
    clientId: string;
    clientSecret: string;
    credentials: RealCredentials;
  };
}

export function makeAdPlatformClient(input: MakeClientInput): AdPlatformClient {
  if (input.runtime === 'sim') {
    return new SimulatedAdsClient(input.kv);
  }
  if (input.provider === 'meta') {
    return new MetaAdsClient();
  }
  const cfg = input.realConfig;
  if (!cfg) {
    throw new Error('makeAdPlatformClient: realConfig required when runtime="real"');
  }
  return new RealGoogleAdsClient({
    developerToken: cfg.developerToken,
    loginCustomerId: cfg.loginCustomerId,
    customerId: cfg.credentials.customerId,
    refreshToken: cfg.credentials.refreshToken,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
  });
}
