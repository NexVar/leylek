/**
 * gateway Worker — API entry, OAuth, routing, frontend façade.
 *
 * All /api/* traffic from the React frontend hits this Worker first.
 * Auth flows live here; campaign / agent operations are routed via
 * Service Bindings to the specialised agent Workers.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

import type { Env } from './env';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { campaignRoutes } from './routes/campaigns';
import { adAccountRoutes } from './routes/connect';
import { notificationRoutes } from './routes/notifications';

const app = new Hono<{ Bindings: Env }>();

app.use(
  '*',
  cors({
    origin: (origin) => origin,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

// ---------------------------------------------------------------------------
// Aggregated health — pings every Service Binding individually and reports
// each upstream's state. A single down upstream must not flip the gateway's
// own status to red, otherwise we lose observability when partial outages
// happen.
// ---------------------------------------------------------------------------
type UpstreamHealth = { status: 'ok' | 'down'; detail?: unknown };

async function probeUpstream(binding: Fetcher): Promise<UpstreamHealth> {
  try {
    const res = await binding.fetch('https://internal/api/health');
    if (!res.ok) {
      return { status: 'down', detail: `http_${res.status}` };
    }
    const json = (await res.json()) as Record<string, unknown>;
    return { status: 'ok', detail: json };
  } catch (err) {
    return { status: 'down', detail: err instanceof Error ? err.message : 'unknown' };
  }
}

app.get('/api/health', async (c) => {
  const [content, optimizer, publisher, analytics] = await Promise.all([
    probeUpstream(c.env.CONTENT_AGENT),
    probeUpstream(c.env.OPTIMIZER_AGENT),
    probeUpstream(c.env.PUBLISHER_AGENT),
    probeUpstream(c.env.ANALYTICS_WORKER),
  ]);
  return c.json({
    status: 'ok',
    service: 'gateway',
    timestamp: new Date().toISOString(),
    upstream: { content, optimizer, publisher, analytics },
  });
});

app.route('/api/auth', authRoutes);
app.route('/api/auth', adAccountRoutes);
app.route('/api/campaigns', campaignRoutes);
app.route('/api/notifications', notificationRoutes);
app.route('/api/admin', adminRoutes);

// ---------------------------------------------------------------------------
// Creative proxy — serves AI-generated ad images from R2 under the same
// leylek.nexvar.io origin (no cross-origin CORS, no separate r2.dev URL
// leaking on the brand). Keys are content-agent-issued opaque strings
// (`ad-<id>.png`); we serve any key that exists. Caching is the same
// `immutable` header content-agent set at upload time — Cloudflare CDN
// honours it without us re-emitting per response.
// ---------------------------------------------------------------------------
app.get('/api/creatives/:key', async (c) => {
  const key = c.req.param('key');
  if (!key || key.length === 0 || key.includes('/') || key.includes('..')) {
    return c.json({ error: 'invalid_key' }, 400);
  }
  const object = await c.env.CREATIVES.get(key);
  if (!object) {
    return c.json({ error: 'not_found', key }, 404);
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  if (!headers.has('cache-control')) {
    headers.set('cache-control', 'public, max-age=31536000, immutable');
  }
  return new Response(object.body, { headers });
});

app.notFound((c) => c.json({ error: 'not found' }, 404));

app.onError((err, c) => {
  console.error('[gateway] unhandled error:', err);
  return c.json({ error: 'internal server error' }, 500);
});

export default app;
