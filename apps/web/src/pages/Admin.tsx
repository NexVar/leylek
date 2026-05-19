import { useMemo, useState } from 'react';
import { ApiError } from '../api/client';
import { useAdminD1, useAdminKv, useAdminKvValue, useAdminSummary } from '../api/hooks';
import type { AdminD1Table } from '../api/types';
import { Button } from '../components/Button';
import { Card, CardHeader } from '../components/Card';
import { Pill } from '../components/Pill';
import { SpinnerInline } from '../components/SpinnerInline';
import { cn } from '../lib/cn';

const TABLES: Array<{ value: AdminD1Table; label: string }> = [
  { value: 'campaigns', label: 'campaigns' },
  { value: 'ads', label: 'ads' },
  { value: 'agent_logs', label: 'agent_logs' },
  { value: 'notifications', label: 'notifications' },
  { value: 'connected_accounts', label: 'connected_accounts' },
  { value: 'metric_snapshots', label: 'metric_snapshots' },
  { value: 'users', label: 'users' },
];

const KV_PREFIXES = ['gads:', 'meta:', 'magic_link:', 'oauth_state:', 'sim:'];

type Tab = 'summary' | 'd1' | 'kv';

/**
 * Internal inspector. Surfaces D1 + KV state so demo viewers can see the
 * rows behind the agent timeline + the KV keys the mock workers persist.
 * Auth-gated by ProtectedRoute (any logged-in user can read; the project
 * is single-tenant). All data is read-only — no mutations live on this
 * surface deliberately.
 */
export function AdminPage() {
  const [tab, setTab] = useState<Tab>('summary');

  return (
    <div className="flex flex-col gap-7 sm:gap-8 max-w-[960px]">
      <header className="flex flex-col gap-1.5">
        <span className="text-label text-ink-muted uppercase tracking-[0.08em]">Inspector</span>
        <h1 className="text-[28px] font-bold leading-[1.15] tracking-[-0.015em] text-ink sm:text-h1">
          Sistem durumu
        </h1>
        <p className="text-body-md text-ink-muted max-w-2xl">
          D1 tabloları + KV anahtarları üzerinde salt-okunur görünüm. Demo akışı sırasında ajanın
          gerçekten yazdığı row'ları görmek için.
        </p>
      </header>

      <nav className="flex items-center gap-2 overflow-x-auto border-b border-border">
        {(['summary', 'd1', 'kv'] as const).map((t) => (
          <TabButton key={t} active={tab === t} onClick={() => setTab(t)}>
            {t === 'summary' ? 'Özet' : t === 'd1' ? 'D1 tabloları' : 'KV anahtarları'}
          </TabButton>
        ))}
      </nav>

      {tab === 'summary' ? <SummaryTab /> : null}
      {tab === 'd1' ? <D1Tab /> : null}
      {tab === 'kv' ? <KvTab /> : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-2 -mb-px text-body-sm font-medium transition-colors duration-150 whitespace-nowrap',
        'border-b-2',
        active
          ? 'border-accent text-ink'
          : 'border-transparent text-ink-muted hover:text-ink hover:border-border',
      )}
    >
      {children}
    </button>
  );
}

