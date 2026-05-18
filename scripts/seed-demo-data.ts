/**
 * Leylek demo data seeder.
 *
 * Writes a deterministic 48 h fake history into Cloudflare D1 + KV so the
 * jury sees a populated dashboard the moment they log in:
 *
 *   - 1 demo user (`batuhanbayazitt@gmail.com`)
 *   - 1 connected `google_ads` account (numeric customer id pinned)
 *   - 1 active campaign ("Demlik Pro — Akıllı Çay Demleme Cihazı")
 *   - 3 ads (AGGRESSIVE / STORY / TECHNICAL) with the catastrophic-loser
 *     metric curves from docs/AGENT_DECISIONS.md §5
 *   - 8×6 h `metric_snapshots` buckets per ad — totals match the table exactly
 *   - 3 pre-existing `CREATED_AD` rows in `agent_logs` (publisher agent)
 *   - `gads:*` KV entries shaped the way `RealGoogleAdsClient` expects
 *     when its `baseUrl` points at the `leylek-google-ads-mock` Worker
 *     (mockdata.md). Flipping `GOOGLE_ADS_BASE_URL` to the real Google
 *     endpoint and re-binding per-user OAuth credentials is the only
 *     change needed to go to production.
 *
 * Idempotent: re-running this script produces the exact same final state.
 * The only randomness is in the bucket-level distribution of impressions /
 * clicks / conv / spend, and that is driven by a seeded PRNG (Mulberry32)
 * so the bucket rows are byte-stable across reruns.
 *
 * Transport: pure `fetch` against the Cloudflare REST API.  No `wrangler`
 * dependency.  Reads credentials from `.env` (gitignored) or env vars.
 *
 * Run (from repo root):
 *   pnpm db:seed
 *
 * PRD: §4 (60 sn demo), §8 (D1 schema), §10 (port + adapter), §15 (jury).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Config / constants
// ---------------------------------------------------------------------------

const DEMO_USER = {
  email: 'batuhanbayazitt@gmail.com',
  providerSub: 'demo-google-sub-batuhan',
  name: 'Batuhan Bayazıt',
  companyName: 'Demlik Co.',
} as const;

/**
 * Numeric Google Ads ids. `customerId` must match DEMO_CREDENTIALS in
 * publisher-agent/src/index.ts and analytics-worker/src/index.ts — both
 * the seed and the runtime use this as the KV key partition.
 *
 * Ids are deliberately tiny so they're easy to spot in logs; real Google
 * ids would be 10-19 digit numbers. The mock doesn't enforce either way.
 */
const GADS = {
  customerId: '1234567890',
  campaignId: '2001',
  budgetId: '3001',
} as const;

const DEMO_CAMPAIGN = {
  productUrl: 'https://demlik.pro/akilli-cay-demleme-cihazi',
  /** Stored on `campaigns.do_id`; consumed by publisher-agent + optimizer. */
  externalId: GADS.campaignId,
  dailyBudgetKurus: 100_000,
  // Friendly name not stored in D1 today; campaigns table has no `name`
  // column — the product URL is the handle. Used in KV records only.
  displayName: 'Demlik Pro — Akıllı Çay Demleme Cihazı',
} as const;

const CONNECTED_ACCOUNT = {
  provider: 'google_ads',
  externalId: GADS.customerId,
  accountLabel: 'Demlik',
} as const;

interface DemoAdSpec {
  /** `<adGroupId>~<adId>` — Google's resource leaf shape; stored on `ads.googleAdId`. */
  externalId: string;
  adGroupId: string;
  adId: string;
  strategyType: 'AGGRESSIVE' | 'STORY' | 'TECHNICAL';
  adText: string;
  imagePrompt: string;
  spendKurus: number;
  cpaKurus: number;
  ctrBasisPoints: number;
  // Aggregate totals over the full 48 h window
  impressions: number;
  clicks: number;
  conversions: number;
  agentLogReason: string;
}

/**
 * Numbers are pinned to docs/AGENT_DECISIONS.md §5.  Don't tweak in isolation:
 * the optimizer-agent prompt's "catastrophic loser" branch depends on
 * Ad-1 CPA ≈ 4.575× median, so changing these breaks the demo decision.
 */
