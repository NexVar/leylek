/**
 * Shapes the frontend consumes from the gateway. These mirror the gateway's
 * response shapes; underlying field meanings come from @leylek/shared-types
 * (re-exported where useful) plus the D1 schema in PRD §8.
 */

import type {
  AdProvider,
  AdStatus,
  AdStrategy,
  AgentAction,
  AgentName,
  CampaignMode,
  CampaignStatus,
  OptimizerDecision,
} from '@leylek/shared-types';

export type {
  AdProvider,
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
  /**
   * Set when the campaign is in Co-Pilot mode and the optimizer-agent
   * emitted a proposal instead of executing. Frontend uses this to power
   * the inline "Onayla" shortcut on the OptimizerToast.
   */
  notificationId?: number | null;
  /** Mirror the campaign mode so the toast can pick its variant. */
  campaignMode?: CampaignMode;
}

export interface AuthMeResponse {
  /** `null` when no valid session cookie was sent — frontend redirects to /login. */
  user: User | null;
}

// ---------------------------------------------------------------------------
// Magic-link auth (PRD §9 yedek)
// ---------------------------------------------------------------------------
export interface MagicLinkRequestResponse {
  sent: boolean;
}

// ---------------------------------------------------------------------------
// Notifications (Co-Pilot proposals)
// ---------------------------------------------------------------------------
export type NotificationType = 'STOP_LOSS_PROPOSAL' | 'BUDGET_SHIFT_PROPOSAL' | 'RESUME_PROPOSAL';

export type NotificationStatus = 'pending' | 'approved' | 'rejected';

/**
 * The decision payload the optimizer-agent wrote when emitting the
 * proposal. Stored shape matches `OptimizerDecision` directly — gateway's
 * `NotificationPayloadSchema` is a discriminated union on `action`. We
 * parse lazily because `payloadJson` is a string on the wire.
 */
export type NotificationPayload = OptimizerDecision;

export interface NotificationRecord {
  id: number;
  userId: number;
  campaignId: number;
  type: NotificationType;
  payloadJson: string;
  status: NotificationStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export interface NotificationsResponse {
  notifications: NotificationRecord[];
}

/**
 * Global (cross-campaign) listing returned by `GET /api/notifications`.
 * Each row carries the owning campaign so the inbox can display proposals
 * grouped/labeled by campaign without a second round-trip. `pendingCount`
 * is always set so the header bell stays correct independent of the
 * requested `status` filter.
 */
export interface GlobalNotificationRecord extends NotificationRecord {
  campaign: { id: number; productUrl: string } | null;
}

export interface GlobalNotificationsResponse {
  notifications: GlobalNotificationRecord[];
  pendingCount: number;
}

export interface NotificationApproveResponse {
  notification: NotificationRecord;
  agentLogId: number;
}

export interface NotificationRejectResponse {
  notification: NotificationRecord;
}

// ---------------------------------------------------------------------------
// Connected accounts
// ---------------------------------------------------------------------------
export interface ConnectedAccount {
  id: number;
  provider: AdProvider;
  externalId: string;
  accountLabel: string | null;
  status: 'active' | 'revoked' | 'expired';
  connectedAt: string;
  lastUsedAt: string | null;
}

export interface ConnectedAccountsResponse {
  accounts: ConnectedAccount[];
}

export interface OAuthStartErrorResponse {
  error: 'oauth_not_wired';
  detail: string;
}

// ---------------------------------------------------------------------------
// Admin / inspector
// ---------------------------------------------------------------------------
export type AdminD1Table =
  | 'users'
  | 'connected_accounts'
  | 'campaigns'
  | 'ads'
  | 'agent_logs'
  | 'metric_snapshots'
  | 'notifications';

export interface AdminSummaryResponse {
  d1: Record<AdminD1Table, number>;
  kv: Record<string, number>;
}

export interface AdminD1Response {
  table: AdminD1Table;
  rows: Array<Record<string, unknown>>;
  count: number;
}

export interface AdminKvKey {
  name: string;
  expiration: number | null;
}

export interface AdminKvResponse {
  prefix: string;
  keys: AdminKvKey[];
  listComplete: boolean;
}

export interface AdminKvValueResponse {
  key: string;
  value: string | null;
}