function SummaryTab() {
  const query = useAdminSummary();
  if (query.isLoading) {
    return (
      <Card padding="lg">
        <div className="flex items-center gap-3 text-ink-muted text-body-sm">
          <SpinnerInline className="text-accent" />
          Özet yükleniyor…
        </div>
      </Card>
    );
  }
  if (query.error) return <ErrorCard error={query.error} onRetry={() => query.refetch()} />;
  const data = query.data;
  if (!data) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card padding="lg">
        <CardHeader title="D1 tabloları" subtitle="Toplam satır sayısı" />
        <ul className="mt-4 flex flex-col">
          {Object.entries(data.d1).map(([table, count]) => (
            <li
              key={table}
              className="flex items-center justify-between py-1.5 border-b border-border last:border-b-0"
            >
              <code className="font-mono text-body-sm text-ink">{table}</code>
              <span className="text-h3 text-ink tabular-nums">{count}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card padding="lg">
        <CardHeader title="KV prefix'leri" subtitle="Anahtar sayısı" />
        <ul className="mt-4 flex flex-col">
          {Object.entries(data.kv).map(([prefix, count]) => (
            <li
              key={prefix}
              className="flex items-center justify-between py-1.5 border-b border-border last:border-b-0"
            >
              <code className="font-mono text-body-sm text-ink">{prefix}</code>
              <span className="text-h3 text-ink tabular-nums">{count}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function D1Tab() {
  const [table, setTable] = useState<AdminD1Table>('campaigns');
  const [limit, setLimit] = useState(20);
  const query = useAdminD1(table, limit);

  const columns = useMemo(() => {
    const rows = query.data?.rows ?? [];
    if (rows.length === 0) return [];
    const first = rows[0];
    if (!first) return [];
    return Object.keys(first);
  }, [query.data]);

  return (
    <div className="flex flex-col gap-4">
      <Card padding="md" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="flex flex-col gap-1.5 text-body-sm sm:w-auto">
          <span className="text-ink-muted">Tablo</span>
          <select
            value={table}
            onChange={(e) => setTable(e.target.value as AdminD1Table)}
            className="h-9 rounded-md border border-border bg-surface-raised px-3 text-body-sm text-ink"
          >
            {TABLES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-body-sm sm:w-auto">
          <span className="text-ink-muted">Limit</span>
          <input
            type="number"
            min={1}
            max={200}
            value={limit}
            onChange={(e) => setLimit(Number.parseInt(e.target.value, 10) || 20)}
            className="h-9 rounded-md border border-border bg-surface-raised px-3 text-body-sm text-ink sm:w-24"
          />
        </label>
        <Button variant="secondary" block className="sm:w-auto" onClick={() => query.refetch()}>
          Yenile
        </Button>
        <span className="text-body-sm text-ink-muted sm:ml-auto sm:self-center">
          {query.data?.count ?? 0} satır · DESC sıralı (id)
        </span>
      </Card>

      {query.isLoading ? (
        <Card padding="lg">
          <div className="flex items-center gap-3 text-ink-muted text-body-sm">
            <SpinnerInline className="text-accent" />
            Yükleniyor…
          </div>
        </Card>
      ) : query.error ? (
        <ErrorCard error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <Card padding="sm" className="overflow-x-auto">
          {columns.length === 0 ? (
            <p className="text-body-sm text-ink-muted px-3 py-2">Satır yok.</p>
          ) : (
            <table className="min-w-full text-body-sm">
              <thead>
                <tr className="bg-surface-sunken">
                  {columns.map((col) => (
                    <th
                      key={col}
                      className="text-left font-mono text-[11px] text-ink-subtle uppercase tracking-wider px-3 py-2 border-b border-border whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {query.data?.rows.map((row, idx) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable client-side id
                  <tr key={idx} className="border-b border-border last:border-b-0">
                    {columns.map((col) => (
                      <td
                        key={col}
                        className="px-3 py-2 align-top font-mono text-[12px] text-ink whitespace-pre-wrap max-w-[320px] truncate"
                      >
                        {formatCell(row[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}

function KvTab() {
  const [prefix, setPrefix] = useState('gads:');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const list = useAdminKv(prefix, 100);
  const value = useAdminKvValue(activeKey);

  return (
    <div className="flex flex-col gap-4">
      <Card padding="md" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="flex flex-col gap-1.5 text-body-sm sm:w-auto">
          <span className="text-ink-muted">Prefix</span>
          <input
            type="text"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            list="kv-prefix-options"
            className="h-9 rounded-md border border-border bg-surface-raised px-3 text-body-sm text-ink font-mono sm:w-56"
          />
          <datalist id="kv-prefix-options">
            {KV_PREFIXES.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <Button variant="secondary" block className="sm:w-auto" onClick={() => list.refetch()}>
          Yenile
        </Button>
        <span className="text-body-sm text-ink-muted sm:ml-auto sm:self-center">
          {list.data?.keys.length ?? 0} anahtar
          {list.data && !list.data.listComplete ? ' (kısmi)' : ''}
        </span>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4">
        <Card padding="sm" className="overflow-y-auto max-h-[520px]">
          {list.isLoading ? (
            <div className="flex items-center gap-3 text-ink-muted text-body-sm px-3 py-2">
              <SpinnerInline className="text-accent" />
              Yükleniyor…
            </div>
          ) : list.error ? (
            <ErrorCard error={list.error} onRetry={() => list.refetch()} />
          ) : list.data?.keys.length === 0 ? (
            <p className="text-body-sm text-ink-muted px-3 py-2">Eşleşen anahtar yok.</p>
          ) : (
            <ul className="flex flex-col">
              {list.data?.keys.map((k) => (
                <li key={k.name}>
                  <button
                    type="button"
                    onClick={() => setActiveKey(k.name)}
                    className={cn(
                      'w-full text-left px-3 py-1.5 font-mono text-[12px]',
                      'border-b border-border last:border-b-0',
                      'hover:bg-surface-sunken transition-colors duration-100',
                      activeKey === k.name
                        ? 'bg-surface-sunken text-ink font-medium'
                        : 'text-ink-muted',
                    )}
                    title={k.name}
                  >
                    <span className="block truncate">{k.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card padding="md" className="overflow-x-auto">
          {!activeKey ? (
            <p className="text-body-sm text-ink-muted">
              Bir anahtara tıkla — değeri burada görünür.
            </p>
          ) : value.isLoading ? (
            <div className="flex items-center gap-3 text-ink-muted text-body-sm">
              <SpinnerInline className="text-accent" />
              Yükleniyor…
            </div>
          ) : value.error ? (
            <ErrorCard error={value.error} onRetry={() => value.refetch()} />
          ) : value.data?.value === null ? (
            <p className="text-body-sm text-ink-muted">Anahtar var ama değer null.</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <code className="font-mono text-[11px] text-ink-subtle truncate">{activeKey}</code>
                <Pill tone="neutral">{value.data?.value?.length ?? 0} byte</Pill>
              </div>
              <pre className="font-mono text-[12px] text-ink whitespace-pre-wrap break-all">
                {prettyJson(value.data?.value ?? '')}
              </pre>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function ErrorCard({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const msg = error instanceof ApiError ? `${error.status} — ${error.message}` : 'Bağlantı hatası.';
  return (
    <Card padding="lg" className="flex flex-col gap-3 border-danger/40">
      <Pill tone="danger" dot>
        Hata
      </Pill>
      <p className="text-body-md text-ink-muted">{msg}</p>
      <Button variant="secondary" onClick={onRetry}>
        Tekrar dene
      </Button>
    </Card>
  );
}

function formatCell(v: unknown): string {
  if (v === null) return '∅';
  if (v === undefined) return '';
  if (typeof v === 'string') return v.length > 200 ? `${v.slice(0, 200)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
