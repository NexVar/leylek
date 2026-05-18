export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  CAMPAIGN_AGENT: DurableObjectNamespace;
  PUBLISHER_AGENT: Fetcher;
  GEMINI_API_KEY: string;
  /** Frontend origin — used in Co-Pilot notification email deep-links. */
  APP_URL: string;
  /** Resend API key — fire-and-forget Co-Pilot proposal emails. */
  RESEND_API_KEY: string;
  /** From-address for outbound Resend mail. Default 'Leylek <onboarding@resend.dev>'. */
  RESEND_FROM_EMAIL: string;
}
