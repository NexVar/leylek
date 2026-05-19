import { useState } from 'react';
import { ApiError } from '../api/client';
import { useConnectedAccounts, useConnectMockAccount, useDisconnectAccount } from '../api/hooks';
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
    <div className="flex flex-col gap-7 sm:gap-8 max-w-[760px]">
      <header className="flex flex-col gap-1.5">
        <span className="text-label text-ink-muted uppercase tracking-[0.08em]">
          Hesap Bağlantıları
        </span>
        <h1 className="text-[28px] font-bold leading-[1.15] tracking-[-0.015em] text-ink sm:text-h1">
          Bağlı reklam hesapların
        </h1>
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
            Sandbox bağlantısı — yayın ajanı leylek-*-mock Worker'larına HTTPS gönderir.
            Production'da aynı buton gerçek Google / Meta OAuth akışını başlatacak.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ConnectButton provider="google_ads" />
            <ConnectButton provider="meta" />
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
    <Card
      padding="md"
      className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3 min-w-0 sm:items-center sm:gap-4">
        <div
          aria-hidden
          className={cn(
            'w-10 h-10 rounded-md flex shrink-0 items-center justify-center font-semibold text-[16px]',
            meta.tone,
          )}
        >
          {meta.glyph}
        </div>
        <div className="min-w-0 flex flex-col gap-0.5">
          <span className="text-h3 text-ink leading-tight sm:truncate">
            {account.accountLabel ?? meta.label}
          </span>
          <span className="font-mono text-[11px] text-ink-subtle break-all sm:truncate">
            {meta.label} · {account.externalId}
          </span>
        </div>
      </div>
      <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-3 sm:shrink-0">
        <Pill tone={statusTone} dot>
          {statusLabel}
        </Pill>
        <Button
          variant="ghost"
          size="md"
          onClick={onDisconnect}
          loading={disconnecting}
          disabled={disconnecting}
          block
          className="sm:w-auto"
        >
          Bağlantıyı kes
        </Button>
      </div>
    </Card>
  );
}

interface ConnectButtonProps {
  provider: AdProvider;
}

function ConnectButton({ provider }: ConnectButtonProps) {
  const meta = PROVIDER_META[provider];
  const connect = useConnectMockAccount();
  const [justConnected, setJustConnected] = useState<string | null>(null);

  // Add ~600 ms of artificial latency so the button reads like a real
  // OAuth round-trip ("redirecting to Google → exchanging code →
  // success") instead of an instant insert. The mock backend itself is
  // sub-50 ms; this delay lives entirely on the click handler.
  const handleClick = async () => {
    setJustConnected(null);
    await new Promise((resolve) => setTimeout(resolve, 600));
    try {
      const { account } = await connect.mutateAsync(provider);
      setJustConnected(account.externalId);
    } catch {
      // Mutation surfaces `connect.error` for inline rendering below.
    }
  };

  const errorMessage = (() => {
    if (!connect.error) return null;
    return connect.error instanceof ApiError ? connect.error.message : 'Bağlantı kurulamadı.';
  })();

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={connect.isPending}
        className={cn(
          'w-full h-11 inline-flex items-center justify-center gap-2.5 rounded-md',
          'border border-accent text-accent bg-transparent hover:bg-accent-tint',
          'transition-colors duration-150 text-[15px] font-medium',
          'disabled:opacity-60 disabled:cursor-not-allowed',
        )}
      >
        {connect.isPending ? (
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
        {connect.isPending
          ? `${provider === 'meta' ? 'Meta' : 'Google'} ile bağlanıyor…`
          : provider === 'meta'
            ? 'Meta hesabını bağla'
            : 'Google Ads hesabını bağla'}
      </button>
      {justConnected ? (
        <div className="flex items-start gap-2">
          <Pill tone="success" dot>
            Bağlandı
          </Pill>
          <p className="text-body-sm text-ink-muted leading-[1.45]">
            Sandbox hesabı eklendi · <span className="font-mono">{justConnected}</span>
          </p>
        </div>
      ) : errorMessage ? (
        <div className="flex items-start gap-2">
          <Pill tone="danger" dot>
            Bağlanamadı
          </Pill>
          <p className="text-body-sm text-ink-muted leading-[1.45]">{errorMessage}</p>
        </div>
      ) : null}
    </div>
  );
}
