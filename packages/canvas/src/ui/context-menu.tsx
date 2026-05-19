import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import * as React from 'react';

import { useCanvasPortalContainer } from '../components/canvas-portal-container.tsx';
import { cn } from '../lib/cn.ts';

const ContextMenu = ContextMenuPrimitive.Root;
const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => {
  const portalContainer = useCanvasPortalContainer();
  return (
    <ContextMenuPrimitive.Portal container={portalContainer}>
      <ContextMenuPrimitive.Content
        ref={ref}
        className={cn(
          'sf:z-50 sf:min-w-40 sf:overflow-hidden sf:rounded-md sf:border sf:bg-popover sf:p-1 sf:text-popover-foreground sf:shadow-md sf:data-[state=open]:animate-in sf:data-[state=closed]:animate-out sf:data-[state=closed]:fade-out-0 sf:data-[state=open]:fade-in-0 sf:data-[state=closed]:zoom-out-95 sf:data-[state=open]:zoom-in-95',
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
});
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName;

const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={cn(
      'sf:relative sf:flex sf:cursor-default sf:select-none sf:items-center sf:rounded-sm sf:px-2 sf:py-1.5 sf:text-sm sf:outline-hidden sf:data-disabled:pointer-events-none sf:data-highlighted:bg-accent sf:data-highlighted:text-accent-foreground sf:data-disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;

const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={cn('sf:-mx-1 sf:my-1 sf:h-px sf:bg-border', className)}
    {...props}
  />
));
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName;

const ContextMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn(
      'sf:ml-auto sf:pl-4 sf:text-xs sf:tracking-widest sf:text-muted-foreground',
      className,
    )}
    {...props}
  />
);
ContextMenuShortcut.displayName = 'ContextMenuShortcut';

export {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
};
