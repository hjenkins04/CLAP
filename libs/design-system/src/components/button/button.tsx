import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { type VariantProps } from 'class-variance-authority';
import { Slot } from '../../primitives';
import { cn } from '@ds/utils';
import { buttonVariants } from './button.variants';

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, ...props },
  ref
) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  );
});

export { Button, buttonVariants };
