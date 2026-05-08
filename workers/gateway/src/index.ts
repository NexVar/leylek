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
import { connectRoutes } from './routes/connect';

const app = new Hono<{ Bindings: Env }>();

app.use(
  '*',
  cors({
    origin: (origin) => origin,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

app.get('/api/health', (c) =>
  c.json({
    status: 'ok',
    service: 'gateway',
    timestamp: new Date().toISOString(),
  }),
);

app.route('/api/auth', authRoutes);
app.route('/api/connect', connectRoutes);
app.route('/api/campaigns', campaignRoutes);

app.notFound((c) => c.json({ error: 'not found' }, 404));

app.onError((err, c) => {
  console.error('[gateway] unhandled error:', err);
  return c.json({ error: 'internal server error' }, 500);
});

export default app;
