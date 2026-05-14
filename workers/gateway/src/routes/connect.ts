/**
 * Reklam hesabı bağlama routes — list/disconnect + Meta/Google OAuth stubs.
 *
 * - `GET /api/auth/accounts`               : list current user's connected
 *                                            ad accounts; encrypted tokens are
 *                                            stripped before serialisation.
 * - `POST /api/auth/accounts/:id/disconnect`: mark a row `revoked` and clear
 *                                            its encrypted token columns.
 *
 * The Meta + Google Ads OAuth start/callback flows themselves stay stubs:
 * Meta is Faz 2 (PRD §17) and Google Ads needs developer-token Standard
 * access whose UI is out of scope for this wave. Each `start` returns a
 * friendly 503 so the frontend can render a meaningful "soon" state.
 */

import { schema } from '@leylek/db';
import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';

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
// OAuth start stubs — friendly 503 so the frontend can render a "soon" state.
//
// Meta is explicitly Faz 2 (PRD §17). Google Ads start requires the customer
// to grant scopes whose UI flow is out of scope for this wave; the demo runs
// on the `sim` ad-platform adapter so no real linking is needed today.
// ---------------------------------------------------------------------------
const OAUTH_NOT_WIRED = {
  error: 'oauth_not_wired',
  detail:
    'Bu bağlantı Faz 2\'de devreye girecek (PRD §17). Demo "sim" ad-platform üzerinde çalışıyor.',
};

adAccountRoutes.get('/meta/start', (c) => c.json(OAUTH_NOT_WIRED, 503));
adAccountRoutes.get('/meta/callback', (c) => c.json(OAUTH_NOT_WIRED, 503));
adAccountRoutes.get('/meta/accounts', (c) => c.json(OAUTH_NOT_WIRED, 503));

adAccountRoutes.get('/google-ads/start', (c) => c.json(OAUTH_NOT_WIRED, 503));
adAccountRoutes.get('/google-ads/callback', (c) => c.json(OAUTH_NOT_WIRED, 503));
adAccountRoutes.get('/google-ads/accounts', (c) => c.json(OAUTH_NOT_WIRED, 503));
