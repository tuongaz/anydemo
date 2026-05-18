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
          'sf-inline-flex sf-h-9 sf-items-stretch sf-overflow-hidden sf-rounded-md sf-border sf-border-input sf-bg-background sf-p-0.5',
          className,
        )}
      >
        {options.map((opt, idx) => {
          const isActive = value === opt.value;
          const Icon = opt.icon;
          return (
            <Fragment key={opt.value}>
              {idx > 0 ? (
                <div aria-hidden className="sf-mx-0.5 sf-w-px sf-self-stretch sf-bg-border/70" />
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
                      'sf-flex sf-flex-1 sf-items-center sf-justify-center sf-rounded sf-px-2 sf-transition-colors focus-visible:sf-outline-none focus-visible:sf-ring-1 focus-visible:sf-ring-ring',
                      isActive
                        ? 'sf-bg-secondary sf-text-secondary-foreground sf-shadow-sm'
                        : 'sf-text-muted-foreground hover:sf-bg-accent hover:sf-text-accent-foreground',
                    )}
                  >
                    <Icon className="sf-h-4 sf-w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="sf-px-2 sf-py-1 sf-text-xs">
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
