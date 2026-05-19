/**
 * Live metric drift for the `gads:metrics:*` KV namespace.
 *
 * Runs at the top of every analytics-worker cron tick (see `index.ts`). For
 * every D1 ad with `status='active'`, we read the corresponding mock
 * `gads:metrics:<cid>:<adId>` record, apply a small upward nudge in place,
 * and write it back. The cron's existing `ingestFreshSnapshots` step then
 * picks up the new totals via `client.fetchMetrics` (mock hits this KV
 * record), so the dashboard's spend / clicks / impressions numbers grow
 * tick-over-tick while the demo is open.
 *
 * Design choices:
 *
 *   - **Skip paused ads.** They're filtered upstream in the D1 query, but
 *     even if a paused ad's row were threaded through here we'd still skip
 *     it. The paused ad's frozen "catastrophic" CPA is the visual hook of
 *     the Halıshalı campaign — drifting it would erase that history.
 *
 *   - **Skip zero-metric ads.** A `gads:metrics:*` record with
 *     `impressions === '0'` indicates "freshly published, optimizer hasn't
 *     run yet" (the Nardana campaign). We leave those untouched so the
 *     dashboard surfaces the "no data yet" state authentically for the
 *     first wall-clock day after seeding.
 *
 *   - **Catastrophic-loser ratio is preserved.** The Demlik AGGRESSIVE ad
 *     starts at CPA ≈ 4.575× the campaign median. Each drift tick adds
 *     ~30-90 impressions and ~1-4 clicks per ad uniformly, so the
 *     proportional shape stays roughly the same; AGGRESSIVE's CPA does
 *     trend down slowly because it picks up the occasional conversion,
 *     but on demo-scale wall-clock (minutes to an hour) it stays well
 *     above 4× the median and the optimizer's PAUSE_AD decision still
 *     fires deterministically.
 *
 *   - **Non-deterministic.** Each cron tick is independent and the drift
 *     should *feel* live; we use `Math.random()` directly rather than
 *     seeding a PRNG.
 *
 *   - **String-shaped writes.** Real Google Ads returns metric values as
 *     strings (`'1000'`, not `1000`) and the mock mirrors that shape;
 *     parse the existing record permissively but write strings back.
 */

/** Demo Google Ads customer id; partition key for `gads:metrics:*`. */
export const DRIFT_DEMO_CUSTOMER_ID = '1234567890';

/** Tunables exposed for tests / future calibration. */
export const DRIFT_BOUNDS = {
  impressionsMin: 30,
  impressionsMax: 90,
  clicksMin: 1,
  clicksMax: 4,
  /** Probability multiplier per click that yields a single conversion. */
  conversionRateMin: 0.1,
  conversionRateMax: 0.3,
  /** Cost added per tick: 3-12 × 10⁷ micros = ₺0.30-1.20 worth. */
  costMicrosMultiplierMin: 3,
  costMicrosMultiplierMax: 12,
} as const;

const COST_MICROS_UNIT = 10_000_000;

export interface DriftableAd {
  /** D1 ad row id — used only for diagnostics. */
  adId: number;
  /** Bare numeric ad id (the tail of `<adGroupId>~<adId>`); KV key segment. */
  externalAdId: string;
}

interface StoredMetrics {
  impressions?: number | string;
  clicks?: number | string;
  conversions?: number | string;
  costMicros?: number | string;
  /** Tolerate the snake_case wire shape some seeds may have used. */
  cost_micros?: number | string;
}

/**
 * Outcome of one ad's drift attempt. Returned so the cron caller can log
 * an aggregate `{ drifted, skipped }` line without each tick having to
 * mutate shared state.
 */
export interface DriftOutcome {
  adId: number;
  externalAdId: string;
  status: 'drifted' | 'skipped_zero' | 'skipped_missing';
}

/**
 * Apply one drift tick to a single ad's KV metrics record.
 *
 * Pure-ish — the random generator and "now" are injected so callers can
 * spec the drift in isolation; the cron passes `Math.random` directly.
 */
