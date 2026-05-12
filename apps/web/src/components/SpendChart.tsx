import type { Ad } from '../api/types';
import { cn } from '../lib/cn';
import { kurusToTry, strategyLabel } from '../lib/format';

interface SpendChartProps {
  ads: Ad[];
  className?: string;
}

/**
 * Pure-SVG horizontal bar chart for per-ad spend. Built in-house so we
 * don't pull recharts just for one chart. Each bar:
 *   - background tinted by ad status (danger if paused, success if active)
 *   - label left, value right (tabular)
 *   - 200ms width transition on data change (NOT on mount — see DESIGN.md)
 */
export function SpendChart({ ads, className }: SpendChartProps) {
  const max = Math.max(1, ...ads.map((a) => a.spendKurus));
  const sorted = [...ads].sort((a, b) => b.spendKurus - a.spendKurus);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {sorted.map((ad) => {
        const pct = (ad.spendKurus / max) * 100;
        const isPaused = ad.status === 'paused';
        const fill = isPaused
          ? 'bg-danger'
          : ad.strategyType === 'STORY'
            ? 'bg-success'
            : ad.strategyType === 'TECHNICAL'
              ? 'bg-info'
              : 'bg-accent';

        return (
          <div key={ad.id} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-body-sm text-ink-muted">
                <span className="font-medium text-ink">{strategyLabel(ad.strategyType)}</span>
                <span className="font-mono text-[11px] text-ink-subtle ml-2">#{ad.id}</span>
              </span>
              <span
                className={cn(
                  'text-body-sm tabular-nums font-medium',
                  isPaused ? 'text-danger' : 'text-ink',
                )}
              >
                {kurusToTry(ad.spendKurus)}
              </span>
            </div>
            <div className="h-2 bg-surface-sunken rounded-sm overflow-hidden">
              <div
                className={cn('h-full rounded-sm transition-[width] duration-300 ease-out', fill)}
                style={{ width: `${Math.max(2, pct)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
