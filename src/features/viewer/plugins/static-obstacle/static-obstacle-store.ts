import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Annotation3D,
  AnnotationLayer3D,
  Annotate3DPhase,
  ObstacleClass,
  NormalFace,
} from './static-obstacle-types';
import type { SelectSubMode, TransformMode } from '../../modules/shape-editor';
import { useWorldFrameStore } from '../world-frame';
import { localToGeo } from '../world-frame/geo-utils';

// ── Palette ──────────────────────────────────────────────────────────────────

const LAYER_PALETTE = [
  '#f97316', '#22d3ee', '#a3e635', '#f472b6',
  '#fbbf24', '#60a5fa', '#34d399', '#c084fc',
  '#fb923c', '#e879f9',
];

// ── Pending box ───────────────────────────────────────────────────────────────

export interface PendingBox {
  center: { x: number; y: number; z: number };
  halfExtents: { x: number; y: number; z: number };
  rotationY: number;
  frontFace: NormalFace | null;
}

// ── Store ────────────────────────────────────────────────────────────────────

export type ObstacleEditSubMode = SelectSubMode | TransformMode;

interface StaticObstacleState {
  // Layers
  layers: AnnotationLayer3D[];
  activeLayerId: string | null;
  addLayer: (name: string) => string;
  removeLayer: (id: string) => void;
  renameLayer: (id: string, name: string) => void;
  setLayerVisible: (id: string, visible: boolean) => void;
  setActiveLayer: (id: string) => void;

  // Annotations
  annotations: Annotation3D[];
  commitAnnotation: () => void;
  deleteAnnotation: (id: string) => void;
  setAnnotationVisible: (id: string, visible: boolean) => void;

  // Phase
  phase: Annotate3DPhase;
  setPhase: (p: Annotate3DPhase) => void;

  // Pending shape (engine shape ID during draw/edit)
  pendingShapeId: string | null;
  setPendingShapeId: (id: string | null) => void;

  // Pending box (set by plugin when entering picking-face / classifying)
  pendingBox: PendingBox | null;
  setPendingBox: (box: PendingBox | null) => void;
  setPendingFace: (face: NormalFace) => void;

  // Classification draft
  classifyDraft: ObstacleClass | null;
  attributeDraft: Record<string, string | number | boolean>;
  setClassifyDraft: (cls: ObstacleClass | null) => void;
  setAttributeDraft: (attrs: Record<string, string | number | boolean>) => void;

  // Edit sub-mode (during 'editing' phase)
  editSubMode: ObstacleEditSubMode;
  setEditSubMode: (mode: ObstacleEditSubMode) => void;

  // Label counters (persisted)
  labelCounters: Record<string, number>;

  // Dirty tracking
  isDirty: boolean;
  markClean: () => void;

  discardPending: () => void;
}

