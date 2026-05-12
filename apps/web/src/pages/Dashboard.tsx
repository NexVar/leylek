import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useCampaigns } from '../api/hooks';
import type { Campaign } from '../api/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Pill } from '../components/Pill';
import { SpinnerInline } from '../components/SpinnerInline';
import { hostnameOf, kurusToTry, modeLabel } from '../lib/format';
import { useAuthStore } from '../store/auth';

/**
 * Dashboard — list of campaigns. Each card shows hostname, mode pill,
 * daily budget (tabular TRY), and a status pill. Click → /campaigns/:id.
 *
 * Empty state prompts the user to create their first campaign. Loading
 * state is a small spinner row, not a skeleton — the data lands in <300ms
 * in sim mode so a skeleton would flash and feel wrong.
 */
export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const campaignsQuery = useCampaigns();

  const greetingName = user?.name?.split(' ')[0] ?? user?.email?.split('@')[0] ?? 'orada';

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="flex flex-col gap-1.5">
          <span className="text-label text-ink-muted uppercase tracking-[0.08em]">Hoş geldin</span>
          <h1 className="text-h1 text-ink">{greetingName}, ajanların görevde.</h1>
          <p className="text-body-md text-ink-muted max-w-xl">
            Aktif kampanyalarını ve son ajan kararlarını buradan izle. Bir kampanya seçince
            optimizasyon ajanını manuel olarak da tetikleyebilirsin.
          </p>
        </div>
        <Button variant="secondary" disabled>
          Yeni kampanya
        </Button>
      </header>

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-h2 text-ink">Kampanyalar</h2>
          <span className="text-body-sm text-ink-subtle tabular-nums">
            {campaignsQuery.data?.campaigns.length ?? 0} kampanya
          </span>
        </div>

        {campaignsQuery.isLoading ? (
          <Card>
            <div className="flex items-center gap-3 text-ink-muted text-body-sm">
              <SpinnerInline className="text-accent" />
              Kampanyalar yükleniyor…
            </div>
          </Card>
        ) : campaignsQuery.error ? (
          <ErrorState error={campaignsQuery.error} onRetry={() => campaignsQuery.refetch()} />
        ) : campaignsQuery.data?.campaigns.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {campaignsQuery.data?.campaigns.map((c) => (
              <li key={c.id}>
                <CampaignCard campaign={c} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const statusTone =
    campaign.status === 'active' ? 'success' : campaign.status === 'paused' ? 'warning' : 'neutral';
  const statusLabel =
    campaign.status === 'active'
      ? 'Aktif'
      : campaign.status === 'paused'
        ? 'Duraklatıldı'
        : 'Arşivli';
  const modeTone = campaign.mode === 'OTOPILOT' ? 'navy' : 'accent';

  return (
    <Link
      to={`/campaigns/${campaign.id}`}
      className="block focus:outline-none focus-visible:shadow-focus rounded-md"
    >
      <Card interactive padding="lg" className="h-full">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex flex-col gap-1">
            <span className="font-mono text-[11px] text-ink-subtle uppercase tracking-[0.04em]">
              #{campaign.id} · {hostnameOf(campaign.productUrl)}
            </span>
            <h3 className="text-h3 text-ink truncate" title={campaign.productUrl}>
              {prettyTitle(campaign.productUrl)}
            </h3>
          </div>
          <Pill tone={statusTone} dot>
            {statusLabel}
          </Pill>
        </div>

        <div className="mt-5 flex items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-label text-ink-muted uppercase tracking-[0.04em]">
              Günlük bütçe
            </span>
            <span className="text-h2 tabular-nums text-ink leading-none">
              {kurusToTry(campaign.dailyBudgetKurus)}
            </span>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Pill tone={modeTone}>{modeLabel(campaign.mode)}</Pill>
            {campaign.adCount !== undefined ? (
              <span className="text-body-sm text-ink-muted tabular-nums">
                {campaign.adCount} reklam aktif
              </span>
            ) : null}
          </div>
        </div>
      </Card>
    </Link>
  );
}

function prettyTitle(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() ?? u.hostname;
    return decodeURIComponent(last.replace(/[-_]/g, ' ')).replace(/\b\w/g, (m) =>
      m.toLocaleUpperCase('tr-TR'),
    );
  } catch {
    return url;
  }
}

function EmptyState() {
  return (
    <Card padding="lg" className="flex flex-col items-start gap-4">
      <div className="w-12 h-12 rounded-md bg-accent-tint flex items-center justify-center">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          role="img"
          aria-labelledby="empty-state-title"
        >
          <title id="empty-state-title">Yeni kampanya</title>
          <path d="M4 12h16M12 4v16" stroke="#FF6B5C" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <div>
        <h3 className="text-h3 text-ink">Henüz kampanyan yok</h3>
        <p className="text-body-md text-ink-muted max-w-md mt-1">
          Bir ürün URL’i gir, ajan üç farklı stratejide reklam üretsin ve yayına alsın. Bütçeni biz
          kollarız.
        </p>
      </div>
      <Button variant="primary" disabled>
        İlk kampanyanı oluştur
      </Button>
    </Card>
  );
}

function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const msg =
    error instanceof ApiError
      ? `${error.status} — ${error.message}`
      : error instanceof Error
        ? error.message
        : 'Bilinmeyen hata';
  return (
    <Card padding="lg" className="flex flex-col items-start gap-3 border-danger/50">
      <Pill tone="danger" dot>
        Bağlantı hatası
      </Pill>
      <p className="text-body-md text-ink-muted">{msg}</p>
      <Button variant="secondary" onClick={onRetry}>
        Tekrar dene
      </Button>
    </Card>
  );
}
