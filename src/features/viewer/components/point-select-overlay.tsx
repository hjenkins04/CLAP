import { X, Trash2 } from 'lucide-react';
import { Button } from '@clap/design-system';
import { useHotkey } from '@tanstack/react-hotkeys';
import { useViewerModeStore } from '@/app/stores';
import { usePointSelectStore, PointSelectPlugin } from '../plugins/point-select';
import { CLASSIFICATION_CLASSES } from '../plugins/annotate/classification-classes';
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

  const handleClassify = (classId: number) => {
    const ids = plugin?.getSelectedPointIds() ?? [];
    const editor = engine?.getEditor();
    if (ids.length === 0 || !editor) return;
    editor.setClassification(ids, classId);
    plugin?.clearSelection();
  };

  const handleDelete = () => {
    const ids = plugin?.getSelectedPointIds() ?? [];
    const editor = engine?.getEditor();
    if (ids.length === 0 || !editor) return;
    editor.deletePoints(ids);
    plugin?.clearSelection();
  };

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

  // Delete key to delete selected points
  useHotkey(
    'Delete',
    (e) => {
      e.preventDefault();
      handleDelete();
    },
    { enabled: isActive && selectedCount > 0 },
  );

  if (!isActive) return null;

  return (
    <>
      {/* Instructions bar at top */}
      <div className="pointer-events-none absolute inset-x-0 top-12 z-10 flex justify-center">
        <div className="rounded-md bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
          {phase === 'selected'
            ? `${selectedCount.toLocaleString()} point${selectedCount !== 1 ? 's' : ''} selected — click a class to annotate, Esc to clear`
            : 'Drag to select points — Alt+drag to subtract'}
        </div>
      </div>

      {/* Bottom action panel — shown when points are selected */}
      {selectedCount > 0 && (
        <div className="absolute bottom-4 left-1/2 z-10 w-[520px] -translate-x-1/2 rounded-lg border border-border bg-card/95 shadow-lg backdrop-blur-sm">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
            <span className="text-xs text-muted-foreground">
              {selectedCount.toLocaleString()} point{selectedCount !== 1 ? 's' : ''} selected
            </span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 text-xs text-destructive hover:text-destructive"
                onClick={handleDelete}
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </Button>
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
          </div>

          {/* Classification grid */}
          <div className="p-2">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Classify as:</p>
            <div className="flex flex-wrap gap-1">
              {CLASSIFICATION_CLASSES.map((cls) => {
                const [r, g, b] = cls.color;
                return (
                  <button
                    key={cls.id}
                    type="button"
                    onClick={() => handleClassify(cls.id)}
                    className="flex items-center gap-1 rounded border border-border bg-background/80 px-1.5 py-0.5 text-xs transition-colors hover:border-foreground/30 hover:bg-muted"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor: `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`,
                      }}
                    />
                    {cls.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
