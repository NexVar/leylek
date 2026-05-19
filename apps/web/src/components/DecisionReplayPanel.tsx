import { useEffect, useState } from 'react';
import type { AgentLog } from '../api/types';
import { cn } from '../lib/cn';
import { actionLabel, agentLabel, relativeTimeTr } from '../lib/format';
import { useTypewriter } from '../lib/typewriter';
import { Button } from './Button';
import { Drawer, DrawerHeader } from './Drawer';
import { Pill } from './Pill';

interface DecisionReplayPanelProps {
  open: boolean;
  log: AgentLog | null;
  onClose: () => void;
}

const SEEN_PREFIX = 'leylek:replay-seen:';

/**
 * Read-only side panel that "replays" an agent decision — surfaces the
 * full Turkish reasoning the agent recorded, animated with a duration-
 * based typewriter so the user feels the moment of the decision again.
 *
 * First-time views animate; subsequent visits render instantly. The
 * "Tekrar oynat" button re-triggers the animation deliberately.
 */
export function DecisionReplayPanel({ open, log, onClose }: DecisionReplayPanelProps) {
  const [runId, setRunId] = useState(0);
  const [firstView, setFirstView] = useState(true);

  // Persist "seen" so re-opens skip the animation unless explicitly replayed.
  useEffect(() => {
    if (!open || !log) return;
    const key = `${SEEN_PREFIX}${log.id}`;
    const previouslySeen = typeof window !== 'undefined' && window.localStorage.getItem(key);
    setFirstView(!previouslySeen);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(key, '1');
    }
  }, [open, log]);

  // Reset the runId when a different log is opened so each entry starts fresh.
  useEffect(() => {
    if (!log) return;
    setRunId((n) => n + 1);
  }, [log]);

  const enabled = (firstView || runId > 0) && open;
  const { visible, isComplete } = useTypewriter(log?.reason ?? '', {
    totalMs: 1500,
    enabled,
    runId,
  });

  if (!log) return null;

  const confidencePct = log.confidence !== null ? Math.round(log.confidence * 100) : null;
  const onReplay = () => {
    setFirstView(true);
    setRunId((n) => n + 1);
  };

  return (
    <Drawer open={open} onClose={onClose} width="md" ariaLabel="Karar replay">
      <DrawerHeader
        title={`${agentLabel(log.agentName)} ${actionLabel(log.actionTaken)}`}
        subtitle={
          <span className="flex items-center gap-2 flex-wrap text-body-sm text-ink-muted">
            <time
              dateTime={log.createdAt}
              className="font-mono text-[11px] tabular-nums"
              title={new Date(log.createdAt).toLocaleString('tr-TR')}
            >
              {relativeTimeTr(log.createdAt)}
            </time>
            {log.targetRef ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-[11px] text-ink-subtle">{log.targetRef}</span>
              </>
            ) : null}
            {confidencePct !== null ? (
              <>
                <span aria-hidden="true">·</span>
                <Pill tone="info">güven %{confidencePct}</Pill>
              </>
            ) : null}
          </span>
        }
        onClose={onClose}
      />

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="text-label text-ink-subtle uppercase tracking-wider mb-2">
          Gemini gerekçesi
        </div>
        <p className="text-body-md text-ink leading-[1.65] whitespace-pre-wrap">
          {visible}
          {!isComplete ? (
            <span
              aria-hidden="true"
              className={cn(
                'inline-block w-[2px] h-[1.05em] align-[-2px] ml-[1px]',
                'bg-accent animate-caret-blink',
              )}
            />
          ) : null}
        </p>

        {log.geminiRequestId ? (
          <div className="mt-6 pt-4 border-t border-border">
            <div className="text-label text-ink-subtle uppercase tracking-wider mb-1.5">
              Gemini request id
            </div>
            <code className="font-mono text-[12px] text-ink-muted break-all">
              {log.geminiRequestId}
            </code>
          </div>
        ) : null}
      </div>

      <footer className="border-t border-border px-6 py-3 flex items-center justify-between gap-3">
        <span className="text-body-sm text-ink-subtle">
          {isComplete ? 'Replay tamamlandı.' : 'Oynatılıyor…'}
        </span>
        <Button variant="secondary" size="md" onClick={onReplay} disabled={!isComplete}>
          Tekrar oynat
        </Button>
      </footer>
    </Drawer>
  );
}