export const useStaticObstacleStore = create<StaticObstacleState>()(
  persist(
    (set, get) => ({
      // ── Layers ──────────────────────────────────────────────────────────
      layers: [],
      activeLayerId: null,

      addLayer: (name) => {
        const id = `layer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const color = LAYER_PALETTE[get().layers.length % LAYER_PALETTE.length];
        set((s) => ({
          layers: [...s.layers, { id, name, visible: true, color }],
          activeLayerId: s.activeLayerId ?? id,
          isDirty: true,
        }));
        return id;
      },

      removeLayer: (id) =>
        set((s) => ({
          layers: s.layers.filter((l) => l.id !== id),
          annotations: s.annotations.filter((a) => a.layerId !== id),
          activeLayerId: s.activeLayerId === id
            ? (s.layers.find((l) => l.id !== id)?.id ?? null)
            : s.activeLayerId,
          isDirty: true,
        })),

      renameLayer: (id, name) =>
        set((s) => ({
          layers: s.layers.map((l) => l.id === id ? { ...l, name } : l),
          isDirty: true,
        })),

      setLayerVisible: (id, visible) =>
        set((s) => ({
          layers: s.layers.map((l) => l.id === id ? { ...l, visible } : l),
          isDirty: true,
        })),

      setActiveLayer: (id) => set({ activeLayerId: id }),

      // ── Annotations ─────────────────────────────────────────────────────
      annotations: [],

      commitAnnotation: () => {
        const state = get();
        const {
          pendingBox,
          activeLayerId,
          classifyDraft,
          attributeDraft,
          labelCounters,
          annotations,
        } = state;
        if (!pendingBox?.frontFace || !activeLayerId || !classifyDraft) return;

        const prefix = classifyDraft.kind === 'TrafficLight' ? 'TL' : 'SG';
        const count = (labelCounters[prefix] ?? 0) + 1;
        const label = `${prefix}-${String(count).padStart(3, '0')}`;

        let geoCenter: Annotation3D['geoCenter'];
        const { transform } = useWorldFrameStore.getState();
        if (transform) {
          const geo = localToGeo({ x: pendingBox.center.x, z: pendingBox.center.z }, transform);
          geoCenter = { lat: geo.lat, lng: geo.lng, elevation: pendingBox.center.y };
        }

        const annotation: Annotation3D = {
          id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          layerId: activeLayerId,
          label,
          visible: true,
          center: { ...pendingBox.center },
          halfExtents: { ...pendingBox.halfExtents },
          rotationY: pendingBox.rotationY,
          frontFace: pendingBox.frontFace,
          classification: { ...classifyDraft },
          attributes: { ...attributeDraft },
          geoCenter,
        };

        set({
          annotations: [...annotations, annotation],
          labelCounters: { ...labelCounters, [prefix]: count },
          pendingBox: null,
          pendingShapeId: null,
          classifyDraft: null,
          attributeDraft: {},
          phase: 'drawing',
          isDirty: true,
        });
      },

      deleteAnnotation: (id) =>
        set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id), isDirty: true })),

      setAnnotationVisible: (id, visible) =>
        set((s) => ({
          annotations: s.annotations.map((a) => a.id === id ? { ...a, visible } : a),
          isDirty: true,
        })),

      // ── Phase ────────────────────────────────────────────────────────────
      phase: 'idle',
      setPhase: (phase) => set({ phase }),

      // ── Pending shape ────────────────────────────────────────────────────
      pendingShapeId: null,
      setPendingShapeId: (pendingShapeId) => set({ pendingShapeId }),

      // ── Pending box ──────────────────────────────────────────────────────
      pendingBox: null,
      setPendingBox: (pendingBox) => set({ pendingBox }),
      setPendingFace: (face) =>
        set((s) => ({
          pendingBox: s.pendingBox ? { ...s.pendingBox, frontFace: face } : null,
        })),

      // ── Classification draft ─────────────────────────────────────────────
      classifyDraft: null,
      attributeDraft: {},
      setClassifyDraft: (classifyDraft) => set({ classifyDraft }),
      setAttributeDraft: (attributeDraft) => set({ attributeDraft }),

      // ── Edit sub-mode ────────────────────────────────────────────────────
      editSubMode: 'shape' as ObstacleEditSubMode,
      setEditSubMode: (editSubMode) => set({ editSubMode }),

      // ── Label counters ────────────────────────────────────────────────────
      labelCounters: {},

      // ── Dirty tracking ────────────────────────────────────────────────────
      isDirty: false,
      markClean: () => set({ isDirty: false }),

      discardPending: () =>
        set({
          pendingBox: null,
          pendingShapeId: null,
          classifyDraft: null,
          attributeDraft: {},
          phase: 'drawing',
        }),
    }),
    {
      name: 'clap-plugin-static-obstacle',
      // Annotations are loaded from geometry-annotations.bin when a project is
      // opened — persisting them to localStorage causes stale data to appear
      // before the user selects a project.  Version bump clears any previously
      // stored annotation data from localStorage.
      version: 1,
      migrate: () => ({}),
      partialize: () => ({}),
    },
  ),
);
