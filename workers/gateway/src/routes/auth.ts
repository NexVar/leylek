/**
 * Authentication routes — Google OAuth + magic-link + dev-login + session.
 *
 * - Real production: Google OAuth (PRD §9). State is stored in KV with a
 *   10-minute TTL, then verified + deleted on callback. The session is a
 *   short-TTL HS256 JWT inside an HttpOnly cookie.
 * - Magic-link (PRD §9): user submits email, gateway mints a 36+ char URL-safe
 *   token, stores `magic_link:<token>` in KV for 10 min, ships the verify URL
 *   via Resend. Verify is single-use — the KV entry is deleted on first hit.
 *   Resend free-tier sandbox only delivers to the account owner's address; on
 *   a 4xx we degrade to a 200 with the verify URL inline ONLY when dev-login
 *   is enabled, otherwise return 502 so the UI can surface "provider refused".
 * - Dev shortcut: `/dev-login` (PRD AGENT_DECISIONS §6) is enabled when
 *   `LEYLEK_ALLOW_DEV_LOGIN === 'true'`. Required because the agent-browser
 *   E2E cannot complete the Google consent dance. Hidden — not surfaced in UI.
 */

import { schema } from '@leylek/db';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { type Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';

import { signJwt, verifyJwt } from '../crypto';
import type { Env } from '../env';
import { type AuthVariables, SESSION_COOKIE } from '../middleware/auth';

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
  // The OAuth callback lands on the gateway, not the SPA. In dev both
  // collapse to localhost via APP_URL; in prod the two diverge — Pages
  // serves the frontend and Workers hosts the gateway — so we use the
  // dedicated GATEWAY_URL var here.
  return `${env.GATEWAY_URL}/api/auth/google/callback`;
}

type AuthCtx = Context<{ Bindings: Env; Variables: AuthVariables }>;

async function issueSessionCookie(c: AuthCtx, userId: number): Promise<void> {
  const token = await signJwt(
    { sub: String(userId) },
    c.env.JWT_SECRET,
    c.env.JWT_ISSUER,
    SESSION_TTL_SECONDS,
  );
  // SameSite=None is required because the frontend (Pages) and gateway
  // (Workers) live on different second-level domains; the browser would
  // otherwise drop the cookie on cross-site fetches with credentials.
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'None',
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
// Magic link — request
//
// Mints a 36+ char URL-safe token (`crypto.randomUUID()` + one extra random
// segment so the entropy comfortably exceeds 128 bits). KV stores
// `magic_link:<token>` → `{email, createdAt}` JSON for 10 minutes.
//
// Email delivery is via Resend's REST API with the default
// `onboarding@resend.dev` sender. On Resend's free tier this only delivers
// to the account owner's verified address; any 4xx is treated as a
// "provider refused" rather than a server bug. To keep the demo path open
// we surface the verify URL inline as `devLink` when dev-login is enabled.
// ---------------------------------------------------------------------------
const MagicLinkRequestBody = z.object({ email: z.string().email() });

const MAGIC_LINK_TTL_SECONDS = 60 * 10;
const RESEND_FROM = 'Leylek <onboarding@resend.dev>';

function mintMagicLinkToken(): string {
  // randomUUID is 36 chars; append another randomUUID for >256 bits of entropy.
  // Result is URL-safe (alphanumerics + dashes) and ~73 chars long.
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

function magicLinkHtml(verifyUrl: string): string {
  return `<!doctype html>
<html lang="tr">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#F4F5F7; padding:32px; color:#0B0F1A;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px; margin:0 auto; background:#FFFFFF; border-radius:12px; padding:32px;">
      <tr><td>
        <h1 style="margin:0 0 16px; font-size:22px; color:#0F1729;">Leylek'e Hoş Geldin</h1>
        <p style="margin:0 0 24px; line-height:1.55; color:#0B0F1A;">
          Aşağıdaki butona tıklayarak giriş yapabilirsin. Bu bağlantı <strong>10 dakika</strong>
          boyunca geçerlidir ve yalnızca bir kez kullanılabilir.
        </p>
        <p style="margin:0 0 24px;">
          <a href="${verifyUrl}"
            style="background:#FF6B5C; color:#FFFFFF; text-decoration:none; padding:12px 24px; border-radius:12px; font-weight:600; display:inline-block;">
            Leylek'e Giriş Yap
          </a>
        </p>
        <p style="margin:0 0 8px; font-size:13px; color:#5A6477;">
          Buton çalışmıyorsa şu adresi tarayıcına yapıştırabilirsin:
        </p>
        <p style="margin:0; word-break:break-all; font-size:12px; color:#5A6477;">${verifyUrl}</p>
      </td></tr>
    </table>
    <p style="text-align:center; margin-top:16px; font-size:12px; color:#5A6477;">
      Bu isteği sen yapmadıysan e-postayı yok sayabilirsin.
    </p>
  </body>
</html>`;
}

function magicLinkText(verifyUrl: string): string {
  return [
    "Leylek'e hoş geldin.",
    '',
    'Giriş yapmak için aşağıdaki bağlantıya tıkla:',
    verifyUrl,
    '',
    'Bağlantı 10 dakika boyunca geçerli ve yalnızca bir kez kullanılabilir.',
    'Bu isteği sen yapmadıysan e-postayı yok sayabilirsin.',
  ].join('\n');
}

authRoutes.post('/magic-link/request', async (c) => {
  let parsed: z.infer<typeof MagicLinkRequestBody>;
  try {
    parsed = MagicLinkRequestBody.parse(await c.req.json());
  } catch (err) {
    return c.json(
      { error: 'invalid_request', detail: err instanceof Error ? err.message : 'bad body' },
      400,
    );
  }

  const token = mintMagicLinkToken();
  await c.env.KV.put(
    `magic_link:${token}`,
    JSON.stringify({ email: parsed.email, createdAt: nowIso() }),
    { expirationTtl: MAGIC_LINK_TTL_SECONDS },
  );

  const verifyUrl = `${c.env.GATEWAY_URL}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`;
  const devLoginEnabled = c.env.LEYLEK_ALLOW_DEV_LOGIN === 'true';

  let resendRes: Response;
  try {
    resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${c.env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [parsed.email],
        subject: 'Leylek — Giriş Bağlantın',
        html: magicLinkHtml(verifyUrl),
        text: magicLinkText(verifyUrl),
      }),
    });
  } catch (err) {
    // Network-level failure — treat it like Resend's "we refuse" path.
    console.error('[gateway/auth] resend network error', err);
    if (devLoginEnabled) {
      return c.json({ sent: false, devLink: verifyUrl });
    }
    return c.json({ sent: false }, 502);
  }

  if (!resendRes.ok) {
    const detail = await resendRes.text().catch(() => '');
    console.warn(`[gateway/auth] resend rejected magic-link send (${resendRes.status}): ${detail}`);
    if (devLoginEnabled) {
      // Sandbox refused — surface the link inline so the demo + E2E can proceed.
      return c.json({ sent: false, devLink: verifyUrl });
    }
    return c.json({ sent: false }, 502);
  }

  return c.json({ sent: true });
});

