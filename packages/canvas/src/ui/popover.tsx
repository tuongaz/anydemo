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
          'sf:z-50 sf:w-72 sf:rounded-md sf:border sf:bg-popover sf:p-4 sf:text-popover-foreground sf:shadow-md sf:outline-hidden sf:data-[state=open]:animate-in sf:data-[state=closed]:animate-out sf:data-[state=closed]:fade-out-0 sf:data-[state=open]:fade-in-0 sf:data-[state=closed]:zoom-out-95 sf:data-[state=open]:zoom-in-95 sf:data-[side=bottom]:slide-in-from-top-2 sf:data-[side=left]:slide-in-from-right-2 sf:data-[side=right]:slide-in-from-left-2 sf:data-[side=top]:slide-in-from-bottom-2',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
