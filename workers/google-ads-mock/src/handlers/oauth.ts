/**
 * POST /token — fake OAuth refresh.
 *
 * Mirrors `oauth2.googleapis.com/token` with a `refresh_token` grant:
 * accepts `application/x-www-form-urlencoded`, returns `{access_token,
 * expires_in, token_type}`. We don't validate `client_id`/`client_secret`/
 * `refresh_token` values — they're whatever `RealGoogleAdsClient` sent —
 * but we do enforce `grant_type=refresh_token` so the cache-refresh path
 * in the client is genuinely exercised (the client only ever uses this
 * grant; a different one would mean the client changed under us).
 */
import type { Context } from 'hono';

import type { Env } from '../env';
import { genId } from '../util/ids';
import { jitter } from '../util/jitter';

export async function oauthToken(c: Context<{ Bindings: Env }>): Promise<Response> {
  await jitter();

  const contentType = c.req.header('content-type') ?? '';
  let params: URLSearchParams;
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const body = await c.req.text();
    params = new URLSearchParams(body);
  } else {
    // Some clients (or curl with -d) may omit the header; fall back to text.
    params = new URLSearchParams(await c.req.text());
  }

  const grantType = params.get('grant_type');
  if (grantType !== 'refresh_token') {
    return c.json({ error: 'invalid_grant' }, 400);
  }

  return c.json({
    access_token: `mock_${genId()}`,
    expires_in: 3600,
    token_type: 'Bearer',
  });
}
