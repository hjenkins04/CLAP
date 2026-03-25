import { Check, X } from 'lucide-react';
import { Button } from '@clap/design-system';
import { useViewerModeStore } from '@/app/stores';
import { useWorldFrameStore } from '../plugins/world-frame';
import type { WorldFramePlugin } from '../plugins/world-frame/world-frame-plugin';
import type { ViewerEngine } from '../services/viewer-engine';

interface WorldFrameOverlayProps {
  engine: ViewerEngine | null;
}

export function WorldFrameOverlay({ engine }: WorldFrameOverlayProps) {
  const mode = useViewerModeStore((s) => s.mode);
  const phase = useWorldFrameStore((s) => s.phase);
  const anchor2 = useWorldFrameStore((s) => s.anchor2);
  const rotationOffset = useWorldFrameStore((s) => s.rotationOffset);
  const translationOffset = useWorldFrameStore((s) => s.translationOffset);
  const setRotationOffset = useWorldFrameStore((s) => s.setRotationOffset);
  const setTranslationOffset = useWorldFrameStore((s) => s.setTranslationOffset);

  const plugin = engine?.getPlugin<WorldFramePlugin>('world-frame');

  if (mode !== 'world-frame') return null;

  // Don't show overlay during map-pick phases (modal handles those)
  if (phase === 'map-pick-first' || phase === 'map-pick-second') return null;

  const isPcPick = phase === 'pc-pick-first' || phase === 'pc-pick-second';
  const isPreview = phase === 'preview';
  const isSingleAnchor = !anchor2;

  const instructionText = (() => {
    switch (phase) {
      case 'pc-pick-first':
        return 'Click on the point cloud to select the first anchor point';
      case 'pc-pick-second':
        return 'Click on the point cloud to select the second anchor point';
      case 'preview':
        return 'Adjust alignment, then confirm';
      default:
        return '';
    }
  })();

  return (
    <>
      {/* Instruction banner */}
      {instructionText && (
        <div className="pointer-events-none absolute inset-x-0 top-12 z-20 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-card/95 px-3 py-1.5 shadow-md backdrop-blur-sm">
            <span className="text-xs text-muted-foreground">{instructionText}</span>
            {isPcPick && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-xs"
                onClick={() => plugin?.cancelWorkflow()}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Preview controls */}
      {isPreview && (
        <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-card/95 p-3 shadow-md backdrop-blur-sm">
            {/* Rotation slider (only for single anchor) */}
            {isSingleAnchor && (
              <div className="flex items-center gap-2">
                <label className="w-16 text-xs text-muted-foreground">Rotation</label>
                <input
                  type="range"
                  min={-Math.PI}
                  max={Math.PI}
                  step={0.01}
                  value={rotationOffset}
                  onChange={(e) => setRotationOffset(Number(e.target.value))}
                  className="w-40 accent-primary"
                />
                <span className="w-12 text-right text-xs text-muted-foreground">
                  {Math.round(rotationOffset * (180 / Math.PI))}°
                </span>
              </div>
            )}

            {/* Translation offset */}
            <div className="flex items-center gap-2">
              <label className="w-16 text-xs text-muted-foreground">Offset X</label>
              <input
                type="range"
                min={-50}
                max={50}
                step={0.5}
                value={translationOffset.x}
                onChange={(e) =>
                  setTranslationOffset(Number(e.target.value), translationOffset.z)
                }
                className="w-40 accent-primary"
              />
              <span className="w-12 text-right text-xs text-muted-foreground">
                {translationOffset.x.toFixed(1)}m
              </span>
            </div>
            <div className="flex items-center gap-2">
              <label className="w-16 text-xs text-muted-foreground">Offset Z</label>
              <input
                type="range"
                min={-50}
                max={50}
                step={0.5}
                value={translationOffset.z}
                onChange={(e) =>
                  setTranslationOffset(translationOffset.x, Number(e.target.value))
                }
                className="w-40 accent-primary"
              />
              <span className="w-12 text-right text-xs text-muted-foreground">
                {translationOffset.z.toFixed(1)}m
              </span>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-center gap-1 pt-1">
              <Button
                variant="default"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => plugin?.confirmPreview()}
              >
                <Check className="h-3.5 w-3.5" />
                Confirm
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => plugin?.cancelWorkflow()}
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
