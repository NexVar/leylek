/**
 * Gemini 2.5 Pro wrapper for the content-agent.
 *
 * Responsibilities:
 *   - Build a `responseSchema` that mirrors `ContentAgentOutput`
 *   - Call `ai.models.generateContent` with structured output
 *   - Parse + validate against the shared Zod schema
 *   - One stricter retry on schema-mismatch before giving up
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

// We tried Gemma 4 26B for its 1500 RPD ceiling vs Flash's 20 RPD, but the
// free-tier serving for Gemma 4 is unreliable: end-to-end latency spikes to
// 60-120s with intermittent 502s even though quota is essentially untouched.
// Flash is ~1s steady-state and is the safer pick for the demo path; we'll
// upgrade tiers if the daily cap actually bites.
const MODEL_ID = 'gemini-2.5-flash';
const TEMPERATURE = 0.7;

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
  stage: 'parse' | 'gemini';
  message: string;
  rawText?: string;
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
  const baseUserPrompt = CONTENT_AGENT_USER(
    inputs.productUrl,
    inputs.scrapedContent,
    inputs.dailyBudgetTry,
  );

  // First attempt — plain prompt.
  const first = await callGemini(ai, baseUserPrompt);
  const parsedFirst = tryParse(first.text);
  if (parsedFirst.ok) {
    return {
      output: parsedFirst.value,
      geminiRequestId: first.responseId,
    };
  }

  // Second attempt — feed the failing output back with a stricter instruction.
  // We do this exactly once; if the model is going to drift, it will.
  const retryPrompt = `${baseUserPrompt}

Your previous response did not conform to the required schema:
${parsedFirst.error}

Previous output (truncated):
"""
${(first.text ?? '').slice(0, 1500)}
"""

Return ONLY a valid JSON object matching the schema. No prose, no markdown fences.`;
  const second = await callGemini(ai, retryPrompt);
  const parsedSecond = tryParse(second.text);
  if (parsedSecond.ok) {
    return {
      output: parsedSecond.value,
      geminiRequestId: second.responseId,
    };
  }

  throw new ContentAgentError('Gemini output failed schema validation twice', {
    stage: 'parse',
    message: parsedSecond.error,
    rawText: second.text?.slice(0, 2000),
  });
}

interface GeminiCallResult {
  text: string;
  responseId: string;
}

async function callGemini(ai: GoogleGenAI, contents: string): Promise<GeminiCallResult> {
  try {
    const response = await ai.models.generateContent({
      model: MODEL_ID,
      contents,
      config: {
        systemInstruction: CONTENT_AGENT_SYSTEM,
        temperature: TEMPERATURE,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    });
    const text = response.text ?? '';
    const responseId = response.responseId ?? crypto.randomUUID();
    return { text, responseId };
  } catch (err) {
    throw new ContentAgentError('Gemini generateContent call failed', {
      stage: 'gemini',
      message: err instanceof Error ? err.message : String(err),
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
