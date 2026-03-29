import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Annotation3D,
  AnnotationLayer3D,
  Annotate3DPhase,
  ObstacleClass,
  NormalFace,
} from './static-obstacle-types';
import { useWorldFrameStore } from '../world-frame';
import { localToGeo } from '../world-frame/geo-utils';

// ── Palette ──────────────────────────────────────────────────────────────────

const LAYER_PALETTE = [
  '#f97316', '#22d3ee', '#a3e635', '#f472b6',
  '#fbbf24', '#60a5fa', '#34d399', '#c084fc',
  '#fb923c', '#e879f9',
];

// ── Pending box (managed by plugin, shared here so overlay can read it) ──────

export interface PendingBox {
  center: { x: number; y: number; z: number };
  halfExtents: { x: number; y: number; z: number };
  frontFace: NormalFace | null;
}

// ── Store ────────────────────────────────────────────────────────────────────

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

  // Pending box (set/updated by plugin)
  pendingBox: PendingBox | null;
  setPendingBox: (box: PendingBox | null) => void;
  setPendingFace: (face: NormalFace) => void;

  // Classification draft (used during 'classifying' phase)
  classifyDraft: ObstacleClass | null;
  attributeDraft: Record<string, string | number | boolean>;
  setClassifyDraft: (cls: ObstacleClass | null) => void;
  setAttributeDraft: (attrs: Record<string, string | number | boolean>) => void;

  // Label counters (persisted)
  labelCounters: Record<string, number>;

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
        })),

      renameLayer: (id, name) =>
        set((s) => ({
          layers: s.layers.map((l) => l.id === id ? { ...l, name } : l),
        })),

      setLayerVisible: (id, visible) =>
        set((s) => ({
          layers: s.layers.map((l) => l.id === id ? { ...l, visible } : l),
        })),

      setActiveLayer: (id) => set({ activeLayerId: id }),

      // ── Annotations ─────────────────────────────────────────────────────
      annotations: [],

      commitAnnotation: () => {
        const state = get();
        const { pendingBox, activeLayerId, classifyDraft, attributeDraft, labelCounters, annotations } = state;
        if (!pendingBox?.frontFace || !activeLayerId || !classifyDraft) return;

        const prefix = classifyDraft.kind === 'TrafficLight' ? 'TL' : 'SG';
        const count = (labelCounters[prefix] ?? 0) + 1;
        const label = `${prefix}-${String(count).padStart(3, '0')}`;

        // Geo centre (if world frame is confirmed)
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
          frontFace: pendingBox.frontFace,
          classification: { ...classifyDraft },
          attributes: { ...attributeDraft },
          geoCenter,
        };

        set({
          annotations: [...annotations, annotation],
          labelCounters: { ...labelCounters, [prefix]: count },
          pendingBox: null,
          classifyDraft: null,
          attributeDraft: {},
          phase: 'drawing-base',
        });
      },

      deleteAnnotation: (id) =>
        set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) })),

      setAnnotationVisible: (id, visible) =>
        set((s) => ({
          annotations: s.annotations.map((a) => a.id === id ? { ...a, visible } : a),
        })),

      // ── Phase ────────────────────────────────────────────────────────────
      phase: 'idle',
      setPhase: (phase) => set({ phase }),

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

      // ── Label counters ────────────────────────────────────────────────────
      labelCounters: {},

      discardPending: () =>
        set({ pendingBox: null, classifyDraft: null, attributeDraft: {}, phase: 'drawing-base' }),
    }),
    {
      name: 'clap-plugin-static-obstacle',
      partialize: (s) => ({
        layers: s.layers,
        annotations: s.annotations,
        labelCounters: s.labelCounters,
      }),
    },
  ),
);
