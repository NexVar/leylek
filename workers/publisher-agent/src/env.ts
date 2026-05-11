/**
 * Type-safe environment binding shape for the publisher-agent Worker.
 * Every var, binding, and secret declared in wrangler.toml must appear here.
 */

export interface Env {
  // Bindings
  DB: D1Database;
  KV: KVNamespace;

  // Vars
  META_API_VERSION: string;
  /** Selects which AdPlatformClient the factory builds. Default 'sim' for demo. */
  LEYLEK_AD_PLATFORM: 'sim' | 'real';

  // Secrets
  META_APP_ID: string;
  META_APP_SECRET: string;
  GOOGLE_ADS_DEVELOPER_TOKEN: string;
  /** 10-digit Google Ads MCC ID (no dashes). Only needed in real mode. */
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: string;
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  /** Envelope key (base) for AES-256-GCM decryption of connected_account tokens. */
  AES_KEY_BASE: string;
}
