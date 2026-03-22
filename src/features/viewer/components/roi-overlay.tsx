import { Check, X, BoxSelect, Move, RotateCw, MousePointer } from 'lucide-react';
import { Button } from '@clap/design-system';
import { useHotkey } from '@tanstack/react-hotkeys';
import { useViewerModeStore } from '@/app/stores';
import { useRoiStore, RoiSelectionPlugin } from '../plugins/roi-selection';
import type { RoiEditSubMode } from '../plugins/roi-selection/roi-store';
import { getControlPoints } from '../plugins/roi-selection/roi-edit-handles';
import type { ViewerEngine } from '../services/viewer-engine';

interface RoiOverlayProps {
  engine: ViewerEngine | null;
}

export function RoiOverlay({ engine }: RoiOverlayProps) {
  const mode = useViewerModeStore((s) => s.mode);
  const phase = useRoiStore((s) => s.phase);
  const shapeCount = useRoiStore((s) => s.shapes.length);
  const activeTool = useRoiStore((s) => s.activeTool);
  const editSubMode = useRoiStore((s) => s.editSubMode);
  const selectedCount = useRoiStore((s) => s.selectedPoints.length);

  const plugin = engine?.getPlugin<RoiSelectionPlugin>('roi-selection');
  const isRoi = mode === 'roi-selection';
  const isChoosing = isRoi && phase === 'choosing-tool';
  const isDrawing = isRoi && phase === 'drawing';
  const isExtruding = isRoi && phase === 'extruding';
  const isEditing = isRoi && phase === 'editing';
  const isActive = isChoosing || isDrawing || isExtruding || isEditing;

  // Tool hotkeys (1-4)
  useHotkey('1', (e) => { e.preventDefault(); plugin?.startDrawingTool('rect-2d'); }, {
    enabled: isChoosing, conflictBehavior: 'allow',
  });
  useHotkey('2', (e) => { e.preventDefault(); plugin?.startDrawingTool('box'); }, {
    enabled: isChoosing, conflictBehavior: 'allow',
  });
  useHotkey('3', (e) => { e.preventDefault(); plugin?.startDrawingTool('cylinder'); }, {
    enabled: isChoosing, conflictBehavior: 'allow',
  });
  useHotkey('4', (e) => { e.preventDefault(); plugin?.startDrawingTool('polygon-2d'); }, {
    enabled: isChoosing, conflictBehavior: 'allow',
  });

  // Edit sub-mode hotkeys
  useHotkey('g', (e) => {
    e.preventDefault();
    useRoiStore.getState().setEditSubMode('translate');
  }, { enabled: isEditing, conflictBehavior: 'allow' });

  useHotkey('r', (e) => {
    e.preventDefault();
    useRoiStore.getState().setEditSubMode('rotate');
  }, { enabled: isEditing, conflictBehavior: 'allow' });

  useHotkey('Tab', (e) => {
    e.preventDefault();
    useRoiStore.getState().setEditSubMode('points');
  }, { enabled: isEditing, conflictBehavior: 'allow' });

  // A — select all points
  useHotkey('a', (e) => {
    e.preventDefault();
    const store = useRoiStore.getState();
    if (store.editSubMode !== 'points' || !store.pendingShape) return;
    const pts = getControlPoints(store.pendingShape);
    store.setSelectedPoints(pts.map((_, i) => i));
  }, { enabled: isEditing && editSubMode === 'points', conflictBehavior: 'allow' });

  // Enter — confirm shape (editing) or apply ROI (choosing with shapes)
  useHotkey(
    'Enter',
    (e) => {
      e.preventDefault();
      if (isEditing) plugin?.confirmShape();
      else if (isChoosing && shapeCount > 0) plugin?.applySelection();
    },
    { enabled: isEditing || (isChoosing && shapeCount > 0), conflictBehavior: 'allow' },
  );

  // Escape — discard shape (editing/drawing) or exit mode (choosing)
  useHotkey(
    'Escape',
    (e) => {
      e.preventDefault();
      if (isEditing || isDrawing || isExtruding) plugin?.discardShape();
      else if (isChoosing) plugin?.cancelSelection();
    },
    { enabled: isActive, conflictBehavior: 'allow' },
  );

  // Delete / Backspace — remove last shape
  useHotkey(
    'Delete',
    (e) => {
      e.preventDefault();
      useRoiStore.getState().removeLastShape();
    },
    { enabled: isChoosing && shapeCount > 0, conflictBehavior: 'allow' },
  );
  useHotkey(
    'Backspace',
    (e) => {
      e.preventDefault();
      useRoiStore.getState().removeLastShape();
    },
    { enabled: isChoosing && shapeCount > 0, conflictBehavior: 'allow' },
  );

  // Z — undo last polygon vertex
  useHotkey(
    'z',
    (e) => {
      e.preventDefault();
      useRoiStore.getState().undoPolyVertex();
    },
    { enabled: isDrawing && activeTool === 'polygon-2d', conflictBehavior: 'allow' },
  );

  if (!isActive) return null;

  const editInstructions: Record<RoiEditSubMode, string> = {
    translate: 'Drag arrows to move shape. G=Move  R=Rotate  Tab=Edit Points',
    rotate: 'Drag ring to rotate shape. G=Move  R=Rotate  Tab=Edit Points',
    points: selectedCount > 0
      ? `${selectedCount} point${selectedCount !== 1 ? 's' : ''} selected. Drag to move. Ctrl+click to toggle. A=Select All`
      : 'Click handles to select. Ctrl+click to multi-select. Drag empty space to box-select.',
  };

  const instructions: Record<string, string> = {
    'choosing-tool': `Select a shape tool (1-4) to draw a region. ${shapeCount} region${shapeCount !== 1 ? 's' : ''} defined.`,
    drawing:
      activeTool === 'polygon-2d'
        ? 'Click to place vertices. Double-click or click near first vertex to close. Z to undo vertex.'
        : activeTool === 'cylinder'
          ? 'Click center, drag to set radius.'
          : activeTool === 'box'
            ? 'Click and drag to draw footprint.'
            : 'Click and drag to draw region.',
    extruding: 'Move mouse up/down to set height, click to confirm. Esc to cancel.',
    editing: editInstructions[editSubMode],
  };

  const setSubMode = (m: RoiEditSubMode) =>
    useRoiStore.getState().setEditSubMode(m);

  return (
    <>
      {/* Instruction banner */}
      <div className="absolute left-1/2 top-12 z-20 -translate-x-1/2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card/95 px-3 py-1.5 shadow-md backdrop-blur-sm">
          <BoxSelect className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {instructions[phase] ?? ''}
          </span>
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card/95 px-1 py-0.5 shadow-md backdrop-blur-sm">
          {isEditing && (
            <>
              {/* Edit sub-mode buttons */}
              <Button
                variant={editSubMode === 'translate' ? 'default' : 'ghost'}
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setSubMode('translate')}
              >
                <Move className="h-3.5 w-3.5" />
                Move
                <kbd className="ml-0.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                  G
                </kbd>
              </Button>
              <Button
                variant={editSubMode === 'rotate' ? 'default' : 'ghost'}
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setSubMode('rotate')}
              >
                <RotateCw className="h-3.5 w-3.5" />
                Rotate
                <kbd className="ml-0.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                  R
                </kbd>
              </Button>
              <Button
                variant={editSubMode === 'points' ? 'default' : 'ghost'}
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setSubMode('points')}
              >
                <MousePointer className="h-3.5 w-3.5" />
                Points
                <kbd className="ml-0.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                  Tab
                </kbd>
              </Button>

              <div className="mx-1 h-4 w-px bg-border" />

              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs text-green-500 hover:text-green-400"
                onClick={() => plugin?.confirmShape()}
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
                onClick={() => plugin?.discardShape()}
              >
                <X className="h-3.5 w-3.5" />
                Discard
                <kbd className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                  Esc
                </kbd>
              </Button>
            </>
          )}
          {isChoosing && shapeCount > 0 && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs text-green-500 hover:text-green-400"
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
            </>
          )}
          {isExtruding && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs text-muted-foreground"
              onClick={() => plugin?.discardShape()}
            >
              <X className="h-3.5 w-3.5" />
              Cancel
              <kbd className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                Esc
              </kbd>
            </Button>
          )}
          {(isDrawing || isChoosing) && shapeCount === 0 && (
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
          )}
        </div>
      </div>
    </>
  );
}
