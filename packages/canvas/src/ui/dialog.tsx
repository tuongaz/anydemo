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
      'sf:fixed sf:inset-0 sf:z-50 sf:bg-black/80 sf:data-[state=open]:animate-in sf:data-[state=closed]:animate-out sf:data-[state=closed]:fade-out-0 sf:data-[state=open]:fade-in-0',
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
        'sf:fixed sf:left-[50%] sf:top-[50%] sf:z-50 sf:grid sf:w-full sf:max-w-lg sf:translate-x-[-50%] sf:translate-y-[-50%] sf:gap-4 sf:border sf:border-border sf:bg-card sf:p-6 sf:shadow-lg sf:duration-200 sf:data-[state=open]:animate-in sf:data-[state=closed]:animate-out sf:data-[state=closed]:fade-out-0 sf:data-[state=open]:fade-in-0 sf:data-[state=closed]:zoom-out-95 sf:data-[state=open]:zoom-in-95 sf:data-[state=closed]:slide-out-to-left-1/2 sf:data-[state=closed]:slide-out-to-top-[48%] sf:data-[state=open]:slide-in-from-left-1/2 sf:data-[state=open]:slide-in-from-top-[48%] sf:sm:rounded-lg',
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="sf:absolute sf:right-4 sf:top-4 sf:rounded-sm sf:opacity-70 sf:ring-offset-background sf:transition-opacity sf:hover:opacity-100 sf:focus:outline-hidden sf:focus:ring-2 sf:focus:ring-ring sf:focus:ring-offset-2 sf:disabled:pointer-events-none">
        <X className="sf:h-4 sf:w-4" />
        <span className="sf:sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('sf:flex sf:flex-col sf:space-y-1.5 sf:text-center sf:sm:text-left', className)}
    {...props}
  />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'sf:flex sf:flex-col-reverse sf:sm:flex-row sf:sm:justify-end sf:sm:space-x-2',
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
    className={cn('sf:text-lg sf:font-semibold sf:leading-none sf:tracking-tight', className)}
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
    className={cn('sf:text-sm sf:text-muted-foreground', className)}
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
