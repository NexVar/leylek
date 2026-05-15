/**
 * Type-safe environment binding shape for the gateway Worker.
 * Every secret + binding declared in wrangler.toml must appear here.
 */

export interface Env {
  // Vars
  /** Frontend (Pages) origin — redirect target after OAuth + CORS allow-list. */
  APP_URL: string;
  /** Gateway origin — used for OAuth callback `redirect_uri`. */
  GATEWAY_URL: string;
  JWT_ISSUER: string;
  /** Selects which AdPlatformClient downstream Workers build; gateway just forwards. */
  LEYLEK_AD_PLATFORM: 'sim' | 'real';
  /** When 'true', `/api/auth/dev-login` is enabled (E2E demo shortcut). */
  LEYLEK_ALLOW_DEV_LOGIN: string;
  /**
   * Gate the Google OAuth flow. Flip to 'true' only AFTER the production
   * redirect URI is registered in Google Cloud Console (DEMO_PLAYBOOK §10),
   * else the user hits `Error 400: redirect_uri_mismatch`. Default 'false'
   * hides the button + makes /google/start return 503 with a helpful body.
   */
  LEYLEK_GOOGLE_OAUTH_READY: string;

  // D1
  DB: D1Database;

  // KV
  KV: KVNamespace;

  // Service bindings (populated as workers deploy)
  CONTENT_AGENT: Fetcher;
  OPTIMIZER_AGENT: Fetcher;
  PUBLISHER_AGENT: Fetcher;
  ANALYTICS_WORKER: Fetcher;

  // Secrets — set via `wrangler secret put`
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  JWT_SECRET: string;
  AES_KEY_BASE: string;
  RESEND_API_KEY: string;
  META_APP_ID: string;
  META_APP_SECRET: string;
}
