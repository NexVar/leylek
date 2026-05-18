import { useEffect, useState } from 'react';

/**
 * Duration-based typewriter — animates `text` over `totalMs` regardless of
 * length, so short and long reasonings both feel responsive. Returns the
 * visible substring + a completion flag.
 *
 * When `enabled` is false (e.g. the user has already seen this entry
 * once), the hook returns the full text immediately. The replay handler
 * just bumps `runId` to re-trigger.
 */
export function useTypewriter(
  text: string,
  opts: { totalMs?: number; enabled?: boolean; runId?: number | string } = {},
): { visible: string; isComplete: boolean } {
  const { totalMs = 1500, enabled = true, runId = 0 } = opts;
  const [tick, setTick] = useState(0);

  // `runId` is intentionally only a re-trigger key — bumping it restarts the
  // animation without changing any captured state. Biome's exhaustive-deps
  // rule flags it as unused inside the effect body, which is the point.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runId is the replay trigger
  useEffect(() => {
    if (!enabled || text.length === 0) {
      setTick(text.length);
      return;
    }
    setTick(0);
    const startedAt = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const elapsed = now - startedAt;
      const progress = Math.min(1, elapsed / totalMs);
      const reveal = Math.max(1, Math.floor(text.length * progress));
      setTick(reveal);
      if (progress < 1) {
        raf = requestAnimationFrame(step);
      } else {
        setTick(text.length);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, totalMs, enabled, runId]);

  return { visible: text.slice(0, tick), isComplete: tick >= text.length };
}
