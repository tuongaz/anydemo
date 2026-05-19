import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/cn.ts';

const buttonVariants = cva(
  'sf:inline-flex sf:items-center sf:justify-center sf:whitespace-nowrap sf:rounded-md sf:text-sm sf:font-medium sf:ring-offset-background sf:transition-colors sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring sf:focus-visible:ring-offset-2 sf:disabled:pointer-events-none sf:disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'sf:bg-primary sf:text-primary-foreground sf:font-semibold sf:hover:bg-emerald-400',
        destructive: 'sf:bg-destructive sf:text-destructive-foreground sf:hover:bg-destructive/90',
        outline:
          'sf:border sf:border-input sf:bg-background sf:hover:bg-secondary sf:hover:text-foreground',
        secondary: 'sf:bg-secondary sf:text-secondary-foreground sf:hover:bg-secondary/80',
        ghost: 'sf:text-muted-foreground sf:hover:bg-muted sf:hover:text-foreground',
        link: 'sf:text-primary sf:underline-offset-4 sf:hover:underline',
      },
      size: {
        default: 'sf:h-9 sf:px-4 sf:py-2',
        sm: 'sf:h-8 sf:rounded-md sf:px-3',
        lg: 'sf:h-11 sf:rounded-md sf:px-8',
        icon: 'sf:h-9 sf:w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
