import { useMemo } from 'react';
import { ApiError } from '../api/client';
import {
  useApproveNotification,
  useGlobalNotifications,
  useRejectNotification,
} from '../api/hooks';
import type { GlobalNotificationRecord, NotificationPayload, NotificationType } from '../api/types';
import { cn } from '../lib/cn';
import { hostnameOf, relativeTimeTr } from '../lib/format';
import { Button } from './Button';
import { Drawer, DrawerHeader } from './Drawer';
import { Pill } from './Pill';
import { SpinnerInline } from './SpinnerInline';

interface InboxDrawerProps {
  open: boolean;
  onClose: () => void;
}

const TYPE_LABEL: Record<NotificationType, string> = {
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

function summaryOf(record: GlobalNotificationRecord): string {
  const p = parsePayload(record.payloadJson);
  if (!p) return 'Ajan gerekçesi okunamadı.';
  return p.summary ?? p.decision.reason;
}

/**
 * Cross-campaign Co-Pilot inbox. Triggered from the header bell, slides
 * in from the right. Shows pending proposals grouped by campaign so the
 * user can act on any of them without leaving the current page.
 *
 * Re-uses the existing per-campaign approve/reject mutations — the
 * notification record carries its `campaignId` so we always have the
 * right routing key.
 */
export function InboxDrawer({ open, onClose }: InboxDrawerProps) {
  const query = useGlobalNotifications('pending', open);
  const pending = query.data?.notifications ?? [];

  const grouped = useMemo(() => groupByCampaign(pending), [pending]);

  return (
    <Drawer open={open} onClose={onClose} width="md" ariaLabel="Co-Pilot inbox">
      <DrawerHeader
        title={
          <span className="flex items-center gap-2">
            <span>Bekleyen öneriler</span>
            <Pill tone={pending.length > 0 ? 'warning' : 'neutral'}>{pending.length}</Pill>
          </span>
        }
        subtitle="Optimizasyon ajanının senin onayını beklediği aksiyonlar"
        onClose={onClose}
      />

      <div className="flex-1 overflow-y-auto px-6 py-5">
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
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-6">
            {grouped.map((group) => (
              <section key={group.campaignId} className="flex flex-col gap-3">
                <div className="text-label text-ink-subtle uppercase tracking-wider">
                  {group.label}
                </div>
                <ul className="flex flex-col gap-3">
                  {group.notifications.map((n) => (
                    <li key={n.id}>
                      <InboxCard notification={n} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <footer className="border-t border-border px-6 py-3 text-body-sm text-ink-subtle leading-[1.5]">
        Otopilot moduna geçen kampanyalar için öneri üretilmez — kararlar doğrudan uygulanır.
      </footer>
    </Drawer>
  );
}

interface CampaignGroup {
  campaignId: number | null;
  label: string;
  notifications: GlobalNotificationRecord[];
}

function groupByCampaign(rows: GlobalNotificationRecord[]): CampaignGroup[] {
  const map = new Map<number | string, CampaignGroup>();
  for (const row of rows) {
    const key = row.campaignId ?? 'orphan';
    if (!map.has(key)) {
      const label = row.campaign ? hostnameOf(row.campaign.productUrl) : 'Bağlantısız';
      map.set(key, { campaignId: row.campaignId, label, notifications: [] });
    }
    map.get(key)?.notifications.push(row);
  }
  return Array.from(map.values());
}

function InboxCard({ notification }: { notification: GlobalNotificationRecord }) {
  // `campaignId` may be null in theory (orphaned proposal); in practice the
  // optimizer-agent always emits with a campaign attached, so we treat null
  // as "cannot act" and surface the body but disable the buttons.
  const campaignId = notification.campaignId ?? 0;
  const canAct = campaignId > 0;
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
        'rounded-md border border-border bg-surface p-4 flex flex-col gap-3',
        'shadow-card-sm',
      )}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Pill tone="warning" dot>
          {TYPE_LABEL[notification.type]}
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

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="secondary"
          size="md"
          onClick={() => reject.mutate(notification.id)}
          disabled={!canAct || busy}
          loading={reject.isPending}
        >
          {reject.isPending ? 'Reddediliyor…' : 'Reddet'}
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={() => approve.mutate(notification.id)}
          disabled={!canAct || busy}
          loading={approve.isPending}
        >
          {approve.isPending ? 'Uygulanıyor…' : 'Onayla'}
        </Button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-start gap-2">
      <h3 className="text-h3 text-ink">Şu an bekleyen öneri yok</h3>
      <p className="text-body-sm text-ink-muted leading-[1.55]">
        Optimizasyon ajanı 6 saatte bir kampanyalarına bakar. Co-Pilot moduna geçen kampanyalar için
        aksiyon önerisi geldiğinde burada görünür.
      </p>
    </div>
  );
}
