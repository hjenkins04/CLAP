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
          <input
            type="number"
            min={1}
            step={1}
            className="h-6 w-full rounded border border-border bg-background px-2 text-xs"
            value={cellSize}
            disabled={isApplied}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 1) useVirtualTilesStore.getState().setCellSize(v);
            }}
          />
          <div className="text-[10px] text-muted-foreground">
            Grid: {cols} x {rows} cells
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
