import { Check, Pentagon, Pencil, Power, PowerOff, RotateCcw, Spline, Square, RectangleHorizontal, Trash2 } from 'lucide-react';
import { useViewerModeStore } from '@/app/stores';
import { useRoiStore, RoiSelectionPlugin, type RoiDrawTool } from '../plugins/roi-selection';
import { CommandPopup } from './command-popup';
import { Button, Label } from '@clap/design-system';
import type { ViewerEngine } from '../services/viewer-engine';

interface RoiCommandPanelProps {
  engine: ViewerEngine | null;
}

const DRAW_TOOLS: { id: RoiDrawTool; label: string; icon: typeof Square }[] = [
  { id: 'box',      label: '3D Box',   icon: Square              },
  { id: 'flat-box', label: '2D Plane', icon: RectangleHorizontal },
  { id: 'polygon',  label: 'Polygon',  icon: Pentagon            },
  { id: 'polyline', label: 'Polyline', icon: Spline              },
];

export function RoiCommandPanel({ engine }: RoiCommandPanelProps) {
  const viewerMode    = useViewerModeStore((s) => s.mode);
  const phase         = useRoiStore((s) => s.phase);
  const activeTool    = useRoiStore((s) => s.activeTool);
  const shapeCount    = useRoiStore((s) => s.shapeCount);
  const clipEnabled   = useRoiStore((s) => s.clipEnabled);
  const expanded      = useViewerModeStore((s) => s.isCommandPanelExpanded());
  const setExpanded   = useViewerModeStore((s) => s.setCommandPanelExpanded);

  const plugin    = engine?.getPlugin<RoiSelectionPlugin>('roi-selection');
  const isRoi     = viewerMode === 'roi-selection';
  const isApplied = phase === 'applied';
  const isEditing = isRoi && phase === 'editing';
  const isDrawing = isRoi && phase === 'drawing';

  // Panel visible while editing/drawing OR when applied
  if (!isEditing && !isDrawing && !isApplied) return null;

  return (
    // Position higher than the bottom toolbar (bottom-16 clears the ~56px toolbar)
    <CommandPopup
      title={isApplied ? 'ROI Active' : 'ROI Selection'}
      expanded={expanded}
      onToggleExpand={() => setExpanded(!expanded)}
      className="absolute bottom-16 right-3 z-10 w-64"
      onClose={() => {
        if (isApplied) plugin?.clearRoi();
        else plugin?.cancelSelection();
      }}
    >
      <div className="space-y-3">

        {/* ── Draw tools (editing/drawing phase) ─────────────────────────── */}
        {(isEditing || isDrawing) && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Draw Region</Label>
            <div className="grid grid-cols-2 gap-1">
              {DRAW_TOOLS.map(({ id, label, icon: Icon }) => (
                <Button
                  key={id}
                  variant={isDrawing && activeTool === id ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 justify-start gap-1.5 text-xs"
                  onClick={() => plugin?.startDrawingTool(id)}
                  disabled={(isDrawing && activeTool !== id) || (isEditing && shapeCount > 0)}
                >
                  <Icon className="h-3 w-3 shrink-0" />
                  {label}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* ── Shape count + undo (editing) ──────────────────────────────── */}
        {isEditing && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{shapeCount} region{shapeCount !== 1 ? 's' : ''} defined</span>
            {shapeCount > 0 && (
              <button className="text-red-400 hover:text-red-300" onClick={() => plugin?.removeLastShape()}>
                Undo last
              </button>
            )}
          </div>
        )}

        {/* ── Apply button (editing, has shapes) ───────────────────────── */}
        {isEditing && shapeCount > 0 && (
          <Button
            variant="default"
            size="sm"
            className="h-7 w-full gap-1.5 text-xs"
            onClick={() => plugin?.applySelection()}
          >
            <Check className="h-3.5 w-3.5" />
            Apply ROI
            <kbd className="ml-auto rounded bg-primary-foreground/20 px-1 text-[9px]">Enter</kbd>
          </Button>
        )}

        {/* ── Applied state controls ────────────────────────────────────── */}
        {isApplied && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              {shapeCount} shape{shapeCount !== 1 ? 's' : ''} · Crop {clipEnabled ? 'active' : 'inactive'}
            </p>

            <Button
              variant="outline"
              size="sm"
              className="h-7 w-full gap-1.5 text-xs"
              onClick={() => clipEnabled ? plugin?.disableClip() : plugin?.enableClip()}
            >
              {clipEnabled ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
              {clipEnabled ? 'Disable Crop' : 'Enable Crop'}
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-7 w-full gap-1.5 text-xs"
              onClick={() => plugin?.editRoi()}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit ROI
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-7 w-full gap-1.5 text-xs"
              onClick={() => plugin?.redefine()}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Redefine ROI
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-7 w-full gap-1.5 text-xs text-destructive hover:text-destructive"
              onClick={() => plugin?.clearRoi()}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear ROI
            </Button>
          </div>
        )}

      </div>
    </CommandPopup>
  );
}
