export interface Env {
  DB: D1Database;
  /** Sim metric storage (sim:metrics:<extAdId>); also unused KV slot in real mode. */
  KV: KVNamespace;
  /**
   * @deprecated Faz-4 drops this var (mockdata.md). Cron now always asks the
   * unified client for fresh metrics; sandbox vs prod is a base-URL switch.
   */
  LEYLEK_AD_PLATFORM: 'sim' | 'real';
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
  /** 10-digit Google Ads MCC ID (no dashes). Only used when LEYLEK_AD_PLATFORM=real. */
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: string;
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  AES_KEY_BASE: string;
}
