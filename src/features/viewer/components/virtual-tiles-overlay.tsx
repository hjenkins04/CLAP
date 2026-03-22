import { Check, X, LayoutGrid } from 'lucide-react';
import { Button } from '@clap/design-system';
import { useHotkey } from '@tanstack/react-hotkeys';
import { useViewerModeStore } from '@/app/stores';
import { useVirtualTilesStore } from '../plugins/virtual-tiles';
import { VirtualTilesPlugin } from '../plugins/virtual-tiles';
import type { ViewerEngine } from '../services/viewer-engine';

interface VirtualTilesOverlayProps {
  engine: ViewerEngine | null;
}

export function VirtualTilesOverlay({ engine }: VirtualTilesOverlayProps) {
  const mode = useViewerModeStore((s) => s.mode);
  const phase = useVirtualTilesStore((s) => s.phase);
  const selectedCount = useVirtualTilesStore((s) => s.selectedCells.length);
  const rows = useVirtualTilesStore((s) => s.rows);
  const cols = useVirtualTilesStore((s) => s.cols);

  const plugin = engine?.getPlugin<VirtualTilesPlugin>('virtual-tiles');
  const isActive = mode === 'virtual-tiles' && phase === 'selecting';
  const totalCells = rows * cols;

  // Enter → apply selection
  useHotkey(
    'Enter',
    (e) => {
      e.preventDefault();
      plugin?.applySelection();
    },
    { enabled: isActive && selectedCount > 0, conflictBehavior: 'allow' }
  );

  // Escape → cancel
  useHotkey(
    'Escape',
    (e) => {
      e.preventDefault();
      plugin?.cancelSelection();
    },
    { enabled: isActive, conflictBehavior: 'allow' }
  );

  // A → select all
  useHotkey(
    'a',
    (e) => {
      e.preventDefault();
      useVirtualTilesStore.getState().selectAll();
    },
    { enabled: isActive, conflictBehavior: 'allow' }
  );

  // D → deselect all
  useHotkey(
    'd',
    (e) => {
      e.preventDefault();
      useVirtualTilesStore.getState().deselectAll();
    },
    { enabled: isActive, conflictBehavior: 'allow' }
  );

  if (!isActive) return null;

  return (
    <>
      {/* Instruction banner */}
      <div className="absolute left-1/2 top-12 z-20 -translate-x-1/2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card/95 px-3 py-1.5 shadow-md backdrop-blur-sm">
          <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            Click cells to select regions ({selectedCount}/{totalCells} selected).
            Press Enter to apply, Esc to cancel.
          </span>
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card/95 px-1 py-0.5 shadow-md backdrop-blur-sm">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-green-500 hover:text-green-400"
            disabled={selectedCount === 0}
            onClick={() => plugin?.applySelection()}
          >
            <Check className="h-3.5 w-3.5" />
            Apply
            <kbd className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
              Enter
            </kbd>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground"
            onClick={() => plugin?.cancelSelection()}
          >
            <X className="h-3.5 w-3.5" />
            Cancel
            <kbd className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
              Esc
            </kbd>
          </Button>
          <span className="mx-1 text-[10px] text-muted-foreground">
            <kbd className="rounded bg-muted px-1 py-0.5">A</kbd> All
            <span className="mx-1">/</span>
            <kbd className="rounded bg-muted px-1 py-0.5">D</kbd> None
          </span>
        </div>
      </div>
    </>
  );
}
