import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type BaseMapGizmoMode = 'translate' | 'rotate';

interface EditSnapshot {
  posX: number;
  posZ: number;
  rotY: number;
}

interface BaseMapState {
  visible: boolean;
  opacity: number;
  zoomLevel: number;
  editing: boolean;
  gizmoMode: BaseMapGizmoMode;
  flipX: boolean;
  flipZ: boolean;
  saving: boolean;

  /** Undo/redo history for base map refinement (linear history + cursor) */
  editHistory: EditSnapshot[];
  editCursor: number; // points to current state index
  canUndoEdit: boolean;
  canRedoEdit: boolean;

  setVisible: (v: boolean) => void;
  setOpacity: (o: number) => void;
  setZoomLevel: (z: number) => void;
  setEditing: (editing: boolean) => void;
  setGizmoMode: (mode: BaseMapGizmoMode) => void;
  toggleFlipX: () => void;
  toggleFlipZ: () => void;
  setSaving: (saving: boolean) => void;
  /** Push a new snapshot (truncates any redo history ahead of cursor) */
  pushEditSnapshot: (snap: EditSnapshot) => void;
  /** Move cursor back, return the snapshot to apply */
  undoEdit: () => EditSnapshot | null;
  /** Move cursor forward, return the snapshot to apply */
  redoEdit: () => EditSnapshot | null;
  clearEditHistory: () => void;

  /** Callbacks set by the plugin for the panel */
  _onSave: (() => Promise<void>) | null;
  _setOnSave: (cb: (() => Promise<void>) | null) => void;
  _onUndo: (() => void) | null;
  _onRedo: (() => void) | null;
  _setUndoRedo: (undo: (() => void) | null, redo: (() => void) | null) => void;
}

export const useBaseMapStore = create<BaseMapState>()(
  persist(
    (set, get) => ({
      visible: true,
      opacity: 0.7,
      zoomLevel: 18,
      editing: false,
      gizmoMode: 'translate',
      flipX: false,
      flipZ: false,
      saving: false,
      editHistory: [],
      editCursor: -1,
      canUndoEdit: false,
      canRedoEdit: false,

      setVisible: (visible) => set({ visible }),
      setOpacity: (opacity) => set({ opacity }),
      setZoomLevel: (zoomLevel) => set({ zoomLevel }),
      setEditing: (editing) => set({ editing }),
      setGizmoMode: (gizmoMode) => set({ gizmoMode }),
      toggleFlipX: () => set((s) => ({ flipX: !s.flipX })),
      toggleFlipZ: () => set((s) => ({ flipZ: !s.flipZ })),
      setSaving: (saving) => set({ saving }),

      pushEditSnapshot: (snap) =>
        set((s) => {
          // Truncate any redo history ahead of cursor, then append
          const history = [...s.editHistory.slice(0, s.editCursor + 1), snap];
          const cursor = history.length - 1;
          return {
            editHistory: history,
            editCursor: cursor,
            canUndoEdit: cursor > 0,
            canRedoEdit: false,
          };
        }),

      undoEdit: () => {
        const { editHistory, editCursor } = get();
        if (editCursor <= 0) return null;
        const newCursor = editCursor - 1;
        set({
          editCursor: newCursor,
          canUndoEdit: newCursor > 0,
          canRedoEdit: true,
        });
        return editHistory[newCursor];
      },

      redoEdit: () => {
        const { editHistory, editCursor } = get();
        if (editCursor >= editHistory.length - 1) return null;
        const newCursor = editCursor + 1;
        set({
          editCursor: newCursor,
          canUndoEdit: true,
          canRedoEdit: newCursor < editHistory.length - 1,
        });
        return editHistory[newCursor];
      },

      clearEditHistory: () =>
        set({ editHistory: [], editCursor: -1, canUndoEdit: false, canRedoEdit: false }),

      _onSave: null,
      _setOnSave: (cb) => set({ _onSave: cb }),
      _onUndo: null,
      _onRedo: null,
      _setUndoRedo: (undo, redo) => set({ _onUndo: undo, _onRedo: redo }),
    }),
    {
      name: 'clap-plugin-base-map',
    },
  ),
);
