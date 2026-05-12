import { useEffect, useMemo, useRef, useState } from 'react';
import type { OptimizeNowResponse } from '../api/types';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { Pill } from './Pill';

interface OptimizerToastProps {
  response: OptimizeNowResponse;
  onDismiss: () => void;
  /** Auto-dismiss after stream completes + this many ms (DESIGN.md says ~5s). */
  autoDismissAfterMs?: number;
}

/**
 * Coral decision popover. Per DESIGN.md "Toast / decision popover":
 *   - surface-raised, 16px radius, shadow-lg, 24px padding
 *   - reasoning streams in line-by-line at 30ms per word
 *   - 4px confidence bar at the bottom; coral at >0.8, warning 0.5–0.8, danger <0.5
 *
 * The API returns the full reasoning string in `reasoningStreamLine` and we
 * fake the stream client-side. We do this because the gateway endpoint is
 * a single JSON POST — the *real* Gemini streaming happens server-side
 * inside the Campaign DO, and the gateway returns the finished decision
 * once the DO has committed it. Faking the reveal here lets us preserve
 * the dramatic UX without needing SSE plumbing for the 60s demo path.
 */
export function OptimizerToast({
  response,
  onDismiss,
  autoDismissAfterMs = 5000,
}: OptimizerToastProps) {
  const { decision, reasoningStreamLine } = response;
  const fullReason = reasoningStreamLine || decision.reason;

  // Tokenize on whitespace; re-emit with spaces.
  const tokens = useMemo(() => {
    const split = fullReason.split(/(\s+)/);
    return split.filter((t) => t.length > 0);
  }, [fullReason]);

  const [revealedCount, setRevealedCount] = useState(0);
  const timerRef = useRef<number | null>(null);
  const dismissTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setRevealedCount(0);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setRevealedCount((c) => {
        if (c >= tokens.length) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          return c;
        }
        return c + 1;
      });
    }, 30);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [tokens]);

  const isStreaming = revealedCount < tokens.length;

  // Schedule auto-dismiss after the stream completes.
  useEffect(() => {
    if (isStreaming) return;
    dismissTimerRef.current = window.setTimeout(() => {
      onDismiss();
    }, autoDismissAfterMs);
    return () => {
      if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
    };
  }, [isStreaming, autoDismissAfterMs, onDismiss]);

  const confidence = Math.max(0, Math.min(1, decision.confidence ?? 0));
  const confidenceFill =
    confidence >= 0.8 ? 'bg-accent' : confidence >= 0.5 ? 'bg-warning' : 'bg-danger';
  const confidenceLabel = `%${Math.round(confidence * 100)} güven`;

  const actionTone =
    decision.action === 'PAUSE_AD'
      ? 'danger'
      : decision.action === 'RESUME_AD'
        ? 'success'
        : decision.action === 'REALLOCATE_BUDGET'
          ? 'accent'
          : 'neutral';

  const actionLabel =
    decision.action === 'PAUSE_AD'
      ? 'Reklam Durduruldu'
      : decision.action === 'RESUME_AD'
        ? 'Reklam Yeniden Başlatıldı'
        : decision.action === 'REALLOCATE_BUDGET'
          ? 'Bütçe Kaydırıldı'
          : 'Devam';

  const visible = tokens.slice(0, revealedCount).join('');
  const upcoming = tokens.slice(revealedCount).join('');

  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-label="Optimizasyon kararı"
      className={cn(
        'fixed bottom-6 right-6 z-50 w-[min(440px,calc(100vw-2rem))]',
        'animate-toast-in',
      )}
    >
      <div className="bg-surface-raised rounded-lg shadow-card-lg border border-border overflow-hidden">
        <div className="p-6 pb-5 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1 min-w-0">
              <span className="text-label text-ink-subtle uppercase tracking-[0.06em]">
                Optimizasyon Ajanı
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <Pill tone={actionTone} dot>
                  {actionLabel}
                </Pill>
                {decision.targetAdId ? (
                  <span className="font-mono text-[12px] text-ink-subtle">
                    hedef · ad #{decision.targetAdId}
                  </span>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Kapat"
              className="text-ink-subtle hover:text-ink-muted -mr-2 -mt-2 p-2 rounded-sm"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                role="img"
                aria-labelledby="optimizer-toast-close"
              >
                <title id="optimizer-toast-close">Kapat</title>
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <p className="text-body-md text-ink leading-[1.55] min-h-[3.5rem]" aria-live="polite">
            {visible}
            {isStreaming ? (
              <>
                <span className="inline-block w-1.5 h-4 align-[-2px] ml-0.5 bg-accent animate-pulse-coral" />
                <span className="text-ink-subtle/0">{upcoming}</span>
              </>
            ) : null}
          </p>

          {!isStreaming ? (
            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-body-sm text-ink-muted tabular-nums">{confidenceLabel}</span>
              <Button variant="secondary" size="md" onClick={onDismiss}>
                Anladım
              </Button>
            </div>
          ) : null}
        </div>

        <div
          className="h-1 bg-surface-sunken"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(confidence * 100)}
          aria-label={confidenceLabel}
        >
          <div
            className={cn('h-full transition-[width] duration-500 ease-out', confidenceFill)}
            style={{ width: `${confidence * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
