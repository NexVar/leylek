/**
 * publisher-agent Worker — Meta Marketing API + Google Ads API action layer.
 *
 * Owns ALL outbound calls to ad platforms. Other workers never touch
 * Meta or Google directly — they ask publisher-agent to act.
 *
 * Real API only — sandbox / test account targets, but every call is the
 * actual Meta or Google endpoint. No mocks at this layer.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) =>
  c.json({
    status: 'ok',
    service: 'publisher-agent',
    metaApiVersion: c.env.META_API_VERSION,
  }),
);

// --- Campaign creation (gateway -> here) ----------------------------------
const PublishRequest = z.object({
  campaignId: z.number().int().positive(),
  userId: z.number().int().positive(),
  productUrl: z.string().url(),
  dailyBudgetKurus: z.number().int().positive(),
  variants: z.array(
    z.object({
      strategyType: z.enum(['AGGRESSIVE', 'STORY', 'TECHNICAL']),
      adText: z.string(),
      imagePrompt: z.string(),
    }),
  ),
});

app.post('/internal/publish', async (c) => {
  const body = PublishRequest.parse(await c.req.json());
  // TODO:
  //   1. Decrypt connected_accounts tokens for both Meta + Google Ads
  //   2. Meta: create campaign + adset + 3 ads via Marketing API
  //   3. Google Ads: create campaign + ad group + 3 responsive ads
  //   4. Persist meta_ad_id and google_ad_id to ads table
  return c.json({ todo: 'real Meta + Google Ads API calls', input: body });
});

// --- Atomic actions (optimizer-agent -> here) -----------------------------
const PauseAdRequest = z.object({
  adId: z.number().int().positive(),
  reason: z.string(),
});

app.post('/internal/pause-ad', async (c) => {
  const body = PauseAdRequest.parse(await c.req.json());
  // TODO:
  //   1. Load ad row; pull meta_ad_id / google_ad_id
  //   2. Real Meta: POST /<ad_id> with status=PAUSED
  //   3. Real Google Ads: AdGroupAdService.MutateAdGroupAds with PAUSED
  //   4. Update ads.status = 'paused'
  //   5. agent_logs append
  return c.json({ todo: 'real PAUSE call to Meta + Google', input: body });
});

const ReallocateBudgetRequest = z.object({
  sourceAdId: z.number().int().positive(),
  targetAdId: z.number().int().positive(),
  deltaKurus: z.number().int().positive(),
  reason: z.string(),
});

app.post('/internal/reallocate-budget', async (c) => {
  const body = ReallocateBudgetRequest.parse(await c.req.json());
  // TODO:
  //   - Meta: update adset budget on source DOWN, target UP
  //   - Google Ads: campaign budget update
  return c.json({ todo: 'real budget shift', input: body });
});

export default app;
