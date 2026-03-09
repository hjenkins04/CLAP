import { cva } from 'class-variance-authority';

export const labelVariants = cva(
  'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
  {
    variants: {
      error: {
        true: 'text-destructive',
        false: '',
      },
    },
    defaultVariants: {
      error: false,
    },
  }
);
