/**
 * HdMapPanel — plugin settings panel (shown in the right sidebar under "HD Map").
 *
 * Responsibilities:
 *   - Open / Change project (.hdmap file dialog)
 *   - Save* (write patched XML when dirty)
 *   - Elevation offset fine-tune slider
 *   - Editor mode hints and commit/cancel toolbar
 *
 * The element browser (tree of lane edges, markers, etc.) lives in the
 * Scene Layers panel (SidebarLayersPanel → HdMapLayersSection) so the user
 * can access it without navigating away from other tools.
 */

import { useState } from 'react';
import { useHdMapStore } from './hd-map-store';
import { getHdMapPlugin } from './hd-map-plugin';
import { hdMapHistory } from './hd-map-history';
import type { HdMapProject } from './hd-map-project';

async function openHdMapProject(): Promise<HdMapProject | null> {
  const result = await window.electron?.invoke<HdMapProject | { error: string } | null>(
    'open-hdmap-dialog',
  );
  if (!result || 'error' in result) return null;
  return result;
}

export function HdMapPanel() {
  const project     = useHdMapStore(s => s.project);
  const loadState   = useHdMapStore(s => s.loadState);
  const error       = useHdMapStore(s => s.error);
  const isDirty     = useHdMapStore(s => s.isDirty);
  const elevOffset  = useHdMapStore(s => s.elevationOffset);
  const editorMode  = useHdMapStore(s => s.editorMode);
  const selectedId  = useHdMapStore(s => s.selectedId);
  const elements    = useHdMapStore(s => s.elements);

  const { setProject, setElevationOffset, setEditorMode, updateEdgePoints, updateObjectPoints } = useHdMapStore();

  const [saving, setSaving] = useState(false);

  const isLoaded  = loadState === 'loaded';
  const isLoading = loadState === 'loading';

  const handleOpen = async () => {
    const p = await openHdMapProject();
    if (p) setProject(p);
  };

  const handleSave = async () => {
    const plugin = getHdMapPlugin();
    if (!plugin) return;
    setSaving(true);
    try { await plugin.saveAllTiles(); }
    finally { setSaving(false); }
  };

  const handleCommit = () => {
    const plugin = getHdMapPlugin();
    const pts    = plugin?.commitVertexEdit();
    if (pts && selectedId) {
      const elem = elements.find(e => e.id === selectedId);
      hdMapHistory.record();
      if (elem?.kind === 'road-object') updateObjectPoints(selectedId, pts);
      else if (elem)                    updateEdgePoints(selectedId, pts);
    }
    setEditorMode('none');
  };

  return (
    <div className="space-y-3 text-xs">
      {/* Status + project buttons */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className={`h-2 w-2 flex-shrink-0 rounded-full ${
            isLoaded  ? 'bg-green-500' :
            isLoading ? 'bg-yellow-500 animate-pulse' :
            error     ? 'bg-red-500' :
            'bg-muted-foreground'
          }`} />
          <span className="text-muted-foreground truncate">
            {isLoaded  ? (project?.name ?? 'Loaded') :
             isLoading ? 'Loading\u2026' :
             error     ? 'Error' : 'No project'}
          </span>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          {isLoaded && isDirty && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded px-2 py-0.5 text-[11px] font-medium bg-green-600/80 hover:bg-green-600 text-white disabled:opacity-50"
            >
              {saving ? 'Saving\u2026' : 'Save*'}
            </button>
          )}
          <button
            onClick={handleOpen}
            disabled={isLoading}
            className="rounded px-2 py-0.5 text-[11px] font-medium bg-muted hover:bg-muted/80 disabled:opacity-40"
          >
            {isLoaded ? 'Change' : 'Open\u2026'}
          </button>
        </div>
      </div>

      {error && <p className="text-destructive break-all">{error}</p>}

      {/* Elevation offset */}
      {isLoaded && (
        <div>
          <label className="block text-muted-foreground mb-0.5">
            Elevation offset: {elevOffset.toFixed(1)} m
          </label>
          <input
            type="range" min="40" max="65" step="0.1"
            value={elevOffset}
            onChange={e => setElevationOffset(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Adjust if the map floats above or sinks below road surface.
          </p>
        </div>
      )}

      {/* Editor mode toolbar */}
      {isLoaded && editorMode === 'vertex' && (
        <div className="rounded border border-primary/30 bg-primary/5 p-2 space-y-1.5">
          <p className="text-[10px] text-primary font-medium">Vertex editing active</p>
          <p className="text-[10px] text-muted-foreground">
            Drag handles in the 3D view to reposition vertices.
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={handleCommit}
              className="flex-1 py-0.5 rounded text-[11px] bg-green-600/80 hover:bg-green-600 text-white"
            >
              Done
            </button>
            <button
              onClick={() => setEditorMode('none')}
              className="flex-1 py-0.5 rounded text-[11px] bg-muted hover:bg-muted/80"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isLoaded && editorMode === 'sign-move' && (
        <div className="rounded border border-primary/30 bg-primary/5 p-2 space-y-1.5">
          <p className="text-[10px] text-primary font-medium">Sign repositioning</p>
          <p className="text-[10px] text-muted-foreground">
            Click a position in the 3D view to move the sign.
          </p>
          <button
            onClick={() => setEditorMode('none')}
            className="w-full py-0.5 rounded text-[11px] bg-muted hover:bg-muted/80"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Hint when idle */}
      {isLoaded && editorMode === 'none' && (
        <p className="text-[10px] text-muted-foreground">
          Select elements in the Scene Layers panel to edit or delete them.
        </p>
      )}
    </div>
  );
}
