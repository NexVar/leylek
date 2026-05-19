/**
 * Image generation via Cloudflare Workers AI Flux Schnell.
 *
 * Why not Gemini? Gemini 2.5 Flash Image free-tier quota on this project
 * is 0 (same shape as the Gemini 2.5 Pro story in PRD §16), so the
 * Nano-Banana path 429s every call. Workers AI is bound to the same
 * Cloudflare account the rest of the stack runs on — free tier covers
 * 10 000 neurons/day, Flux Schnell costs ~0.1 neurons per image, so
 * 9-image demo seeds + ad-hoc user campaigns sit well inside the quota.
 *
 * Text variants still go through Gemini (`@google/genai`). Only the
 * image step lives here.
 *
 * On failure (rate limit, content safety, network) we return `null` and
 * the caller stores `image_r2_key = NULL` so the ad card UI renders a
 * "görsel yok" placeholder — a broken image gen never blocks campaign
 * creation.
 */

const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

/**
 * Suffix appended to every content-agent `imagePrompt`. Keeps output
 * consistent across variants: 1:1 framing, clean hero, no embedded
 * text (Meta + Google Ads compliance bans copy baked into the image).
 */
const PROMPT_SUFFIX =
  ' Photo-realistic ad creative, square 1:1 framing, product hero composition, ' +
  'professional lighting, no embedded text or watermark.';

export interface GeneratedImage {
  /** R2 object key (no leading slash). `ad-<16hex>.png` shape. */
  r2Key: string;
  /** PNG byte length — surfaced for log telemetry. */
  bytes: number;
}

/**
 * Workers AI Flux Schnell response shape. The model returns base64 PNG
 * via the `image` field. Older docs sometimes type the response as a
 * `ReadableStream`; the actual runtime returns the JSON shape below.
 */
interface FluxResponse {
  image?: string;
}

export async function generateAndStoreAdImage(
  ai: Ai,
  bucket: R2Bucket,
  prompt: string,
): Promise<GeneratedImage | null> {
  try {
    // 4 steps is Flux Schnell's sweet spot — model is distilled for low
    // step counts. Going higher (e.g. 8) doesn't visibly improve output
    // but doubles neuron cost.
    const response = (await ai.run(IMAGE_MODEL, {
      prompt: prompt + PROMPT_SUFFIX,
      steps: 4,
    })) as FluxResponse | ReadableStream<Uint8Array>;

    let bytes: Uint8Array | null = null;

    if (response instanceof ReadableStream) {
      bytes = await streamToBytes(response);
    } else if (response && typeof response === 'object' && typeof response.image === 'string') {
      bytes = base64ToBytes(response.image);
    }

    if (!bytes || bytes.byteLength === 0) {
      console.warn('[content-agent] image gen returned empty bytes');
      return null;
    }

    const id = randomId(16);
    const r2Key = `ad-${id}.png`;

    await bucket.put(r2Key, bytes, {
      httpMetadata: {
        contentType: 'image/png',
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

async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function randomId(hexChars: number): string {
  const bytes = new Uint8Array(Math.ceil(hexChars / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, hexChars);
}
