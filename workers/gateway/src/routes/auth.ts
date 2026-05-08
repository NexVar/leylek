/**
 * Authentication routes — Google OAuth + Magic Link.
 *
 * Implementation lands in feature/auth-google + feature/auth-magic-link
 * branches. This stub establishes the surface so the frontend can be
 * scaffolded against stable endpoints.
 */

import { Hono } from 'hono';

import type { Env } from '../env';

export const authRoutes = new Hono<{ Bindings: Env }>();

// --- Google OAuth (login) -------------------------------------------------
authRoutes.get('/google/start', (c) => c.text('TODO: build OAuth state + redirect to Google'));
authRoutes.get('/google/callback', (c) => c.text('TODO: exchange code, upsert user, issue JWT'));

// --- Magic Link (backup) --------------------------------------------------
authRoutes.post('/magic-link/request', (c) =>
  c.text('TODO: generate token, store in KV, send via Resend'),
);
authRoutes.get('/magic-link/verify', (c) => c.text('TODO: verify token, upsert user, issue JWT'));

// --- Session --------------------------------------------------------------
authRoutes.get('/me', (c) => c.json({ todo: 'return current user from JWT cookie' }));
authRoutes.post('/logout', (c) => c.text('TODO: clear cookie'));
