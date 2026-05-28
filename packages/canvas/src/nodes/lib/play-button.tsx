import { AlertCircle, Check, Play } from 'lucide-react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { cn } from '../../lib/cn.ts';
import { Button } from '../../ui/button.tsx';
import type { VisualStatus } from './visual-status.ts';

export interface PlayButtonProps {
  visualStatus: VisualStatus;
  disabled: boolean;
  buttonLabel: string;
  isError: boolean;
  onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void;
}

export function PlayButton({
  visualStatus,
  disabled,
  buttonLabel,
  isError,
  onClick,
}: PlayButtonProps) {
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled={disabled}
      data-testid="play-button"
      data-status={visualStatus === 'idle' ? 'idle' : visualStatus}
      data-visual-status={visualStatus}
      aria-label={buttonLabel}
      title={buttonLabel}
      onClick={onClick}
      className={cn(
        'sf:group sf:relative sf:h-8 sf:w-8 sf:rounded-full sf:p-0',
        'sf:hover:bg-primary sf:hover:text-primary-foreground',
        'sf:focus-visible:bg-primary sf:focus-visible:text-primary-foreground',
        visualStatus === 'success' && 'sf:seeflow-play-pop',
        visualStatus === 'error' && 'sf:inline-edit-shake',
        isError && 'sf:border-2 sf:border-rose-500',
      )}
    >
      {visualStatus === 'active' ? (
        <span
          aria-hidden
          data-testid="play-button-ring"
          className={cn('sf:absolute sf:inset-0 sf:rounded-full sf:seeflow-ring-spin')}
          style={{
            background:
              'conic-gradient(from 0deg, var(--emerald-glow) 0deg, transparent 200deg, var(--emerald-glow) 360deg)',
            WebkitMask:
              'radial-gradient(circle, transparent calc(50% - 2px), #000 calc(50% - 2px))',
            mask: 'radial-gradient(circle, transparent calc(50% - 2px), #000 calc(50% - 2px))',
          }}
        />
      ) : null}
      {visualStatus === 'success' ? (
        <>
          <Check
            className="sf:h-4 sf:w-4 sf:relative sf:text-emerald-300 sf:group-hover:hidden"
            aria-hidden
          />
          <Play className="sf:h-4 sf:w-4 sf:relative sf:hidden sf:group-hover:block" aria-hidden />
        </>
      ) : visualStatus === 'error' ? (
        <>
          <AlertCircle
            className="sf:h-4 sf:w-4 sf:relative sf:text-rose-300 sf:group-hover:hidden"
            aria-hidden
          />
          <Play className="sf:h-4 sf:w-4 sf:relative sf:hidden sf:group-hover:block" aria-hidden />
        </>
      ) : (
        <Play
          className={cn('sf:h-4 sf:w-4 sf:relative', visualStatus === 'active' && 'sf:opacity-80')}
          aria-hidden
        />
      )}
    </Button>
  );
}
