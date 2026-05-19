import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import {
  useApproveNotification,
  useCampaign,
  useCampaignLogs,
  useInvalidateCampaign,
  useOptimizeNow,
  useUpdateCampaignMode,
} from '../api/hooks';
import type { Ad, AgentLog, CampaignMode, OptimizeNowResponse } from '../api/types';
import { AgentLogRow } from '../components/AgentLogRow';
import { Button } from '../components/Button';
import { Card, CardHeader } from '../components/Card';
import { DecisionReplayPanel } from '../components/DecisionReplayPanel';
import { MetricNumber } from '../components/MetricNumber';
import { NotificationsPanel } from '../components/NotificationsPanel';
import { OptimizerToast } from '../components/OptimizerToast';
import { Pill } from '../components/Pill';
import { SpendChart } from '../components/SpendChart';
import { SpinnerInline } from '../components/SpinnerInline';
import { cn } from '../lib/cn';
import {
  basisPointsToPercent,
  hostnameOf,
  kurusToTry,
  modeLabel,
  prettyTitle,
  strategyLabel,
} from '../lib/format';

/**
 * The demo screen. Layout (per spec):
 *   Header (campaign meta + coral CTA)
 *   ┌────────────────────────────┐ ┌──────────────┐
 *   │ 3 ad cards in a row        │ │ Agent        │
 *   │ Spend chart below          │ │ timeline     │
 *   └────────────────────────────┘ └──────────────┘
 *
 * Clicking "Şimdi Optimize Et" → POST /optimize-now → coral toast streams
 * the reasoning client-side (30ms/word). After stream completes + 5s
 * settle, we refetch the campaign + logs so the timeline + paused ad
 * status update without a second click.
 */
