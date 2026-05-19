export interface Env {
  GEMINI_API_KEY: string;
  /** R2 bucket for AI-generated ad creatives. Key shape: `ads/<adId>.png`. */
  CREATIVES: R2Bucket;
}