const ADS: readonly DemoAdSpec[] = [
  {
    externalId: '4001~5001',
    adGroupId: '4001',
    adId: '5001',
    strategyType: 'AGGRESSIVE',
    adText:
      'Çayını 3 dakikada mükemmel demle.\nDemlik Pro ile ilk 100 sipariş %40 indirim — bugün bitmeden sepete ekle, çay keyfini bir üst seviyeye taşı.',
    imagePrompt:
      'High-contrast product hero of a sleek Turkish smart tea brewer with warm steam, marketplace banner style.',
    spendKurus: 1_100_000,
    cpaKurus: 18_333,
    ctrBasisPoints: 210,
    impressions: 10_500,
    clicks: 220,
    conversions: 60,
    agentLogReason:
      'AGGRESSIVE varyantı yayına alındı: kısa, kıtlık + indirim çerçeveli copy ile yüksek CTR hedeflendi.',
  },
  {
    externalId: '4002~5002',
    adGroupId: '4002',
    adId: '5002',
    strategyType: 'STORY',
    adText:
      'Anneannemin pazar sabahları demlediği çayın o kokusu vardı, hatırlar mısınız?\nDemlik Pro bu sabahları geri getiriyor — her bardakta aynı sıcaklık, aynı huzur.',
    imagePrompt:
      'Soft morning light on a wooden kitchen table, vintage Turkish tea glasses next to a modern brewer, nostalgic mood.',
    spendKurus: 375_000,
    cpaKurus: 1_500,
    ctrBasisPoints: 400,
    impressions: 13_000,
    clicks: 520,
    conversions: 250,
    agentLogReason:
      'STORY varyantı yayına alındı: duygusal nostaljik anlatım, KOBİ Türk hedef kitlesinde dönüşüm beklendi.',
  },
  {
    externalId: '4003~5003',
    adGroupId: '4003',
    adId: '5003',
    strategyType: 'TECHNICAL',
    adText:
      'Demlik Pro: çift kademe sıcaklık kontrolü (60-95°C), 5 demleme programı, mobil uygulamadan zamanlama, ısı kaybı yalıtımı.\nLaboratuvarda test edilmiş tutarlılık, sertifikalı paslanmaz çelik gövde.',
    imagePrompt:
      'Top-down exploded view of a precision tea brewer, callouts for temperature sensor, timer, insulated steel chamber.',
    spendKurus: 380_000,
    cpaKurus: 4_000,
    ctrBasisPoints: 300,
    impressions: 9_500,
    clicks: 285,
    conversions: 95,
    agentLogReason:
      'TECHNICAL varyantı yayına alındı: spesifikasyon-odaklı copy ile karşılaştırmacı alıcı segmenti hedeflendi.',
  },
] as const;

const BUCKET_COUNT = 8;
const HOURS_PER_BUCKET = 6;
const SEED = 0x1eaf_5eed; // stable across reruns

