/**
 * GET /v21.0/oauth/access_token — long-lived token exchange.
 *
 * Mirrors Meta's Graph API edge for swapping a short-lived user access
 * token for a 60-day long-lived one:
 *
 *   GET /v21.0/oauth/access_token
 *     ?grant_type=fb_exchange_token
 *     &fb_exchange_token=<short>
 *     &client_id=<app_id>
 *     &client_secret=<app_secret>
 *
 * We don't validate the token / client_id / client_secret values — they're
 * whatever `RealMetaAdsClient` (or curl) sent — but we do require
 * `grant_type` to be present so the caller's "I'm doing a real OAuth
 * exchange" code path is exercised, not silently bypassed.
 *
 * Response shape matches Meta's documented payload exactly: a JSON object
 * with `access_token`, `token_type: 'bearer'`, and `expires_in: 5184000`
 * (60 days in seconds).
 */
import type { Context } from 'hono';

import type { Env } from '../env';
import { jitter } from '../util/jitter';

export async function oauthAccessToken(c: Context<{ Bindings: Env }>): Promise<Response> {
  await jitter();

  const grantType = c.req.query('grant_type');
  if (!grantType) {
    return c.json(
      {
        error: {
          message: 'Missing required parameter: grant_type',
          type: 'OAuthException',
          code: 100,
        },
      },
      400,
    );
  }

  // 16-char hex blob, prefixed with `mock_meta_` so it's obvious in logs
  // that this token came from the mock rather than from Meta proper.
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

  return c.json({
    access_token: `mock_meta_${hex}`,
    token_type: 'bearer',
    expires_in: 5_184_000,
  });
}
