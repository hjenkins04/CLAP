import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { Button } from '@clap/design-system';

interface CommandPopupProps {
  title: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
  children: React.ReactNode;
  /** Override the outer positioning classes. Defaults to "absolute bottom-3 right-3". */
  className?: string;
}

export function CommandPopup({
  title,
  expanded,
  onToggleExpand,
  onClose,
  children,
  className,
}: CommandPopupProps) {
  return (
    <div className={className ?? 'absolute bottom-3 right-3 z-10 w-64'}>
      <div className="rounded-lg border border-border bg-card/95 shadow-lg backdrop-blur-sm">
        {/* Header — always visible */}
        <div className="flex items-center justify-between px-3 py-1.5">
          <button
            onClick={onToggleExpand}
            className="flex flex-1 items-center gap-1.5 text-xs font-medium text-foreground"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronUp className="h-3 w-3 text-muted-foreground" />
            )}
            {title}
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={onClose}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>

        {/* Content — only when expanded */}
        {expanded && (
          <div className="border-t border-border px-3 py-2">{children}</div>
        )}
      </div>
    </div>
  );
}
