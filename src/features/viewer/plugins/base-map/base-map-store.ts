import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type BaseMapGizmoMode = 'translate' | 'rotate';

interface BaseMapState {
  visible: boolean;
  opacity: number;
  zoomLevel: number;
  editing: boolean;
  gizmoMode: BaseMapGizmoMode;
  flipX: boolean;
  flipZ: boolean;
  saving: boolean;

  setVisible: (v: boolean) => void;
  setOpacity: (o: number) => void;
  setZoomLevel: (z: number) => void;
  setEditing: (editing: boolean) => void;
  setGizmoMode: (mode: BaseMapGizmoMode) => void;
  toggleFlipX: () => void;
  toggleFlipZ: () => void;
  setSaving: (saving: boolean) => void;

  /** Callback set by the plugin for the panel to trigger save */
  _onSave: (() => Promise<void>) | null;
  _setOnSave: (cb: (() => Promise<void>) | null) => void;
}

export const useBaseMapStore = create<BaseMapState>()(
  persist(
    (set) => ({
      visible: true,
      opacity: 0.7,
      zoomLevel: 18,
      editing: false,
      gizmoMode: 'translate',
      flipX: false,
      flipZ: false,
      saving: false,

      setVisible: (visible) => set({ visible }),
      setOpacity: (opacity) => set({ opacity }),
      setZoomLevel: (zoomLevel) => set({ zoomLevel }),
      setEditing: (editing) => set({ editing }),
      setGizmoMode: (gizmoMode) => set({ gizmoMode }),
      toggleFlipX: () => set((s) => ({ flipX: !s.flipX })),
      toggleFlipZ: () => set((s) => ({ flipZ: !s.flipZ })),
      setSaving: (saving) => set({ saving }),
      _onSave: null,
      _setOnSave: (cb) => set({ _onSave: cb }),
    }),
    {
      name: 'clap-plugin-base-map',
    },
  ),
);
