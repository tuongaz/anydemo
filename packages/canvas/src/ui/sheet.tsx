import * as SheetPrimitive from '@radix-ui/react-dialog';
import { type VariantProps, cva } from 'class-variance-authority';
import { X } from 'lucide-react';
import * as React from 'react';

import { useCanvasPortalContainer } from '../components/canvas-portal-container.tsx';
import { cn } from '../lib/cn.ts';

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = ({
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof SheetPrimitive.Portal>) => {
  const portalContainer = useCanvasPortalContainer();
  return (
    <SheetPrimitive.Portal container={portalContainer} {...props}>
      {children}
    </SheetPrimitive.Portal>
  );
};

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      'sf-fixed sf-inset-0 sf-z-50 sf-bg-black/80 data-[state=open]:sf-animate-in data-[state=closed]:sf-animate-out data-[state=closed]:sf-fade-out-0 data-[state=open]:sf-fade-in-0',
      className,
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  'sf-fixed sf-z-50 sf-gap-4 sf-bg-card sf-border-border sf-p-6 sf-shadow-lg sf-transition sf-ease-in-out data-[state=open]:sf-animate-in data-[state=closed]:sf-animate-out data-[state=closed]:sf-duration-300 data-[state=open]:sf-duration-500',
  {
    variants: {
      side: {
        top: 'sf-inset-x-0 sf-top-0 sf-border-b data-[state=closed]:sf-slide-out-to-top data-[state=open]:sf-slide-in-from-top',
        bottom:
          'sf-inset-x-0 sf-bottom-0 sf-border-t data-[state=closed]:sf-slide-out-to-bottom data-[state=open]:sf-slide-in-from-bottom',
        left: 'sf-inset-y-0 sf-left-0 sf-h-full sf-w-3/4 sf-border-r data-[state=closed]:sf-slide-out-to-left data-[state=open]:sf-slide-in-from-left sm:sf-max-w-sm',
        right:
          'sf-inset-y-0 sf-right-0 sf-h-full sf-w-3/4 sf-border-l data-[state=closed]:sf-slide-out-to-right data-[state=open]:sf-slide-in-from-right sm:sf-max-w-sm',
      },
    },
    defaultVariants: {
      side: 'right',
    },
  },
);

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = 'right', className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), className)} {...props}>
      {children}
      <SheetPrimitive.Close className="sf-absolute sf-right-4 sf-top-4 sf-rounded-sm sf-opacity-70 sf-ring-offset-background sf-transition-opacity hover:sf-opacity-100 focus:sf-outline-none focus:sf-ring-2 focus:sf-ring-ring focus:sf-ring-offset-2 disabled:sf-pointer-events-none">
        <X className="sf-h-4 sf-w-4" />
        <span className="sr-only">Close</span>
      </SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('sf-flex sf-flex-col sf-space-y-2 sf-text-center sm:sf-text-left', className)}
    {...props}
  />
);
SheetHeader.displayName = 'SheetHeader';

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'sf-flex sf-flex-col-reverse sm:sf-flex-row sm:sf-justify-end sm:sf-space-x-2',
      className,
    )}
    {...props}
  />
);
SheetFooter.displayName = 'SheetFooter';

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn('sf-text-lg sf-font-semibold sf-text-foreground', className)}
    {...props}
  />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn('sf-text-sm sf-text-muted-foreground', className)}
    {...props}
  />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
