/**
 * TanStack Query v5 hooks per gateway endpoint. Query keys are stable
 * tuples — see `queryKeys` for the shape used in `invalidateQueries`.
 */

import type { CampaignMode } from '@leylek/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from './client';
import type {
  AdminD1Response,
  AdminD1Table,
  AdminKvResponse,
  AdminKvValueResponse,
  AdminSummaryResponse,
  AgentLogsResponse,
  AuthMeResponse,
  Campaign,
  CampaignDetailResponse,
  CampaignListResponse,
  ConnectedAccount,
  ConnectedAccountsResponse,
  GlobalNotificationsResponse,
  MagicLinkRequestResponse,
  NotificationApproveResponse,
  NotificationRecord,
  NotificationRejectResponse,
  NotificationsResponse,
  OptimizeNowResponse,
} from './types';

export const queryKeys = {
  me: ['auth', 'me'] as const,
  campaigns: ['campaigns'] as const,
  campaign: (id: number) => ['campaigns', id] as const,
  campaignLogs: (id: number) => ['campaigns', id, 'logs'] as const,
  campaignNotifications: (id: number) => ['campaigns', id, 'notifications'] as const,
  globalNotifications: (status: 'pending' | 'all') => ['notifications', status] as const,
  accounts: ['auth', 'accounts'] as const,
};

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => api<AuthMeResponse>('/api/auth/me', { signal }),
    retry: (failureCount, err) => {
      if (err instanceof ApiError && err.status === 401) return false;
      return failureCount < 1;
    },
    staleTime: 60_000,
  });
}

export function useRequestMagicLink() {
  return useMutation({
    mutationFn: (email: string) =>
      api<MagicLinkRequestResponse>('/api/auth/magic-link/request', {
        method: 'POST',
        body: { email },
      }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      qc.setQueryData(queryKeys.me, null);
      qc.removeQueries({ queryKey: queryKeys.me });
    },
  });
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------
export function useCampaigns(enabled = true) {
  return useQuery({
    queryKey: queryKeys.campaigns,
    queryFn: ({ signal }) => api<CampaignListResponse>('/api/campaigns', { signal }),
    enabled,
  });
}

export function useCampaign(id: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.campaign(id),
    queryFn: ({ signal }) => api<CampaignDetailResponse>(`/api/campaigns/${id}`, { signal }),
    enabled: enabled && Number.isFinite(id) && id > 0,
  });
}

export function useCampaignLogs(id: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.campaignLogs(id),
    queryFn: ({ signal }) => api<AgentLogsResponse>(`/api/campaigns/${id}/logs`, { signal }),
    enabled: enabled && Number.isFinite(id) && id > 0,
  });
}

export function useOptimizeNow(campaignId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<OptimizeNowResponse>(`/api/campaigns/${campaignId}/optimize-now`, {
        method: 'POST',
      }),
    onSuccess: async () => {
      // Demo path: refetch happens after the toast finishes streaming
      // (the page calls invalidateCampaign manually after a delay).
      // Here we only mark stale so any other consumer picks it up.
      await qc.invalidateQueries({
        queryKey: queryKeys.campaign(campaignId),
        refetchType: 'none',
      });
      await qc.invalidateQueries({
        queryKey: queryKeys.campaignLogs(campaignId),
        refetchType: 'none',
      });
    },
  });
}

export function useInvalidateCampaign() {
  const qc = useQueryClient();
  return async (campaignId: number) => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.campaign(campaignId) }),
      qc.invalidateQueries({ queryKey: queryKeys.campaignLogs(campaignId) }),
      qc.invalidateQueries({ queryKey: queryKeys.campaignNotifications(campaignId) }),
    ]);
  };
}

export interface CreateCampaignBody {
  productUrl: string;
  mode: CampaignMode;
  dailyBudgetKurus: number;
}

export interface CreateCampaignResponse {
  campaign: Campaign;
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCampaignBody) =>
      api<CreateCampaignResponse>('/api/campaigns', {
        method: 'POST',
        body,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.campaigns });
    },
  });
}

export interface UpdateCampaignModeResponse {
  campaign: Campaign;
}

export function useUpdateCampaignMode(campaignId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: CampaignMode) =>
      api<UpdateCampaignModeResponse>(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        body: { mode },
      }),
    onMutate: async (mode) => {
      await qc.cancelQueries({ queryKey: queryKeys.campaign(campaignId) });
      const previous = qc.getQueryData<CampaignDetailResponse>(queryKeys.campaign(campaignId));
      if (previous) {
        qc.setQueryData<CampaignDetailResponse>(queryKeys.campaign(campaignId), {
          ...previous,
          campaign: { ...previous.campaign, mode },
        });
      }
      return { previous };
    },
    onError: (_err, _mode, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(queryKeys.campaign(campaignId), ctx.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.campaign(campaignId) });
      void qc.invalidateQueries({ queryKey: queryKeys.campaigns });
    },
  });
}

