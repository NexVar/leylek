/**
 * Authentication routes — Google OAuth + dev-login + session.
 *
 * - Real production: Google OAuth (PRD §9). State is stored in KV with a
 *   10-minute TTL, then verified + deleted on callback. The session is a
 *   short-TTL HS256 JWT inside an HttpOnly cookie.
 * - Dev shortcut: `/dev-login` (PRD AGENT_DECISIONS §6) is enabled when
 *   `LEYLEK_ALLOW_DEV_LOGIN === 'true'`. Required because the agent-browser
 *   E2E cannot complete the Google consent dance.
 *
 * Magic-link is deliberately deferred (AGENT_DECISIONS §9); the surface is
 * left out so the typechecker is honest about what's wired.
 */

import { schema } from '@leylek/db';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { type Context, Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';

import { signJwt } from '../crypto';
import type { Env } from '../env';
import { type AuthVariables, requireAuth, SESSION_COOKIE } from '../middleware/auth';

export const authRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// Session lifetime — 24h per PRD §9.
const SESSION_TTL_SECONDS = 60 * 60 * 24;
// OAuth state lifetime — Google's recommended 10 minutes.
const OAUTH_STATE_TTL_SECONDS = 60 * 10;

const GoogleUserInfoSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  name: z.string().optional(),
  picture: z.string().url().optional(),
});

const GoogleTokenSchema = z.object({
  access_token: z.string(),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function redirectUri(env: Env): string {
  // The OAuth redirect points back at *this* worker. APP_URL is the frontend
  // origin in dev — for prod we'd flip to the gateway's workers.dev URL via a
  // separate `GATEWAY_URL` var. Keeping APP_URL as the dev convention here so
  // a local `wrangler dev` + Vite dev pair both resolve back through the
  // same redirect entry.
  return `${env.APP_URL}/api/auth/google/callback`;
}

type AuthCtx = Context<{ Bindings: Env; Variables: AuthVariables }>;

async function issueSessionCookie(c: AuthCtx, userId: number): Promise<void> {
  const token = await signJwt(
    { sub: String(userId) },
    c.env.JWT_SECRET,
    c.env.JWT_ISSUER,
    SESSION_TTL_SECONDS,
  );
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Google OAuth — start
// ---------------------------------------------------------------------------
authRoutes.get('/google/start', async (c) => {
  const state = crypto.randomUUID();
  await c.env.KV.put(`oauth_state:${state}`, '1', { expirationTtl: OAUTH_STATE_TTL_SECONDS });

  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri(c.env),
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// ---------------------------------------------------------------------------
// Google OAuth — callback
// ---------------------------------------------------------------------------
authRoutes.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) {
    return c.json({ error: 'missing code or state' }, 400);
  }

  // CSRF check: state must exist in KV, then we burn it.
  const stored = await c.env.KV.get(`oauth_state:${state}`);
  if (!stored) {
    return c.json({ error: 'invalid or expired state' }, 400);
  }
  await c.env.KV.delete(`oauth_state:${state}`);

  // Exchange code → access token.
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: c.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri(c.env),
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!tokenRes.ok) {
    console.error('[gateway/auth] token swap failed', tokenRes.status, await tokenRes.text());
    return c.json({ error: 'token exchange failed' }, 502);
  }
  const tokenJson = GoogleTokenSchema.safeParse(await tokenRes.json());
  if (!tokenJson.success) {
    return c.json({ error: 'token response malformed' }, 502);
  }

  // userinfo lookup — we trust Google to give us `sub` + `email`.
  const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { authorization: `Bearer ${tokenJson.data.access_token}` },
  });
  if (!userinfoRes.ok) {
    return c.json({ error: 'userinfo lookup failed' }, 502);
  }
  const userinfo = GoogleUserInfoSchema.safeParse(await userinfoRes.json());
  if (!userinfo.success) {
    return c.json({ error: 'userinfo response malformed' }, 502);
  }

  // Upsert user — match on (provider='google', provider_sub).
  const db = drizzle(c.env.DB, { schema });
  const existing = await db.query.users.findFirst({
    where: and(
      eq(schema.users.provider, 'google'),
      eq(schema.users.providerSub, userinfo.data.sub),
    ),
  });
  let userId: number;
  if (existing) {
    await db
      .update(schema.users)
      .set({
        email: userinfo.data.email,
        name: userinfo.data.name ?? existing.name,
        avatarUrl: userinfo.data.picture ?? existing.avatarUrl,
        lastLoginAt: nowIso(),
      })
      .where(eq(schema.users.id, existing.id));
    userId = existing.id;
  } else {
    const inserted = await db
      .insert(schema.users)
      .values({
        email: userinfo.data.email,
        name: userinfo.data.name ?? null,
        avatarUrl: userinfo.data.picture ?? null,
        provider: 'google',
        providerSub: userinfo.data.sub,
        lastLoginAt: nowIso(),
      })
      .returning({ id: schema.users.id });
    // biome-ignore lint/style/noNonNullAssertion: drizzle .returning() always yields one row on a single-value insert
    userId = inserted[0]!.id;
  }

  await issueSessionCookie(c, userId);
  return c.redirect(c.env.APP_URL);
});

// ---------------------------------------------------------------------------
// Dev-login — gated on LEYLEK_ALLOW_DEV_LOGIN flag
// ---------------------------------------------------------------------------
const DevLoginBody = z.object({ email: z.string().email() });

authRoutes.post('/dev-login', async (c) => {
  if (c.env.LEYLEK_ALLOW_DEV_LOGIN !== 'true') {
    return c.json({ error: 'not found' }, 404);
  }
  let parsed: z.infer<typeof DevLoginBody>;
  try {
    parsed = DevLoginBody.parse(await c.req.json());
  } catch (err) {
    return c.json(
      { error: 'invalid_request', detail: err instanceof Error ? err.message : 'bad body' },
      400,
    );
  }

  const db = drizzle(c.env.DB, { schema });
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, parsed.email),
  });
  if (!user) {
    return c.json({ error: 'user not seeded' }, 404);
  }

  await db.update(schema.users).set({ lastLoginAt: nowIso() }).where(eq(schema.users.id, user.id));

  await issueSessionCookie(c, user.id);
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
    },
  });
});

// ---------------------------------------------------------------------------
// Session — current user
// ---------------------------------------------------------------------------
authRoutes.get('/me', requireAuth, async (c) => {
  const userId = Number(c.get('userId'));
  const db = drizzle(c.env.DB, { schema });
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      companyName: user.companyName,
    },
  });
});

// ---------------------------------------------------------------------------
// Session — logout
// ---------------------------------------------------------------------------
authRoutes.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.body(null, 204);
});
