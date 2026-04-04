import {
  MapPin,
  MapPinOff,
  FlipHorizontal2,
  FlipVertical2,
  ArrowUpDown,
  Check,
  X,
  Move,
  RotateCw,
  Pencil,
  Undo2,
  Redo2,
  Save,
} from 'lucide-react';
import { Button } from '@clap/design-system';
import { useViewerModeStore } from '@/app/stores';
import { useWorldFrameStore } from './world-frame-store';
import { useBaseMapStore } from '../base-map/base-map-store';

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

  // Base-map editing state (alignment gizmo)
  const editing = useBaseMapStore((s) => s.editing);
  const gizmoMode = useBaseMapStore((s) => s.gizmoMode);
  const canUndo = useBaseMapStore((s) => s.canUndoEdit);
  const canRedo = useBaseMapStore((s) => s.canRedoEdit);
  const saving = useBaseMapStore((s) => s.saving);
  const setEditing = useBaseMapStore((s) => s.setEditing);
  const setGizmoMode = useBaseMapStore((s) => s.setGizmoMode);
  const onSave = useBaseMapStore((s) => s._onSave);
  const onCancel = useBaseMapStore((s) => s._onCancel);
  const onUndo = useBaseMapStore((s) => s._onUndo);
  const onRedo = useBaseMapStore((s) => s._onRedo);

  // Anchor point gizmo state
  const editingAnchor = useWorldFrameStore((s) => s.editingAnchor);
  const setEditingAnchor = useWorldFrameStore((s) => s.setEditingAnchor);
  const onSaveAnchor = useWorldFrameStore((s) => s._onSaveAnchor);
  const onCancelAnchor = useWorldFrameStore((s) => s._onCancelAnchor);

  const isConfirmed = phase === 'confirmed' && anchor1 !== null;
  const isActive = phase !== 'idle' && phase !== 'confirmed';

  const handleSave = async () => {
    if (onSave) await onSave();
    setEditing(false);
  };

  const handleCancel = () => {
    if (onCancel) onCancel();
    setEditing(false);
  };

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
                disabled={editing}
              >
                <FlipHorizontal2 className="h-3 w-3" />
                Flip X
              </Button>
              <Button
                variant={flipZ ? 'default' : 'outline'}
                size="sm"
                className="h-6 flex-1 gap-1 text-xs"
                onClick={toggleFlipZ}
                disabled={editing}
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
                  disabled={editing}
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

            {/* ── Edit Anchor (move reference point gizmo) ────────────── */}
            {!editingAnchor ? (
              <Button
                variant="outline"
                size="sm"
                className="h-6 w-full gap-1.5 text-xs"
                onClick={() => setEditingAnchor(true)}
                disabled={editing || editingZOffset}
              >
                <MapPinOff className="h-3 w-3" />
                Edit Anchor
              </Button>
            ) : (
              <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2">
                <p className="text-[10px] text-muted-foreground">
                  Drag the green anchor sphere to reposition the map reference point.
                </p>
                <div className="flex gap-1">
                  <Button
                    variant="default"
                    size="sm"
                    className="h-6 flex-1 gap-1 text-xs"
                    onClick={async () => {
                      if (onSaveAnchor) await onSaveAnchor();
                      setEditingAnchor(false);
                    }}
                    disabled={saving}
                  >
                    <Save className="h-3 w-3" />
                    {saving ? 'Saving…' : 'Apply'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-xs"
                    onClick={() => {
                      if (onCancelAnchor) onCancelAnchor();
                      setEditingAnchor(false);
                    }}
                    disabled={saving}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}

            {/* ── Edit Alignment (gizmo) ─────────────────────────────── */}
            {!editing ? (
              <Button
                variant="outline"
                size="sm"
                className="h-6 w-full gap-1.5 text-xs"
                onClick={() => setEditing(true)}
                disabled={editingZOffset || editingAnchor}
              >
                <Pencil className="h-3 w-3" />
                Edit Alignment
              </Button>
            ) : (
              <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2">
                <p className="text-[10px] text-muted-foreground">
                  Drag the gizmo in the 3D view to reposition or rotate the map.
                </p>

                {/* Mode toggle */}
                <div className="flex gap-1">
                  <Button
                    variant={gizmoMode === 'translate' ? 'default' : 'outline'}
                    size="sm"
                    className="h-6 flex-1 gap-1 text-xs"
                    onClick={() => setGizmoMode('translate')}
                  >
                    <Move className="h-3 w-3" />
                    Move
                  </Button>
                  <Button
                    variant={gizmoMode === 'rotate' ? 'default' : 'outline'}
                    size="sm"
                    className="h-6 flex-1 gap-1 text-xs"
                    onClick={() => setGizmoMode('rotate')}
                  >
                    <RotateCw className="h-3 w-3" />
                    Rotate
                  </Button>
                </div>

                {/* Undo / Redo */}
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 flex-1 gap-1 text-xs"
                    onClick={() => onUndo?.()}
                    disabled={!canUndo}
                  >
                    <Undo2 className="h-3 w-3" />
                    Undo
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 flex-1 gap-1 text-xs"
                    onClick={() => onRedo?.()}
                    disabled={!canRedo}
                  >
                    <Redo2 className="h-3 w-3" />
                    Redo
                  </Button>
                </div>

                {/* Save / Cancel */}
                <div className="flex gap-1">
                  <Button
                    variant="default"
                    size="sm"
                    className="h-6 flex-1 gap-1 text-xs"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    <Save className="h-3 w-3" />
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-xs"
                    onClick={handleCancel}
                    disabled={saving}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs"
              onClick={() => enterWorldFrameMode()}
              disabled={editing || editingAnchor}
            >
              Redefine
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs"
              onClick={() => useWorldFrameStore.getState().resetWorldFrame()}
              disabled={editing || editingAnchor}
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
