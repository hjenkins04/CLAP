import { create } from 'zustand';

export type PointSelectPhase = 'idle' | 'selecting' | 'selected';

interface PointSelectState {
  phase: PointSelectPhase;
  /** Number of currently selected/highlighted points */
  selectedCount: number;
  /** Whether the user is actively dragging a selection rectangle */
  dragging: boolean;

  setPhase: (phase: PointSelectPhase) => void;
  setSelectedCount: (count: number) => void;
  setDragging: (dragging: boolean) => void;
  reset: () => void;
}

export const usePointSelectStore = create<PointSelectState>()((set) => ({
  phase: 'idle',
  selectedCount: 0,
  dragging: false,

  setPhase: (phase) => set({ phase }),
  setSelectedCount: (selectedCount) => set({ selectedCount }),
  setDragging: (dragging) => set({ dragging }),
  reset: () => set({ phase: 'idle', selectedCount: 0, dragging: false }),
}));