// ---------------------------------------------------------------------------
// Notifications (Co-Pilot proposals)
// ---------------------------------------------------------------------------
export function useCampaignNotifications(campaignId: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.campaignNotifications(campaignId),
    queryFn: ({ signal }) =>
      api<NotificationsResponse>(`/api/campaigns/${campaignId}/notifications`, { signal }),
    enabled: enabled && Number.isFinite(campaignId) && campaignId > 0,
  });
}

function patchNotification(
  qc: ReturnType<typeof useQueryClient>,
  campaignId: number,
  next: NotificationRecord,
) {
  qc.setQueryData<NotificationsResponse | undefined>(
    queryKeys.campaignNotifications(campaignId),
    (prev) => {
      if (!prev) return prev;
      return {
        notifications: prev.notifications.map((n) => (n.id === next.id ? next : n)),
      };
    },
  );
}

export function useApproveNotification(campaignId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: number) =>
      api<NotificationApproveResponse>(
        `/api/campaigns/${campaignId}/notifications/${notificationId}/approve`,
        { method: 'POST' },
      ),
    onSuccess: (data) => {
      patchNotification(qc, campaignId, data.notification);
      // The approve path triggers a publisher action; refresh ads + logs +
      // the global bell so the resolved proposal disappears from the inbox.
      void qc.invalidateQueries({ queryKey: queryKeys.campaign(campaignId) });
      void qc.invalidateQueries({ queryKey: queryKeys.campaignLogs(campaignId) });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useRejectNotification(campaignId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: number) =>
      api<NotificationRejectResponse>(
        `/api/campaigns/${campaignId}/notifications/${notificationId}/reject`,
        { method: 'POST' },
      ),
    onSuccess: (data) => {
      patchNotification(qc, campaignId, data.notification);
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/**
 * Cross-campaign listing for the header bell + InboxDrawer.
 *
 * Polls every 30 s while mounted — pending count drives the bell badge,
 * so the user sees new Co-Pilot proposals without refreshing. We poll
 * rather than stream because the optimizer cron runs every 6 h; even
 * 30 s is generous, and SSE/WebSocket plumbing isn't worth it for the
 * demo cadence.
 */
export function useGlobalNotifications(status: 'pending' | 'all' = 'pending', enabled = true) {
  return useQuery({
    queryKey: queryKeys.globalNotifications(status),
    queryFn: ({ signal }) =>
      api<GlobalNotificationsResponse>(`/api/notifications?status=${status}`, { signal }),
    enabled,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });
}

// ---------------------------------------------------------------------------
// Connected accounts (Meta + Google Ads)
// ---------------------------------------------------------------------------
export function useConnectedAccounts(enabled = true) {
  return useQuery({
    queryKey: queryKeys.accounts,
    queryFn: ({ signal }) => api<ConnectedAccountsResponse>('/api/auth/accounts', { signal }),
    enabled,
  });
}

export function useDisconnectAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: number) =>
      api<void>(`/api/auth/accounts/${accountId}/disconnect`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.accounts });
    },
  });
}

// ---------------------------------------------------------------------------
// Admin / inspector
// ---------------------------------------------------------------------------
export function useAdminSummary(enabled = true) {
  return useQuery({
    queryKey: ['admin', 'summary'] as const,
    queryFn: ({ signal }) => api<AdminSummaryResponse>('/api/admin/summary', { signal }),
    enabled,
    staleTime: 5_000,
  });
}

export function useAdminD1(table: AdminD1Table | null, limit = 20) {
  return useQuery({
    queryKey: ['admin', 'd1', table, limit] as const,
    queryFn: ({ signal }) =>
      api<AdminD1Response>(`/api/admin/d1?table=${table}&limit=${limit}`, { signal }),
    enabled: table !== null,
    staleTime: 5_000,
  });
}

export function useAdminKv(prefix: string, limit = 50) {
  return useQuery({
    queryKey: ['admin', 'kv', prefix, limit] as const,
    queryFn: ({ signal }) =>
      api<AdminKvResponse>(`/api/admin/kv?prefix=${encodeURIComponent(prefix)}&limit=${limit}`, {
        signal,
      }),
    staleTime: 5_000,
  });
}

export function useAdminKvValue(key: string | null) {
  return useQuery({
    queryKey: ['admin', 'kv-value', key] as const,
    queryFn: ({ signal }) =>
      api<AdminKvValueResponse>(`/api/admin/kv/value?key=${encodeURIComponent(key ?? '')}`, {
        signal,
      }),
    enabled: key !== null && key.length > 0,
    staleTime: 0,
  });
}

/**
 * Sandbox-mock OAuth connect. POSTs to the gateway, which simulates the
 * dance against the leylek-*-mock Workers and persists a connected_accounts
 * row. Production replacement (Faz 2) keeps the same endpoint shape but
 * routes through the real Google / Meta OAuth flow before persisting.
 */
export function useConnectMockAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: 'google_ads' | 'meta') =>
      api<{ account: ConnectedAccount }>('/api/auth/accounts/connect', {
        method: 'POST',
        body: { provider },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.accounts });
    },
  });
}