// ---------------------------------------------------------------------------
// Magic link — verify
//
// Single-use: KV entry is deleted on first hit. Renders inline HTML on
// expiry/missing so the user lands on a clear message instead of a JSON
// blob or the SPA's empty shell. On success we upsert the user (matching
// on email since there's no Google `sub` available here), set the session
// cookie via the same helper Google OAuth uses, and redirect to APP_URL.
// ---------------------------------------------------------------------------
const ExpiredLinkHtml = (appUrl: string): string => `<!doctype html>
<html lang="tr">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#F4F5F7; min-height:100vh; margin:0; padding:48px 16px; color:#0B0F1A;">
    <main style="max-width:480px; margin:0 auto; background:#FFFFFF; border-radius:12px; padding:32px; text-align:center;">
      <h1 style="margin:0 0 12px; font-size:22px; color:#0F1729;">Bağlantı geçersiz</h1>
      <p style="margin:0 0 24px; line-height:1.55;">
        Bu giriş bağlantısı geçersiz veya süresi dolmuş. Yeni bir bağlantı için lütfen
        giriş sayfasına dönüp tekrar dene.
      </p>
      <p style="margin:0;">
        <a href="${appUrl}"
          style="background:#FF6B5C; color:#FFFFFF; text-decoration:none; padding:12px 24px; border-radius:12px; font-weight:600; display:inline-block;">
          Giriş sayfasına dön
        </a>
      </p>
    </main>
  </body>
</html>`;

const MagicLinkPayloadSchema = z.object({
  email: z.string().email(),
  createdAt: z.string(),
});

authRoutes.get('/magic-link/verify', async (c) => {
  const token = c.req.query('token');
  if (!token) {
    return c.html(ExpiredLinkHtml(c.env.APP_URL), 400);
  }

  const raw = await c.env.KV.get(`magic_link:${token}`);
  if (!raw) {
    return c.html(ExpiredLinkHtml(c.env.APP_URL), 400);
  }
  // Single-use — burn it immediately, even if the upsert below fails.
  await c.env.KV.delete(`magic_link:${token}`);

  let payload: z.infer<typeof MagicLinkPayloadSchema>;
  try {
    payload = MagicLinkPayloadSchema.parse(JSON.parse(raw));
  } catch (err) {
    console.error('[gateway/auth] magic-link payload malformed', err);
    return c.html(ExpiredLinkHtml(c.env.APP_URL), 400);
  }

  const db = drizzle(c.env.DB, { schema });
  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, payload.email),
  });
  let userId: number;
  if (existing) {
    await db
      .update(schema.users)
      .set({ lastLoginAt: nowIso() })
      .where(eq(schema.users.id, existing.id));
    userId = existing.id;
  } else {
    const inserted = await db
      .insert(schema.users)
      .values({
        email: payload.email,
        provider: 'magic_link',
        // No Google `sub` available — providerSub mirrors the email so the
        // unique (provider, provider_sub) index stays meaningful.
        providerSub: payload.email,
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
//
// Returns 200 with `{user: null}` when no valid session is present, instead
// of the typical 401 + redirect dance. Reason: the frontend's
// `ProtectedRoute` already handles the falsy-user redirect locally, and a
// 401 here just splatters a red error in every visitor's devtools network
// tab even though the UX is correct. 200-with-null keeps the contract
// honest and the dashboard's first paint clean.
// ---------------------------------------------------------------------------
authRoutes.get('/me', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    return c.json({ user: null });
  }
  const payload = await verifyJwt(token, c.env.JWT_SECRET, c.env.JWT_ISSUER);
  if (!payload) {
    return c.json({ user: null });
  }
  const userId = Number(payload.sub);
  const db = drizzle(c.env.DB, { schema });
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user) {
    return c.json({ user: null });
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
