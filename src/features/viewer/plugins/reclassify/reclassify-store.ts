import { create } from 'zustand';

type ReclassifyPhase = 'idle' | 'selecting' | 'selected';

interface ReclassifyState {
  phase: ReclassifyPhase;
  selectedCount: number;
  isDragging: boolean;
  /** Screen-space position (fixed coords) where the gizmo should anchor */
  gizmoScreenPos: { x: number; y: number } | null;
  /** Set by the plugin; called by the gizmo to commit a reclassification */
  _applyReclassification: ((classId: number) => void) | null;

  setPhase: (phase: ReclassifyPhase) => void;
  setSelectedCount: (count: number) => void;
  setDragging: (dragging: boolean) => void;
  setGizmoScreenPos: (pos: { x: number; y: number } | null) => void;
  setApplyFn: (fn: ((classId: number) => void) | null) => void;
  reset: () => void;
}

export const useReclassifyStore = create<ReclassifyState>((set) => ({
  phase: 'idle',
  selectedCount: 0,
  isDragging: false,
  gizmoScreenPos: null,
  _applyReclassification: null,

  setPhase: (phase) => set({ phase }),
  setSelectedCount: (selectedCount) => set({ selectedCount }),
  setDragging: (isDragging) => set({ isDragging }),
  setGizmoScreenPos: (gizmoScreenPos) => set({ gizmoScreenPos }),
  setApplyFn: (_applyReclassification) => set({ _applyReclassification }),
  reset: () =>
    set({ phase: 'idle', selectedCount: 0, isDragging: false, gizmoScreenPos: null }),
}));
