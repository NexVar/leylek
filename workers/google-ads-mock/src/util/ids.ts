/**
 * 16 hex chars from 8 random bytes — same shape as `SimulatedAdsClient`.
 * Deliberately not `crypto.randomUUID()` because we use `~` as a separator
 * in adGroupAds resource names and UUID dashes would muddy the leaf.
 */
export function genId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
