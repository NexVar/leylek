/**
 * TanStack Query v5 hooks per gateway endpoint. Query keys are stable
 * tuples — see `queryKeys` for the shape used in `invalidateQueries`.
 */

import type { CampaignMode } from '@leylek/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from './client';
import type {
  AgentLogsResponse,
  AuthMeResponse,
  Campaign,
  CampaignDetailResponse,
  CampaignListResponse,
  ConnectedAccountsResponse,
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

/**
 * Kept for the gateway E2E test that hits `/api/auth/dev-login` directly.
 * The Login UI no longer calls this — magic-link is the only user-facing
 * auth path (plus Google OAuth as the primary).
 */
export function useDevLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) =>
      api<AuthMeResponse>('/api/auth/dev-login', {
        method: 'POST',
        body: { email },
      }),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.me, data);
    },
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
      // The approve path triggers a publisher action; refresh ads + logs.
      void qc.invalidateQueries({ queryKey: queryKeys.campaign(campaignId) });
      void qc.invalidateQueries({ queryKey: queryKeys.campaignLogs(campaignId) });
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
    },
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
