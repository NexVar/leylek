/**
 * leylek-google-ads-mock — Google Ads REST API v17 subset for sandbox.
 *
 * Plan: docs/mockdata.md → Faz 1. This Worker mirrors the exact request
 * and response shapes `workers/publisher-agent/src/clients/real-google-ads.ts`
 * emits/expects, so flipping `GOOGLE_ADS_BASE_URL` between this worker
 * and `googleads.googleapis.com` (and `GOOGLE_ADS_OAUTH_URL` between this
 * worker and `oauth2.googleapis.com`) is the only change needed to swap
 * sandbox for production.
 *
 * State lives in the shared `leylek-kv` namespace under `gads:*` keys.
 * Headers (`Authorization`, `developer-token`, `login-customer-id`) are
 * accepted but not validated — this mock is for our own integration
 * tests, not for emulating Google's auth surface.
 */
import { Hono } from 'hono';

import type { Env } from './env';
import { adGroupAdsMutate } from './handlers/ad-group-ads';
import { adGroupsMutate } from './handlers/ad-groups';
import { campaignBudgetsMutate } from './handlers/campaign-budgets';
import { campaignsMutate } from './handlers/campaigns';
import { googleAdsSearch } from './handlers/google-ads-search';
import { oauthToken } from './handlers/oauth';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ status: 'ok', service: 'google-ads-mock' }));

// OAuth refresh — mirrors `oauth2.googleapis.com/token`. The path is
// `/token` (no version prefix) because the real client constructs
// the URL as `${oauthUrl}` exactly and the production URL is
// `https://oauth2.googleapis.com/token` — so the path we serve from
// our base URL is the trailing `/token`.
app.post('/token', oauthToken);

// Google Ads REST surface — `/v17/customers/:cid/<resource>:mutate` and
// `/v17/customers/:cid/googleAds:search`. Hono pattern matching keeps
// the `:mutate` suffix literal so it doesn't collide with `:cid`.
app.post('/v17/customers/:cid/campaignBudgets\\:mutate', campaignBudgetsMutate);
app.post('/v17/customers/:cid/campaigns\\:mutate', campaignsMutate);
app.post('/v17/customers/:cid/adGroups\\:mutate', adGroupsMutate);
app.post('/v17/customers/:cid/adGroupAds\\:mutate', adGroupAdsMutate);
app.post('/v17/customers/:cid/googleAds\\:search', googleAdsSearch);

// Fallback — Google's real API returns 404 for unknown paths.
app.all('*', (c) => c.json({ error: 'not_found', path: c.req.path }, 404));

export default app;
