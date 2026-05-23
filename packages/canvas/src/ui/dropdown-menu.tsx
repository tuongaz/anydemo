import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import * as React from 'react';

import { useCanvasPortalContainer } from '../components/canvas-portal-container.tsx';
import { cn } from '../lib/cn.ts';

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

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
          'sf:z-50 sf:min-w-40 sf:overflow-hidden sf:rounded-md sf:border sf:bg-popover sf:p-1 sf:text-popover-foreground sf:shadow-md sf:data-[state=open]:animate-in sf:data-[state=closed]:animate-out sf:data-[state=closed]:fade-out-0 sf:data-[state=open]:fade-in-0 sf:data-[state=closed]:zoom-out-95 sf:data-[state=open]:zoom-in-95 sf:data-[side=bottom]:slide-in-from-top-2 sf:data-[side=left]:slide-in-from-right-2 sf:data-[side=right]:slide-in-from-left-2 sf:data-[side=top]:slide-in-from-bottom-2',
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
      'sf:relative sf:flex sf:cursor-default sf:select-none sf:items-center sf:gap-2 sf:rounded-sm sf:px-2 sf:py-1.5 sf:text-sm sf:outline-hidden sf:data-disabled:pointer-events-none sf:data-highlighted:bg-accent sf:data-highlighted:text-accent-foreground sf:data-disabled:opacity-50',
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
    className={cn('sf:-mx-1 sf:my-1 sf:h-px sf:bg-border', className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      'sf:px-2 sf:py-1.5 sf:text-xs sf:font-semibold sf:uppercase sf:tracking-wide sf:text-muted-foreground',
      className,
    )}
    {...props}
  />
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      'sf:relative sf:flex sf:cursor-default sf:select-none sf:items-center sf:rounded-sm sf:py-1.5 sf:pl-8 sf:pr-2 sf:text-sm sf:outline-hidden sf:data-disabled:pointer-events-none sf:data-highlighted:bg-accent sf:data-highlighted:text-accent-foreground sf:data-disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="sf:absolute sf:left-2 sf:flex sf:h-3.5 sf:w-3.5 sf:items-center sf:justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="sf:h-4 sf:w-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
