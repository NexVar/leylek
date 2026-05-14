import { useState } from 'react';
import { ApiError, GATEWAY_URL } from '../api/client';
import { useConnectedAccounts, useDisconnectAccount } from '../api/hooks';
import type { AdProvider, ConnectedAccount } from '../api/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Pill } from '../components/Pill';
import { SpinnerInline } from '../components/SpinnerInline';
import { cn } from '../lib/cn';

const PROVIDER_META: Record<AdProvider, { label: string; glyph: string; tone: string }> = {
  meta: {
    label: 'Meta Reklam Hesabı',
    glyph: 'M',
    tone: 'bg-info text-white',
  },
  google_ads: {
    label: 'Google Ads',
    glyph: 'G',
    tone: 'bg-accent text-accent-foreground',
  },
};

/**
 * Connected accounts page. Lists Meta + Google Ads bindings, lets the
 * user disconnect, and links into the OAuth `/start` endpoints. Those
 * endpoints currently respond with 503 + `{error:'oauth_not_wired', detail}`
 * — we render the detail copy inside a warning Pill instead of redirecting.
 *
 * Per PRD §17 the Meta OAuth flow + Google Ads Standard access flip live
 * in Faz 2; the UI is wired today so the day the gateway implements
 * `/start` properly, this page already routes there.
 */
export function AccountsPage() {
  const query = useConnectedAccounts();
  const disconnect = useDisconnectAccount();

  return (
    <div className="flex flex-col gap-8 max-w-[760px]">
      <header className="flex flex-col gap-1.5">
        <span className="text-label text-ink-muted uppercase tracking-[0.08em]">
          Hesap Bağlantıları
        </span>
        <h1 className="text-h1 text-ink">Bağlı reklam hesapların</h1>
        <p className="text-body-md text-ink-muted max-w-xl">
          Yayın ajanı reklamlarını bu hesaplar üzerinden açar, durdurur ve bütçesini kaydırır.
          Token'lar şifrelenmiş olarak saklanır.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-h2 text-ink">Bağlı hesaplar</h2>

        {query.isLoading ? (
          <Card>
            <div className="flex items-center gap-3 text-ink-muted text-body-sm">
              <SpinnerInline className="text-accent" />
              Hesaplar yükleniyor…
            </div>
          </Card>
        ) : query.error ? (
          <Card padding="lg" className="flex flex-col gap-3 border-danger/40">
            <Pill tone="danger" dot>
              {query.error instanceof ApiError ? `Hata ${query.error.status}` : 'Bağlantı hatası'}
            </Pill>
            <p className="text-body-md text-ink-muted">
              {query.error instanceof ApiError ? query.error.message : 'Hesaplar okunamadı.'}
            </p>
            <Button variant="secondary" onClick={() => query.refetch()}>
              Tekrar dene
            </Button>
          </Card>
        ) : query.data?.accounts.length === 0 ? (
          <Card padding="lg" className="text-body-md text-ink-muted">
            Henüz bağlı bir reklam hesabın yok. Aşağıdan başla.
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {query.data?.accounts.map((acc) => (
              <li key={acc.id}>
                <AccountRow
                  account={acc}
                  onDisconnect={() => disconnect.mutate(acc.id)}
                  disconnecting={disconnect.isPending && disconnect.variables === acc.id}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-h2 text-ink">Yeni bağlantı ekle</h2>
        <Card padding="lg" className="flex flex-col gap-4">
          <p className="text-body-md text-ink-muted">
            Her sağlayıcı için tek bir hesap bağlayabilirsin (MVP — Faz 2'de çoklu hesap).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ConnectButton provider="meta" path="/api/auth/meta/start" />
            <ConnectButton provider="google_ads" path="/api/auth/google-ads/start" />
          </div>
        </Card>
      </section>
    </div>
  );
}

interface AccountRowProps {
  account: ConnectedAccount;
  onDisconnect: () => void;
  disconnecting: boolean;
}

function AccountRow({ account, onDisconnect, disconnecting }: AccountRowProps) {
  const meta = PROVIDER_META[account.provider];
  const statusTone =
    account.status === 'active' ? 'success' : account.status === 'expired' ? 'warning' : 'neutral';
  const statusLabel =
    account.status === 'active'
      ? 'Aktif'
      : account.status === 'expired'
        ? 'Süresi dolmuş'
        : 'İptal';

  return (
    <Card padding="md" className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-4 min-w-0">
        <div
          aria-hidden
          className={cn(
            'w-10 h-10 rounded-md flex items-center justify-center font-semibold text-[16px]',
            meta.tone,
          )}
        >
          {meta.glyph}
        </div>
        <div className="min-w-0 flex flex-col gap-0.5">
          <span className="text-h3 text-ink truncate">{account.accountLabel ?? meta.label}</span>
          <span className="font-mono text-[11px] text-ink-subtle truncate">
            {meta.label} · {account.externalId}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Pill tone={statusTone} dot>
          {statusLabel}
        </Pill>
        <Button
          variant="ghost"
          size="md"
          onClick={onDisconnect}
          loading={disconnecting}
          disabled={disconnecting}
        >
          Bağlantıyı kes
        </Button>
      </div>
    </Card>
  );
}

interface ConnectButtonProps {
  provider: AdProvider;
  path: string;
}

function ConnectButton({ provider, path }: ConnectButtonProps) {
  const meta = PROVIDER_META[provider];
  const [notWired, setNotWired] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  const handleClick = async () => {
    setNotWired(null);
    setRequesting(true);
    try {
      const res = await fetch(`${GATEWAY_URL}${path}`, {
        method: 'GET',
        credentials: 'include',
        redirect: 'manual',
      });
      if (res.status === 503) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          detail?: string;
        } | null;
        setNotWired(body?.detail ?? 'OAuth akışı henüz devrede değil (Faz 2).');
        return;
      }
      // For real OAuth, the gateway 302s — `redirect: 'manual'` makes
      // `res.type === 'opaqueredirect'`. Follow it ourselves.
      if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
        window.location.href = `${GATEWAY_URL}${path}`;
        return;
      }
      if (!res.ok) {
        setNotWired(`Hata ${res.status} — bağlantı başlatılamadı.`);
      }
    } catch {
      setNotWired('Ağ hatası — gateway erişilemiyor.');
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={requesting}
        className={cn(
          'w-full h-11 inline-flex items-center justify-center gap-2.5 rounded-md',
          'border border-accent text-accent bg-transparent hover:bg-accent-tint',
          'transition-colors duration-150 text-[15px] font-medium',
          'disabled:opacity-60 disabled:cursor-not-allowed',
        )}
      >
        {requesting ? (
          <SpinnerInline className="text-current" />
        ) : (
          <span
            aria-hidden
            className={cn(
              'w-6 h-6 rounded-sm flex items-center justify-center text-[13px] font-semibold',
              meta.tone,
            )}
          >
            {meta.glyph}
          </span>
        )}
        {provider === 'meta' ? 'Meta hesabını bağla' : 'Google Ads hesabını bağla'}
      </button>
      {notWired ? (
        <div className="flex items-start gap-2">
          <Pill tone="warning" dot>
            Faz 2'de geliyor
          </Pill>
          <p className="text-body-sm text-ink-muted leading-[1.45]">{notWired}</p>
        </div>
      ) : null}
    </div>
  );
}
