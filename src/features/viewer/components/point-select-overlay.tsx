import { X } from 'lucide-react';
import { Button } from '@clap/design-system';
import { useHotkey } from '@tanstack/react-hotkeys';
import { useViewerModeStore } from '@/app/stores';
import { usePointSelectStore, PointSelectPlugin } from '../plugins/point-select';
import type { ViewerEngine } from '../services/viewer-engine';

interface PointSelectOverlayProps {
  engine: ViewerEngine | null;
}

export function PointSelectOverlay({ engine }: PointSelectOverlayProps) {
  const mode = useViewerModeStore((s) => s.mode);
  const exitMode = useViewerModeStore((s) => s.exitMode);
  const selectedCount = usePointSelectStore((s) => s.selectedCount);
  const phase = usePointSelectStore((s) => s.phase);

  const plugin = engine?.getPlugin<PointSelectPlugin>('point-select');
  const isActive = mode === 'point-select';

  // Escape to exit or clear
  useHotkey(
    'Escape',
    (e) => {
      e.preventDefault();
      if (selectedCount > 0) {
        plugin?.clearSelection();
      } else {
        exitMode();
      }
    },
    { enabled: isActive },
  );

  if (!isActive) return null;

  return (
    <>
      {/* Instructions bar at top */}
      <div className="pointer-events-none absolute inset-x-0 top-12 z-10 flex justify-center">
        <div className="rounded-md bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
          {phase === 'selected'
            ? `${selectedCount.toLocaleString()} point${selectedCount !== 1 ? 's' : ''} selected — drag to reselect, Esc to clear`
            : 'Drag to select points'}
        </div>
      </div>

      {/* Bottom action bar */}
      {selectedCount > 0 && (
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-card/90 px-3 py-1.5 shadow-sm backdrop-blur-sm">
          <span className="text-xs text-muted-foreground">
            {selectedCount.toLocaleString()} point{selectedCount !== 1 ? 's' : ''} selected
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-6 gap-1 text-xs"
            onClick={() => plugin?.clearSelection()}
          >
            <X className="h-3 w-3" />
            Clear
          </Button>
        </div>
      )}
    </>
  );
}
