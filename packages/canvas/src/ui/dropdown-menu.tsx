import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as React from 'react';

import { useCanvasPortalContainer } from '../components/canvas-portal-container.tsx';
import { cn } from '../lib/cn.ts';

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => {
  const portalContainer = useCanvasPortalContainer();
  return (
    <DropdownMenuPrimitive.Portal container={portalContainer}>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'sf-z-50 sf-min-w-[10rem] sf-overflow-hidden sf-rounded-md sf-border sf-bg-popover sf-p-1 sf-text-popover-foreground sf-shadow-md data-[state=open]:sf-animate-in data-[state=closed]:sf-animate-out data-[state=closed]:sf-fade-out-0 data-[state=open]:sf-fade-in-0 data-[state=closed]:sf-zoom-out-95 data-[state=open]:sf-zoom-in-95 data-[side=bottom]:sf-slide-in-from-top-2 data-[side=left]:sf-slide-in-from-right-2 data-[side=right]:sf-slide-in-from-left-2 data-[side=top]:sf-slide-in-from-bottom-2',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'sf-relative sf-flex sf-cursor-default sf-select-none sf-items-center sf-gap-2 sf-rounded-sm sf-px-2 sf-py-1.5 sf-text-sm sf-outline-none data-[disabled]:sf-pointer-events-none data-[highlighted]:sf-bg-accent data-[highlighted]:sf-text-accent-foreground data-[disabled]:sf-opacity-50',
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn('-sf-mx-1 sf-my-1 sf-h-px sf-bg-border', className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
