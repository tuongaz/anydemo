import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as React from 'react';

import { useCanvasPortalContainer } from '../components/canvas-portal-container.tsx';
import { cn } from '../lib/cn.ts';

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

// US-019: portal-mount the content to document.body so the tooltip's
// position:fixed coordinates anchor against the viewport, not a transformed
// ancestor. The side panel lives inside xyflow's `<Panel>` which is a sibling
// of the transformed `.react-flow__viewport` — but the canvas-zoom transform
// still propagates through React's render tree into the floating wrapper's
// containing block on some browsers / when the tooltip is animated with
// `transform`. Portaling to body sidesteps every containing-block edge case
// uniformly (Radix's recommended fix; matches the shadcn template).
const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => {
  const portalContainer = useCanvasPortalContainer();
  return (
    <TooltipPrimitive.Portal container={portalContainer}>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'sf:z-50 sf:overflow-hidden sf:rounded-md sf:bg-foreground sf:px-3 sf:py-1.5 sf:text-sm sf:text-background sf:shadow-md sf:animate-in sf:fade-in-0 sf:zoom-in-95 sf:data-[state=closed]:animate-out sf:data-[state=closed]:fade-out-0 sf:data-[state=closed]:zoom-out-95 sf:data-[side=bottom]:slide-in-from-top-2 sf:data-[side=left]:slide-in-from-right-2 sf:data-[side=right]:slide-in-from-left-2 sf:data-[side=top]:slide-in-from-bottom-2',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
