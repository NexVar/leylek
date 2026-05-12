/**
 * Display helpers — kuruş → TRY, ad strategy → Turkish label, etc.
 * All number formatting uses `tr-TR` so 1234.5 renders as "1.234,5".
 */

const TRY_FORMATTER = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const TRY_FORMATTER_DECIMAL = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const PERCENT_FORMATTER = new Intl.NumberFormat('tr-TR', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const COMPACT_FORMATTER = new Intl.NumberFormat('tr-TR', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function kurusToTry(kurus: number, { decimals }: { decimals?: boolean } = {}): string {
  const value = kurus / 100;
  return decimals ? TRY_FORMATTER_DECIMAL.format(value) : TRY_FORMATTER.format(value);
}

export function basisPointsToPercent(bp: number | null): string {
  if (bp === null || bp === undefined) return '—';
  return PERCENT_FORMATTER.format(bp / 10_000);
}

export function compact(value: number): string {
  return COMPACT_FORMATTER.format(value);
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function strategyLabel(strategy: 'AGGRESSIVE' | 'STORY' | 'TECHNICAL'): string {
  switch (strategy) {
    case 'AGGRESSIVE':
      return 'Agresif';
    case 'STORY':
      return 'Hikaye';
    case 'TECHNICAL':
      return 'Teknik';
  }
}

export function modeLabel(mode: 'OTOPILOT' | 'COPILOT'): string {
  return mode === 'OTOPILOT' ? 'Otopilot' : 'Co-Pilot';
}

export function agentLabel(agent: 'content' | 'optimizer' | 'publisher'): string {
  switch (agent) {
    case 'content':
      return 'İçerik Ajanı';
    case 'optimizer':
      return 'Optimizasyon Ajanı';
    case 'publisher':
      return 'Yayın Ajanı';
  }
}

export function actionLabel(action: string): string {
  const map: Record<string, string> = {
    CREATED_AD: 'reklam oluşturdu',
    PAUSED_AD: 'reklamı durdurdu',
    RESUMED_AD: 'reklamı yeniden başlattı',
    REALLOCATED_BUDGET: 'bütçeyi kaydırdı',
    PROPOSED_PAUSE: 'durdurma önerdi',
    PROPOSED_BUDGET_SHIFT: 'bütçe kaydırma önerdi',
  };
  return map[action] ?? action.toLowerCase().replace(/_/g, ' ');
}

export function relativeTimeTr(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const delta = Math.max(0, Date.now() - then);
  const sec = Math.floor(delta / 1000);
  if (sec < 5) return 'şimdi';
  if (sec < 60) return `${sec} sn önce`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} dk önce`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} sa önce`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} gün önce`;
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'short',
  });
}
