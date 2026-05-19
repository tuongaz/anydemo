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
      'sf:fixed sf:inset-0 sf:z-50 sf:bg-black/80 sf:data-[state=open]:animate-in sf:data-[state=closed]:animate-out sf:data-[state=closed]:fade-out-0 sf:data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  'sf:fixed sf:z-50 sf:gap-4 sf:bg-card sf:border-border sf:p-6 sf:shadow-lg sf:transition sf:ease-in-out sf:data-[state=open]:animate-in sf:data-[state=closed]:animate-out sf:data-[state=closed]:duration-300 sf:data-[state=open]:duration-500',
  {
    variants: {
      side: {
        top: 'sf:inset-x-0 sf:top-0 sf:border-b sf:data-[state=closed]:slide-out-to-top sf:data-[state=open]:slide-in-from-top',
        bottom:
          'sf:inset-x-0 sf:bottom-0 sf:border-t sf:data-[state=closed]:slide-out-to-bottom sf:data-[state=open]:slide-in-from-bottom',
        left: 'sf:inset-y-0 sf:left-0 sf:h-full sf:w-3/4 sf:border-r sf:data-[state=closed]:slide-out-to-left sf:data-[state=open]:slide-in-from-left sf:sm:max-w-sm',
        right:
          'sf:inset-y-0 sf:right-0 sf:h-full sf:w-3/4 sf:border-l sf:data-[state=closed]:slide-out-to-right sf:data-[state=open]:slide-in-from-right sf:sm:max-w-sm',
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
      <SheetPrimitive.Close className="sf:absolute sf:right-4 sf:top-4 sf:rounded-sm sf:opacity-70 sf:ring-offset-background sf:transition-opacity sf:hover:opacity-100 sf:focus:outline-hidden sf:focus:ring-2 sf:focus:ring-ring sf:focus:ring-offset-2 sf:disabled:pointer-events-none">
        <X className="sf:h-4 sf:w-4" />
        <span className="sf:sr-only">Close</span>
      </SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('sf:flex sf:flex-col sf:space-y-2 sf:text-center sf:sm:text-left', className)}
    {...props}
  />
);
SheetHeader.displayName = 'SheetHeader';

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'sf:flex sf:flex-col-reverse sf:sm:flex-row sf:sm:justify-end sf:sm:space-x-2',
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
    className={cn('sf:text-lg sf:font-semibold sf:text-foreground', className)}
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
    className={cn('sf:text-sm sf:text-muted-foreground', className)}
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
