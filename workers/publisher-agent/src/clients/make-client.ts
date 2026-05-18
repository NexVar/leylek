/**
 * Factory: build the `AdPlatformClient` for a given provider.
 *
 * Single code path post-mockdata.md — every demo and every production
 * call goes through `RealGoogleAdsClient` or `RealMetaAdsClient`. Whether
 * the HTTP traffic lands on a `leylek-*-mock` Worker (sandbox) or on
 * `googleads.googleapis.com` / `graph.facebook.com` (prod) is determined
 * by the `GOOGLE_ADS_BASE_URL`, `GOOGLE_ADS_OAUTH_URL`, `META_ADS_BASE_URL`
 * env vars on the calling Worker. No sim/real branch, no `LEYLEK_AD_PLATFORM`.
 *
 * `SimulatedAdsClient` is preserved in the repo for one-line rollback,
 * but the factory no longer dispatches to it.
 */

import type { AdPlatformClient } from '@leylek/shared-types';

import { RealGoogleAdsClient } from './real-google-ads';
import { RealMetaAdsClient } from './real-meta-ads';

export type AdPlatformProvider = 'google_ads' | 'meta';

/**
 * Per-user credentials decrypted from `connected_accounts`. Empty
 * strings work against the mock Workers (they don't validate); real
 * production requires the gateway's AES helper to fill these in.
 */
export interface AdPlatformCredentials {
  /** Google Ads OAuth refresh token. */
  refreshToken?: string;
  /** Google Ads 10-digit customer id (no dashes). */
  customerId?: string;
  /** Meta long-lived user access token (60 days). */
  accessToken?: string;
  /** Meta ad account id, without the `act_` prefix. */
  adAccountId?: string;
}

/**
 * The platform-shaped env shared by publisher-agent + analytics-worker.
 * Both expose the same superset of fields; the factory only reads what
 * its branch needs.
 */
export interface AdPlatformEnv {
  GOOGLE_ADS_BASE_URL: string;
  GOOGLE_ADS_OAUTH_URL: string;
  META_ADS_BASE_URL: string;
  GOOGLE_ADS_DEVELOPER_TOKEN: string;
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: string;
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  META_API_VERSION?: string;
}

export interface MakeClientInput {
  provider: AdPlatformProvider;
  credentials: AdPlatformCredentials;
  env: AdPlatformEnv;
}

export function makeAdPlatformClient(input: MakeClientInput): AdPlatformClient {
  if (input.provider === 'google_ads') {
    return new RealGoogleAdsClient({
      baseUrl: input.env.GOOGLE_ADS_BASE_URL,
      oauthUrl: input.env.GOOGLE_ADS_OAUTH_URL,
      developerToken: input.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      loginCustomerId: input.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
      customerId: input.credentials.customerId ?? '',
      refreshToken: input.credentials.refreshToken ?? '',
      clientId: input.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: input.env.GOOGLE_OAUTH_CLIENT_SECRET,
    });
  }
  return new RealMetaAdsClient({
    baseUrl: input.env.META_ADS_BASE_URL,
    accessToken: input.credentials.accessToken ?? '',
    adAccountId: input.credentials.adAccountId ?? '',
    apiVersion: input.env.META_API_VERSION ?? 'v21.0',
  });
}
