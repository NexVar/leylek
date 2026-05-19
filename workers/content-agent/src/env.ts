export interface Env {
  GEMINI_API_KEY: string;
  /** R2 bucket for AI-generated ad creatives (optional — set binding in wrangler.toml). */
  CREATIVES?: R2Bucket;
}
