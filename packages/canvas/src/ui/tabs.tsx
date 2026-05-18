import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as React from 'react';

import { cn } from '../lib/cn.ts';

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'sf-inline-flex sf-h-9 sf-items-center sf-justify-center sf-rounded-md sf-bg-muted sf-p-1 sf-text-muted-foreground',
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'sf-inline-flex sf-items-center sf-justify-center sf-whitespace-nowrap sf-rounded-sm sf-px-3 sf-py-1 sf-text-xs sf-font-medium sf-ring-offset-background sf-transition-all focus-visible:sf-outline-none focus-visible:sf-ring-2 focus-visible:sf-ring-ring focus-visible:sf-ring-offset-2 disabled:sf-pointer-events-none disabled:sf-opacity-50 data-[state=active]:sf-bg-background data-[state=active]:sf-text-foreground data-[state=active]:sf-shadow-sm',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'sf-mt-2 sf-ring-offset-background focus-visible:sf-outline-none focus-visible:sf-ring-2 focus-visible:sf-ring-ring focus-visible:sf-ring-offset-2',
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsContent, TabsList, TabsTrigger };
