export interface Env {
  DB: D1Database;
  /** Reserved KV binding; the unified client doesn't touch KV directly. */
  KV: KVNamespace;
  /** Google Ads REST root — mock worker URL in sandbox, googleads.googleapis.com in prod. */
  GOOGLE_ADS_BASE_URL: string;
  /** Google OAuth token endpoint — mock worker URL in sandbox, oauth2.googleapis.com in prod. */
  GOOGLE_ADS_OAUTH_URL: string;
  /** Meta Marketing API root — mock worker URL in sandbox, graph.facebook.com in prod. */
  META_ADS_BASE_URL: string;
  META_APP_ID: string;
  META_APP_SECRET: string;
  META_API_VERSION: string;
  GOOGLE_ADS_DEVELOPER_TOKEN: string;
  /** 10-digit Google Ads MCC ID (no dashes). Required by RealGoogleAdsClient. */
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: string;
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  AES_KEY_BASE: string;
}
