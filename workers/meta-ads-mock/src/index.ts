/**
 * leylek-meta-ads-mock — Hono Worker emulating Meta Marketing API v21.0
 *
 * Surface (subset that `RealMetaAdsClient` actually calls):
 *
 *   GET  /v21.0/oauth/access_token
 *   POST /v21.0/act_:adAccountId/campaigns
 *   POST /v21.0/act_:adAccountId/adsets
 *   POST /v21.0/act_:adAccountId/ads
 *   GET  /v21.0/:campaignId/adsets             (campaign -> adsets edge)
 *   GET  /v21.0/:adId/insights                 (ad -> insights edge)
 *   POST /v21.0/:id                            (ad status OR adset budget,
 *                                                dispatched by KV adType)
 *   GET  /health
 *
 * State: shared `leylek-kv` namespace, `meta:*` prefix only. See
 * handler files for the per-key shape.
 *
 * Auth: Meta uses `Authorization: Bearer <token>` or `?access_token=`.
 * The mock does not validate either — credentials are whatever the
 * `RealMetaAdsClient` configured. Validation here would only ever
 * reject a misconfigured client; it does not add security to the demo.
 */
import { Hono } from 'hono';
import type { Env } from './env';
import { createAd, updateAdStatus } from './handlers/ads';
import { listCampaignAdsets } from './handlers/adset-lookup';
import { createAdSet, updateAdSetBudget } from './handlers/adsets';
import { createCampaign } from './handlers/campaigns';
import { getInsights } from './handlers/insights';
import { oauthAccessToken } from './handlers/oauth';
import { jitter } from './util/jitter';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ status: 'ok', service: 'meta-ads-mock' }));

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------
app.get('/v21.0/oauth/access_token', oauthAccessToken);

// ---------------------------------------------------------------------------
// Account-scoped creates (campaign / adset / ad).
//
// Meta URLs look like `/v21.0/act_<digits>/campaigns`. Hono treats a URL
// segment as opaque, so we capture the whole `act_<digits>` token via
// `:adAccountSegment` and strip the `act_` prefix in this thin shim
// before delegating to the handlers. The handlers read the digits-only
// account id from a fixed query-param convention so they can ignore
// path-routing concerns entirely.
// ---------------------------------------------------------------------------

const ACCOUNT_PREFIX = 'act_';

function extractAccountId(segment: string | undefined): string | null {
  if (!segment) return null;
  if (!segment.startsWith(ACCOUNT_PREFIX)) return null;
  const id = segment.slice(ACCOUNT_PREFIX.length);
  return id.length > 0 ? id : null;
}

function badAccountSegment(
  c: { json: (b: unknown, s?: number) => Response },
  raw: string | undefined,
) {
  return c.json(
    {
      error: {
        message: `Expected ad account segment to start with 'act_', got ${raw ?? ''}`,
        type: 'GraphMethodException',
        code: 100,
      },
    },
    400,
  );
}

app.post('/v21.0/:adAccountSegment/campaigns', async (c) => {
  const aaId = extractAccountId(c.req.param('adAccountSegment'));
  if (!aaId) return badAccountSegment(c, c.req.param('adAccountSegment'));
  return createCampaign(c, aaId);
});

app.post('/v21.0/:adAccountSegment/adsets', async (c) => {
  const aaId = extractAccountId(c.req.param('adAccountSegment'));
  if (!aaId) return badAccountSegment(c, c.req.param('adAccountSegment'));
  return createAdSet(c, aaId);
});

app.post('/v21.0/:adAccountSegment/ads', async (c) => {
  const aaId = extractAccountId(c.req.param('adAccountSegment'));
  if (!aaId) return badAccountSegment(c, c.req.param('adAccountSegment'));
  return createAd(c, aaId);
});

// ---------------------------------------------------------------------------
// Object-id-scoped edges (`GET /v21.0/<id>/adsets`, `GET /v21.0/<id>/insights`)
// ---------------------------------------------------------------------------
app.get('/v21.0/:campaignId/adsets', listCampaignAdsets);
app.get('/v21.0/:adId/insights', getInsights);

// ---------------------------------------------------------------------------
// POST /v21.0/:id — Meta's "update by id" convention.
//
// One route handles both:
//   * Ad status update (`{status: 'PAUSED' | 'ACTIVE'}`)
//   * AdSet budget update (`{daily_budget: <number>}`)
//
// The id resolves to either kind via the `meta:adType:<id>` reverse
// index written at create time. The shared body is parsed once here and
// passed to the specialised handler; Zod re-parses inside the handler
// for the type-narrow story.
// ---------------------------------------------------------------------------
app.post('/v21.0/:id', async (c) => {
  await jitter();
  const id = c.req.param('id');
  if (!id || id.startsWith('act_') || id === 'oauth') {
    // Defensive: these prefixes belong to other routes already mounted
    // above. If Hono fell through to here, the caller asked for
    // something we don't implement.
    return c.json(
      {
        error: {
          message: `Unsupported path /v21.0/${id ?? ''}`,
          type: 'GraphMethodException',
          code: 100,
        },
      },
      404,
    );
  }

  const adType = await c.env.KV.get(`meta:adType:${id}`);
  if (!adType) {
    return c.json(
      {
        error: { message: `Unknown object id ${id}`, type: 'GraphMethodException', code: 100 },
      },
      404,
    );
  }

  const aaId = await c.env.KV.get(`meta:adAccount:${id}`);
  if (!aaId) {
    return c.json(
      {
        error: {
          message: `Object ${id} has no ad account binding`,
          type: 'GraphMethodException',
          code: 100,
        },
      },
      500,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: {
          message: 'Request body must be valid JSON',
          type: 'GraphMethodException',
          code: 100,
        },
      },
      400,
    );
  }

  if (adType === 'ad') {
    return updateAdStatus(c, id, aaId, body);
  }
  if (adType === 'adset') {
    return updateAdSetBudget(c, id, aaId, body);
  }
  // Campaign-level POST updates aren't implemented because no Leylek
  // code path needs them today.
  return c.json(
    {
      error: {
        message: `Update by id for type '${adType}' is not implemented`,
        type: 'GraphMethodException',
        code: 100,
      },
    },
    400,
  );
});

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------
app.notFound((c) =>
  c.json(
    {
      error: {
        message: `Path not found: ${c.req.method} ${new URL(c.req.url).pathname}`,
        type: 'GraphMethodException',
        code: 100,
      },
    },
    404,
  ),
);

export default app;
