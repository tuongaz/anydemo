import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';

import { useCanvasPortalContainer } from '../components/canvas-portal-container.tsx';
import { cn } from '../lib/cn.ts';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = ({
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Portal>) => {
  const portalContainer = useCanvasPortalContainer();
  return (
    <DialogPrimitive.Portal container={portalContainer} {...props}>
      {children}
    </DialogPrimitive.Portal>
  );
};
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'sf-fixed sf-inset-0 sf-z-50 sf-bg-black/80 data-[state=open]:sf-animate-in data-[state=closed]:sf-animate-out data-[state=closed]:sf-fade-out-0 data-[state=open]:sf-fade-in-0',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'sf-fixed sf-left-[50%] sf-top-[50%] sf-z-50 sf-grid sf-w-full sf-max-w-lg sf-translate-x-[-50%] sf-translate-y-[-50%] sf-gap-4 sf-border sf-border-border sf-bg-card sf-p-6 sf-shadow-lg sf-duration-200 data-[state=open]:sf-animate-in data-[state=closed]:sf-animate-out data-[state=closed]:sf-fade-out-0 data-[state=open]:sf-fade-in-0 data-[state=closed]:sf-zoom-out-95 data-[state=open]:sf-zoom-in-95 data-[state=closed]:sf-slide-out-to-left-1/2 data-[state=closed]:sf-slide-out-to-top-[48%] data-[state=open]:sf-slide-in-from-left-1/2 data-[state=open]:sf-slide-in-from-top-[48%] sm:sf-rounded-lg',
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="sf-absolute sf-right-4 sf-top-4 sf-rounded-sm sf-opacity-70 sf-ring-offset-background sf-transition-opacity hover:sf-opacity-100 focus:sf-outline-none focus:sf-ring-2 focus:sf-ring-ring focus:sf-ring-offset-2 disabled:sf-pointer-events-none">
        <X className="sf-h-4 sf-w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('sf-flex sf-flex-col sf-space-y-1.5 sf-text-center sm:sf-text-left', className)}
    {...props}
  />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'sf-flex sf-flex-col-reverse sm:sf-flex-row sm:sf-justify-end sm:sf-space-x-2',
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('sf-text-lg sf-font-semibold sf-leading-none sf-tracking-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('sf-text-sm sf-text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
