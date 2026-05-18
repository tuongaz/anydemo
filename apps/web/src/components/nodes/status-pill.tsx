import { cn } from '@seeflow/canvas';

export type NodeStatus = 'idle' | 'running' | 'done' | 'error';

const STYLES: Record<Exclude<NodeStatus, 'idle'>, string> = {
  running: 'bg-amber-950/50 text-amber-300 animate-pulse',
  done: 'bg-emerald-950/50 text-emerald-300',
  error: 'bg-rose-950/50 text-rose-300',
};

// Idle is intentionally invisible — the pill is meaningful state, not chrome.
// Once a node has run, the pill becomes visible (running/done/error).
export function StatusPill({
  status,
  'data-testid': dataTestId,
}: {
  status: NodeStatus;
  'data-testid'?: string;
}) {
  if (status === 'idle') return null;
  return (
    <span
      data-status={status}
      data-testid={dataTestId}
      className={cn(
        'inline-flex h-4 items-center rounded-full px-1.5 py-0 font-normal text-[9px] uppercase tracking-wide',
        STYLES[status],
      )}
    >
      {status}
    </span>
  );
}
