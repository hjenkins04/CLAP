import { forwardRef, type LabelHTMLAttributes } from 'react';
import { type VariantProps } from 'class-variance-authority';
import { cn } from '@ds/utils';
import { labelVariants } from './label.variants';

export interface LabelProps
  extends LabelHTMLAttributes<HTMLLabelElement>,
    VariantProps<typeof labelVariants> {}

const Label = forwardRef<HTMLLabelElement, LabelProps>(function Label(
  { className, error, ...props },
  ref
) {
  return (
    <label
      ref={ref}
      className={cn(labelVariants({ error }), className)}
      {...props}
    />
  );
});

export { Label, labelVariants };
