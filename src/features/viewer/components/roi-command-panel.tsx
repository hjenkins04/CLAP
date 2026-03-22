import { Box, Circle, Square, Pentagon, Move, RotateCw, MousePointer } from 'lucide-react';
import { useViewerModeStore } from '@/app/stores';
import {
  useRoiStore,
  RoiSelectionPlugin,
  type RoiDrawTool,
} from '../plugins/roi-selection';
import { CommandPopup } from './command-popup';
import { Button, Label } from '@clap/design-system';
import type { ViewerEngine } from '../services/viewer-engine';

interface RoiCommandPanelProps {
  engine: ViewerEngine | null;
}

const TOOLS: { id: RoiDrawTool; label: string; icon: typeof Box; key: string }[] = [
  { id: 'rect-2d', label: 'Rectangle', icon: Square, key: '1' },
  { id: 'box', label: '3D Box', icon: Box, key: '2' },
  { id: 'cylinder', label: 'Cylinder', icon: Circle, key: '3' },
  { id: 'polygon-2d', label: 'Polygon', icon: Pentagon, key: '4' },
];

export function RoiCommandPanel({ engine }: RoiCommandPanelProps) {
  const mode = useViewerModeStore((s) => s.mode);
  const phase = useRoiStore((s) => s.phase);
  const activeTool = useRoiStore((s) => s.activeTool);
  const shapeCount = useRoiStore((s) => s.shapes.length);
  const hasPending = useRoiStore((s) => s.pendingShape !== null);
  const editSubMode = useRoiStore((s) => s.editSubMode);
  const selectedCount = useRoiStore((s) => s.selectedPoints.length);
  const expanded = useViewerModeStore((s) => s.isCommandPanelExpanded());
  const setExpanded = useViewerModeStore((s) => s.setCommandPanelExpanded);

  const plugin = engine?.getPlugin<RoiSelectionPlugin>('roi-selection');
  const isRoi = mode === 'roi-selection';
  const isApplied = phase === 'applied';
  const isActive =
    isRoi && (phase === 'choosing-tool' || phase === 'drawing' || phase === 'editing');

  if (!isActive && !isApplied) return null;

  return (
    <CommandPopup
      title={isApplied ? 'ROI Selection (Active)' : 'ROI Selection'}
      expanded={expanded}
      onToggleExpand={() => setExpanded(!expanded)}
      onClose={() => {
        if (isApplied) {
          plugin?.clearRoi();
        } else {
          plugin?.cancelSelection();
        }
      }}
    >
      <div className="space-y-3">
        {/* Tool selector */}
        {!isApplied && (
          <div className="space-y-1.5">
            <Label className="text-xs">Shape Tool</Label>
            <div className="grid grid-cols-2 gap-1">
              {TOOLS.map(({ id, label, icon: Icon, key }) => (
                <Button
                  key={id}
                  variant={activeTool === id && phase === 'drawing' ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 justify-start gap-1.5 text-xs"
                  disabled={phase === 'editing'}
                  onClick={() => plugin?.startDrawingTool(id)}
                >
                  <Icon className="h-3 w-3" />
                  {label}
                  <kbd className="ml-auto rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
                    {key}
                  </kbd>
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Edit sub-mode + actions */}
        {phase === 'editing' && hasPending && (
          <div className="space-y-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Edit Mode</Label>
              <div className="grid grid-cols-3 gap-1">
                <Button
                  variant={editSubMode === 'translate' ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => useRoiStore.getState().setEditSubMode('translate')}
                >
                  <Move className="h-3 w-3" />
                  Move
                </Button>
                <Button
                  variant={editSubMode === 'rotate' ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => useRoiStore.getState().setEditSubMode('rotate')}
                >
                  <RotateCw className="h-3 w-3" />
                  Rotate
                </Button>
                <Button
                  variant={editSubMode === 'points' ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => useRoiStore.getState().setEditSubMode('points')}
                >
                  <MousePointer className="h-3 w-3" />
                  Points
                </Button>
              </div>
            </div>
            {editSubMode === 'points' && selectedCount > 0 && (
              <div className="text-xs text-muted-foreground">
                {selectedCount} point{selectedCount !== 1 ? 's' : ''} selected
              </div>
            )}
            <div className="flex gap-1">
              <Button
                variant="default"
                size="sm"
                className="h-7 flex-1 text-xs"
                onClick={() => plugin?.confirmShape()}
              >
                Confirm Shape
                <kbd className="ml-1 rounded bg-primary-foreground/20 px-1 text-[9px]">
                  Enter
                </kbd>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 flex-1 text-xs"
                onClick={() => plugin?.discardShape()}
              >
                Discard
                <kbd className="ml-1 rounded bg-muted px-1 text-[9px] text-muted-foreground">
                  Esc
                </kbd>
              </Button>
            </div>
          </div>
        )}

        {/* Shape list */}
        <div className="text-xs text-muted-foreground">
          {shapeCount} region{shapeCount !== 1 ? 's' : ''} defined
          {shapeCount > 0 && !isApplied && (
            <button
              className="ml-2 text-red-400 hover:text-red-300"
              onClick={() => useRoiStore.getState().removeLastShape()}
            >
              Undo last
            </button>
          )}
        </div>

        {/* Apply / Clear */}
        {!isApplied && shapeCount > 0 && phase === 'choosing-tool' && (
          <Button
            variant="default"
            size="sm"
            className="h-7 w-full text-xs"
            onClick={() => plugin?.applySelection()}
          >
            Apply ROI
            <kbd className="ml-1 rounded bg-primary-foreground/20 px-1 text-[9px]">
              Enter
            </kbd>
          </Button>
        )}

        {isApplied && (
          <button
            className="w-full rounded bg-muted px-2 py-1 text-xs text-foreground hover:bg-muted/80"
            onClick={() => plugin?.clearRoi()}
          >
            Clear ROI Filter
          </button>
        )}
      </div>
    </CommandPopup>
  );
}
