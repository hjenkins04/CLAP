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
  /** Up to 3 most recently used class IDs, most recent first */
  recentClassIds: number[];

  setPhase: (phase: ReclassifyPhase) => void;
  setSelectedCount: (count: number) => void;
  setDragging: (dragging: boolean) => void;
  setGizmoScreenPos: (pos: { x: number; y: number } | null) => void;
  setApplyFn: (fn: ((classId: number) => void) | null) => void;
  addRecentClass: (id: number) => void;
  reset: () => void;
}

export const useReclassifyStore = create<ReclassifyState>((set) => ({
  phase: 'idle',
  selectedCount: 0,
  isDragging: false,
  gizmoScreenPos: null,
  _applyReclassification: null,
  recentClassIds: [],

  setPhase: (phase) => set({ phase }),
  setSelectedCount: (selectedCount) => set({ selectedCount }),
  setDragging: (isDragging) => set({ isDragging }),
  setGizmoScreenPos: (gizmoScreenPos) => set({ gizmoScreenPos }),
  setApplyFn: (_applyReclassification) => set({ _applyReclassification }),
  addRecentClass: (id) =>
    set((s) => ({
      recentClassIds: [id, ...s.recentClassIds.filter((x) => x !== id)].slice(0, 3),
    })),
  reset: () =>
    set({ phase: 'idle', selectedCount: 0, isDragging: false, gizmoScreenPos: null }),
}));
