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
import { generateAndStoreAdImage } from './image-gen';
import { scrapeProductUrl } from './scrape';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) =>
  c.json({ status: 'ok', service: 'content-agent', model: 'gemma-4-26b-a4b-it' }),
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

    // Image generation per variant. Best-effort and parallel — a failure on
    // any single image returns null for that variant, never blocking the
    // overall response. Workers AI Flux Schnell is fast (~1-2 s per image)
    // so total wall-clock is dominated by the slowest of the three.
    const imageR2Keys: (string | null)[] = await Promise.all(
      result.output.variants.map(async (v) => {
        const generated = await generateAndStoreAdImage(c.env.AI, c.env.CREATIVES, v.imagePrompt);
        return generated?.r2Key ?? null;
      }),
    );

    return c.json({
      output: result.output,
      imageR2Keys,
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

/**
 * Backfill endpoint — generates an image for an ad whose original
 * content-agent call ran before image gen was wired (seeded demo
 * campaigns + any pre-Wave-12 row). Body: `{prompt: string}`. Returns
 * `{r2Key | null}`. Idempotent — caller decides whether to re-trigger.
 */
const BackfillRequest = z.object({
  prompt: z.string().min(1),
});

app.post('/internal/generate-image', async (c) => {
  let body: z.infer<typeof BackfillRequest>;
  try {
    body = BackfillRequest.parse(await c.req.json());
  } catch (err) {
    return c.json(
      { error: 'invalid_request', detail: err instanceof Error ? err.message : 'bad body' },
      400,
    );
  }
  const generated = await generateAndStoreAdImage(c.env.AI, c.env.CREATIVES, body.prompt);
  return c.json({ r2Key: generated?.r2Key ?? null, bytes: generated?.bytes ?? 0 });
});

export default app;
