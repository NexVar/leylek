export interface Env {
  DB: D1Database;
  /** Sim metric storage (sim:metrics:<extAdId>); also unused KV slot in real mode. */
  KV: KVNamespace;
  /** Runtime flag — 'sim' for demo, 'real' once Google Ads dev token is approved (PRD §10). */
  LEYLEK_AD_PLATFORM: 'sim' | 'real';
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
