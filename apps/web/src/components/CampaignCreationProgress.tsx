import { useEffect, useMemo, useState } from 'react';
import type { Ad, AdStrategy } from '../api/types';
import { cn } from '../lib/cn';
import { Pill } from './Pill';

export type CreationStage = 'scrape' | 'audience' | 'strategy' | 'images' | 'publish' | 'done';

interface CampaignCreationProgressProps {
  /** URL the user entered — shown in the scrape step. */
  productUrl: string;
  /** Daily budget in TRY (already divided from kurus) — shown in summary. */
  dailyBudgetTry: number;
  /**
   * Audience + ad rows arrive once the mutation succeeds. Until then the
   * progress component shows placeholder copy paced by `currentStage`.
   */
  audience: { demographic: string; interests: string[]; painPoints: string[] } | null;
  ads: Ad[];
  /** Current artificial stage — advances on timer, gated by mutation state. */
  stage: CreationStage;
  /** True if the mutation has resolved. Drives the transition from `publish` → `done`. */
  mutationReady: boolean;
}

const STAGE_ORDER: CreationStage[] = [
  'scrape',
  'audience',
  'strategy',
  'images',
  'publish',
  'done',
];

const STRATEGY_LABEL: Record<AdStrategy, string> = {
  AGGRESSIVE: 'Saldırgan',
  STORY: 'Hikaye',
  TECHNICAL: 'Teknik',
};

const STRATEGY_TONE: Record<AdStrategy, 'danger' | 'accent' | 'info'> = {
  AGGRESSIVE: 'danger',
  STORY: 'accent',
  TECHNICAL: 'info',
};

const STRATEGY_REASONING: Record<AdStrategy, string> = {
  AGGRESSIVE: 'Yüksek talep + sınırlı süre tonu — net call-to-action ile dönüşümü baskıla.',
  STORY: 'Marka hikayesi + duygusal bağ — görsele dayalı yumuşak yaklaşım.',
  TECHNICAL: 'Özellik vurgusu + sayısal kanıt — bilinçli alıcıya hitap.',
};

const STRATEGY_PLATFORMS: Record<AdStrategy, { label: string; rationale: string }> = {
  AGGRESSIVE: {
    label: 'Meta Reels + Google Display',
    rationale: 'hızlı tüketim, algoritmik feed',
  },
  STORY: {
    label: 'Instagram Feed + Facebook',
    rationale: 'görsel okuma, duygusal etkileşim',
  },
  TECHNICAL: {
    label: 'Google Arama + Display',
    rationale: 'arama niyeti, bilinçli alıcı',
  },
};

function stageIndex(s: CreationStage): number {
  return STAGE_ORDER.indexOf(s);
}

/** Returns the human label for the stage's "AI is doing" headline. */
function stageHeadline(s: CreationStage): string {
  switch (s) {
    case 'scrape':
      return 'Ürün sayfasını okuyorum';
    case 'audience':
      return 'Hedef kitleyi haritalıyorum';
    case 'strategy':
      return '3 reklam stratejisi yazıyorum';
    case 'images':
      return 'Workers AI Flux ile görselleri üretiyorum';
    case 'publish':
      return 'Google Ads + Meta sandbox’a yayın veriyorum';
    case 'done':
      return 'Kampanya yayında';
  }
}

