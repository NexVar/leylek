/**
 * Auth middleware — gates routes on a valid `leylek_session` JWT cookie.
 *
 * Downstream handlers read the resolved user id via `c.get('userId')`. The
 * value is the string `sub` claim; handlers wishing to use it as a D1 PK
 * should coerce with `Number(c.get('userId'))`.
 */

import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';

import { verifyJwt } from '../crypto';
import type { Env } from '../env';

export const SESSION_COOKIE = 'leylek_session';

export type AuthVariables = {
  userId: string;
};

export const requireAuth = createMiddleware<{
  Bindings: Env;
  Variables: AuthVariables;
}>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const payload = await verifyJwt(token, c.env.JWT_SECRET, c.env.JWT_ISSUER);
  if (!payload) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  c.set('userId', payload.sub);
  await next();
});
