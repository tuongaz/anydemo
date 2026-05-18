import * as SliderPrimitive from '@radix-ui/react-slider';
import * as React from 'react';

import { cn } from '../lib/cn.ts';

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      'sf-relative sf-flex sf-w-full sf-touch-none sf-select-none sf-items-center',
      className,
    )}
    {...props}
  >
    <SliderPrimitive.Track className="sf-relative sf-h-1.5 sf-w-full sf-grow sf-overflow-hidden sf-rounded-full sf-bg-secondary">
      <SliderPrimitive.Range className="sf-absolute sf-h-full sf-bg-primary" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="sf-block sf-h-4 sf-w-4 sf-rounded-full sf-border sf-border-primary/60 sf-bg-background sf-shadow-sm sf-transition-colors hover:sf-border-primary focus-visible:sf-outline-none focus-visible:sf-ring-2 focus-visible:sf-ring-ring disabled:sf-pointer-events-none disabled:sf-opacity-50" />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
