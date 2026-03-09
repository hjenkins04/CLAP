import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { cn } from '@ds/utils';

function Toaster({ className, ...props }: ToasterProps) {
  return (
    <Sonner
      className={cn('toaster group', className)}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          title: 'group-[.toast]:text-foreground group-[.toast]:font-semibold',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  );
}

export { Toaster, type ToasterProps };
