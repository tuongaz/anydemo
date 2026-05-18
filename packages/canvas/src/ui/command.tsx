import type { DialogProps } from '@radix-ui/react-dialog';
import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import * as React from 'react';

import { cn } from '../lib/cn.ts';
import { Dialog, DialogContent } from './dialog.tsx';

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      'sf-flex sf-h-full sf-w-full sf-flex-col sf-overflow-hidden sf-rounded-md sf-bg-card sf-text-foreground',
      className,
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

const CommandDialog = ({ children, ...props }: DialogProps) => {
  return (
    <Dialog {...props}>
      <DialogContent className="sf-overflow-hidden sf-p-0 sf-shadow-lg">
        <Command className="[&_[cmdk-group-heading]]:sf-px-2 [&_[cmdk-group-heading]]:sf-font-medium [&_[cmdk-group-heading]]:sf-text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:sf-pt-0 [&_[cmdk-group]]:sf-px-2 [&_[cmdk-input-wrapper]_svg]:sf-h-5 [&_[cmdk-input-wrapper]_svg]:sf-w-5 [&_[cmdk-input]]:sf-h-12 [&_[cmdk-item]]:sf-px-2 [&_[cmdk-item]]:sf-py-3 [&_[cmdk-item]_svg]:sf-h-5 [&_[cmdk-item]_svg]:sf-w-5">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
};

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div className="sf-flex sf-items-center sf-border-b sf-px-3" cmdk-input-wrapper="">
    <Search className="sf-mr-2 sf-h-4 sf-w-4 sf-shrink-0 sf-opacity-50" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        'sf-flex sf-h-11 sf-w-full sf-rounded-md sf-bg-transparent sf-py-3 sf-text-sm sf-outline-none placeholder:sf-text-muted-foreground disabled:sf-cursor-not-allowed disabled:sf-opacity-50',
        className,
      )}
      {...props}
    />
  </div>
));
CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn('sf-max-h-[300px] sf-overflow-y-auto sf-overflow-x-hidden', className)}
    {...props}
  />
));
CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty ref={ref} className="sf-py-6 sf-text-center sf-text-sm" {...props} />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      'sf-overflow-hidden sf-p-1 sf-text-foreground [&_[cmdk-group-heading]]:sf-px-2 [&_[cmdk-group-heading]]:sf-py-1.5 [&_[cmdk-group-heading]]:sf-text-xs [&_[cmdk-group-heading]]:sf-font-medium [&_[cmdk-group-heading]]:sf-text-muted-foreground',
      className,
    )}
    {...props}
  />
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn('-sf-mx-1 sf-h-px sf-bg-border', className)}
    {...props}
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "sf-relative sf-flex sf-cursor-default sf-select-none sf-items-center sf-rounded-sm sf-px-2 sf-py-1.5 sf-text-sm sf-outline-none aria-selected:sf-bg-muted aria-selected:sf-text-foreground data-[disabled='true']:sf-pointer-events-none data-[disabled='true']:sf-opacity-50",
      className,
    )}
    {...props}
  />
));
CommandItem.displayName = CommandPrimitive.Item.displayName;

const CommandShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn('sf-ml-auto sf-text-xs sf-tracking-widest sf-text-muted-foreground', className)}
      {...props}
    />
  );
};
CommandShortcut.displayName = 'CommandShortcut';

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
};
