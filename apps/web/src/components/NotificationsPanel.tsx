import { useMemo, useState } from 'react';
import { ApiError } from '../api/client';
import {
  useApproveNotification,
  useCampaignNotifications,
  useRejectNotification,
} from '../api/hooks';
import type { NotificationPayload, NotificationRecord, NotificationType } from '../api/types';
import { cn } from '../lib/cn';
import { relativeTimeTr } from '../lib/format';
import { Button } from './Button';
import { Card, CardHeader } from './Card';
import { Pill } from './Pill';
import { SpinnerInline } from './SpinnerInline';

interface NotificationsPanelProps {
  campaignId: number;
  /** Active campaign mode — panel only renders for Co-Pilot. */
  mode: 'OTOPILOT' | 'COPILOT';
}

const NOTIFICATION_LABEL: Record<NotificationType, string> = {
  STOP_LOSS_PROPOSAL: 'Zarar koruması',
  BUDGET_SHIFT_PROPOSAL: 'Bütçe kaydırma',
  RESUME_PROPOSAL: 'Yeniden başlatma',
};

function parsePayload(raw: string): NotificationPayload | null {
  try {
    return JSON.parse(raw) as NotificationPayload;
  } catch {
    return null;
  }
}

function summaryOf(n: NotificationRecord): string {
  const p = parsePayload(n.payloadJson);
  if (!p || !('reason' in p)) return 'Ajan gerekçesi okunamadı.';
  return p.reason;
}

/**
 * Co-Pilot proposal panel. Lives between the spend chart and the agent-logs
 * timeline on CampaignDetail. Renders `pending` notifications as actionable
 * cards (Onayla / Reddet) and collapses the resolved ones into a single
 * summary line beneath, per spec.
 */
export function NotificationsPanel({ campaignId, mode }: NotificationsPanelProps) {
  const isCoPilot = mode === 'COPILOT';
  const query = useCampaignNotifications(campaignId, isCoPilot);
  const [showHistory, setShowHistory] = useState(false);

  const notifications = query.data?.notifications ?? [];
  const pending = useMemo(
    () => notifications.filter((n) => n.status === 'pending'),
    [notifications],
  );
  const resolved = useMemo(
    () => notifications.filter((n) => n.status !== 'pending'),
    [notifications],
  );

  if (!isCoPilot) {
    return null;
  }

  const approvedCount = resolved.filter((n) => n.status === 'approved').length;
  const rejectedCount = resolved.filter((n) => n.status === 'rejected').length;

  return (
    <Card padding="lg">
      <CardHeader
        title="Bekleyen Öneriler"
        subtitle="Optimizasyon ajanının senin onayını beklediği aksiyonlar"
        trailing={<Pill tone={pending.length > 0 ? 'warning' : 'neutral'}>{pending.length}</Pill>}
      />

      <div className="mt-5 flex flex-col gap-3">
        {query.isLoading ? (
          <div className="flex items-center gap-3 text-ink-muted text-body-sm">
            <SpinnerInline className="text-accent" />
            Öneriler yükleniyor…
          </div>
        ) : query.error ? (
          <p className="text-body-sm text-danger">
            Öneriler okunamadı:{' '}
            {query.error instanceof ApiError ? query.error.message : 'bağlantı hatası.'}
          </p>
        ) : pending.length === 0 ? (
          <p className="text-body-sm text-ink-subtle">
            Şu an bekleyen öneri yok. Optimizasyon ajanı 6 saatte bir tekrar bakar.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((n) => (
              <li key={n.id}>
                <NotificationCard campaignId={campaignId} notification={n} />
              </li>
            ))}
          </ul>
        )}

        {resolved.length > 0 ? (
          <div className="pt-3 mt-1 border-t border-border">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="w-full text-left text-body-sm text-ink-muted hover:text-ink flex items-center justify-between gap-3"
            >
              <span>
                <span className="text-success font-medium">{approvedCount}</span> öneri onaylandı,{' '}
                <span className="text-ink-muted font-medium">{rejectedCount}</span> reddedildi —{' '}
                <span className="text-info underline-offset-2 hover:underline">
                  geçmişi {showHistory ? 'gizle' : 'gör'}
                </span>
              </span>
              <Chevron open={showHistory} />
            </button>

            {showHistory ? (
              <ul className="flex flex-col gap-2 mt-3">
                {resolved.map((n) => (
                  <li key={n.id} className="flex items-start gap-3 text-body-sm text-ink-muted">
                    <Pill
                      tone={n.status === 'approved' ? 'success' : 'neutral'}
                      className="shrink-0"
                    >
                      {n.status === 'approved' ? 'Onaylandı' : 'Reddedildi'}
                    </Pill>
                    <div className="min-w-0">
                      <div className="text-ink font-medium">{NOTIFICATION_LABEL[n.type]}</div>
                      <p className="leading-[1.5] mt-0.5 line-clamp-2">{summaryOf(n)}</p>
                    </div>
                    <time
                      dateTime={n.resolvedAt ?? n.createdAt}
                      className="font-mono text-[11px] text-ink-subtle shrink-0 pt-0.5 tabular-nums"
                    >
                      {relativeTimeTr(n.resolvedAt ?? n.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

interface NotificationCardProps {
  campaignId: number;
  notification: NotificationRecord;
}

function NotificationCard({ campaignId, notification }: NotificationCardProps) {
  const approve = useApproveNotification(campaignId);
  const reject = useRejectNotification(campaignId);
  const summary = summaryOf(notification);
  const busy = approve.isPending || reject.isPending;

  const errorMessage = (() => {
    const err = approve.error ?? reject.error;
    if (!err) return null;
    return err instanceof ApiError ? err.message : 'Beklenmeyen bir hata oluştu.';
  })();

  return (
    <div
      className={cn(
        'rounded-md border border-border bg-surface-raised p-4 flex flex-col gap-3',
        'shadow-card-sm',
      )}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Pill tone="warning" dot>
          {NOTIFICATION_LABEL[notification.type]}
        </Pill>
        <time
          dateTime={notification.createdAt}
          className="font-mono text-[11px] text-ink-subtle tabular-nums"
          title={new Date(notification.createdAt).toLocaleString('tr-TR')}
        >
          {relativeTimeTr(notification.createdAt)}
        </time>
      </div>

      <p className="text-body-sm text-ink leading-[1.55]">{summary}</p>

      {errorMessage ? (
        <p className="text-body-sm text-danger leading-[1.4]">{errorMessage}</p>
      ) : null}

      <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-end">
        <Button
          variant="secondary"
          size="md"
          onClick={() => reject.mutate(notification.id)}
          disabled={busy}
          loading={reject.isPending}
          block
          className="sm:w-auto"
        >
          {reject.isPending ? 'Reddediliyor…' : 'Reddet'}
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={() => approve.mutate(notification.id)}
          disabled={busy}
          loading={approve.isPending}
          block
          className="sm:w-auto"
        >
          {approve.isPending ? 'Uygulanıyor…' : 'Onayla'}
        </Button>
      </div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      role="img"
      aria-label={open ? 'Daralt' : 'Genişlet'}
      className={cn('transition-transform duration-150', open && 'rotate-180')}
    >
      <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
