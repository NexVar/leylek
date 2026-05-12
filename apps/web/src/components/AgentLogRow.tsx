import type { AgentLog } from '../api/types';
import { cn } from '../lib/cn';
import { actionLabel, agentLabel, relativeTimeTr } from '../lib/format';

interface AgentLogRowProps {
  log: AgentLog;
  isFirst?: boolean;
  isLast?: boolean;
}

/**
 * Single log row in the agent timeline. Per DESIGN.md:
 *   left:   8px dot (coral default, navy for content agent, danger for PAUSED_AD)
 *   middle: bold "<agent> <verb>", then full Turkish reasoning
 *   right:  relative timestamp in mono, top-aligned
 *
 * The dot is connected by a vertical rail except on the first/last row.
 */
export function AgentLogRow({ log, isFirst = false, isLast = false }: AgentLogRowProps) {
  const dotColor =
    log.actionTaken === 'PAUSED_AD'
      ? 'bg-danger'
      : log.agentName === 'content'
        ? 'bg-primary'
        : log.agentName === 'publisher'
          ? 'bg-info'
          : 'bg-accent';

  return (
    <li className="flex gap-3 items-start">
      <div className="relative flex flex-col items-center shrink-0" aria-hidden="true">
        {!isFirst ? <span className="absolute top-0 h-2 w-px bg-border" /> : null}
        <span
          className={cn(
            'mt-2 w-2 h-2 rounded-full',
            dotColor,
            log.actionTaken === 'PAUSED_AD' && 'animate-pulse-coral',
          )}
        />
        {!isLast ? <span className="flex-1 w-px bg-border min-h-6" /> : null}
      </div>

      <div className="flex-1 min-w-0 pb-4">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-body-sm font-semibold text-ink">{agentLabel(log.agentName)}</span>
          <span className="text-body-sm text-ink-muted">{actionLabel(log.actionTaken)}</span>
          {log.targetRef ? (
            <span className="font-mono text-[11px] text-ink-subtle">· {log.targetRef}</span>
          ) : null}
        </div>
        <p className="text-body-sm text-ink-muted mt-1 leading-[1.55]">{log.reason}</p>
        {log.geminiRequestId ? (
          <div className="font-mono text-[11px] text-ink-subtle mt-1.5">{log.geminiRequestId}</div>
        ) : null}
      </div>

      <time
        dateTime={log.createdAt}
        className="font-mono text-[11px] text-ink-subtle shrink-0 pt-2 tabular-nums"
        title={new Date(log.createdAt).toLocaleString('tr-TR')}
      >
        {relativeTimeTr(log.createdAt)}
      </time>
    </li>
  );
}
