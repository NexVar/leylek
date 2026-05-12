/**
 * TanStack Query v5 hooks per gateway endpoint. Query keys are stable
 * tuples — see `queryKeys` for the shape used in `invalidateQueries`.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from './client';
import type {
  AgentLogsResponse,
  AuthMeResponse,
  CampaignDetailResponse,
  CampaignListResponse,
  OptimizeNowResponse,
} from './types';

export const queryKeys = {
  me: ['auth', 'me'] as const,
  campaigns: ['campaigns'] as const,
  campaign: (id: number) => ['campaigns', id] as const,
  campaignLogs: (id: number) => ['campaigns', id, 'logs'] as const,
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
    ]);
  };
}
