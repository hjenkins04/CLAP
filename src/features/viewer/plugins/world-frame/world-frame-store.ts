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

  /** Shared overlay alignment — used by base satellite map + OSM features */
  flipX: boolean;
  flipZ: boolean;
  zOffset: number;
  editingZOffset: boolean;
  pendingZOffset: number;

  setPhase: (phase: WorldFramePhase) => void;
  setMarkersVisible: (visible: boolean) => void;
  toggleFlipX: () => void;
  toggleFlipZ: () => void;
  setFlipX: (flipX: boolean) => void;
  setFlipZ: (flipZ: boolean) => void;
  setZOffset: (offset: number) => void;
  setEditingZOffset: (editing: boolean) => void;
  setPendingZOffset: (offset: number) => void;
  confirmZOffset: () => void;
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
  /** Update anchor1.pc AND recompute transform in one atomic step (for live gizmo dragging). */
  setAnchor1PcLive: (pt: PcPoint) => void;
  /** Auto-confirm the world frame from a known CRS geo-reference point (origin at PC {0,0,0}). */
  autoConfirmFromCrs: (refGeo: GeoPoint) => void;

  /** Whether the user is currently dragging the anchor-point gizmo. */
  editingAnchor: boolean;
  setEditingAnchor: (v: boolean) => void;
  _onSaveAnchor: (() => Promise<void>) | null;
  _setOnSaveAnchor: (cb: (() => Promise<void>) | null) => void;
  _onCancelAnchor: (() => void) | null;
  _setOnCancelAnchor: (cb: (() => void) | null) => void;
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
      flipX: false,
      flipZ: false,
      zOffset: -1,
      editingZOffset: false,
      pendingZOffset: -1,

      setPhase: (phase) => set({ phase }),
      setMarkersVisible: (markersVisible) => set({ markersVisible }),
      toggleFlipX: () => set((s) => ({ flipX: !s.flipX })),
      toggleFlipZ: () => set((s) => ({ flipZ: !s.flipZ })),
      setFlipX: (flipX) => set({ flipX }),
      setFlipZ: (flipZ) => set({ flipZ }),
      setZOffset: (zOffset) => set({ zOffset }),
      setEditingZOffset: (editingZOffset) => set((s) => ({
        editingZOffset,
        pendingZOffset: editingZOffset ? s.zOffset : s.pendingZOffset,
      })),
      setPendingZOffset: (pendingZOffset) => set({ pendingZOffset }),
      confirmZOffset: () => set((s) => ({
        zOffset: s.pendingZOffset,
        editingZOffset: false,
      })),

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
          flipX: false,
          flipZ: false,
          zOffset: -1,
        }),

      recomputeTransform: () => {
        const state = get();
        set({ transform: buildTransform(state) });
      },

      setAnchor1PcLive: (pt: PcPoint) => {
        const { geoPoint1, anchor1, translationOffset } = get();
        if (!geoPoint1 || !anchor1) return;
        // Compensate translationOffset so transform.translation stays constant.
        // transform.translation = anchor1.pc + translationOffset
        // We want: pt + newOffset = anchor1.pc + translationOffset
        // => newOffset = translationOffset + (anchor1.pc - pt)
        const newOffset = {
          x: translationOffset.x + (anchor1.pc.x - pt.x),
          z: translationOffset.z + (anchor1.pc.z - pt.z),
        };
        const newAnchor1 = { geo: geoPoint1, pc: pt };
        const state = { ...get(), anchor1: newAnchor1, translationOffset: newOffset };
        set({ anchor1: newAnchor1, translationOffset: newOffset, transform: buildTransform(state) });
      },

      editingAnchor: false,
      setEditingAnchor: (editingAnchor) => set({ editingAnchor }),
      _onSaveAnchor: null,
      _setOnSaveAnchor: (cb) => set({ _onSaveAnchor: cb }),
      _onCancelAnchor: null,
      _setOnCancelAnchor: (cb) => set({ _onCancelAnchor: cb }),

      autoConfirmFromCrs: (refGeo: GeoPoint) => {
        // The pre-transformed point cloud has its origin at (0,0,0) in Three.js
        // space, which corresponds to refGeo in the real world.
        // East = +X, North = +Z, elevation = +Y — no rotation needed.
        const anchor1: WorldFrameAnchor = { geo: refGeo, pc: { x: 0, y: 0, z: 0 } };
        const transform: WorldFrameTransform = {
          refGeo,
          translation: { x: 0, z: 0 },
          rotation: 0,
        };
        set({
          phase: 'confirmed',
          geoPoint1: refGeo,
          geoPoint2: null,
          anchor1,
          anchor2: null,
          rotationOffset: 0,
          translationOffset: { x: 0, z: 0 },
          transform,
          flipX: false,
          flipZ: false,
        });
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
        flipX: state.flipX,
        flipZ: state.flipZ,
        zOffset: state.zOffset,
      }),
    },
  ),
);
