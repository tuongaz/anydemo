import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as React from 'react';

import { useCanvasPortalContainer } from '../components/canvas-portal-container.tsx';
import { cn } from '../lib/cn.ts';

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, ...props }, ref) => {
  const portalContainer = useCanvasPortalContainer();
  return (
    <PopoverPrimitive.Portal container={portalContainer}>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'sf-z-50 sf-w-72 sf-rounded-md sf-border sf-bg-popover sf-p-4 sf-text-popover-foreground sf-shadow-md sf-outline-none data-[state=open]:sf-animate-in data-[state=closed]:sf-animate-out data-[state=closed]:sf-fade-out-0 data-[state=open]:sf-fade-in-0 data-[state=closed]:sf-zoom-out-95 data-[state=open]:sf-zoom-in-95 data-[side=bottom]:sf-slide-in-from-top-2 data-[side=left]:sf-slide-in-from-right-2 data-[side=right]:sf-slide-in-from-left-2 data-[side=top]:sf-slide-in-from-bottom-2',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
