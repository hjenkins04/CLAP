import {
  BoxSelect,
  GitCommitHorizontal,
  Move,
  MousePointer2,
  RotateCw,
  Scale3D,
  Square,
  Spline,
} from 'lucide-react';
import { Button } from '@clap/design-system';
import { useHotkey } from '@tanstack/react-hotkeys';
import { useViewerModeStore } from '@/app/stores';
import { useRoiStore, RoiSelectionPlugin } from '../plugins/roi-selection';
import type { RoiEditSubMode } from '../plugins/roi-selection/roi-store';
import type { ViewerEngine } from '../services/viewer-engine';

interface RoiOverlayProps {
  engine: ViewerEngine | null;
}

const ELEMENT_MODES: Array<{ id: RoiEditSubMode; label: string; Icon: typeof Move; key?: string }> = [
  { id: 'shape',  label: 'Select',  Icon: MousePointer2,       key: 'Q' },
  { id: 'vertex', label: 'Vertex',  Icon: GitCommitHorizontal          },
  { id: 'edge',   label: 'Edge',    Icon: Spline                       },
  { id: 'face',   label: 'Face',    Icon: Square                       },
];

const TRANSFORM_MODES: Array<{ id: RoiEditSubMode; label: string; Icon: typeof Move; key?: string }> = [
  { id: 'translate', label: 'Move',   Icon: Move,    key: 'G' },
  { id: 'rotate',    label: 'Rotate', Icon: RotateCw, key: 'R' },
  { id: 'scale',     label: 'Scale',  Icon: Scale3D           },
];

export function RoiOverlay({ engine }: RoiOverlayProps) {
  const viewerMode  = useViewerModeStore((s) => s.mode);
  const phase       = useRoiStore((s) => s.phase);
  const editSubMode = useRoiStore((s) => s.editSubMode);
  const shapeCount  = useRoiStore((s) => s.shapeCount);
  const selInfo     = useRoiStore((s) => s.selectionInfo);

  const plugin    = engine?.getPlugin<RoiSelectionPlugin>('roi-selection');
  const isRoi     = viewerMode === 'roi-selection';
  const isEditing = isRoi && phase === 'editing';
  const isDrawing = isRoi && phase === 'drawing';

  // ── Hotkeys ────────────────────────────────────────────────────────────────
  useHotkey('q', (e) => { e.preventDefault(); plugin?.setEditSubMode('shape');     }, { enabled: isEditing, conflictBehavior: 'allow' });
  useHotkey('g', (e) => { e.preventDefault(); plugin?.setEditSubMode('translate'); }, { enabled: isEditing, conflictBehavior: 'allow' });
  useHotkey('r', (e) => { e.preventDefault(); plugin?.setEditSubMode('rotate');    }, { enabled: isEditing, conflictBehavior: 'allow' });

  useHotkey('Enter', (e) => {
    e.preventDefault();
    if (isEditing && shapeCount > 0) plugin?.applySelection();
  }, { enabled: isEditing && shapeCount > 0, conflictBehavior: 'allow' });

  useHotkey('Escape', (e) => {
    e.preventDefault();
    if (isDrawing) plugin?.cancelDraw();
    else if (isEditing) plugin?.cancelSelection();
  }, { enabled: isRoi, conflictBehavior: 'allow' });

  useHotkey('Delete',    (e) => { e.preventDefault(); plugin?.removeLastShape(); }, { enabled: isEditing && shapeCount > 0, conflictBehavior: 'allow' });
  useHotkey('Backspace', (e) => { e.preventDefault(); plugin?.removeLastShape(); }, { enabled: isEditing && shapeCount > 0, conflictBehavior: 'allow' });

  if (!isRoi) return null;

  // ── Hint text ──────────────────────────────────────────────────────────────
  const hint = isDrawing
    ? 'Click to place · Double-click / Enter to finish · Backspace to undo · Esc to cancel'
    : selInfo.shapes > 0
      ? `${selInfo.shapes} shape${selInfo.shapes !== 1 ? 's' : ''} selected · use handles or gizmo`
      : selInfo.elements > 0
        ? `${selInfo.elements} element${selInfo.elements !== 1 ? 's' : ''} selected · drag gizmo to move`
        : shapeCount > 0
          ? `${shapeCount} region${shapeCount !== 1 ? 's' : ''} defined — click to select or draw more`
          : 'Draw a region using the panel tools · Esc to exit';

  return (
    <>
      {/* Instruction banner */}
      <div className="absolute left-1/2 top-12 z-20 -translate-x-1/2 pointer-events-none">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card/95 px-3 py-1.5 shadow-md backdrop-blur-sm">
          <BoxSelect className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{hint}</span>
        </div>
      </div>

      {/* Bottom edit-mode toolbar — only shown while editing (not drawing) */}
      {isEditing && (
        <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card/95 px-1 py-0.5 shadow-md backdrop-blur-sm">

            {/* Selection sub-modes */}
            {ELEMENT_MODES.map(({ id, label, Icon, key }) => (
              <Button
                key={id}
                variant={editSubMode === id ? 'default' : 'ghost'}
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => plugin?.setEditSubMode(id)}
                title={key ? `${label} (${key})` : label}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden md:inline">{label}</span>
                {key && (
                  <kbd className="ml-0.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                    {key}
                  </kbd>
                )}
              </Button>
            ))}

            <div className="mx-1 h-4 w-px bg-border" />

            {/* Transform modes */}
            {TRANSFORM_MODES.map(({ id, label, Icon, key }) => (
              <Button
                key={id}
                variant={editSubMode === id ? 'default' : 'ghost'}
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => plugin?.setEditSubMode(id)}
                title={key ? `${label} (${key})` : label}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden md:inline">{label}</span>
                {key && (
                  <kbd className="ml-0.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                    {key}
                  </kbd>
                )}
              </Button>
            ))}

          </div>
        </div>
      )}
    </>
  );
}
