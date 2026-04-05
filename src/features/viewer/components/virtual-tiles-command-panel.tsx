import { useState, useEffect } from 'react';
import { useViewerModeStore } from '@/app/stores';
import { useVirtualTilesStore, VirtualTilesPlugin } from '../plugins/virtual-tiles';
import { CommandPopup } from './command-popup';
import { Label } from '@clap/design-system';
import type { ViewerEngine } from '../services/viewer-engine';

interface VirtualTilesCommandPanelProps {
  engine: ViewerEngine | null;
}

export function VirtualTilesCommandPanel({ engine }: VirtualTilesCommandPanelProps) {
  const mode = useViewerModeStore((s) => s.mode);
  const phase = useVirtualTilesStore((s) => s.phase);
  const cellSize = useVirtualTilesStore((s) => s.cellSize);
  const rows = useVirtualTilesStore((s) => s.rows);
  const cols = useVirtualTilesStore((s) => s.cols);
  const selectedCount = useVirtualTilesStore((s) => s.selectedCells.length);
  const expanded = useViewerModeStore((s) => s.isCommandPanelExpanded());
  const setExpanded = useViewerModeStore((s) => s.setCommandPanelExpanded);

  const plugin = engine?.getPlugin<VirtualTilesPlugin>('virtual-tiles');
  const isSelecting = mode === 'virtual-tiles' && phase === 'selecting';
  const isApplied = phase === 'applied';
  const totalCells = rows * cols;
  const minCellSize = plugin?.minCellSize ?? 1;

  // Local draft so the user can type freely without triggering grid rebuild
  const [draft, setDraft] = useState(String(cellSize));

  // Keep draft in sync when store value changes externally
  useEffect(() => {
    setDraft(String(cellSize));
  }, [cellSize]);

  const applyDraft = () => {
    const v = Number(draft);
    if (!isNaN(v) && v >= minCellSize) {
      useVirtualTilesStore.getState().setCellSize(v);
    } else {
      // Revert draft to last committed value
      setDraft(String(cellSize));
    }
  };

  if (!isSelecting && !isApplied) return null;

  return (
    <CommandPopup
      title={isApplied ? 'Virtual Tiles (Active)' : 'Virtual Tiles'}
      expanded={expanded}
      onToggleExpand={() => setExpanded(!expanded)}
      onClose={() => {
        if (isApplied) {
          plugin?.clearTiles();
        } else {
          plugin?.cancelSelection();
        }
      }}
    >
      <div className="space-y-3">
        {/* Cell size control */}
        <div className="space-y-1.5">
          <Label className="text-xs">Cell Size (m)</Label>
          <div className="flex gap-1">
            <input
              type="number"
              min={minCellSize}
              step={minCellSize}
              className="h-6 w-full rounded border border-border bg-background px-2 text-xs disabled:opacity-40"
              value={draft}
              disabled={isApplied}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyDraft();
                if (e.key === 'Escape') setDraft(String(cellSize));
              }}
              onBlur={applyDraft}
            />
            {!isApplied && (
              <button
                className="h-6 rounded bg-primary px-2 text-xs text-primary-foreground hover:bg-primary/80 disabled:opacity-40"
                disabled={isApplied}
                onClick={applyDraft}
              >
                Apply
              </button>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground">
            Grid: {cols} × {rows} — min cell {minCellSize}m
          </div>
        </div>

        {/* Selection info */}
        <div className="text-xs text-muted-foreground">
          Selected: {selectedCount} / {totalCells} cells
          {selectedCount > 30 && (
            <span className="ml-1 text-red-400">(max 30 can be applied)</span>
          )}
        </div>

        {/* Clear button when applied */}
        {isApplied && (
          <button
            className="w-full rounded bg-muted px-2 py-1 text-xs text-foreground hover:bg-muted/80"
            onClick={() => plugin?.clearTiles()}
          >
            Clear Tile Filter
          </button>
        )}
      </div>
    </CommandPopup>
  );
}
