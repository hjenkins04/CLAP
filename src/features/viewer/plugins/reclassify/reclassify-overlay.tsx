import { X } from 'lucide-react';
import { Button } from '@clap/design-system';
import { useHotkey } from '@tanstack/react-hotkeys';
import { useViewerModeStore } from '@/app/stores';
import { useReclassifyStore } from './reclassify-store';
import { ReclassifyPlugin } from './reclassify-plugin';
import type { ViewerEngine } from '../../services/viewer-engine';

interface ReclassifyOverlayProps {
  engine: ViewerEngine | null;
}

export function ReclassifyOverlay({ engine }: ReclassifyOverlayProps) {
  const mode = useViewerModeStore((s) => s.mode);
  const exitMode = useViewerModeStore((s) => s.exitMode);
  const selectedCount = useReclassifyStore((s) => s.selectedCount);
  const phase = useReclassifyStore((s) => s.phase);

  const plugin = engine?.getPlugin<ReclassifyPlugin>('reclassify');
  const isActive = mode === 'reclassify';

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

  const handleClear = () => {
    plugin?.clearSelection();
  };

  return (
    <>
      {/* Instruction bar */}
      <div className="pointer-events-none absolute inset-x-0 top-12 z-10 flex justify-center">
        <div className="rounded-md bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
          {phase === 'selected'
            ? `${selectedCount.toLocaleString()} point${selectedCount !== 1 ? 's' : ''} selected — pick a class to reclassify`
            : 'Drag to select points · Alt+drag to deselect · Esc to exit'}
        </div>
      </div>

      {/* Bottom action bar when points are selected */}
      {selectedCount > 0 && (
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-card/90 px-3 py-1.5 shadow-sm backdrop-blur-sm">
          <div className="h-2 w-2 rounded-full bg-cyan-400" />
          <span className="text-xs text-muted-foreground">
            {selectedCount.toLocaleString()} point{selectedCount !== 1 ? 's' : ''} selected
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-6 gap-1 text-xs"
            onClick={handleClear}
          >
            <X className="h-3 w-3" />
            Clear
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs text-muted-foreground"
            onClick={exitMode}
          >
            Exit
          </Button>
        </div>
      )}
    </>
  );
}
