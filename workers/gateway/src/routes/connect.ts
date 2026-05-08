/**
 * Reklam hesabı bağlama routes — Meta + Google Ads OAuth.
 *
 * Separate from /api/auth; here we connect the user's ad accounts to act
 * on their behalf. Token storage uses AES-256-GCM with envelope key.
 *
 * Implementation lands in feature/oauth-meta + feature/oauth-google-ads
 * branches.
 */

import { Hono } from 'hono';

import type { Env } from '../env';

export const connectRoutes = new Hono<{ Bindings: Env }>();

// --- Meta OAuth -----------------------------------------------------------
connectRoutes.get('/meta/start', (c) =>
  c.text('TODO: redirect to facebook.com/.../dialog/oauth with ads_management scope'),
);
connectRoutes.get('/meta/callback', (c) =>
  c.text('TODO: code -> short token -> long-lived token; encrypt; persist to D1'),
);
connectRoutes.get('/meta/accounts', (c) =>
  c.json({ todo: 'list user accessible Meta ad accounts after OAuth' }),
);

// --- Google Ads OAuth -----------------------------------------------------
connectRoutes.get('/google-ads/start', (c) =>
  c.text('TODO: redirect to Google OAuth with adwords scope'),
);
connectRoutes.get('/google-ads/callback', (c) =>
  c.text('TODO: token swap; encrypt; persist to D1'),
);
connectRoutes.get('/google-ads/accounts', (c) =>
  c.json({ todo: 'customers:listAccessibleCustomers' }),
);
