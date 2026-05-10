export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  CAMPAIGN_AGENT: DurableObjectNamespace;
  PUBLISHER_AGENT: Fetcher;
  GEMINI_API_KEY: string;
  /** Ad-platform runtime selector — forwarded to publisher-agent Service Binding calls. */
  LEYLEK_AD_PLATFORM: 'sim' | 'real';
}
