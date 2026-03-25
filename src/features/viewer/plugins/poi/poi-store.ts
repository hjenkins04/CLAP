import { create } from 'zustand';

interface PoiPosition {
  x: number;
  y: number;
  z: number;
}

/**
 * POI state machine phases:
 *   idle       – no active POI workflow (POI may or may not exist)
 *   selecting  – user is hovering / picking a point on the cloud
 *   confirming – point placed, gizmo shown, awaiting Enter/Esc
 */
export type PoiPhase = 'idle' | 'selecting' | 'confirming';

interface PoiState {
  /** World-space position of the confirmed POI, or null if none set */
  position: PoiPosition | null;

  /** Current phase of POI placement flow */
  phase: PoiPhase;

  /** Preview position shown during hover (not committed) */
  previewPosition: PoiPosition | null;

  /** Whether the POI marker is visible in the scene */
  markerVisible: boolean;

  setPosition: (x: number, y: number, z: number) => void;
  clearPosition: () => void;
  setPhase: (phase: PoiPhase) => void;
  setPreviewPosition: (pos: PoiPosition | null) => void;
  setMarkerVisible: (visible: boolean) => void;
}

export const usePoiStore = create<PoiState>()((set) => ({
  position: null,
  phase: 'idle',
  previewPosition: null,
  markerVisible: true,

  setPosition: (x, y, z) => set({ position: { x, y, z } }),
  clearPosition: () => set({ position: null }),
  setPhase: (phase) => set({ phase }),
  setPreviewPosition: (previewPosition) => set({ previewPosition }),
  setMarkerVisible: (markerVisible) => set({ markerVisible }),
}));
