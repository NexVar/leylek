/**
 * Minimal classnames joiner. Avoids the `clsx` dep — we don't need the
 * full feature set, just truthy-string concatenation.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p)).join(' ');
}
