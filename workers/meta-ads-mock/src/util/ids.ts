/**
 * Meta object IDs are numeric integers in production (campaign, adset, ad,
 * account all use 15-17 digit base-10 IDs). The future `RealMetaAdsClient`
 * holds them as `string` values, so we return strings here too — but we
 * shape them to look like real Meta IDs so log lines and KV keys are
 * indistinguishable from production.
 *
 * Implementation: 17-digit numeric string, derived from 8 random bytes via
 * `crypto.getRandomValues`. The leading digit is always `1` to avoid the
 * confusing "leading zero" case (which `parseInt` would silently strip).
 */
export function genMetaId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  // 17-digit numeric string; truncate to fit, prefix `1` to avoid leading zeros.
  return `1${(n % 10_000_000_000_000_000n).toString().padStart(16, '0')}`;
}
