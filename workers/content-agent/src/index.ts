/**
 * content-agent Worker — Gemini 2.5 Pro powered ad creative generation.
 *
 * Input: product URL + daily budget (kurus).
 * Output: audience + 3 ad variants conforming to ContentAgentOutput.
 *
 * Invoked by gateway via Service Binding (Worker-to-Worker call), not
 * exposed to the public internet.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import type { Env } from './env';
import { analyzeProduct, ContentAgentError } from './gemini';
import { scrapeProductUrl } from './scrape';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) =>
  c.json({ status: 'ok', service: 'content-agent', model: 'gemini-2.5-pro' }),
);

const AnalyzeRequest = z.object({
  productUrl: z.string().url(),
  dailyBudgetKurus: z.number().int().positive(),
});

app.post('/internal/analyze', async (c) => {
  let body: z.infer<typeof AnalyzeRequest>;
  try {
    body = AnalyzeRequest.parse(await c.req.json());
  } catch (err) {
    return c.json(
      {
        error: 'invalid_request',
        detail: err instanceof Error ? err.message : 'malformed body',
      },
      400,
    );
  }

  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'missing_gemini_api_key' }, 500);
  }

  // Step 1 — try to fetch the product page; fall back to a slug-derived hint
  // if anything goes wrong. The demo URL is allowed to be unreachable.
  const scrape = await scrapeProductUrl(body.productUrl);

  // Step 2 — Gemini with structured output + one stricter retry on schema drift.
  const dailyBudgetTry = body.dailyBudgetKurus / 100;
  try {
    const result = await analyzeProduct(apiKey, {
      productUrl: body.productUrl,
      scrapedContent: scrape.content,
      dailyBudgetTry,
    });
    return c.json({
      output: result.output,
      geminiRequestId: result.geminiRequestId,
      sourceMode: scrape.mode,
    });
  } catch (err) {
    if (err instanceof ContentAgentError) {
      console.error('[content-agent] analyze failed:', err.diagnostic);
      return c.json(
        {
          error: 'content_agent_failed',
          stage: err.diagnostic.stage,
          detail: err.diagnostic.message,
          rawText: err.diagnostic.rawText,
          sourceMode: scrape.mode,
        },
        502,
      );
    }
    console.error('[content-agent] unexpected error:', err);
    return c.json({ error: 'internal_error' }, 500);
  }
});

export default app;
