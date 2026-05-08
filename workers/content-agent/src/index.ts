/**
 * content-agent Worker — Gemini 2.5 Pro powered ad creative generation.
 *
 * Input: product URL + daily budget.
 * Output: audience + 3 ad variants conforming to ContentAgentOutput.
 *
 * Invoked by gateway via Service Binding (Worker-to-Worker call), not
 * exposed to the public internet.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) =>
  c.json({ status: 'ok', service: 'content-agent', model: 'gemini-2.5-pro' }),
);

const AnalyzeRequest = z.object({
  productUrl: z.string().url(),
  dailyBudgetKurus: z.number().int().positive(),
});

app.post('/internal/analyze', async (c) => {
  const body = AnalyzeRequest.parse(await c.req.json());
  // TODO:
  //   1. Fetch productUrl, extract title + description + price + images
  //   2. Compose Gemini 2.5 Pro request with CONTENT_AGENT_SYSTEM + CONTENT_AGENT_USER
  //   3. Use Gemini structured output to enforce ContentAgentOutput schema
  //   4. Return parsed output
  return c.json({ todo: 'implement Gemini call', input: body });
});

export default app;