// Internal sanity check — script will hard-fail at startup if any total
// doesn't match what the AGENT_DECISIONS table promises.
for (const ad of ADS) {
  const computedCtrBp = Math.round((ad.clicks / ad.impressions) * 10_000);
  if (computedCtrBp !== ad.ctrBasisPoints) {
    throw new Error(
      `Bad spec for ${ad.externalId}: computed ctrBp=${computedCtrBp} != ${ad.ctrBasisPoints}`,
    );
  }
  if (ad.conversions > 0) {
    const computedCpa = Math.round(ad.spendKurus / ad.conversions);
    if (computedCpa !== ad.cpaKurus) {
      throw new Error(
        `Bad spec for ${ad.externalId}: computed cpaKurus=${computedCpa} != ${ad.cpaKurus}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Colors (TTY only)
// ---------------------------------------------------------------------------

const isTTY = process.stdout.isTTY === true;
const c = {
  reset: isTTY ? '\x1b[0m' : '',
  bold: isTTY ? '\x1b[1m' : '',
  dim: isTTY ? '\x1b[2m' : '',
  red: isTTY ? '\x1b[31m' : '',
  green: isTTY ? '\x1b[32m' : '',
  yellow: isTTY ? '\x1b[33m' : '',
  cyan: isTTY ? '\x1b[36m' : '',
} as const;

function info(msg: string): void {
  console.log(`${c.cyan}[seed]${c.reset} ${msg}`);
}
function ok(msg: string): void {
  console.log(`  ${c.green}ok${c.reset}   ${msg}`);
}
function warn(msg: string): void {
  console.log(`  ${c.yellow}warn${c.reset} ${msg}`);
}
function fatal(msg: string): never {
  console.error(`${c.red}${c.bold}FATAL${c.reset} ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// .env loader (no dotenv dependency — small parser inline)
// ---------------------------------------------------------------------------

function loadEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..');
  const envPath = resolve(repoRoot, '.env');
  if (!existsSync(envPath)) {
    warn(`.env not found at ${envPath}; relying on process.env`);
    return;
  }
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip optional matched quotes
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    fatal(`Missing required env var ${name} (check .env or shell environment)`);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Cloudflare REST helpers
// ---------------------------------------------------------------------------

interface D1QueryResultBlock<T> {
  results: T[];
  meta: {
    last_row_id?: number;
    changes?: number;
    rows_written?: number;
    rows_read?: number;
  };
  success: boolean;
}

interface D1Envelope<T> {
  result: D1QueryResultBlock<T>[];
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
}

interface KvBulkEnvelope {
  success: boolean;
  result?: {
    successful_key_count: number;
    unsuccessful_keys: string[];
  };
  errors: Array<{ code: number; message: string }>;
}

class Cloudflare {
  constructor(
    private readonly accountId: string,
    private readonly apiToken: string,
    private readonly d1DbId: string,
    private readonly kvNamespaceId: string,
  ) {}

  async d1<T = Record<string, unknown>>(
    sql: string,
    params: ReadonlyArray<string | number | null> = [],
  ): Promise<D1QueryResultBlock<T>> {
    const url =
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}` +
      `/d1/database/${this.d1DbId}/query`;
    // Cloudflare D1 only accepts string params via REST; coerce defensively.
    const stringParams = params.map((p) => {
      if (p === null) return null;
      if (typeof p === 'number') return p; // D1 accepts numbers too in REST
      return p;
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params: stringParams }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `D1 query failed (${res.status}): ${text.slice(0, 800)}\n` + `SQL: ${sql.slice(0, 200)}…`,
      );
    }
    const env = JSON.parse(text) as D1Envelope<T>;
    if (!env.success) {
      const reason = env.errors?.map((e) => `${e.code} ${e.message}`).join('; ') ?? 'unknown';
      throw new Error(`D1 query API returned success=false: ${reason}\nSQL: ${sql}`);
    }
    const first = env.result[0];
    if (!first) {
      throw new Error(`D1 returned empty result array.\nSQL: ${sql}`);
    }
    return first;
  }

  /**
   * Bulk KV write — up to 10 000 pairs in one request.  We have a handful of
   * entries, but using bulk avoids the multipart/form-data dance the
   * single-key endpoint requires.
   */
  async kvBulkPut(pairs: ReadonlyArray<{ key: string; value: string }>): Promise<void> {
    if (pairs.length === 0) return;
    const url =
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}` +
      `/storage/kv/namespaces/${this.kvNamespaceId}/bulk`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(pairs),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`KV bulk PUT failed (${res.status}): ${text.slice(0, 800)}`);
    }
    const env = JSON.parse(text) as KvBulkEnvelope;
    if (!env.success) {
      const reason = env.errors?.map((e) => `${e.code} ${e.message}`).join('; ') ?? 'unknown';
      throw new Error(`KV bulk API returned success=false: ${reason}`);
    }
    if (env.result && env.result.unsuccessful_keys.length > 0) {
      throw new Error(
        `KV bulk reported unsuccessful keys: ${env.result.unsuccessful_keys.join(', ')}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Seeded PRNG — Mulberry32.
//
// Tiny, fast, deterministic, 2^32 period.  Plenty for distributing 8 bucket
// weights per ad.  Picked over a CSPRNG because reproducibility across
// reruns is the whole point.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b_79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Split `total` into exactly `bucketCount` non-negative integers whose sum
 * equals `total`, using PRNG-derived weights and the largest-remainder
 * method.  Bias term keeps each bucket roughly in [60%, 140%] of the mean
 * so no bucket goes pathologically empty or huge.
 */
function distribute(total: number, bucketCount: number, rng: () => number): number[] {
  if (total <= 0) return Array(bucketCount).fill(0);
  // Weights in [0.7, 1.3] — mild jitter, never zero.
  const weights: number[] = [];
  let weightSum = 0;
  for (let i = 0; i < bucketCount; i++) {
    const w = 0.7 + rng() * 0.6;
    weights.push(w);
    weightSum += w;
  }
  // Raw scaled values; track remainder for largest-remainder rounding.
  const raw: number[] = [];
  const ints: number[] = [];
  const remainders: Array<{ idx: number; frac: number }> = [];
  let assigned = 0;
  for (let i = 0; i < bucketCount; i++) {
    const w = weights[i];
    if (w === undefined) throw new Error('unreachable');
    const r = (total * w) / weightSum;
    const f = Math.floor(r);
    raw.push(r);
    ints.push(f);
    assigned += f;
    remainders.push({ idx: i, frac: r - f });
  }
  // Distribute the leftover units to buckets with the largest fractional part.
  remainders.sort((a, b) => b.frac - a.frac);
  let leftover = total - assigned;
  for (let i = 0; i < remainders.length && leftover > 0; i++) {
    const entry = remainders[i];
    if (entry === undefined) break;
    ints[entry.idx] = (ints[entry.idx] ?? 0) + 1;
    leftover -= 1;
  }
  // Sanity
  const check = ints.reduce((a, b) => a + b, 0);
  if (check !== total) {
    throw new Error(`distribute() invariant failed: ${check} != ${total}`);
  }
  return ints;
}

// ---------------------------------------------------------------------------
// Seed pipeline
// ---------------------------------------------------------------------------

async function upsertUser(cf: Cloudflare): Promise<number> {
  // SQLite UPSERT — D1 fully supports ON CONFLICT...DO UPDATE.
  const upsertSql = `
    INSERT INTO users (email, name, avatar_url, provider, provider_sub, company_name)
    VALUES (?, ?, NULL, 'google', ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      name = excluded.name,
      avatar_url = NULL,
      provider = excluded.provider,
      provider_sub = excluded.provider_sub,
      company_name = excluded.company_name
  `;
  await cf.d1(upsertSql, [
    DEMO_USER.email,
    DEMO_USER.name,
    DEMO_USER.providerSub,
    DEMO_USER.companyName,
  ]);
  const sel = await cf.d1<{ id: number }>('SELECT id FROM users WHERE email = ?', [
    DEMO_USER.email,
  ]);
  const row = sel.results[0];
  if (!row) throw new Error('User upsert returned no row');
  return row.id;
}

async function upsertConnectedAccount(cf: Cloudflare, userId: number): Promise<number> {
  const upsertSql = `
    INSERT INTO connected_accounts (
      user_id, provider, external_id, account_label, status
    )
    VALUES (?, ?, ?, ?, 'active')
    ON CONFLICT(user_id, provider, external_id) DO UPDATE SET
      account_label = excluded.account_label,
      status = 'active',
      last_used_at = CURRENT_TIMESTAMP
  `;
  await cf.d1(upsertSql, [
    userId,
    CONNECTED_ACCOUNT.provider,
    CONNECTED_ACCOUNT.externalId,
    CONNECTED_ACCOUNT.accountLabel,
  ]);
  const sel = await cf.d1<{ id: number }>(
    'SELECT id FROM connected_accounts WHERE user_id = ? AND provider = ? AND external_id = ?',
    [userId, CONNECTED_ACCOUNT.provider, CONNECTED_ACCOUNT.externalId],
  );
  const row = sel.results[0];
  if (!row) throw new Error('Connected account upsert returned no row');
  return row.id;
}

async function wipeDemoCampaignRows(cf: Cloudflare): Promise<void> {
  // We want exact idempotence on the campaign side: delete and re-insert.
  // Foreign-key cascades from `campaigns` would handle child tables in SQLite
  // *if* foreign_keys=ON.  D1 currently runs with foreign_keys OFF, so be
  // explicit and tear children down ourselves.
  const findIds = await cf.d1<{ id: number }>('SELECT id FROM campaigns WHERE product_url = ?', [
    DEMO_CAMPAIGN.productUrl,
  ]);
  const campaignIds = findIds.results.map((r) => r.id);
  if (campaignIds.length === 0) {
    info('  no pre-existing demo campaign rows to wipe');
    return;
  }
  // Build IN clause; we have ≤ a few IDs at most.
  const placeholders = campaignIds.map(() => '?').join(',');
  await cf.d1(
    `DELETE FROM metric_snapshots WHERE ad_id IN (SELECT id FROM ads WHERE campaign_id IN (${placeholders}))`,
    campaignIds,
  );
  await cf.d1(`DELETE FROM agent_logs WHERE campaign_id IN (${placeholders})`, campaignIds);
  await cf.d1(`DELETE FROM ads WHERE campaign_id IN (${placeholders})`, campaignIds);
  await cf.d1(`DELETE FROM campaigns WHERE id IN (${placeholders})`, campaignIds);
  info(`  wiped ${campaignIds.length} pre-existing demo campaign row(s) and children`);
}

async function insertCampaign(cf: Cloudflare, userId: number): Promise<number> {
  const insert = await cf.d1<{ id: number }>(
    `INSERT INTO campaigns (
       user_id, product_url, mode, daily_budget_kurus, status, do_id
     )
     VALUES (?, ?, 'OTOPILOT', ?, 'active', ?)
     RETURNING id`,
    [userId, DEMO_CAMPAIGN.productUrl, DEMO_CAMPAIGN.dailyBudgetKurus, DEMO_CAMPAIGN.externalId],
  );
  const row = insert.results[0];
  if (!row) throw new Error('Campaign insert returned no row');
  return row.id;
}

async function insertAds(cf: Cloudflare, campaignId: number): Promise<number[]> {
  const ids: number[] = [];
  for (const ad of ADS) {
    const insert = await cf.d1<{ id: number }>(
      `INSERT INTO ads (
         campaign_id, strategy_type, ad_text, image_prompt,
         google_ad_id, status, spend_kurus, cpa_kurus, ctr_basis_points
       )
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
       RETURNING id`,
      [
        campaignId,
        ad.strategyType,
        ad.adText,
        ad.imagePrompt,
        ad.externalId,
        ad.spendKurus,
        ad.cpaKurus,
        ad.ctrBasisPoints,
      ],
    );
    const row = insert.results[0];
    if (!row) throw new Error(`Ad insert returned no row for ${ad.externalId}`);
    ids.push(row.id);
    ok(`ad ${ad.strategyType.padEnd(11)} -> id=${row.id} (${ad.externalId})`);
  }
  return ids;
}

async function insertAgentLogs(
  cf: Cloudflare,
  campaignId: number,
  adIds: ReadonlyArray<number>,
): Promise<void> {
  for (let i = 0; i < ADS.length; i++) {
    const ad = ADS[i];
    const adId = adIds[i];
    if (!ad || adId === undefined) throw new Error('unreachable');
    await cf.d1(
      `INSERT INTO agent_logs (
         campaign_id, agent_name, action_taken, target_ref, reason, confidence, gemini_request_id
       )
       VALUES (?, 'publisher', 'CREATED_AD', ?, ?, 1.0, NULL)`,
      [campaignId, String(adId), ad.agentLogReason],
    );
  }
}

async function insertMetricSnapshots(cf: Cloudflare, adIds: ReadonlyArray<number>): Promise<void> {
  // PRNG is seeded per-script-run, not per-ad, so re-running yields identical
  // distributions for every bucket of every ad.
  const rng = mulberry32(SEED);
  const end = new Date('2026-05-19T00:00:00.000Z'); // pinned so snapshots are stable
  const totalRows = ADS.length * BUCKET_COUNT;
  info(`  inserting ${totalRows} metric_snapshots (${ADS.length} ads × ${BUCKET_COUNT} buckets)`);

  for (let i = 0; i < ADS.length; i++) {
    const ad = ADS[i];
    const adId = adIds[i];
    if (!ad || adId === undefined) throw new Error('unreachable');

    const impBuckets = distribute(ad.impressions, BUCKET_COUNT, rng);
    const clkBuckets = distribute(ad.clicks, BUCKET_COUNT, rng);
    const convBuckets = distribute(ad.conversions, BUCKET_COUNT, rng);
    const spendBuckets = distribute(ad.spendKurus, BUCKET_COUNT, rng);

    // Each bucket's snapshot_at is the END of the bucket (i.e. running totals
    // would be sums of older + this bucket).  We just record per-bucket deltas.
    for (let b = 0; b < BUCKET_COUNT; b++) {
      // Bucket index 0 is the oldest (48 h ago), BUCKET_COUNT-1 is the newest.
      const hoursAgo = (BUCKET_COUNT - 1 - b) * HOURS_PER_BUCKET;
      const snapshotAt = new Date(end.getTime() - hoursAgo * 3600 * 1000);
      const imp = impBuckets[b] ?? 0;
      const clk = clkBuckets[b] ?? 0;
      const conv = convBuckets[b] ?? 0;
      const spend = spendBuckets[b] ?? 0;
      await cf.d1(
        `INSERT INTO metric_snapshots (
           ad_id, snapshot_at, impressions, clicks, conversions, spend_kurus
         )
         VALUES (?, ?, ?, ?, ?, ?)`,
        [adId, snapshotAt.toISOString(), imp, clk, conv, spend],
      );
    }
  }
}

async function writeKvDemoState(cf: Cloudflare): Promise<void> {
  const nowIso = new Date('2026-05-19T00:00:00.000Z').toISOString();
  const cid = GADS.customerId;
  const budgetResourceName = `customers/${cid}/campaignBudgets/${GADS.budgetId}`;
  const campaignResourceName = `customers/${cid}/campaigns/${GADS.campaignId}`;
  // Daily budget in micros (Google API unit). 100_000 kurus = 1000 TRY = 1_000_000_000 micros.
  const dailyMicros = (DEMO_CAMPAIGN.dailyBudgetKurus / 100) * 1_000_000;

  const pairs: Array<{ key: string; value: string }> = [
    {
      key: `gads:customer:${cid}`,
      value: JSON.stringify({
        resourceName: `customers/${cid}`,
        id: cid,
        descriptiveName: CONNECTED_ACCOUNT.accountLabel,
        currencyCode: 'TRY',
        timeZone: 'Europe/Istanbul',
      }),
    },
    {
      key: `gads:budget:${cid}:${GADS.budgetId}`,
      value: JSON.stringify({
        resourceName: budgetResourceName,
        id: GADS.budgetId,
        name: `${DEMO_CAMPAIGN.displayName} budget`,
        amountMicros: dailyMicros,
        deliveryMethod: 'STANDARD',
        createdAt: nowIso,
      }),
    },
    {
      key: `gads:campaign:${cid}:${GADS.campaignId}`,
      value: JSON.stringify({
        resourceName: campaignResourceName,
        id: GADS.campaignId,
        name: DEMO_CAMPAIGN.displayName,
        status: 'ENABLED',
        advertisingChannelType: 'SEARCH',
        // The googleAds:search budget-lookup handler reads this field.
        campaignBudget: budgetResourceName,
        networkSettings: {
          target_google_search: true,
          target_search_network: false,
          target_content_network: false,
        },
        createdAt: nowIso,
      }),
    },
  ];

  for (const ad of ADS) {
    const adGroupResourceName = `customers/${cid}/adGroups/${ad.adGroupId}`;
    const adResourceName = `customers/${cid}/adGroupAds/${ad.externalId}`;
    const [headline, ...bodyParts] = ad.adText.split('\n');
    const body = bodyParts.join(' ').trim() || ad.adText;

    pairs.push({
      key: `gads:adGroup:${cid}:${ad.adGroupId}`,
      value: JSON.stringify({
        resourceName: adGroupResourceName,
        id: ad.adGroupId,
        name: `${ad.strategyType} group`,
        campaign: campaignResourceName,
        status: 'ENABLED',
        type: 'SEARCH_STANDARD',
        cpcBidMicros: 1_000_000,
        createdAt: nowIso,
      }),
    });

    pairs.push({
      key: `gads:ad:${cid}:${ad.externalId}`,
      value: JSON.stringify({
        resourceName: adResourceName,
        adGroup: adGroupResourceName,
        status: 'ENABLED',
        ad: {
          final_urls: [DEMO_CAMPAIGN.productUrl],
          responsive_search_ad: {
            headlines: [
              { text: (headline ?? 'Leylek').slice(0, 30) },
              { text: ad.strategyType.slice(0, 30) },
              { text: 'Leylek AI Reklam' },
            ],
            descriptions: [{ text: body.slice(0, 90) }, { text: 'Otonom AI reklam yönetimi' }],
          },
        },
        strategyType: ad.strategyType,
        adText: ad.adText,
        imagePrompt: ad.imagePrompt,
        createdAt: nowIso,
      }),
    });

    // Metrics record consumed by googleAds:search query 2. We key by the
    // bare numeric ad id so the GAQL `WHERE ad_group_ad.ad.id = <id>`
    // matches via the handler's direct lookup; values are strings to
    // mirror Google's wire shape.
    pairs.push({
      key: `gads:metrics:${cid}:${ad.adId}`,
      value: JSON.stringify({
        impressions: String(ad.impressions),
        clicks: String(ad.clicks),
        conversions: String(ad.conversions),
        // Google reports cost in micros: 1 currency unit = 1_000_000 micros.
        // Our spendKurus is in kurus (1 TRY = 100 kurus), so micros = kurus * 10_000.
        costMicros: String(ad.spendKurus * 10_000),
      }),
    });
  }

  await cf.kvBulkPut(pairs);
  ok(`KV bulk wrote ${pairs.length} gads:* keys`);
}

// ---------------------------------------------------------------------------
// Safety check — refuse if .env credentials don't look like the demo project.
// ---------------------------------------------------------------------------

function safetyCheck(d1DbId: string, kvNsId: string): void {
  // The repo's prod D1 + KV IDs are pinned in every worker's wrangler.toml
  // (see workers/publisher-agent/wrangler.toml).  If the .env points
  // somewhere else, this is probably a mis-copied token or a fresh
  // environment — bail loudly rather than silently seed someone else's DB.
  const expectedD1 = 'c20b810d-f5a9-464d-9fa9-8a33101948f7';
  const expectedKv = 'e9c37be505844e1dbdb0b83b8311ed17';
  if (d1DbId !== expectedD1) {
    fatal(
      `Refusing to run: CLOUDFLARE_D1_DATABASE_ID (${d1DbId}) does not match ` +
        `the leylek-prod D1 id pinned in workers/*/wrangler.toml (${expectedD1}).\n` +
        'If you really mean to seed a different database, set LEYLEK_SEED_FORCE=1.',
    );
  }
  if (kvNsId !== expectedKv) {
    fatal(
      `Refusing to run: CLOUDFLARE_KV_NAMESPACE_ID (${kvNsId}) does not match ` +
        `the KV namespace pinned in workers/*/wrangler.toml (${expectedKv}).\n` +
        'If you really mean to seed a different namespace, set LEYLEK_SEED_FORCE=1.',
    );
  }
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  loadEnv();

  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requireEnv('CLOUDFLARE_API_TOKEN');
  const d1DbId = requireEnv('CLOUDFLARE_D1_DATABASE_ID');
  const kvNamespaceId = requireEnv('CLOUDFLARE_KV_NAMESPACE_ID');

  if (process.env.LEYLEK_SEED_FORCE !== '1') {
    safetyCheck(d1DbId, kvNamespaceId);
  } else {
    warn('LEYLEK_SEED_FORCE=1 set — skipping D1/KV id sanity check');
  }

  const cf = new Cloudflare(accountId, apiToken, d1DbId, kvNamespaceId);

  info(`${c.bold}Leylek demo seeder${c.reset} — gads:* / meta:* KV layout`);
  info(
    `  account=${accountId.slice(0, 8)}…  d1=${d1DbId.slice(0, 8)}…  kv=${kvNamespaceId.slice(0, 8)}…`,
  );

  // 1. User
  info('1/6 upserting demo user');
  const userId = await upsertUser(cf);
  ok(`user ${DEMO_USER.email} -> id=${userId}`);

  // 2. Connected account
  info('2/6 upserting connected_accounts row');
  const accountRowId = await upsertConnectedAccount(cf, userId);
  ok(`connected_account google_ads:${CONNECTED_ACCOUNT.externalId} -> id=${accountRowId}`);

  // 3. Wipe + insert campaign
  info('3/6 wiping any previous demo campaign state');
  await wipeDemoCampaignRows(cf);

  info('4/6 inserting fresh campaign');
  const campaignId = await insertCampaign(cf, userId);
  ok(`campaign ${DEMO_CAMPAIGN.externalId} -> id=${campaignId}`);

  // 4. Ads + agent_logs
  info('5/6 inserting 3 ads + CREATED_AD agent_logs');
  const adIds = await insertAds(cf, campaignId);
  await insertAgentLogs(cf, campaignId, adIds);
  ok(`agent_logs (CREATED_AD × ${adIds.length})`);

  // 5. Metric snapshots
  info('6/6 inserting metric_snapshots + writing gads:* KV entries');
  await insertMetricSnapshots(cf, adIds);
  ok('metric_snapshots written');

  await writeKvDemoState(cf);

  console.log();
  console.log(
    `${c.green}${c.bold}✓ Seeded${c.reset} ` +
      `user=${userId}, campaign=${campaignId}, ads=[${adIds.join(', ')}]`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(`${c.red}${c.bold}seed-demo-data failed:${c.reset}\n${message}`);
  process.exit(1);
});
