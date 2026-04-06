import { create } from 'zustand';
import type { PointInfo, PointInfoPhase } from './point-info-types';

interface PointInfoState {
  phase: PointInfoPhase;
  pickedPoint: PointInfo | null;
  previewPoint: PointInfo | null;

  setPhase: (phase: PointInfoPhase) => void;
  setPickedPoint: (p: PointInfo | null) => void;
  setPreviewPoint: (p: PointInfo | null) => void;
  clear: () => void;
}

export const usePointInfoStore = create<PointInfoState>((set) => ({
  phase: 'idle',
  pickedPoint: null,
  previewPoint: null,

  setPhase: (phase) => set({ phase }),
  setPickedPoint: (pickedPoint) => set({ pickedPoint }),
  setPreviewPoint: (previewPoint) => set({ previewPoint }),
  clear: () => set({ pickedPoint: null, previewPoint: null }),
}));
