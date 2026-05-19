/**
 * Gemini 3.1 Flash Lite wrapper for the content-agent.
 *
 * Responsibilities:
 *   - Build a `responseSchema` that mirrors `ContentAgentOutput`
 *   - Call `ai.models.generateContent` with structured output
 *   - Parse + validate against the shared Zod schema
 *   - Detect 429 / quota errors so the gateway can surface a rate-limit toast
 *
 * SDK shape (verified via context7 against `/googleapis/js-genai`):
 *   ai.models.generateContent({
 *     model, contents,
 *     config: { systemInstruction, temperature, responseMimeType, responseSchema }
 *   })
 *   -> { text, responseId, ... }
 */

import { GoogleGenAI, Type } from '@google/genai';
import { CONTENT_AGENT_SYSTEM, CONTENT_AGENT_USER } from '@leylek/prompts';
import { ContentAgentOutput } from '@leylek/shared-types';

// Gemini 3.1 Flash Lite — 15 RPM / 500 RPD on free tier (plenty for a
// single-tenant demo), low-latency (~1-3s steady-state), and stable. We
// previously bounced between gemini-2.5-flash (20 RPD too tight) and
// gemma-4-26b-a4b-it (Google's free-tier Gemma serving was intermittently
// returning 5xx with 60-150s latency). 3.1-flash-lite is the goldilocks
// pick: fast enough not to need a streaming response, generous enough to
// survive a demo session.
const MODEL_ID = 'gemini-3.1-flash-lite';
const TEMPERATURE = 0.7;
// Generous ceiling — the model is normally fast but we don't want to abort
// a real slow tail (cold start, network) and surface a misleading error.
const GEMINI_TIMEOUT_MS = 180_000;

/**
 * OpenAPI-3.0-subset schema describing `ContentAgentOutput`. Kept in lockstep
 * with `packages/shared-types/src/index.ts` — the Zod schema is the ground
 * truth, this is the Gemini-facing mirror. If the Zod shape ever drifts,
 * Gemini will produce data and Zod will reject it, surfacing the mismatch.
 */
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    audience: {
      type: Type.OBJECT,
      properties: {
        demographic: { type: Type.STRING },
        interests: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          minItems: 1,
          maxItems: 10,
        },
        painPoints: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          minItems: 1,
          maxItems: 5,
        },
      },
      required: ['demographic', 'interests', 'painPoints'],
      propertyOrdering: ['demographic', 'interests', 'painPoints'],
    },
    variants: {
      type: Type.ARRAY,
      // Exactly three variants — Gemini honours minItems/maxItems as a hard hint.
      minItems: 3,
      maxItems: 3,
      items: {
        type: Type.OBJECT,
        properties: {
          strategyType: {
            type: Type.STRING,
            enum: ['AGGRESSIVE', 'STORY', 'TECHNICAL'],
          },
          adText: { type: Type.STRING },
          imagePrompt: { type: Type.STRING },
        },
        required: ['strategyType', 'adText', 'imagePrompt'],
        propertyOrdering: ['strategyType', 'adText', 'imagePrompt'],
      },
    },
  },
  required: ['audience', 'variants'],
  propertyOrdering: ['audience', 'variants'],
};

export interface AnalyzeResult {
  output: ReturnType<typeof ContentAgentOutput.parse>;
  geminiRequestId: string;
}

export interface AnalyzeInputs {
  productUrl: string;
  scrapedContent: string;
  dailyBudgetTry: number;
}

export interface AnalyzeFailure {
  stage: 'parse' | 'gemini' | 'rate_limited';
  message: string;
  rawText?: string;
}

/**
 * Pattern-match the Gemini SDK error message for 429 / RESOURCE_EXHAUSTED so
 * the gateway can surface a "rate limited" toast instead of the generic
 * `content_agent_failed`. The SDK throws strings shaped like
 * "[GoogleGenerativeAI Error]: ... [429 Too Many Requests] ..." or includes
 * "RESOURCE_EXHAUSTED" / "quota" — match any of those.
 */
function isRateLimitError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('429') ||
    m.includes('resource_exhausted') ||
    m.includes('quota') ||
    m.includes('rate limit')
  );
}

export class ContentAgentError extends Error {
  constructor(
    message: string,
    public readonly diagnostic: AnalyzeFailure,
  ) {
    super(message);
    this.name = 'ContentAgentError';
  }
}

export async function analyzeProduct(
  apiKey: string,
  inputs: AnalyzeInputs,
): Promise<AnalyzeResult> {
  const ai = new GoogleGenAI({ apiKey });
  const userPrompt = CONTENT_AGENT_USER(
    inputs.productUrl,
    inputs.scrapedContent,
    inputs.dailyBudgetTry,
  );

  // Single attempt — Gemma 4 26B free-tier latency is 30-90s per call, so a
  // schema-retry doubles worst-case wall time past Cloudflare's edge timeout
  // and gives the user a 524 instead of a clean failure. responseSchema +
  // responseMimeType already constrain the model strongly enough that retries
  // rarely changed the outcome anyway.
  const result = await callGemini(ai, userPrompt);
  const parsed = tryParse(result.text);
  if (parsed.ok) {
    return {
      output: parsed.value,
      geminiRequestId: result.responseId,
    };
  }

  throw new ContentAgentError('Gemini output failed schema validation', {
    stage: 'parse',
    message: parsed.error,
    rawText: result.text?.slice(0, 2000),
  });
}

interface GeminiCallResult {
  text: string;
  responseId: string;
}

async function callGemini(ai: GoogleGenAI, contents: string): Promise<GeminiCallResult> {
  const started = Date.now();
  try {
    const generation = ai.models.generateContent({
      model: MODEL_ID,
      contents,
      config: {
        systemInstruction: CONTENT_AGENT_SYSTEM,
        temperature: TEMPERATURE,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    });
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`gemini_timeout after ${GEMINI_TIMEOUT_MS / 1000}s`)),
        GEMINI_TIMEOUT_MS,
      );
    });
    const response = await Promise.race([generation, timeout]);
    const text = response.text ?? '';
    const responseId = response.responseId ?? crypto.randomUUID();
    console.log(`[content-agent] gemini ok in ${Date.now() - started}ms`);
    return { text, responseId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[content-agent] gemini failed after ${Date.now() - started}ms:`,
      message.slice(0, 200),
    );
    throw new ContentAgentError('Gemini generateContent call failed', {
      stage: isRateLimitError(message) ? 'rate_limited' : 'gemini',
      message,
    });
  }
}

type ParseOutcome =
  | { ok: true; value: ReturnType<typeof ContentAgentOutput.parse> }
  | { ok: false; error: string };

function tryParse(text: string): ParseOutcome {
  if (!text) return { ok: false, error: 'Empty response from Gemini' };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      error: `Response is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const result = ContentAgentOutput.safeParse(json);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true, value: result.data };
}
