/**
 * Product URL scraping with graceful fallback.
 *
 * The demo product URL (`https://demlik.pro/akilli-cay-demleme-cihazi`)
 * may not resolve — per AGENT_DECISIONS.md the agent MUST stay green when
 * the page is unreachable. On any fetch error / non-2xx / timeout we
 * synthesise a slug-derived hint so Gemini still has _something_ to bite on.
 */

const FETCH_TIMEOUT_MS = 5_000;
const MAX_CONTENT_BYTES = 4_096;

export interface ScrapeResult {
  content: string;
  mode: 'fetched' | 'fallback';
}

export async function scrapeProductUrl(productUrl: string): Promise<ScrapeResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(productUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          // A boring desktop UA — many storefronts 403 unknown bots.
          'user-agent': 'Mozilla/5.0 (compatible; LeylekContentAgent/1.0; +https://leylek.app)',
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'tr-TR,tr;q=0.9,en;q=0.5',
        },
      });
      if (!res.ok) {
        return { content: fallbackFromUrl(productUrl), mode: 'fallback' };
      }
      const html = await res.text();
      const stripped = stripHtml(html).slice(0, MAX_CONTENT_BYTES);
      if (stripped.length < 40) {
        // Page loaded but is empty/JS-only — fall back so Gemini isn't fed garbage.
        return { content: fallbackFromUrl(productUrl), mode: 'fallback' };
      }
      return { content: stripped, mode: 'fetched' };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return { content: fallbackFromUrl(productUrl), mode: 'fallback' };
  }
}

/**
 * Strip HTML to plain text. Cheap and good enough for first-pass content extraction:
 *   - drop <script> / <style> blocks entirely
 *   - replace remaining tags with whitespace
 *   - decode a handful of common HTML entities
 *   - collapse whitespace
 *
 * We deliberately do not pull in a DOM parser — Workers don't ship one and the
 * heavyweight options bloat the bundle without buying much for ad-copy hints.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build a synthetic content hint from the URL when the page can't be fetched.
 * `https://demlik.pro/akilli-cay-demleme-cihazi` -> "akilli cay demleme cihazi".
 *
 * Adds the hostname so Gemini at least knows the vendor, and prefixes a marker
 * sentence so the model is told (not tricked into thinking the page worked).
 */
function fallbackFromUrl(productUrl: string): string {
  let host = '';
  let slug = '';
  try {
    const u = new URL(productUrl);
    host = u.hostname.replace(/^www\./, '');
    const segments = u.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1] ?? '';
    slug = decodeURIComponent(last)
      .replace(/\.[a-z0-9]+$/i, '') // drop extension
      .replace(/[-_]+/g, ' ')
      .trim();
  } catch {
    // Malformed URL — treat the whole thing as a slug.
    slug = productUrl.replace(/[^a-zA-Z0-9]+/g, ' ').trim();
  }

  const hint = [slug, host].filter(Boolean).join(' — ');
  return [
    '[FALLBACK] The product page could not be fetched.',
    'Use the URL slug as a hint for what the product is, and write copy that is',
    'broadly applicable to that product category.',
    `Hint: ${hint || productUrl}`,
  ].join(' ');
}
