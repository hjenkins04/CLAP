import { MapPin, FlipHorizontal2, FlipVertical2, ArrowUpDown, Check, X } from 'lucide-react';
import { Button } from '@clap/design-system';
import { useViewerModeStore } from '@/app/stores';
import { useWorldFrameStore } from './world-frame-store';

export function WorldFramePanel() {
  const phase = useWorldFrameStore((s) => s.phase);
  const anchor1 = useWorldFrameStore((s) => s.anchor1);
  const flipX = useWorldFrameStore((s) => s.flipX);
  const flipZ = useWorldFrameStore((s) => s.flipZ);
  const zOffset = useWorldFrameStore((s) => s.zOffset);
  const editingZOffset = useWorldFrameStore((s) => s.editingZOffset);
  const pendingZOffset = useWorldFrameStore((s) => s.pendingZOffset);
  const toggleFlipX = useWorldFrameStore((s) => s.toggleFlipX);
  const toggleFlipZ = useWorldFrameStore((s) => s.toggleFlipZ);
  const setEditingZOffset = useWorldFrameStore((s) => s.setEditingZOffset);
  const setPendingZOffset = useWorldFrameStore((s) => s.setPendingZOffset);
  const confirmZOffset = useWorldFrameStore((s) => s.confirmZOffset);
  const enterWorldFrameMode = useViewerModeStore((s) => s.enterWorldFrameMode);

  const isConfirmed = phase === 'confirmed' && anchor1 !== null;
  const isActive = phase !== 'idle' && phase !== 'confirmed';

  return (
    <div className="space-y-3">
      {isConfirmed ? (
        <>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 text-green-500" />
            <span>World frame set</span>
          </div>
          <div className="space-y-1 text-xs text-muted-foreground">
            <div>
              Anchor: {anchor1.geo.lat.toFixed(6)}, {anchor1.geo.lng.toFixed(6)}
            </div>
          </div>

          {/* Overlay alignment controls — shared by satellite map + OSM */}
          <div className="space-y-2 border-t border-border pt-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Overlay Alignment
            </span>

            {/* Flip */}
            <div className="flex gap-1">
              <Button
                variant={flipX ? 'default' : 'outline'}
                size="sm"
                className="h-6 flex-1 gap-1 text-xs"
                onClick={toggleFlipX}
              >
                <FlipHorizontal2 className="h-3 w-3" />
                Flip X
              </Button>
              <Button
                variant={flipZ ? 'default' : 'outline'}
                size="sm"
                className="h-6 flex-1 gap-1 text-xs"
                onClick={toggleFlipZ}
              >
                <FlipVertical2 className="h-3 w-3" />
                Flip Y
              </Button>
            </div>

            {/* Z Offset */}
            {!editingZOffset ? (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Z Offset: {zOffset.toFixed(1)}m
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-xs"
                  onClick={() => setEditingZOffset(true)}
                >
                  <ArrowUpDown className="h-3 w-3" />
                  Edit
                </Button>
              </div>
            ) : (
              <>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Z Offset: {pendingZOffset.toFixed(1)}m
                </label>
                <input
                  type="range"
                  min="-20"
                  max="20"
                  step="0.5"
                  value={pendingZOffset}
                  onChange={(e) => setPendingZOffset(Number(e.target.value))}
                  className="mb-2 w-full accent-primary"
                />
                <div className="flex gap-1">
                  <Button
                    variant="default"
                    size="sm"
                    className="h-6 flex-1 gap-1 text-xs"
                    onClick={confirmZOffset}
                  >
                    <Check className="h-3 w-3" />
                    Apply
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-xs"
                    onClick={() => setEditingZOffset(false)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </>
            )}
          </div>

          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs"
              onClick={() => enterWorldFrameMode()}
            >
              Redefine
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs"
              onClick={() => useWorldFrameStore.getState().resetWorldFrame()}
            >
              Clear
            </Button>
          </div>
        </>
      ) : isActive ? (
        <div className="text-xs text-muted-foreground">
          Setting world frame...
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-full gap-1.5 text-xs"
          onClick={enterWorldFrameMode}
        >
          <MapPin className="h-3.5 w-3.5" />
          Set World Frame
        </Button>
      )}
    </div>
  );
}
