/**
 * Admin / inspector routes — surfaces internal D1 + KV state for demo
 * walkthroughs without giving up the wrangler-tail debugging story.
 *
 * Auth: `requireAuth` only. The Leylek demo is single-tenant; any logged-in
 * user can read everything. A future multi-tenant version would need an
 * `isAdmin` claim (or row-level filters) — right now the value is showing
 * jury / team-mates that the "agent did X" claim is backed by actual DB rows.
 *
 * Endpoints:
 *   GET /api/admin/summary               — counts per D1 table + KV prefix
 *   GET /api/admin/d1?table=<name>&limit — last N rows from a whitelisted table
 *   GET /api/admin/kv?prefix=&limit      — KV keys under a prefix
 *   GET /api/admin/kv/value?key=         — single KV value (string)
 */

import { Hono } from 'hono';

import type { Env } from '../env';
import { type AuthVariables, requireAuth } from '../middleware/auth';

export const adminRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

adminRoutes.use('*', requireAuth);

/**
 * Whitelist of tables admin endpoints can read. SQLite parameterised
 * queries can't bind table names, so we interpolate — the whitelist is
 * what keeps it safe.
 */
const D1_TABLES = [
  'users',
  'connected_accounts',
  'campaigns',
  'ads',
  'agent_logs',
  'metric_snapshots',
  'notifications',
] as const;

type D1Table = (typeof D1_TABLES)[number];

const KV_PREFIXES = ['gads:', 'meta:', 'magic_link:', 'oauth_state:', 'sim:'] as const;

function clampLimit(raw: string | undefined, fallback: number, max: number): number {
  const n = Number.parseInt(raw ?? `${fallback}`, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

adminRoutes.get('/summary', async (c) => {
  const d1: Record<D1Table, number> = {} as Record<D1Table, number>;
  for (const t of D1_TABLES) {
    const r = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>();
    d1[t] = r?.n ?? 0;
  }
  const kv: Record<string, number> = {};
  for (const p of KV_PREFIXES) {
    const list = await c.env.KV.list({ prefix: p, limit: 1000 });
    kv[p] = list.keys.length;
  }
  return c.json({ d1, kv });
});

adminRoutes.get('/d1', async (c) => {
  const table = c.req.query('table');
  if (!table || !D1_TABLES.includes(table as D1Table)) {
    return c.json({ error: 'invalid_table', allowed: D1_TABLES }, 400);
  }
  const limit = clampLimit(c.req.query('limit'), 20, 200);
  const result = await c.env.DB.prepare(`SELECT * FROM ${table} ORDER BY id DESC LIMIT ?`)
    .bind(limit)
    .all();
  return c.json({ table, rows: result.results, count: result.results.length });
});

adminRoutes.get('/kv', async (c) => {
  const prefix = c.req.query('prefix') ?? '';
  const limit = clampLimit(c.req.query('limit'), 50, 500);
  const list = await c.env.KV.list({ prefix, limit });
  return c.json({
    prefix,
    keys: list.keys.map((k) => ({
      name: k.name,
      expiration: k.expiration ?? null,
    })),
    listComplete:
      'list_complete' in list ? (list as { list_complete?: boolean }).list_complete : true,
  });
});

adminRoutes.get('/kv/value', async (c) => {
  const key = c.req.query('key');
  if (!key || key.length === 0) {
    return c.json({ error: 'missing_key' }, 400);
  }
  const value = await c.env.KV.get(key);
  return c.json({ key, value });
});
