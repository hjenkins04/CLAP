import { Move, RotateCw, Pencil, Check, FlipHorizontal2, FlipVertical2, Save, ArrowUpDown, X } from 'lucide-react';
import { Button } from '@clap/design-system';
import { useBaseMapStore } from './base-map-store';
import { useWorldFrameStore } from '../world-frame';

export function BaseMapPanel() {
  const visible = useBaseMapStore((s) => s.visible);
  const opacity = useBaseMapStore((s) => s.opacity);
  const zoomLevel = useBaseMapStore((s) => s.zoomLevel);
  const editing = useBaseMapStore((s) => s.editing);
  const gizmoMode = useBaseMapStore((s) => s.gizmoMode);
  const setVisible = useBaseMapStore((s) => s.setVisible);
  const setOpacity = useBaseMapStore((s) => s.setOpacity);
  const zOffset = useBaseMapStore((s) => s.zOffset);
  const editingZOffset = useBaseMapStore((s) => s.editingZOffset);
  const pendingZOffset = useBaseMapStore((s) => s.pendingZOffset);
  const setZoomLevel = useBaseMapStore((s) => s.setZoomLevel);
  const setEditingZOffset = useBaseMapStore((s) => s.setEditingZOffset);
  const setPendingZOffset = useBaseMapStore((s) => s.setPendingZOffset);
  const confirmZOffset = useBaseMapStore((s) => s.confirmZOffset);
  const flipX = useBaseMapStore((s) => s.flipX);
  const flipZ = useBaseMapStore((s) => s.flipZ);
  const setEditing = useBaseMapStore((s) => s.setEditing);
  const saving = useBaseMapStore((s) => s.saving);
  const onSave = useBaseMapStore((s) => s._onSave);
  const setGizmoMode = useBaseMapStore((s) => s.setGizmoMode);
  const toggleFlipX = useBaseMapStore((s) => s.toggleFlipX);
  const toggleFlipZ = useBaseMapStore((s) => s.toggleFlipZ);
  const transform = useWorldFrameStore((s) => s.transform);

  if (!transform) {
    return (
      <div className="text-xs text-muted-foreground">
        Set a world frame to enable the base map.
      </div>
    );
  }

  return (
    <>
      {/* Visible Toggle */}
      <div className="mb-3 flex items-center justify-between">
        <label className="text-xs text-muted-foreground">Visible</label>
        <button
          onClick={() => setVisible(!visible)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            visible ? 'bg-primary' : 'bg-muted'
          }`}
        >
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-background transition-transform ${
              visible ? 'translate-x-5' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Opacity */}
      <div className="mb-3">
        <label className="mb-1 block text-xs text-muted-foreground">
          Opacity: {Math.round(opacity * 100)}%
        </label>
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))}
          disabled={!visible}
          className="w-full accent-primary disabled:opacity-40"
        />
      </div>

      {/* Zoom Level */}
      <div className="mb-3">
        <label className="mb-1 block text-xs text-muted-foreground">
          Detail Level: {zoomLevel}
        </label>
        <input
          type="range"
          min="16"
          max="19"
          step="1"
          value={zoomLevel}
          onChange={(e) => setZoomLevel(Number(e.target.value))}
          disabled={!visible}
          className="w-full accent-primary disabled:opacity-40"
        />
      </div>

      {/* Z Offset */}
      <div className="mb-3">
        {!editingZOffset ? (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Z Offset: {zOffset.toFixed(1)}m
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-xs"
              disabled={!visible}
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

      {/* Edit / Refine */}
      {!editing ? (
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-full gap-1.5 text-xs"
          disabled={!visible}
          onClick={() => setEditing(true)}
        >
          <Pencil className="h-3.5 w-3.5" />
          Refine Alignment
        </Button>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-1">
            <Button
              variant={gizmoMode === 'translate' ? 'default' : 'outline'}
              size="sm"
              className="h-7 flex-1 gap-1 text-xs"
              onClick={() => setGizmoMode('translate')}
            >
              <Move className="h-3.5 w-3.5" />
              Move
            </Button>
            <Button
              variant={gizmoMode === 'rotate' ? 'default' : 'outline'}
              size="sm"
              className="h-7 flex-1 gap-1 text-xs"
              onClick={() => setGizmoMode('rotate')}
            >
              <RotateCw className="h-3.5 w-3.5" />
              Rotate
            </Button>
          </div>
          <div className="flex gap-1">
            <Button
              variant={flipX ? 'default' : 'outline'}
              size="sm"
              className="h-7 flex-1 gap-1 text-xs"
              onClick={toggleFlipX}
            >
              <FlipHorizontal2 className="h-3.5 w-3.5" />
              Flip X
            </Button>
            <Button
              variant={flipZ ? 'default' : 'outline'}
              size="sm"
              className="h-7 flex-1 gap-1 text-xs"
              onClick={toggleFlipZ}
            >
              <FlipVertical2 className="h-3.5 w-3.5" />
              Flip Y
            </Button>
          </div>
          <Button
            variant="default"
            size="sm"
            className="h-7 w-full gap-1.5 text-xs"
            onClick={() => setEditing(false)}
          >
            <Check className="h-3.5 w-3.5" />
            Done
          </Button>
        </div>
      )}

      {/* Save geo-reference */}
      <Button
        variant="outline"
        size="sm"
        className="mt-1 h-7 w-full gap-1.5 text-xs"
        disabled={saving || !onSave}
        onClick={() => onSave?.()}
      >
        <Save className="h-3.5 w-3.5" />
        {saving ? 'Saving...' : 'Save Geo-Reference'}
      </Button>
    </>
  );
}
