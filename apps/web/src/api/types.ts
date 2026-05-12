/**
 * Shapes the frontend consumes from the gateway. These mirror the gateway's
 * response shapes; underlying field meanings come from @leylek/shared-types
 * (re-exported where useful) plus the D1 schema in PRD §8.
 */

import type {
  AdStatus,
  AdStrategy,
  AgentAction,
  AgentName,
  CampaignMode,
  CampaignStatus,
  OptimizerDecision,
} from '@leylek/shared-types';

export type {
  AdStatus,
  AdStrategy,
  AgentAction,
  AgentName,
  CampaignMode,
  CampaignStatus,
  OptimizerDecision,
};

export interface User {
  id: number;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  companyName: string | null;
}

export interface Campaign {
  id: number;
  userId: number;
  productUrl: string;
  mode: CampaignMode;
  dailyBudgetKurus: number;
  status: CampaignStatus;
  adCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Ad {
  id: number;
  campaignId: number;
  strategyType: AdStrategy;
  adText: string;
  imagePrompt: string | null;
  metaAdId: string | null;
  googleAdId: string | null;
  status: AdStatus;
  spendKurus: number;
  cpaKurus: number | null;
  ctrBasisPoints: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentLog {
  id: number;
  campaignId: number;
  agentName: AgentName;
  actionTaken: AgentAction;
  targetRef: string | null;
  reason: string;
  confidence: number | null;
  geminiRequestId: string | null;
  createdAt: string;
}

export interface CampaignListResponse {
  campaigns: Campaign[];
}

export interface CampaignDetailResponse {
  campaign: Campaign;
  ads: Ad[];
  logs: AgentLog[];
}

export interface AgentLogsResponse {
  logs: AgentLog[];
}

export interface OptimizeNowResponse {
  decision: OptimizerDecision;
  reasoningStreamLine: string;
  agentLogId: number;
}

export interface AuthMeResponse {
  user: User;
}
