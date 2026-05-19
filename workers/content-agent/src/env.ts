export interface Env {
  GEMINI_API_KEY: string;
  /** Workers AI binding — Flux Schnell for image gen (Gemini text-only). */
  AI: Ai;
  /** R2 bucket for AI-generated ad creatives. Key shape: `ad-<id>.png`. */
  CREATIVES: R2Bucket;
}
