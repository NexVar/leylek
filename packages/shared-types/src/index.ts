/**
 * @leylek/shared-types — Zod schemas + TS types shared between
 * Workers (gateway, agents) and the frontend.
 *
 * Frontend and backend speak the same shapes — validation at every boundary,
 * type inference everywhere.
 */

import { z } from 'zod';

export * from './ad-platform';

// ---------------------------------------------------------------------------
// Campaign mode
// ---------------------------------------------------------------------------
export const CampaignMode = z.enum(['OTOPILOT', 'COPILOT']);
export type CampaignMode = z.infer<typeof CampaignMode>;

export const CampaignStatus = z.enum(['active', 'paused', 'archived']);
export type CampaignStatus = z.infer<typeof CampaignStatus>;

// ---------------------------------------------------------------------------
// Ad strategy
// ---------------------------------------------------------------------------
export const AdStrategy = z.enum(['AGGRESSIVE', 'STORY', 'TECHNICAL']);
export type AdStrategy = z.infer<typeof AdStrategy>;

export const AdStatus = z.enum(['pending', 'active', 'paused']);
export type AdStatus = z.infer<typeof AdStatus>;

// ---------------------------------------------------------------------------
// Auth providers
// ---------------------------------------------------------------------------
export const AuthProvider = z.enum(['google', 'magic_link']);
export type AuthProvider = z.infer<typeof AuthProvider>;

export const AdProvider = z.enum(['meta', 'google_ads']);
export type AdProvider = z.infer<typeof AdProvider>;

// ---------------------------------------------------------------------------
// Agent identity
// ---------------------------------------------------------------------------
export const AgentName = z.enum(['content', 'optimizer', 'publisher']);
export type AgentName = z.infer<typeof AgentName>;

export const AgentAction = z.enum([
  'CREATED_AD',
  'PAUSED_AD',
  'RESUMED_AD',
  'REALLOCATED_BUDGET',
  'PROPOSED_PAUSE',
  'PROPOSED_BUDGET_SHIFT',
]);
export type AgentAction = z.infer<typeof AgentAction>;

// ---------------------------------------------------------------------------
// API request/response: campaign create
// ---------------------------------------------------------------------------
export const CreateCampaignRequest = z.object({
  productUrl: z.string().url(),
  mode: CampaignMode,
  /** Daily budget in TRY kurus (TRY * 100) */
  dailyBudgetKurus: z.number().int().positive(),
});
export type CreateCampaignRequest = z.infer<typeof CreateCampaignRequest>;

// ---------------------------------------------------------------------------
// Ad variant (content-agent output)
// ---------------------------------------------------------------------------
export const AdVariant = z.object({
  strategyType: AdStrategy,
  adText: z.string().min(20).max(500),
  imagePrompt: z.string().min(20).max(500),
});
export type AdVariant = z.infer<typeof AdVariant>;

export const ContentAgentOutput = z.object({
  audience: z.object({
    demographic: z.string(),
    interests: z.array(z.string()).min(1).max(10),
    painPoints: z.array(z.string()).min(1).max(5),
  }),
  variants: z.tuple([AdVariant, AdVariant, AdVariant]),
});
export type ContentAgentOutput = z.infer<typeof ContentAgentOutput>;

// ---------------------------------------------------------------------------
// Optimizer decision (Gemini structured output)
// ---------------------------------------------------------------------------
export const OptimizerDecision = z.object({
  action: z.enum(['PAUSE_AD', 'RESUME_AD', 'REALLOCATE_BUDGET', 'KEEP']),
  targetAdId: z.number().int().positive().nullable(),
  /** When reallocating: source ad id losing the budget */
  sourceAdId: z.number().int().positive().nullable().optional(),
  /** When reallocating: kurus to move */
  budgetDeltaKurus: z.number().int().optional(),
  reason: z.string().min(20),
  confidence: z.number().min(0).max(1),
});
export type OptimizerDecision = z.infer<typeof OptimizerDecision>;