export function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const campaignQuery = useCampaign(id);
  const logsQuery = useCampaignLogs(id);
  const optimizeMutation = useOptimizeNow(id);
  const modeMutation = useUpdateCampaignMode(id);
  const approveFromToast = useApproveNotification(id);
  const invalidate = useInvalidateCampaign();

  const [toast, setToast] = useState<OptimizeNowResponse | null>(null);
  const [replayLog, setReplayLog] = useState<AgentLog | null>(null);

  if (!Number.isFinite(id) || id <= 0) {
    return (
      <Card>
        <p className="text-body-md text-ink-muted">Geçersiz kampanya kimliği.</p>
      </Card>
    );
  }

  if (campaignQuery.isLoading) {
    return (
      <Card>
        <div className="flex items-center gap-3 text-ink-muted text-body-sm">
          <SpinnerInline className="text-accent" />
          Kampanya yükleniyor…
        </div>
      </Card>
    );
  }

  if (campaignQuery.error) {
    const status = campaignQuery.error instanceof ApiError ? campaignQuery.error.status : null;
    return (
      <Card padding="lg" className="flex flex-col items-start gap-3 border-danger/50">
        <Pill tone="danger" dot>
          {status ? `Hata ${status}` : 'Bağlantı hatası'}
        </Pill>
        <p className="text-body-md text-ink-muted">Kampanya bilgilerine ulaşılamadı.</p>
        <Link to="/dashboard">
          <Button variant="secondary">Kampanyalara dön</Button>
        </Link>
      </Card>
    );
  }

  if (!campaignQuery.data) return null;

  const { campaign, ads } = campaignQuery.data;
  const logs = logsQuery.data?.logs ?? campaignQuery.data.logs;

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <BackLink />

      <CampaignHeader
        productUrl={campaign.productUrl}
        mode={campaign.mode}
        status={campaign.status}
        dailyBudgetKurus={campaign.dailyBudgetKurus}
        adCount={ads.length}
        optimizing={optimizeMutation.isPending}
        modeSwitching={modeMutation.isPending}
        onModeChange={(next) => {
          if (next === campaign.mode) return;
          modeMutation.mutate(next);
        }}
        onOptimize={async () => {
          try {
            const res = await optimizeMutation.mutateAsync();
            setToast({ ...res, campaignMode: res.campaignMode ?? campaign.mode });
          } catch (err) {
            const msg = humanizeOptimizeError(err);
            // Render a one-off danger pill toast via setToast with a fake decision shape.
            setToast({
              decision: {
                action: 'KEEP',
                targetAdId: null,
                reason: msg,
                confidence: 0,
              },
              reasoningStreamLine: msg,
              agentLogId: 0,
            });
          }
        }}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <div className="flex flex-col gap-6 min-w-0">
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <h2 className="text-h2 text-ink">Reklam Varyantları</h2>
              <span className="text-body-sm text-ink-subtle">
                İçerik ajanının ürettiği üç strateji
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {ads.map((ad) => (
                <AdCard key={ad.id} ad={ad} />
              ))}
            </div>
          </section>

          <section>
            <Card padding="lg" className="rounded-xl">
              <CardHeader
                title="Harcama Dağılımı"
                subtitle="Reklam başına son 48 saatlik harcama"
                trailing={
                  <span className="text-body-sm text-ink-subtle tabular-nums">
                    Toplam{' '}
                    <span className="text-ink font-medium">
                      {kurusToTry(ads.reduce((s, a) => s + a.spendKurus, 0))}
                    </span>
                  </span>
                }
              />
              <div className="mt-5">
                <SpendChart ads={ads} />
              </div>
            </Card>
          </section>
        </div>

        <aside className="min-w-0 flex flex-col gap-6">
          <NotificationsPanel campaignId={id} mode={campaign.mode} />

          <Card padding="lg">
            <CardHeader
              title="Ajan Kararları"
              subtitle="En yeni karar en üstte"
              trailing={<Pill tone="neutral">{logs.length}</Pill>}
            />
            <div className="mt-5">
              {logs.length === 0 ? (
                <p className="text-body-sm text-ink-subtle">
                  Henüz karar yok. "Şimdi Optimize Et" ile tetikleyebilirsin.
                </p>
              ) : (
                <ul className="flex flex-col">
                  {logs.map((log, i) => (
                    <AgentLogRow
                      key={log.id}
                      log={log}
                      isFirst={i === 0}
                      isLast={i === logs.length - 1}
                      onReplay={setReplayLog}
                    />
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </aside>
      </div>

      {toast ? (
        <OptimizerToast
          response={toast}
          mode={toast.campaignMode ?? campaign.mode}
          approving={approveFromToast.isPending}
          onApprove={
            typeof toast.notificationId === 'number'
              ? async () => {
                  if (typeof toast.notificationId !== 'number') return;
                  try {
                    await approveFromToast.mutateAsync(toast.notificationId);
                    setToast(null);
                    void invalidate(id);
                  } catch {
                    /* error already surfaced via mutation state */
                  }
                }
              : undefined
          }
          onDismiss={() => {
            setToast(null);
            void invalidate(id);
          }}
        />
      ) : null}

      <DecisionReplayPanel
        open={replayLog !== null}
        log={replayLog}
        onClose={() => setReplayLog(null)}
      />
    </div>
  );
}

/**
 * Translate optimizer error codes into friendly Turkish prose so the toast
 * reads as a real reason instead of leaking an internal `optimizer_failed`
 * identifier — which looks to the user like the code itself is broken.
 */
function humanizeOptimizeError(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Optimizasyon başarısız oldu. Birazdan tekrar dene.';
  const code = err.message;
  if (code === 'rate_limited') {
    return 'AI servisi şu an çok yoğun (rate limited). Yaklaşık bir dakika sonra tekrar dene — sistemde hata yok.';
  }
  if (code === 'optimizer_failed' || code === 'no_decision') {
    return 'AI optimizasyon kararı veremedi — geçici bir Gemini servis hatası. Birazdan tekrar dene.';
  }
  if (code === 'campaign_not_found' || code === 'forbidden') {
    return 'Bu kampanyaya şu anda optimizasyon yetkin yok.';
  }
  return err.message || 'Optimizasyon başarısız oldu. Birazdan tekrar dene.';
}

function BackLink() {
  return (
    <Link
      to="/dashboard"
      className="inline-flex items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink rounded-sm self-start"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        role="img"
        aria-labelledby="back-link-title"
      >
        <title id="back-link-title">Geri</title>
        <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      Kampanyalara dön
    </Link>
  );
}

interface CampaignHeaderProps {
  productUrl: string;
  mode: CampaignMode;
  status: 'active' | 'paused' | 'archived';
  dailyBudgetKurus: number;
  adCount: number;
  optimizing: boolean;
  modeSwitching: boolean;
  onModeChange: (next: CampaignMode) => void;
  onOptimize: () => void;
}

function CampaignHeader({
  productUrl,
  mode,
  status,
  dailyBudgetKurus,
  adCount,
  optimizing,
  modeSwitching,
  onModeChange,
  onOptimize,
}: CampaignHeaderProps) {
  const statusTone = status === 'active' ? 'success' : status === 'paused' ? 'warning' : 'neutral';
  const statusLabel =
    status === 'active' ? 'Aktif' : status === 'paused' ? 'Duraklatıldı' : 'Arşivli';
  const otherMode: CampaignMode = mode === 'OTOPILOT' ? 'COPILOT' : 'OTOPILOT';

  return (
    <Card padding="lg" className="flex flex-col gap-5">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Pill tone={statusTone} dot>
              {statusLabel}
            </Pill>
            <ModePillToggle
              mode={mode}
              switching={modeSwitching}
              onChange={() => onModeChange(otherMode)}
            />
            <span className="font-mono text-[11px] text-ink-subtle">{hostnameOf(productUrl)}</span>
          </div>
          <h1 className="text-[28px] font-bold leading-[1.15] tracking-[-0.015em] text-ink sm:text-h1">
            {prettyTitle(productUrl)}
          </h1>
          <a
            href={productUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="max-w-full text-body-sm text-info hover:underline truncate inline-flex items-center gap-1"
            title={productUrl}
          >
            {productUrl}
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              role="img"
              aria-labelledby="external-link-title"
            >
              <title id="external-link-title">Yeni sekmede aç</title>
              <path
                d="M5 2h5v5M10 2 4.5 7.5M6 6v3.5H2.5V3H6"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        </div>
        <Button
          variant="primary"
          size="lg"
          onClick={onOptimize}
          loading={optimizing}
          block
          className="md:w-auto md:self-start whitespace-nowrap"
        >
          {optimizing ? 'Karar veriliyor…' : 'Şimdi Optimize Et'}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-5 pt-4 border-t border-border md:grid-cols-4">
        <MetricNumber
          label="Günlük bütçe"
          value={kurusToTry(dailyBudgetKurus)}
          hint="Otomatik dağılım"
        />
        <MetricNumber label="Aktif reklam" value={adCount} hint="3 strateji" />
        <MetricNumber
          label="Mod"
          value={modeLabel(mode)}
          hint={mode === 'OTOPILOT' ? 'Tam otonom' : 'Onaylı'}
          emphasis="muted"
        />
        <MetricNumber
          label="Ajan durumu"
          value={
            <span className="inline-flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse-coral" />
              Görevde
            </span>
          }
          hint="Cron · 6 saat"
          emphasis="muted"
        />
      </div>
    </Card>
  );
}

interface ModePillToggleProps {
  mode: CampaignMode;
  switching: boolean;
  onChange: () => void;
}

/**
 * Mode pill that doubles as a toggle. Click → PATCH the campaign's mode.
 * Tones per spec: success for Otopilot, info for Co-Pilot.
 */
function ModePillToggle({ mode, switching, onChange }: ModePillToggleProps) {
  const otherLabel = mode === 'OTOPILOT' ? 'Co-Pilot' : 'Otopilot';
  const tone =
    mode === 'OTOPILOT'
      ? {
          bg: 'bg-[color-mix(in_srgb,var(--color-success)_16%,transparent)]',
          text: 'text-success',
          dot: 'bg-success',
        }
      : {
          bg: 'bg-[color-mix(in_srgb,var(--color-info)_16%,transparent)]',
          text: 'text-info',
          dot: 'bg-info',
        };

  return (
    <button
      type="button"
      onClick={onChange}
      disabled={switching}
      aria-label={`Modu ${otherLabel} olarak değiştir`}
      title={`${otherLabel}’a geç`}
      className={cn(
        'inline-flex items-center gap-1.5 h-6 px-2 rounded-sm text-[12px] font-medium leading-none whitespace-nowrap',
        'transition-colors duration-150 focus-visible:outline-none',
        'disabled:opacity-60 disabled:cursor-not-allowed',
        tone.bg,
        tone.text,
      )}
    >
      {switching ? (
        <SpinnerInline size={10} className="text-current" />
      ) : (
        <span className={cn('w-1.5 h-1.5 rounded-full', tone.dot)} aria-hidden />
      )}
      {modeLabel(mode)}
    </button>
  );
}

interface AdCardProps {
  ad: Ad;
}

function AdCard({ ad }: AdCardProps) {
  const isPaused = ad.status === 'paused';

  const strategyMeta = useMemo(() => {
    switch (ad.strategyType) {
      case 'AGGRESSIVE':
        return { tone: 'danger' as const, accent: 'border-danger/50' };
      case 'STORY':
        return { tone: 'success' as const, accent: 'border-success/40' };
      case 'TECHNICAL':
        return { tone: 'info' as const, accent: 'border-info/40' };
    }
  }, [ad.strategyType]);

  const cpaLabel = ad.cpaKurus !== null ? kurusToTry(ad.cpaKurus) : '—';
  const statusTone = isPaused ? 'danger' : ad.status === 'pending' ? 'warning' : 'success';
  const statusLabel =
    ad.status === 'paused' ? 'Durduruldu' : ad.status === 'pending' ? 'Hazırlanıyor' : 'Yayında';

  return (
    <Card
      padding="md"
      className={cn(
        'flex flex-col h-full transition-colors duration-200',
        isPaused && 'bg-danger/[0.04] border-danger/30',
        !isPaused && `border-l-2 ${strategyMeta.accent}`,
      )}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Pill tone={isPaused ? 'danger' : strategyMeta.tone} dot>
          {strategyLabel(ad.strategyType)}
        </Pill>
        <Pill tone={statusTone}>{statusLabel}</Pill>
      </div>

      <div className="mt-3">
        {ad.imageR2Key ? (
          <img
            src={`/api/creatives/${ad.imageR2Key}`}
            alt={`${strategyLabel(ad.strategyType)} reklam görseli`}
            loading="lazy"
            decoding="async"
            className={cn(
              'w-full aspect-square object-cover rounded-md border border-border bg-surface-sunken',
              isPaused && 'opacity-40 grayscale',
            )}
          />
        ) : (
          <div
            role="img"
            aria-label="Görsel henüz üretilmedi"
            className={cn(
              'w-full aspect-square rounded-md border border-dashed border-border',
              'bg-surface-sunken flex items-center justify-center text-body-sm text-ink-subtle',
              'leading-[1.4] text-center px-4',
            )}
          >
            Görsel hazırlanıyor — /admin'den "Görselleri üret" ile tetikle
          </div>
        )}
      </div>

      <p
        className={cn(
          'text-body-md text-ink mt-3 leading-[1.5] sm:min-h-[5.5rem]',
          isPaused && 'text-ink-muted line-through decoration-danger/40',
        )}
      >
        {ad.adText}
      </p>

      <div className="mt-4 pt-4 border-t border-border grid grid-cols-3 gap-2">
        <MetricNumber
          label="Harcama"
          value={kurusToTry(ad.spendKurus)}
          emphasis={isPaused ? 'danger' : 'default'}
        />
        <MetricNumber
          label="CPA"
          value={cpaLabel}
          emphasis={ad.cpaKurus !== null && ad.cpaKurus > 8000 ? 'danger' : 'default'}
        />
        <MetricNumber
          label="CTR"
          value={basisPointsToPercent(ad.ctrBasisPoints)}
          emphasis="muted"
        />
      </div>

      <div className="mt-3 flex flex-col gap-1 text-body-sm text-ink-subtle sm:flex-row sm:items-center sm:justify-between sm:gap-2">
        <span className="font-mono text-[11px] break-all">
          {ad.googleAdId ?? ad.metaAdId ?? `sim_ad_${ad.id}`}
        </span>
        {isPaused ? <span className="text-danger font-medium">stop-loss tetiklendi</span> : null}
      </div>
    </Card>
  );
}
