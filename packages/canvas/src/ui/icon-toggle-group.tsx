import { type ComponentType, Fragment } from 'react';

import { cn } from '../lib/cn.ts';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip.tsx';

export type IconToggleOption<V extends string> = {
  value: V;
  icon: ComponentType<{ className?: string }>;
  label: string;
  testId?: string;
};

export interface IconToggleGroupProps<V extends string> {
  value: V;
  onChange: (value: V) => void;
  options: IconToggleOption<V>[];
  ariaLabel?: string;
  className?: string;
}

export function IconToggleGroup<V extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: IconToggleGroupProps<V>) {
  return (
    <TooltipProvider delayDuration={300}>
      <div
        aria-label={ariaLabel}
        className={cn(
          'inline-flex h-9 items-stretch overflow-hidden rounded-md border border-input bg-background p-0.5',
          className,
        )}
      >
        {options.map((opt, idx) => {
          const isActive = value === opt.value;
          const Icon = opt.icon;
          return (
            <Fragment key={opt.value}>
              {idx > 0 ? (
                <div aria-hidden className="mx-0.5 w-px self-stretch bg-border/70" />
              ) : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-pressed={isActive}
                    aria-label={opt.label}
                    data-active={isActive}
                    data-testid={opt.testId}
                    onClick={() => onChange(opt.value)}
                    className={cn(
                      'flex flex-1 items-center justify-center rounded px-2 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                      isActive
                        ? 'bg-secondary text-secondary-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="px-2 py-1 text-xs">
                  {opt.label}
                </TooltipContent>
              </Tooltip>
            </Fragment>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
