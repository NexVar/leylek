/**
 * crypto.ts — Web Crypto API helpers for the gateway Worker.
 *
 * Two responsibilities:
 *
 *   1. JWT (HS256) — sign + verify the session cookie payload.
 *   2. AES-256-GCM — envelope encryption for OAuth tokens persisted in
 *      `connected_accounts.enc_access_token` / `enc_refresh_token`.
 *
 * Workers Runtime is Web Standards: no `Buffer`, no `crypto` from Node. We use
 * `crypto.subtle` directly. Base64 strings are produced/consumed via the
 * `atob` / `btoa` builtins; the AES tag is treated as the trailing 16 bytes of
 * `ciphertext` per WebCrypto's `AES-GCM` output convention.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface JwtPayload {
  /** Subject — stringified user id. JWT spec requires a string. */
  sub: string;
  /** Issuer — checked against `env.JWT_ISSUER`. */
  iss: string;
  /** Issued-at, seconds since epoch. */
  iat: number;
  /** Expiry, seconds since epoch. */
  exp: number;
  /** Optional extras — keep open for downstream usage. */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  // Cap chunk size to avoid call-stack overflow on large inputs.
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

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return base64ToBytes(padded + padding);
}

/**
 * Workers' `@cloudflare/workers-types` types `Uint8Array<ArrayBufferLike>`,
 * but SubtleCrypto's `BufferSource` expects `ArrayBufferView<ArrayBuffer>`.
 * The two are structurally identical at runtime; we paper over the variance
 * by copying the bytes into a fresh `Uint8Array` whose backing buffer is a
 * plain `ArrayBuffer`. Costs one extra small allocation per call.
 */
function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  out.set(bytes);
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: bounds checked by loop guard
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// JWT — HS256
// ---------------------------------------------------------------------------
async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Sign a JWT (HS256). Adds `iat`, `exp`, `iss` to the caller-supplied payload.
 */
export async function signJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp' | 'iss'> & { sub: string },
  secret: string,
  issuer: string,
  ttlSeconds: number,
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    ...payload,
    iss: issuer,
    iat: now,
    exp: now + ttlSeconds,
  };

  const headerSeg = bytesToBase64Url(textEncoder.encode(JSON.stringify(header)));
  const payloadSeg = bytesToBase64Url(textEncoder.encode(JSON.stringify(fullPayload)));
  const signingInput = `${headerSeg}.${payloadSeg}`;

  const key = await importHmacKey(secret);
  const sigBuf = await crypto.subtle.sign('HMAC', key, textEncoder.encode(signingInput));
  const sigSeg = bytesToBase64Url(new Uint8Array(sigBuf));
  return `${signingInput}.${sigSeg}`;
}

/**
 * Verify a JWT. Returns the payload on success, `null` on any failure
 * (malformed, bad signature, expired, wrong issuer).
 */
export async function verifyJwt(
  token: string,
  secret: string,
  issuer: string,
): Promise<JwtPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerSeg, payloadSeg, sigSeg] = parts as [string, string, string];

    const expected = base64UrlToBytes(sigSeg);
    const key = await importHmacKey(secret);
    const actualSigBuf = await crypto.subtle.sign(
      'HMAC',
      key,
      textEncoder.encode(`${headerSeg}.${payloadSeg}`),
    );
    const actual = new Uint8Array(actualSigBuf);
    if (!constantTimeEqual(actual, expected)) return null;

    const payloadJson = textDecoder.decode(base64UrlToBytes(payloadSeg));
    const payload = JSON.parse(payloadJson) as JwtPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (payload.iss !== issuer) return null;
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AES-256-GCM
// ---------------------------------------------------------------------------
async function importAesKey(base64Key: string): Promise<CryptoKey> {
  const raw = base64ToBytes(base64Key);
  if (raw.byteLength !== 32) {
    throw new Error(`AES_KEY_BASE must decode to 32 bytes, got ${raw.byteLength}`);
  }
  return crypto.subtle.importKey('raw', asBufferSource(raw), { name: 'AES-GCM' }, false, [
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
