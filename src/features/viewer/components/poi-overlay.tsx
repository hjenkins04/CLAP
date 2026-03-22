import { Check, X, MousePointer, Trash2 } from 'lucide-react';
import { Button } from '@clap/design-system';
import { useHotkey } from '@tanstack/react-hotkeys';
import { usePoiStore } from '../plugins/poi';
import { useViewerModeStore } from '@/app/stores';
import type { ViewerEngine } from '../services/viewer-engine';
import { PoiPlugin } from '../plugins/poi';

interface PoiOverlayProps {
  engine: ViewerEngine | null;
}

export function PoiOverlay({ engine }: PoiOverlayProps) {
  const mode = useViewerModeStore((s) => s.mode);
  const phase = usePoiStore((s) => s.phase);
  const exitMode = useViewerModeStore((s) => s.exitMode);

  const plugin = engine?.getPlugin<PoiPlugin>('poi');
  const isPoiMode = mode === 'poi';
  const isConfirming = isPoiMode && phase === 'confirming';
  const isSelecting = isPoiMode && phase === 'selecting';

  // --- Hotkeys ---

  // Enter → confirm POI placement (only during confirming phase)
  useHotkey(
    'Enter',
    (e) => {
      e.preventDefault();
      plugin?.confirmAdjustment();
    },
    { enabled: isConfirming, conflictBehavior: 'allow' }
  );

  // Escape → cancel current POI phase
  // In confirming: reverts gizmo changes and exits
  // In selecting: exits POI mode entirely
  useHotkey(
    'Escape',
    (e) => {
      e.preventDefault();
      if (isConfirming) {
        plugin?.cancelAdjustment();
      } else {
        exitMode();
      }
    },
    { enabled: isPoiMode, conflictBehavior: 'allow' }
  );

  // Delete → remove existing POI (during confirming phase)
  useHotkey(
    'Delete',
    (e) => {
      e.preventDefault();
      plugin?.cancelAdjustment();
      usePoiStore.getState().clearPosition();
    },
    { enabled: isConfirming, conflictBehavior: 'allow' }
  );

  if (!isPoiMode) return null;

  return (
    <>
      {/* Instruction banner */}
      <div className="absolute left-1/2 top-12 z-20 -translate-x-1/2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card/95 px-3 py-1.5 shadow-md backdrop-blur-sm">
          <MousePointer className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {isSelecting && 'Click on the point cloud to place a target point'}
            {isConfirming &&
              'Drag the gizmo to adjust, then press Enter to confirm or Esc to cancel'}
          </span>
        </div>
      </div>

      {/* Confirm / Cancel / Delete buttons during confirming */}
      {isConfirming && (
        <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card/95 px-1 py-0.5 shadow-md backdrop-blur-sm">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs text-green-500 hover:text-green-400"
              onClick={() => plugin?.confirmAdjustment()}
            >
              <Check className="h-3.5 w-3.5" />
              Confirm
              <kbd className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                Enter
              </kbd>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs text-muted-foreground"
              onClick={() => plugin?.cancelAdjustment()}
            >
              <X className="h-3.5 w-3.5" />
              Cancel
              <kbd className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                Esc
              </kbd>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs text-red-400 hover:text-red-300"
              onClick={() => {
                plugin?.cancelAdjustment();
                usePoiStore.getState().clearPosition();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
              <kbd className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                Del
              </kbd>
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
