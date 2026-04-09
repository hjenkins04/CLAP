import { create } from 'zustand';

type ReclassifyPhase = 'idle' | 'selecting' | 'selected';
export type ReclassifyTool = 'drag-select' | 'polygon';

interface ReclassifyState {
  phase: ReclassifyPhase;
  activeTool: ReclassifyTool;
  selectedCount: number;
  isDragging: boolean;
  /** Screen-space position (fixed coords) where the gizmo should anchor */
  gizmoScreenPos: { x: number; y: number } | null;
  /** Set by the plugin; called by the gizmo to commit a reclassification */
  _applyReclassification: ((classId: number) => void) | null;
  /** Up to 3 most recently used class IDs, most recent first */
  recentClassIds: number[];

  setPhase: (phase: ReclassifyPhase) => void;
  setActiveTool: (tool: ReclassifyTool) => void;
  setSelectedCount: (count: number) => void;
  setDragging: (dragging: boolean) => void;
  setGizmoScreenPos: (pos: { x: number; y: number } | null) => void;
  setApplyFn: (fn: ((classId: number) => void) | null) => void;
  addRecentClass: (id: number) => void;
  reset: () => void;
}

export const useReclassifyStore = create<ReclassifyState>((set) => ({
  phase: 'idle',
  activeTool: 'drag-select',
  selectedCount: 0,
  isDragging: false,
  gizmoScreenPos: null,
  _applyReclassification: null,
  recentClassIds: [],

  setPhase: (phase) => set({ phase }),
  setActiveTool: (activeTool) => set({ activeTool }),
  setSelectedCount: (selectedCount) => set({ selectedCount }),
  setDragging: (isDragging) => set({ isDragging }),
  setGizmoScreenPos: (gizmoScreenPos) => set({ gizmoScreenPos }),
  setApplyFn: (_applyReclassification) => set({ _applyReclassification }),
  addRecentClass: (id) =>
    set((s) => ({
      recentClassIds: [id, ...s.recentClassIds.filter((x) => x !== id)].slice(0, 3),
    })),
  reset: () =>
    set({ phase: 'idle', activeTool: 'drag-select', selectedCount: 0, isDragging: false, gizmoScreenPos: null }),
}));
