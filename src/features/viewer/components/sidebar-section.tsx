import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface SidebarSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function SidebarSection({
  title,
  defaultOpen = false,
  children,
}: SidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between py-1"
      >
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">
          {title}
        </h3>
        <ChevronDown
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
            open ? '' : '-rotate-90'
          }`}
        />
      </button>
      {open && <div className="mt-2">{children}</div>}
    </section>
  );
}
