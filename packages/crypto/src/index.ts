/**
 * index.ts — AES-256-GCM envelope encryption for OAuth tokens.
 *
 * Extracted from `workers/gateway/src/crypto.ts` so that
 * `publisher-agent` and `analytics-worker` can decrypt
 * `connected_accounts.enc_access_token` / `enc_refresh_token`
 * per request (PRD §17).
 *
 * Workers Runtime is Web Standards: no `Buffer`, no Node `crypto`.
 * We use `crypto.subtle` directly. Base64 via `atob` / `btoa`.
 * AES tag is the trailing 16 bytes of the ciphertext output.
 */

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Workers' `@cloudflare/workers-types` types `Uint8Array<ArrayBufferLike>`,
 * but SubtleCrypto's `BufferSource` expects `ArrayBufferView<ArrayBuffer>`.
 * Copy into a fresh `Uint8Array` whose backing buffer is a plain `ArrayBuffer`.
 */
function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  out.set(bytes);
  return out;
}

// ---------------------------------------------------------------------------
// AES-256-GCM
// ---------------------------------------------------------------------------
async function importAesKey(base64Key: string): Promise<CryptoKey> {
  const raw = base64ToBytes(base64Key);
  const derived = await crypto.subtle.digest('SHA-256', asBufferSource(raw));
  return crypto.subtle.importKey('raw', derived, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Encrypt plaintext with AES-256-GCM. Returns base64 of `iv || ciphertext || tag`.
 * A fresh 12-byte IV is generated per call; SubtleCrypto appends the 16-byte
 * auth tag onto the ciphertext output, so the layout is `iv(12) || ct || tag(16)`.
 */
export async function aesEncrypt(plain: string, base64Key: string): Promise<string> {
  const key = await importAesKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(plain),
  );
  const ct = new Uint8Array(ctBuf);

  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv, 0);
  packed.set(ct, iv.length);
  return bytesToBase64(packed);
}

/**
 * Decrypt the output of {@link aesEncrypt}. Throws on auth-tag failure or if
 * the packed buffer is too short to contain `iv(12) || tag(16)`.
 */
export async function aesDecrypt(packed: string, base64Key: string): Promise<string> {
  const bytes = base64ToBytes(packed);
  if (bytes.byteLength < 12 + 16) {
    throw new Error('aesDecrypt: packed buffer too short');
  }
  const iv = asBufferSource(bytes.subarray(0, 12));
  const ct = asBufferSource(bytes.subarray(12));
  const key = await importAesKey(base64Key);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return textDecoder.decode(plainBuf);
}
