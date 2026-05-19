import { AlertTriangle, Check, Radar } from 'lucide-react';
import type { ReactElement } from 'react';
import { cn } from '../lib/cn.ts';
import type { VisualStatus } from './lib/visual-status.ts';

const STYLES: Record<Exclude<VisualStatus, 'idle'>, string> = {
  // 20px tall, ~22px wide compact pill. Active gets the conic-gradient ring
  // via .seeflow-ring-spin on a sibling overlay (added below). Success/error
  // get a one-shot scale-pop via .seeflow-pill-pop.
  active: 'sf:border-amber-400 sf:bg-amber-950/40 sf:text-amber-300',
  success: 'sf:border-emerald-400 sf:bg-emerald-950/40 sf:text-emerald-300 sf:seeflow-pill-pop',
  error: 'sf:border-rose-400 sf:bg-rose-950/40 sf:text-rose-300 sf:seeflow-pill-pop',
};

export interface StatusIconPillProps {
  visualStatus: VisualStatus;
  /** Optional tooltip text (typically the StatusReport summary). */
  summary?: string;
  'data-testid'?: string;
}

/**
 * Compact icon pill rendered on the right side of the StateNode header.
 * Mirrors the play button's position on PlayNode so the two node types
 * align visually. Idle → renders nothing.
 *
 * Active gets a conic-gradient amber ring (sibling overlay, rotates via
 * seeflow-ring-spin under prefers-reduced-motion: no-preference).
 * Success + error get a one-shot 240ms scale pop.
 */
export function StatusIconPill({
  visualStatus,
  summary,
  'data-testid': testId,
}: StatusIconPillProps): ReactElement | null {
  if (visualStatus === 'idle') return null;
  const Icon =
    visualStatus === 'active' ? Radar : visualStatus === 'success' ? Check : AlertTriangle;
  return (
    <span
      data-testid={testId}
      data-visual-status={visualStatus}
      title={summary}
      className={cn(
        'sf:relative sf:inline-flex sf:h-5 sf:items-center sf:justify-center sf:rounded-full sf:border-[1.5px] sf:px-1',
        STYLES[visualStatus as Exclude<VisualStatus, 'idle'>],
      )}
    >
      {visualStatus === 'active' ? (
        <span
          aria-hidden
          data-testid="status-icon-pill-ring"
          className="sf:absolute sf:inset-0 sf:rounded-full sf:seeflow-ring-spin"
          style={{
            background:
              'conic-gradient(from 0deg, var(--amber-hi) 0deg, transparent 200deg, var(--amber-hi) 360deg)',
            WebkitMask:
              'radial-gradient(circle, transparent calc(50% - 1.5px), #000 calc(50% - 1.5px))',
            mask: 'radial-gradient(circle, transparent calc(50% - 1.5px), #000 calc(50% - 1.5px))',
          }}
        />
      ) : null}
      <Icon className="sf:h-3 sf:w-3 sf:relative" aria-hidden />
    </span>
  );
}
