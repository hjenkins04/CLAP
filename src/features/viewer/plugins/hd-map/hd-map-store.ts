import { create } from 'zustand';
import type { HdMapProject } from './hd-map-project';
import type { HdMapElement, GeoPoint } from './hd-map-edit-model';

export type HdMapLoadState = 'idle' | 'loading' | 'loaded' | 'error';
export type HdMapEditorMode = 'none' | 'vertex' | 'sign-move';

interface HdMapState {
  // ── Project / load ──────────────────────────────────────────────────────────
  project:         HdMapProject | null;
  loadState:       HdMapLoadState;
  error:           string | null;

  // ── Rendering ───────────────────────────────────────────────────────────────
  elevationOffset: number;
  showEdges:       boolean;
  showMarkers:     boolean;
  showObjects:     boolean;
  showSigns:       boolean;

  // ── Editor state ────────────────────────────────────────────────────────────
  /** Full element list, populated after tiles are loaded. */
  elements:     HdMapElement[];
  selectedId:   string | null;
  editorMode:   HdMapEditorMode;
  isDirty:      boolean;
  /** File keys (lxsx_0, rsgx_3, …) that have been modified. */
  dirtyFiles:   Set<string>;

  // ── Actions ─────────────────────────────────────────────────────────────────
  setProject:         (p: HdMapProject) => void;
  setLoadState:       (s: HdMapLoadState, err?: string) => void;
  setElevationOffset: (v: number) => void;
  setShowEdges:       (v: boolean) => void;
  setShowMarkers:     (v: boolean) => void;
  setShowObjects:     (v: boolean) => void;
  setShowSigns:       (v: boolean) => void;

  setElements:        (elems: HdMapElement[]) => void;
  selectElement:      (id: string | null) => void;
  setEditorMode:      (mode: HdMapEditorMode) => void;
  toggleElementHidden:(id: string) => void;

  /** Update the GeoPoints of an edge or marker-line element. */
  updateEdgePoints:  (id: string, geoPoints: GeoPoint[]) => void;
  /** Update the edgePoints polygon of a road-object element. */
  updateObjectPoints:(id: string, edgePoints: GeoPoint[]) => void;
  /** Update the position and azimuth of a sign element. */
  updateSign:        (id: string, point: GeoPoint, azimuth: number) => void;

  deleteElement:  (id: string) => void;
  markFileDirty:  (key: string) => void;
  clearDirty:     () => void;

  /** Per-drag undo/redo counts for the active vertex editing session. */
  vertexUndoCount:        number;
  vertexRedoCount:        number;
  setVertexHistoryCounts: (undo: number, redo: number) => void;
}

export const useHdMapStore = create<HdMapState>((set) => ({
  project:         null,
  loadState:       'idle',
  error:           null,
  elevationOffset: 51.3,
  showEdges:       true,
  showMarkers:     true,
  showObjects:     true,
  showSigns:       true,
  elements:        [],
  selectedId:      null,
  editorMode:      'none',
  isDirty:         false,
  dirtyFiles:      new Set(),
  vertexUndoCount: 0,
  vertexRedoCount: 0,

  setProject: (p) => set({
    project:         p,
    loadState:       'idle',
    error:           null,
    elevationOffset: p.elevationOffsetDefault ?? 51.3,
    elements:        [],
    selectedId:      null,
    editorMode:      'none',
    isDirty:         false,
    dirtyFiles:      new Set(),
  }),
  setLoadState:       (s, err = null) => set({ loadState: s, error: err ?? null }),
  setElevationOffset: (v) => set({ elevationOffset: v }),
  setShowEdges:       (v) => set({ showEdges: v }),
  setShowMarkers:     (v) => set({ showMarkers: v }),
  setShowObjects:     (v) => set({ showObjects: v }),
  setShowSigns:       (v) => set({ showSigns: v }),

  setElements: (elems) => set({ elements: elems }),

  selectElement: (id) => set((s) => ({
    selectedId: id,
    // Exit vertex editing when selection changes
    editorMode: s.editorMode !== 'none' && s.selectedId !== id ? 'none' : s.editorMode,
  })),

  setEditorMode: (mode) => set({ editorMode: mode }),

  toggleElementHidden: (id) => set((s) => {
    const elem = s.elements.find(e => e.id === id);
    const willHide = elem ? !elem.hidden : false;
    return {
      elements:   s.elements.map(e => e.id === id ? { ...e, hidden: !e.hidden } : e),
      selectedId: willHide && s.selectedId === id ? null : s.selectedId,
      editorMode: willHide && s.selectedId === id ? 'none' : s.editorMode,
    };
  }),

  updateEdgePoints: (id, geoPoints) => set((s) => {
    const fileKey = fileKeyFromId(id);
    return {
      elements:   s.elements.map(e => e.id === id ? { ...e, geoPoints } as HdMapElement : e),
      isDirty:    true,
      dirtyFiles: new Set([...s.dirtyFiles, fileKey]),
    };
  }),

  updateObjectPoints: (id, edgePoints) => set((s) => {
    const fileKey = fileKeyFromId(id);
    return {
      elements:   s.elements.map(e => e.id === id ? { ...e, edgePoints } as HdMapElement : e),
      isDirty:    true,
      dirtyFiles: new Set([...s.dirtyFiles, fileKey]),
    };
  }),

  updateSign: (id, point, azimuth) => set((s) => {
    const fileKey = fileKeyFromId(id);
    return {
      elements:   s.elements.map(e => e.id === id ? { ...e, point, azimuth } as HdMapElement : e),
      isDirty:    true,
      dirtyFiles: new Set([...s.dirtyFiles, fileKey]),
    };
  }),

  deleteElement: (id) => set((s) => {
    const fileKey = fileKeyFromId(id);
    return {
      elements:   s.elements.map(e => e.id === id ? { ...e, deleted: true } : e),
      selectedId: s.selectedId === id ? null : s.selectedId,
      editorMode: s.selectedId === id ? 'none' : s.editorMode,
      isDirty:    true,
      dirtyFiles: new Set([...s.dirtyFiles, fileKey]),
    };
  }),

  markFileDirty: (key) => set((s) => ({
    isDirty:    true,
    dirtyFiles: new Set([...s.dirtyFiles, key]),
  })),

  clearDirty: () => set({ isDirty: false, dirtyFiles: new Set() }),

  setVertexHistoryCounts: (undo, redo) => set({ vertexUndoCount: undo, vertexRedoCount: redo }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Derive the file key (lxsx_N or rsgx_N) from an element id. */
function fileKeyFromId(id: string): string {
  // id format: "lxsx:fi:..." or "rsgx:fi:..."
  const parts = id.split(':');
  return `${parts[0]}_${parts[1]}`;
}
