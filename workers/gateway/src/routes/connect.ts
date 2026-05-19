/**
 * Reklam hesabı bağlama routes — list/disconnect + sandbox-mock OAuth.
 *
 * - `GET /api/auth/accounts`               : list current user's connected
 *                                            ad accounts; encrypted tokens are
 *                                            stripped before serialisation.
 * - `POST /api/auth/accounts/connect`      : simulate the OAuth dance against
 *                                            the leylek-*-mock Workers and
 *                                            persist a connected_accounts row.
 * - `POST /api/auth/accounts/:id/disconnect`: mark a row `revoked` and clear
 *                                            its encrypted token columns.
 *
 * Real Google OAuth + Meta OAuth shipping in Faz 2 (PRD §17) — production
 * deploy flips `*_BASE_URL` env to the live endpoints and adds the real
 * OAuth start/callback dance. Until then the sandbox-mock path lets the
 * UI demonstrate the full "connect → account in list" flow end-to-end.
 */

import { schema } from '@leylek/db';
import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import { z } from 'zod';

import { aesEncrypt } from '../crypto';
import type { Env } from '../env';
import { type AuthVariables, requireAuth } from '../middleware/auth';

export const adAccountRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// ---------------------------------------------------------------------------
// GET /api/auth/accounts — list the current user's linked ad accounts.
//
// Critically: never serialise `encAccessToken` / `encRefreshToken`. They're
// AES ciphertexts (still useless to a client) but emitting them widens the
// blast radius of any future XSS or log capture; safer to omit by default.
// ---------------------------------------------------------------------------
adAccountRoutes.get('/accounts', requireAuth, async (c) => {
  const userId = Number(c.get('userId'));
  const db = drizzle(c.env.DB, { schema });

  const rows = await db
    .select({
      id: schema.connectedAccounts.id,
      provider: schema.connectedAccounts.provider,
      externalId: schema.connectedAccounts.externalId,
      accountLabel: schema.connectedAccounts.accountLabel,
      status: schema.connectedAccounts.status,
      connectedAt: schema.connectedAccounts.connectedAt,
      lastUsedAt: schema.connectedAccounts.lastUsedAt,
    })
    .from(schema.connectedAccounts)
    .where(eq(schema.connectedAccounts.userId, userId))
    .orderBy(desc(schema.connectedAccounts.connectedAt));

  return c.json({ accounts: rows });
});

// ---------------------------------------------------------------------------
// POST /api/auth/accounts/:id/disconnect — revoke + scrub stored tokens.
// ---------------------------------------------------------------------------
adAccountRoutes.post('/accounts/:id/disconnect', requireAuth, async (c) => {
  const userId = Number(c.get('userId'));
  const accountId = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return c.json({ error: 'invalid account id' }, 400);
  }

  const db = drizzle(c.env.DB, { schema });
  const owned = await db.query.connectedAccounts.findFirst({
    where: and(
      eq(schema.connectedAccounts.id, accountId),
      eq(schema.connectedAccounts.userId, userId),
    ),
  });
  if (!owned) {
    return c.json({ error: 'not found' }, 404);
  }

  await db
    .update(schema.connectedAccounts)
    .set({
      status: 'revoked',
      encAccessToken: null,
      encRefreshToken: null,
    })
    .where(eq(schema.connectedAccounts.id, accountId));

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/auth/accounts/connect — sandbox-mock OAuth dance.
//
// Simulates a successful OAuth round-trip against the leylek-*-mock
// Workers: generates a random external account id in the same shape the
// mock returns (10-17 digit numeric), encrypts a placeholder token, and
// inserts the row as `status='active'`. The frontend invalidates the
// listing query so the new row appears immediately.
//
// Production replacement (Faz 2) hangs off the same endpoint shape: instead
// of fabricating ids + tokens, it'll redirect to Google/Meta, accept the
// callback, exchange the code, and persist the real refresh / access token
// in the same encrypted columns. The frontend contract stays unchanged.
// ---------------------------------------------------------------------------
const ConnectBody = z.object({
  provider: z.enum(['google_ads', 'meta']),
});

function genSandboxId(provider: 'google_ads' | 'meta'): string {
  // Google customer ids are conventionally 10 digits; Meta ad account ids
  // are 15-17 digits. Match those shapes so log readers see realistic ids.
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  const digits = provider === 'google_ads' ? 10 : 16;
  const mod = 10n ** BigInt(digits);
  return (n % mod).toString().padStart(digits, '0');
}

adAccountRoutes.post('/accounts/connect', requireAuth, async (c) => {
  const userId = Number(c.get('userId'));
  let body: { provider: 'google_ads' | 'meta' };
  try {
    body = ConnectBody.parse(await c.req.json());
  } catch {
    return c.json({ error: 'invalid_body' }, 400);
  }

  const db = drizzle(c.env.DB, { schema });
  const externalId = genSandboxId(body.provider);
  const accountLabel =
    body.provider === 'google_ads'
      ? `Sandbox Google Ads · ${externalId}`
      : `Sandbox Meta · act_${externalId}`;

  // Encrypt a placeholder so the column is non-null and shaped like the
  // real prod columns. Mock workers don't validate the token, so any
  // string works; the production OAuth callback will replace this with
  // the actual refresh / access token at exchange time.
  const encAccessToken =
    body.provider === 'meta'
      ? await aesEncrypt(`sandbox-meta-access-${externalId}`, c.env.AES_KEY_BASE)
      : null;
  const encRefreshToken =
    body.provider === 'google_ads'
      ? await aesEncrypt(`sandbox-google-refresh-${externalId}`, c.env.AES_KEY_BASE)
      : null;

  const inserted = await db
    .insert(schema.connectedAccounts)
    .values({
      userId,
      provider: body.provider,
      externalId,
      accountLabel,
      status: 'active',
      encAccessToken,
      encRefreshToken,
    })
    .returning({
      id: schema.connectedAccounts.id,
      provider: schema.connectedAccounts.provider,
      externalId: schema.connectedAccounts.externalId,
      accountLabel: schema.connectedAccounts.accountLabel,
      status: schema.connectedAccounts.status,
      connectedAt: schema.connectedAccounts.connectedAt,
      lastUsedAt: schema.connectedAccounts.lastUsedAt,
    });

  const account = inserted[0];
  if (!account) {
    return c.json({ error: 'insert_failed' }, 500);
  }

  return c.json({ account });
});