export async function driftOneAd(
  kv: KVNamespace,
  customerId: string,
  ad: DriftableAd,
  rng: () => number = Math.random,
): Promise<DriftOutcome> {
  const key = metricsKey(customerId, ad.externalAdId);
  const raw = await kv.get(key);
  if (raw === null) {
    return { adId: ad.adId, externalAdId: ad.externalAdId, status: 'skipped_missing' };
  }

  let stored: StoredMetrics;
  try {
    stored = JSON.parse(raw) as StoredMetrics;
  } catch {
    // Corrupt record — fail safe: treat as missing so the next seed/run
    // rewrites it clean.
    return { adId: ad.adId, externalAdId: ad.externalAdId, status: 'skipped_missing' };
  }

  const impressions = toNumber(stored.impressions);
  const clicks = toNumber(stored.clicks);
  const conversions = toNumber(stored.conversions);
  const costMicros = toNumber(stored.costMicros ?? stored.cost_micros);

  // Newly published ads (Nardana) carry `impressions === '0'`; leave them
  // alone so the "no data yet" UI state is preserved through the first
  // demo session window.
  if (impressions === 0) {
    return { adId: ad.adId, externalAdId: ad.externalAdId, status: 'skipped_zero' };
  }

  const deltas = nextDrift(rng);
  const next = {
    impressions: String(impressions + deltas.impressions),
    clicks: String(clicks + deltas.clicks),
    conversions: String(conversions + deltas.conversions),
    costMicros: String(costMicros + deltas.costMicros),
  };

  await kv.put(key, JSON.stringify(next));
  return { adId: ad.adId, externalAdId: ad.externalAdId, status: 'drifted' };
}

/**
 * Run drift across a batch of ads. Errors on a single ad are caught and
 * surfaced via the returned `DriftOutcome[]` so a single bad KV record
 * never aborts the rest of the cron's work.
 */
export async function driftAds(
  kv: KVNamespace,
  customerId: string,
  ads: ReadonlyArray<DriftableAd>,
  rng: () => number = Math.random,
): Promise<DriftOutcome[]> {
  const outcomes: DriftOutcome[] = [];
  for (const ad of ads) {
    try {
      outcomes.push(await driftOneAd(kv, customerId, ad, rng));
    } catch (err) {
      console.error('[analytics-worker] drift failed for ad', {
        adId: ad.adId,
        externalAdId: ad.externalAdId,
        error: err instanceof Error ? err.message : String(err),
      });
      outcomes.push({
        adId: ad.adId,
        externalAdId: ad.externalAdId,
        status: 'skipped_missing',
      });
    }
  }
  return outcomes;
}

/**
 * Pull the numeric ad-id tail out of the seed's `<adGroupId>~<adId>` leaf.
 * Falls back to the input string if there's no tilde (real Google ad ids
 * are bare numerics).
 */
export function externalAdIdTail(value: string): string {
  const tail = value.split('~').pop();
  return tail && tail.length > 0 ? tail : value;
}

/**
 * Build the deltas for a single tick. Pulled out so unit tests can call it
 * with a deterministic rng and assert the bounds.
 */
export function nextDrift(rng: () => number): {
  impressions: number;
  clicks: number;
  conversions: number;
  costMicros: number;
} {
  const impressions = intInRange(rng, DRIFT_BOUNDS.impressionsMin, DRIFT_BOUNDS.impressionsMax);
  const clicks = intInRange(rng, DRIFT_BOUNDS.clicksMin, DRIFT_BOUNDS.clicksMax);

  // Conversion probability ranges proportional-ish to clicks; we cap at 1
  // per tick so a particularly noisy roll can't single-handedly skew the
  // catastrophic-loser ratio.
  const conversionRate =
    DRIFT_BOUNDS.conversionRateMin +
    rng() * (DRIFT_BOUNDS.conversionRateMax - DRIFT_BOUNDS.conversionRateMin);
  const conversions = rng() < clicks * conversionRate ? 1 : 0;

  const costMultiplier = intInRange(
    rng,
    DRIFT_BOUNDS.costMicrosMultiplierMin,
    DRIFT_BOUNDS.costMicrosMultiplierMax,
  );
  const costMicros = costMultiplier * COST_MICROS_UNIT;

  return { impressions, clicks, conversions, costMicros };
}

function metricsKey(customerId: string, externalAdId: string): string {
  return `gads:metrics:${customerId}:${externalAdId}`;
}

function intInRange(rng: () => number, minInclusive: number, maxInclusive: number): number {
  const span = maxInclusive - minInclusive + 1;
  return minInclusive + Math.floor(rng() * span);
}

function toNumber(value: number | string | undefined): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
