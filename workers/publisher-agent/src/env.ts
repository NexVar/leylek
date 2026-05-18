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
  /**
   * @deprecated Faz-4 drops this var (mockdata.md). The factory now routes
   * by `provider` + base-URL, so the runtime distinction is gone.
   */
  LEYLEK_AD_PLATFORM: 'sim' | 'real';
  /** Google Ads REST root — mock worker URL in sandbox, googleads.googleapis.com in prod. */
  GOOGLE_ADS_BASE_URL: string;
  /** Google OAuth token endpoint — mock worker URL in sandbox, oauth2.googleapis.com in prod. */
  GOOGLE_ADS_OAUTH_URL: string;
  /** Meta Marketing API root — mock worker URL in sandbox, graph.facebook.com in prod. */
  META_ADS_BASE_URL: string;

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