export function CampaignCreationProgress({
  productUrl,
  dailyBudgetTry,
  audience,
  ads,
  stage,
  mutationReady,
}: CampaignCreationProgressProps) {
  const sorted = useMemo(
    () =>
      [...ads].sort((a, b) => {
        const order: AdStrategy[] = ['AGGRESSIVE', 'STORY', 'TECHNICAL'];
        return order.indexOf(a.strategyType) - order.indexOf(b.strategyType);
      }),
    [ads],
  );

  const currentIdx = stageIndex(stage);

  return (
    <div className="flex flex-col gap-5">
      {/* ---- timeline (5 steps, last "done" is the result not a step) ---- */}
      <ol className="flex flex-col gap-3">
        {STAGE_ORDER.filter((s) => s !== 'done').map((s, i) => {
          const idx = stageIndex(s);
          const status: 'pending' | 'active' | 'complete' =
            idx < currentIdx || (mutationReady && s === 'publish' && currentIdx >= idx)
              ? 'complete'
              : idx === currentIdx
                ? 'active'
                : 'pending';
          return (
            <li key={s} className="flex items-start gap-3">
              <StageDot status={status} />
              <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                <span
                  className={cn(
                    'text-body-sm font-medium leading-tight',
                    status === 'pending' ? 'text-ink-subtle' : 'text-ink',
                  )}
                >
                  {stageHeadline(s)}
                </span>
                {status === 'active' ? (
                  <StageBody stage={s} productUrl={productUrl} audience={audience} ads={sorted} />
                ) : null}
                {status === 'complete' ? (
                  <StageSummary stage={s} audience={audience} ads={sorted} />
                ) : null}
              </div>
              {i < STAGE_ORDER.length - 2 ? null : null}
            </li>
          );
        })}
      </ol>

      {/* ---- done state — full reveal of result ---- */}
      {stage === 'done' ? (
        <DoneReveal
          productUrl={productUrl}
          dailyBudgetTry={dailyBudgetTry}
          audience={audience}
          ads={sorted}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage dot — pending (empty), active (pulse), complete (filled check)
// ---------------------------------------------------------------------------
function StageDot({ status }: { status: 'pending' | 'active' | 'complete' }) {
  if (status === 'complete') {
    return (
      <span
        aria-hidden
        className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-success text-white shrink-0"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <title>complete</title>
          <path
            d="M2.5 6.5L4.8 8.8L9.5 4.1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span
        aria-hidden
        className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent text-accent-foreground animate-pulse-coral shrink-0"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" className="animate-spin-slow">
          <title>active</title>
          <circle
            cx="5"
            cy="5"
            r="3.5"
            stroke="currentColor"
            strokeWidth="1.4"
            fill="none"
            strokeDasharray="14"
            strokeDashoffset="6"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="mt-0.5 inline-flex w-5 h-5 rounded-full border border-border bg-surface-sunken shrink-0"
    />
  );
}

// ---------------------------------------------------------------------------
// Active-stage body — shows the live work in progress, with typewriter on the
// reasoning line where available. Real data slots in as soon as the mutation
// resolves and `audience` / `ads` populate.
// ---------------------------------------------------------------------------
function StageBody({
  stage,
  productUrl,
  audience,
  ads,
}: {
  stage: CreationStage;
  productUrl: string;
  audience: { demographic: string; interests: string[]; painPoints: string[] } | null;
  ads: Ad[];
}) {
  if (stage === 'scrape') {
    return (
      <div className="rounded-md border border-border bg-surface-sunken/60 px-3 py-2 text-body-sm text-ink-muted">
        <span className="font-mono text-[12px] text-ink-subtle break-all">{productUrl}</span>
      </div>
    );
  }

  if (stage === 'audience') {
    if (audience) return <AudienceReveal audience={audience} />;
    return (
      <Typewriter
        text="Demografik kesit + ilgi alanları + pain-point haritası çıkarılıyor…"
        className="text-body-sm text-ink-muted"
      />
    );
  }

  if (stage === 'strategy') {
    if (ads.length > 0) {
      return <StrategyReveal ads={ads} />;
    }
    return (
      <Typewriter
        text="AGGRESSIVE / STORY / TECHNICAL — üç farklı ton aynı ürüne…"
        className="text-body-sm text-ink-muted"
      />
    );
  }

  if (stage === 'images') {
    return <ImagesReveal ads={ads} />;
  }

  if (stage === 'publish') {
    if (ads.length > 0) return <PlatformRouting ads={ads} />;
    return (
      <Typewriter
        text="Google Ads + Meta hesabına bağlanılıyor…"
        className="text-body-sm text-ink-muted"
      />
    );
  }

  return null;
}

function StageSummary({
  stage,
  audience,
  ads,
}: {
  stage: CreationStage;
  audience: { demographic: string; interests: string[]; painPoints: string[] } | null;
  ads: Ad[];
}) {
  if (stage === 'audience' && audience) {
    return (
      <p className="text-body-sm text-ink-muted">
        <span className="font-medium text-ink">{audience.demographic}</span> —{' '}
        {audience.interests.slice(0, 3).join(', ')}
      </p>
    );
  }
  if (stage === 'strategy' && ads.length > 0) {
    return (
      <p className="text-body-sm text-ink-muted">
        3 varyant hazır: {ads.map((a) => STRATEGY_LABEL[a.strategyType]).join(' · ')}
      </p>
    );
  }
  if (stage === 'images') {
    const filled = ads.filter((a) => a.imageR2Key).length;
    return (
      <p className="text-body-sm text-ink-muted">
        {filled}/{ads.length || 3} görsel üretildi
      </p>
    );
  }
  if (stage === 'publish' && ads.length > 0) {
    return (
      <p className="text-body-sm text-ink-muted">
        Tüm varyantlar Google Ads + Meta sandbox’a aktarıldı.
      </p>
    );
  }
  if (stage === 'scrape') {
    return <p className="text-body-sm text-ink-muted">Sayfa okundu, içerik çıkarıldı.</p>;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sub-reveals
// ---------------------------------------------------------------------------
function AudienceReveal({
  audience,
}: {
  audience: { demographic: string; interests: string[]; painPoints: string[] };
}) {
  return (
    <div className="flex flex-col gap-2 animate-fade-up">
      <p className="text-body-sm text-ink font-medium">{audience.demographic}</p>
      <div className="flex flex-wrap gap-1.5">
        {audience.interests.slice(0, 6).map((i) => (
          <Pill key={i} tone="accent">
            {i}
          </Pill>
        ))}
      </div>
      <ul className="flex flex-col gap-1 mt-1">
        {audience.painPoints.slice(0, 3).map((p) => (
          <li key={p} className="text-body-sm text-ink-muted flex items-start gap-2">
            <span aria-hidden className="text-accent mt-0.5">
              •
            </span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StrategyReveal({ ads }: { ads: Ad[] }) {
  return (
    <div className="grid gap-2 animate-fade-up">
      {ads.map((ad, i) => (
        <div
          key={ad.id}
          className="rounded-md border border-border bg-surface-sunken/40 px-3 py-2.5 flex flex-col gap-1.5 animate-fade-up"
          style={{ animationDelay: `${i * 120}ms` }}
        >
          <div className="flex items-center gap-2">
            <Pill tone={STRATEGY_TONE[ad.strategyType]} dot>
              {STRATEGY_LABEL[ad.strategyType]}
            </Pill>
            <span className="text-[12px] text-ink-subtle">
              {STRATEGY_REASONING[ad.strategyType]}
            </span>
          </div>
          <p className="text-body-sm text-ink leading-snug line-clamp-2">{ad.adText}</p>
        </div>
      ))}
    </div>
  );
}

function ImagesReveal({ ads }: { ads: Ad[] }) {
  const slots = ads.length > 0 ? ads : [null, null, null];
  return (
    <div className="grid grid-cols-3 gap-2 animate-fade-up">
      {slots.map((ad, i) => (
        <ImageSlot key={ad?.id ?? `ph-${i}`} ad={ad} index={i} />
      ))}
    </div>
  );
}

function ImageSlot({ ad, index }: { ad: Ad | null; index: number }) {
  if (!ad?.imageR2Key) {
    return (
      <div
        className="aspect-square rounded-md bg-surface-sunken border border-border overflow-hidden relative"
        style={{ animationDelay: `${index * 160}ms` }}
      >
        <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent_30%,rgba(255,255,255,0.55)_50%,transparent_70%)] bg-[length:200%_100%] animate-[shimmer_1400ms_linear_infinite]" />
      </div>
    );
  }
  return (
    <div className="aspect-square rounded-md bg-surface-sunken border border-border overflow-hidden animate-fade-up">
      <img
        src={`/api/creatives/${ad.imageR2Key}`}
        alt={STRATEGY_LABEL[ad.strategyType]}
        className="w-full h-full object-cover"
        loading="lazy"
      />
    </div>
  );
}

function PlatformRouting({ ads }: { ads: Ad[] }) {
  return (
    <div className="grid gap-1.5 animate-fade-up">
      {ads.map((ad) => {
        const p = STRATEGY_PLATFORMS[ad.strategyType];
        return (
          <div
            key={ad.id}
            className="flex items-center gap-2 text-body-sm text-ink-muted leading-tight"
          >
            <Pill tone={STRATEGY_TONE[ad.strategyType]}>{STRATEGY_LABEL[ad.strategyType]}</Pill>
            <span className="text-ink">→</span>
            <span className="font-medium text-ink">{p.label}</span>
            <span className="text-ink-subtle text-[12px]">({p.rationale})</span>
          </div>
        );
      })}
    </div>
  );
}

function DoneReveal({
  productUrl,
  dailyBudgetTry,
  audience,
  ads,
}: {
  productUrl: string;
  dailyBudgetTry: number;
  audience: { demographic: string; interests: string[]; painPoints: string[] } | null;
  ads: Ad[];
}) {
  return (
    <div className="rounded-md border border-[color-mix(in_srgb,var(--color-success)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-success)_8%,transparent)] px-4 py-3 flex flex-col gap-2 animate-fade-up">
      <div className="flex items-center gap-2">
        <Pill tone="success" dot>
          aktif
        </Pill>
        <span className="text-body-sm text-ink font-medium">
          {ads.length || 3} reklam · {dailyBudgetTry.toLocaleString('tr-TR')} ₺/gün
        </span>
      </div>
      {audience ? (
        <p className="text-body-sm text-ink-muted">
          Hedef: <span className="text-ink">{audience.demographic}</span>
        </p>
      ) : null}
      <p className="text-[12px] text-ink-subtle break-all font-mono">{productUrl}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Typewriter — types out `text` one char at a time, ~28ms/char. Used for
// stage commentary while real data hasn't arrived yet.
// ---------------------------------------------------------------------------
function Typewriter({ text, className }: { text: string; className?: string }) {
  const [shown, setShown] = useState('');
  useEffect(() => {
    setShown('');
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setShown(text.slice(0, i));
      if (i >= text.length) {
        window.clearInterval(id);
      }
    }, 28);
    return () => window.clearInterval(id);
  }, [text]);
  return (
    <p className={className}>
      {shown}
      <span aria-hidden className="inline-block w-1 h-3 bg-accent ml-0.5 animate-caret-blink" />
    </p>
  );
}
