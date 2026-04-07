import { create } from 'zustand';

interface DemVisualizationState {
  enabled:   boolean;
  opacity:   number;
  wireframe: boolean;
  /** Vertex sampling step: 1 = full resolution (every DEM cell), 2 = every 2nd, etc. */
  step:      number;

  setEnabled:   (v: boolean) => void;
  setOpacity:   (v: number)  => void;
  setWireframe: (v: boolean) => void;
  setStep:      (v: number)  => void;
}

export const useDemVisualizationStore = create<DemVisualizationState>((set) => ({
  enabled:   false,
  opacity:   0.55,
  wireframe: false,
  step:      1,

  setEnabled:   (enabled)   => set({ enabled }),
  setOpacity:   (opacity)   => set({ opacity: Math.min(1, Math.max(0, opacity)) }),
  setWireframe: (wireframe) => set({ wireframe }),
  setStep:      (step)      => set({ step: Math.max(1, Math.round(step)) }),
}));
