export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  CAMPAIGN_AGENT: DurableObjectNamespace;
  PUBLISHER_AGENT: Fetcher;
  GEMINI_API_KEY: string;
}
