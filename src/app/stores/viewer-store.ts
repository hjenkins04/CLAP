import { create } from 'zustand';

export type ColorMode = 'rgb' | 'height' | 'classification' | 'intensity';
export type CameraProjection = 'perspective' | 'orthographic';

interface ViewerState {
  pointBudget: number;
  pointSize: number;
  colorMode: ColorMode;
  edlEnabled: boolean;
  edlStrength: number;
  edlRadius: number;
  cameraProjection: CameraProjection;
  loadedFile: string | null;
  numVisiblePoints: number;

  setPointBudget: (budget: number) => void;
  setPointSize: (size: number) => void;
  setColorMode: (mode: ColorMode) => void;
  setEdlEnabled: (enabled: boolean) => void;
  setEdlStrength: (strength: number) => void;
  setEdlRadius: (radius: number) => void;
  setCameraProjection: (projection: CameraProjection) => void;
  setLoadedFile: (file: string | null) => void;
  setNumVisiblePoints: (count: number) => void;
}

export const useViewerStore = create<ViewerState>()((set) => ({
  pointBudget: 2_000_000,
  pointSize: 1.0,
  colorMode: 'rgb',
  edlEnabled: false,
  edlStrength: 0.4,
  edlRadius: 1.4,
  cameraProjection: 'orthographic',
  loadedFile: null,
  numVisiblePoints: 0,

  setPointBudget: (pointBudget) => set({ pointBudget }),
  setPointSize: (pointSize) => set({ pointSize }),
  setColorMode: (colorMode) => set({ colorMode }),
  setEdlEnabled: (edlEnabled) => set({ edlEnabled }),
  setEdlStrength: (edlStrength) => set({ edlStrength }),
  setEdlRadius: (edlRadius) => set({ edlRadius }),
  setCameraProjection: (cameraProjection) => set({ cameraProjection }),
  setLoadedFile: (loadedFile) => set({ loadedFile }),
  setNumVisiblePoints: (numVisiblePoints) => set({ numVisiblePoints }),
}));
