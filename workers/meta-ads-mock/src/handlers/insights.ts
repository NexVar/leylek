/**
 * GET /v21.0/:adId/insights — Meta Marketing API insights edge.
 *
 * Real Meta returns rows in a `{ data: [...], paging: {...} }` envelope.
 * Every numeric metric comes back as a **string** in the response (this
 * is documented Meta behaviour, not a quirk of the SDK), and `spend` is
 * an account-currency decimal (e.g. `'12.50'`), NOT minor units. The
 * future `RealMetaAdsClient.fetchMetrics` multiplies spend by 100 to
 * convert back to kuruş.
 *
 * State source: `meta:insights:<adId>` is populated by the seed script
 * (Faz 6) and never written by this worker. We just read it back and
 * project to the documented response shape. If the key is missing —
 * e.g. an ad created by an end-to-end test but never seeded — return a
 * zero row so the caller still gets a well-formed payload.
 *
 * Date presets accepted (subset of Meta's full list, picked to cover
 * what `RealMetaAdsClient` actually requests):
 *   today, yesterday, last_2_days, last_3_days, last_7_days
 * Anything else still returns a row, but with `last_7_days` window
 * arithmetic — Meta is also lenient on unknown presets.
 */
import type { Context } from 'hono';

import type { Env } from '../env';
import { jitter } from '../util/jitter';

interface StoredInsightAction {
  action_type: string;
  value: string;
}

interface StoredInsightRow {
  impressions: string;
  clicks: string;
  spend: string;
  actions?: StoredInsightAction[];
  date_start?: string;
  date_stop?: string;
}

type StoredInsight = StoredInsightRow | { data: StoredInsightRow[] };

const PRESET_DAYS: Record<string, number> = {
  today: 1,
  yesterday: 1,
  last_2_days: 2,
  last_3_days: 3,
  last_7_days: 7,
};

function dateWindowForPreset(preset: string): { start: string; stop: string } {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (preset === 'today') {
    return { start: today, stop: today };
  }
  if (preset === 'yesterday') {
    const y = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    return { start: y, stop: y };
  }
  const days = PRESET_DAYS[preset] ?? 7;
  // Inclusive window: today minus (days-1).
  const start = new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return { start, stop: today };
}

function normaliseStored(stored: StoredInsight | null): StoredInsightRow | null {
  if (!stored) return null;
  // Seed may write either the row directly or the full {data:[row]} envelope.
  if ('data' in stored && Array.isArray(stored.data)) {
    return stored.data[0] ?? null;
  }
  if ('impressions' in stored) {
    return stored;
  }
  return null;
}

export async function getInsights(c: Context<{ Bindings: Env }>): Promise<Response> {
  await jitter();

  const adId = c.req.param('adId');
  if (!adId) {
    return c.json(
      { error: { message: 'Missing ad id', type: 'GraphMethodException', code: 100 } },
      400,
    );
  }

  const preset = c.req.query('date_preset') ?? 'last_7_days';
  const { start: dateStart, stop: dateStop } = dateWindowForPreset(preset);

  const raw = await c.env.KV.get(`meta:insights:${adId}`);
  const stored = raw ? (JSON.parse(raw) as StoredInsight) : null;
  const row = normaliseStored(stored);

  const responseRow = row
    ? {
        impressions: row.impressions,
        clicks: row.clicks,
        spend: row.spend,
        actions: row.actions ?? [],
        date_start: row.date_start ?? dateStart,
        date_stop: row.date_stop ?? dateStop,
      }
    : {
        impressions: '0',
        clicks: '0',
        spend: '0',
        actions: [] as StoredInsightAction[],
        date_start: dateStart,
        date_stop: dateStop,
      };

  return c.json({
    data: [responseRow],
    paging: {
      cursors: {
        before: 'MAZDZD',
        after: 'MAZDZD',
      },
    },
  });
}
