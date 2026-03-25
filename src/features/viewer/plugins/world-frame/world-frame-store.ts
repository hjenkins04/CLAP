import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  computeWorldFrameTransform,
  type GeoPoint,
  type WorldFrameTransform,
} from './geo-utils';

// ── Types ────────────────────────────────────────────────────────────

export interface PcPoint {
  x: number;
  y: number;
  z: number;
}

export interface WorldFrameAnchor {
  geo: GeoPoint;
  pc: PcPoint;
}

export type WorldFramePhase =
  | 'idle'
  | 'map-pick-first'
  | 'map-pick-second'
  | 'pc-pick-first'
  | 'pc-pick-second'
  | 'preview'
  | 'confirmed';

// ── Store ────────────────────────────────────────────────────────────

interface WorldFrameState {
  phase: WorldFramePhase;
  geoPoint1: GeoPoint | null;
  geoPoint2: GeoPoint | null;
  anchor1: WorldFrameAnchor | null;
  anchor2: WorldFrameAnchor | null;
  previewPcPoint: PcPoint | null;
  rotationOffset: number;
  translationOffset: { x: number; z: number };
  transform: WorldFrameTransform | null;
  markersVisible: boolean;

  setPhase: (phase: WorldFramePhase) => void;
  setMarkersVisible: (visible: boolean) => void;
  setGeoPoint1: (pt: GeoPoint) => void;
  setGeoPoint2: (pt: GeoPoint | null) => void;
  setAnchor1Pc: (pt: PcPoint) => void;
  setAnchor2Pc: (pt: PcPoint) => void;
  setPreviewPcPoint: (pt: PcPoint | null) => void;
  setRotationOffset: (rad: number) => void;
  setTranslationOffset: (x: number, z: number) => void;
  confirmWorldFrame: () => void;
  resetWorldFrame: () => void;
  recomputeTransform: () => void;
}

/**
 * Y-up (Three.js standard, enforced by the editor's saved GlobalTransform).
 * Ground plane is XZ. Picked world-space points: pc.x = east, pc.z = north.
 */
function buildTransform(state: {
  anchor1: WorldFrameAnchor | null;
  anchor2: WorldFrameAnchor | null;
  rotationOffset: number;
  translationOffset: { x: number; z: number };
}): WorldFrameTransform | null {
  if (!state.anchor1) return null;
  return computeWorldFrameTransform(
    { geo: state.anchor1.geo, pc: { x: state.anchor1.pc.x, z: state.anchor1.pc.z } },
    state.anchor2
      ? { geo: state.anchor2.geo, pc: { x: state.anchor2.pc.x, z: state.anchor2.pc.z } }
      : null,
    state.rotationOffset,
    state.translationOffset,
  );
}

export const useWorldFrameStore = create<WorldFrameState>()(
  persist(
    (set, get) => ({
      phase: 'idle',
      geoPoint1: null,
      geoPoint2: null,
      anchor1: null,
      anchor2: null,
      previewPcPoint: null,
      rotationOffset: 0,
      translationOffset: { x: 0, z: 0 },
      transform: null,
      markersVisible: true,

      setPhase: (phase) => set({ phase }),
      setMarkersVisible: (markersVisible) => set({ markersVisible }),

      setGeoPoint1: (pt) => set({ geoPoint1: pt }),
      setGeoPoint2: (pt) => set({ geoPoint2: pt }),

      setAnchor1Pc: (pt) => {
        const { geoPoint1 } = get();
        if (!geoPoint1) return;
        set({ anchor1: { geo: geoPoint1, pc: pt } });
      },

      setAnchor2Pc: (pt) => {
        const { geoPoint2 } = get();
        if (!geoPoint2) return;
        set({ anchor2: { geo: geoPoint2, pc: pt } });
      },

      setPreviewPcPoint: (previewPcPoint) => set({ previewPcPoint }),

      setRotationOffset: (rad) => {
        set({ rotationOffset: rad });
        const state = get();
        set({ transform: buildTransform(state) });
      },

      setTranslationOffset: (x, z) => {
        set({ translationOffset: { x, z } });
        const state = get();
        set({ transform: buildTransform(state) });
      },

      confirmWorldFrame: () => {
        const state = get();
        const transform = buildTransform(state);
        set({ phase: 'confirmed', transform });
      },

      resetWorldFrame: () =>
        set({
          phase: 'idle',
          geoPoint1: null,
          geoPoint2: null,
          anchor1: null,
          anchor2: null,
          previewPcPoint: null,
          rotationOffset: 0,
          translationOffset: { x: 0, z: 0 },
          transform: null,
        }),

      recomputeTransform: () => {
        const state = get();
        set({ transform: buildTransform(state) });
      },
    }),
    {
      name: 'clap-plugin-world-frame',
      version: 2,
      partialize: (state) => ({
        phase: state.phase === 'confirmed' ? 'confirmed' : 'idle',
        anchor1: state.anchor1,
        anchor2: state.anchor2,
        rotationOffset: state.rotationOffset,
        translationOffset: state.translationOffset,
        transform: state.transform,
      }),
    },
  ),
);
