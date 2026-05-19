/**
 * Image generation via Gemini 2.5 Flash Image ("Nano Banana").
 *
 * Same Gemini API key the text content-agent uses; free tier covers the
 * demo cadence (a handful of campaigns/day, 3 images each). On failure
 * (rate limit, content-safety reject, network) we return `null` and the
 * caller stores `image_r2_key = NULL` — the ad card UI renders a
 * "görsel yok" placeholder so a broken image gen never blocks campaign
 * creation.
 *
 * The model returns image bytes inline as base64 inside the structured
 * response (see the part with `inlineData`). We upload directly to the
 * bound R2 bucket with an immutable cache header so the gateway proxy
 * can serve it forever.
 */

import type { GoogleGenAI } from '@google/genai';

const IMAGE_MODEL_ID = 'gemini-2.5-flash-image';

/**
 * Style suffix appended to every content-agent `imagePrompt`. Keeps the
 * output consistent across variants (1:1 aspect, clean product hero,
 * no embedded text — important because Meta ad images can't carry
 * baked-in copy for compliance).
 */
const PROMPT_SUFFIX =
  '\n\nStyle: photo-realistic ad creative, square 1:1 framing, product hero composition, ' +
  'professional lighting, no embedded text or watermark.';

export interface GeneratedImage {
  /** R2 object key (no leading slash). `ad-<id>.png` shape. */
  r2Key: string;
  /** PNG byte length — surfaced for log telemetry. */
  bytes: number;
}

export async function generateAndStoreAdImage(
  ai: GoogleGenAI,
  bucket: R2Bucket,
  prompt: string,
): Promise<GeneratedImage | null> {
  try {
    const response = await ai.models.generateContent({
      model: IMAGE_MODEL_ID,
      contents: prompt + PROMPT_SUFFIX,
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    let imageData: string | null = null;
    let mimeType = 'image/png';
    for (const part of parts) {
      if (part.inlineData?.data) {
        imageData = part.inlineData.data;
        if (part.inlineData.mimeType) mimeType = part.inlineData.mimeType;
        break;
      }
    }
    if (!imageData) {
      console.warn('[content-agent] image gen returned no inline data');
      return null;
    }

    // Decode base64 to Uint8Array. atob is available in the Workers runtime.
    const binary = atob(imageData);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';
    const id = randomId(16);
    const r2Key = `ad-${id}.${ext}`;

    await bucket.put(r2Key, bytes, {
      httpMetadata: {
        contentType: mimeType,
        // Creatives are immutable — we re-key on regeneration.
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });

    return { r2Key, bytes: bytes.byteLength };
  } catch (err) {
    console.warn(
      '[content-agent] image gen failed',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

function randomId(hexChars: number): string {
  const bytes = new Uint8Array(Math.ceil(hexChars / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, hexChars);
}
