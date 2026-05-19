import { describe, expect, it } from 'vitest';
import { aesDecrypt, aesEncrypt, signJwt, verifyJwt } from '../../workers/gateway/src/crypto';

// Test-only key material — constructed from a plain UTF-8 phrase so gitleaks
// doesn't flag it as a high-entropy secret. The real gateway derives a
// 32-byte AES key via SHA-256, so this becomes a stable derived key.
const AES_KEY = Buffer.from('leylek-unit-test-aes-key-not-a-real-secret').toString('base64');
const JWT_SECRET = 'leylek-unit-test-jwt-secret-not-a-real-secret';
const ISSUER = 'leylek-test';

describe('AES-256-GCM envelope', () => {
  it('encrypts and decrypts a roundtrip', async () => {
    const plain = 'ya29.A0Aae0EwYa-mock-refresh-token-XYZ';
    const ct = await aesEncrypt(plain, AES_KEY);
    expect(ct).toBeTypeOf('string');
    expect(ct.length).toBeGreaterThan(plain.length);
    const back = await aesDecrypt(ct, AES_KEY);
    expect(back).toBe(plain);
  });

  it('produces a different ciphertext each call (fresh IV)', async () => {
    const a = await aesEncrypt('same plaintext', AES_KEY);
    const b = await aesEncrypt('same plaintext', AES_KEY);
    expect(a).not.toBe(b);
    expect(await aesDecrypt(a, AES_KEY)).toBe('same plaintext');
    expect(await aesDecrypt(b, AES_KEY)).toBe('same plaintext');
  });

  it('throws on tampered ciphertext (GCM auth tag catches it)', async () => {
    const ct = await aesEncrypt('sensitive', AES_KEY);
    // Flip a bit somewhere in the middle of the packed buffer.
    const bytes = Buffer.from(ct, 'base64');
    bytes[20] = (bytes[20] ?? 0) ^ 0x01;
    const tampered = bytes.toString('base64');
    await expect(aesDecrypt(tampered, AES_KEY)).rejects.toThrow();
  });

  it('throws on a different key', async () => {
    const ct = await aesEncrypt('sensitive', AES_KEY);
    const otherKey = 'differentDifferentDifferentDifferentDifferentDifferentDifferentXYZA';
    await expect(aesDecrypt(ct, otherKey)).rejects.toThrow();
  });
});

describe('JWT (HS256)', () => {
  it('signs + verifies a payload', async () => {
    const token = await signJwt({ sub: '42' }, JWT_SECRET, ISSUER, 60);
    expect(token.split('.')).toHaveLength(3);
    const payload = await verifyJwt(token, JWT_SECRET, ISSUER);
    expect(payload?.sub).toBe('42');
    expect(payload?.iss).toBe(ISSUER);
    expect(payload?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signJwt({ sub: '1' }, JWT_SECRET, ISSUER, 60);
    expect(await verifyJwt(token, 'wrong-secret', ISSUER)).toBeNull();
  });

  it('rejects a token from a different issuer', async () => {
    const token = await signJwt({ sub: '1' }, JWT_SECRET, ISSUER, 60);
    expect(await verifyJwt(token, JWT_SECRET, 'leylek-other')).toBeNull();
  });

  it('rejects an expired token', async () => {
    // ttl=-1 → exp in the past. iat in the past too; verify must reject.
    const token = await signJwt({ sub: '1' }, JWT_SECRET, ISSUER, -1);
    expect(await verifyJwt(token, JWT_SECRET, ISSUER)).toBeNull();
  });

  it('rejects a malformed token', async () => {
    expect(await verifyJwt('not.a.jwt', JWT_SECRET, ISSUER)).toBeNull();
    expect(await verifyJwt('only-one-segment', JWT_SECRET, ISSUER)).toBeNull();
    expect(await verifyJwt('', JWT_SECRET, ISSUER)).toBeNull();
  });
});
