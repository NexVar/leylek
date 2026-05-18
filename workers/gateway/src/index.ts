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

app.notFound((c) => c.json({ error: 'not found' }, 404));

app.onError((err, c) => {
  console.error('[gateway] unhandled error:', err);
  return c.json({ error: 'internal server error' }, 500);
});

export default app;
