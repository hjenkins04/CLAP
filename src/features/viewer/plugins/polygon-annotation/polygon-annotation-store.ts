import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  PolygonAnnotation,
  PolygonLayer,
  PolygonClass,
  PolyAnnotPhase,
} from './polygon-annotation-types';
import { useWorldFrameStore } from '../world-frame';
import { localToGeo } from '../world-frame/geo-utils';

// ── Palette ───────────────────────────────────────────────────────────────────

const LAYER_PALETTE = [
  '#22d3ee', '#f97316', '#a3e635', '#f472b6',
  '#fbbf24', '#60a5fa', '#34d399', '#c084fc',
  '#fb923c', '#e879f9',
];

// ── Store ─────────────────────────────────────────────────────────────────────

interface PolyAnnotState {
  // ── Layers ─────────────────────────────────────────────────────────────────
  layers: PolygonLayer[];
  activeLayerId: string | null;
  addLayer: (name: string) => string;
  removeLayer: (id: string) => void;
  renameLayer: (id: string, name: string) => void;
  setLayerVisible: (id: string, visible: boolean) => void;
  setActiveLayer: (id: string) => void;

  // ── Annotations ────────────────────────────────────────────────────────────
  annotations: PolygonAnnotation[];
  commitPolygon: () => void;
  deleteAnnotation: (id: string) => void;
  setAnnotationVisible: (id: string, visible: boolean) => void;
  updateVertex: (annId: string, vertIdx: number, pos: { x: number; y: number; z: number }) => void;
  insertVertex: (annId: string, afterEdgeIdx: number, pos: { x: number; y: number; z: number }) => void;
  setAnnotationVertices: (annId: string, vertices: Array<{ x: number; y: number; z: number }>) => void;

  // ── Edit state (which annotation is being edited) ─────────────────────────
  editingAnnotationId: string | null;
  setEditingAnnotationId: (id: string | null) => void;

  // ── Phase ──────────────────────────────────────────────────────────────────
  phase: PolyAnnotPhase;
  setPhase: (p: PolyAnnotPhase) => void;

  // ── Draft vertices (in-progress polygon while drawing) ────────────────────
  draftVertices: Array<{ x: number; y: number; z: number }>;
  setDraftVertices: (verts: Array<{ x: number; y: number; z: number }>) => void;
  clearDraft: () => void;

  // ── Classification draft ───────────────────────────────────────────────────
  classifyDraft: PolygonClass | null;
  attributeDraft: Record<string, string | number | boolean>;
  setClassifyDraft: (cls: PolygonClass | null) => void;
  setAttributeDraft: (attrs: Record<string, string | number | boolean>) => void;

  // ── Label counters (persisted) ─────────────────────────────────────────────
  labelCounters: Record<string, number>;

  // ── Dirty tracking ─────────────────────────────────────────────────────────
  isDirty: boolean;
  markClean: () => void;

  discardPending: () => void;
}

export const usePolyAnnotStore = create<PolyAnnotState>()(
  persist(
    (set, get) => ({
      // ── Layers ──────────────────────────────────────────────────────────────
      layers: [],
      activeLayerId: null,

      addLayer: (name) => {
        const id = `poly-layer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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

      // ── Annotations ─────────────────────────────────────────────────────────
      annotations: [],

      commitPolygon: () => {
        const {
          draftVertices,
          activeLayerId,
          classifyDraft,
          attributeDraft,
          labelCounters,
          annotations,
        } = get();

        if (draftVertices.length < 3 || !activeLayerId || !classifyDraft) return;

        const prefix = 'PL';
        const count = (labelCounters[prefix] ?? 0) + 1;
        const label = `${prefix}-${String(count).padStart(3, '0')}`;

        // Compute centroid for geo lookup
        const cx = draftVertices.reduce((s, v) => s + v.x, 0) / draftVertices.length;
        const cz = draftVertices.reduce((s, v) => s + v.z, 0) / draftVertices.length;
        const cy = draftVertices.reduce((s, v) => s + v.y, 0) / draftVertices.length;

        let geoCentroid: PolygonAnnotation['geoCentroid'];
        const { transform } = useWorldFrameStore.getState();
        if (transform) {
          const geo = localToGeo({ x: cx, z: cz }, transform);
          geoCentroid = { lat: geo.lat, lng: geo.lng, elevation: cy };
        }

        const annotation: PolygonAnnotation = {
          id: `poly-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          layerId: activeLayerId,
          label,
          visible: true,
          vertices: draftVertices.map((v) => ({ ...v })),
          classification: classifyDraft,
          attributes: { ...attributeDraft },
          geoCentroid,
        };

        set({
          annotations: [...annotations, annotation],
          labelCounters: { ...labelCounters, [prefix]: count },
          draftVertices: [],
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

      updateVertex: (annId, vertIdx, pos) =>
        set((s) => ({
          annotations: s.annotations.map((a) => {
            if (a.id !== annId) return a;
            const vertices = [...a.vertices];
            vertices[vertIdx] = { ...pos };
            return { ...a, vertices };
          }),
          isDirty: true,
        })),

      insertVertex: (annId, afterEdgeIdx, pos) =>
        set((s) => ({
          annotations: s.annotations.map((a) => {
            if (a.id !== annId) return a;
            const vertices = [...a.vertices];
            vertices.splice(afterEdgeIdx + 1, 0, { ...pos });
            return { ...a, vertices };
          }),
          isDirty: true,
        })),

      setAnnotationVertices: (annId, vertices) =>
        set((s) => ({
          annotations: s.annotations.map((a) =>
            a.id !== annId ? a : { ...a, vertices: vertices.map((v) => ({ ...v })) },
          ),
          isDirty: true,
        })),

      editingAnnotationId: null,
      setEditingAnnotationId: (editingAnnotationId) => set({ editingAnnotationId }),

      // ── Phase ────────────────────────────────────────────────────────────────
      phase: 'idle',
      setPhase: (phase) => set({ phase }),

      // ── Draft vertices ───────────────────────────────────────────────────────
      draftVertices: [],
      setDraftVertices: (draftVertices) => set({ draftVertices }),
      clearDraft: () => set({ draftVertices: [] }),

      // ── Classification draft ─────────────────────────────────────────────────
      classifyDraft: null,
      attributeDraft: {},
      setClassifyDraft: (classifyDraft) => set({ classifyDraft }),
      setAttributeDraft: (attributeDraft) => set({ attributeDraft }),

      // ── Label counters ────────────────────────────────────────────────────────
      labelCounters: {},

      // ── Dirty tracking ────────────────────────────────────────────────────────
      isDirty: false,
      markClean: () => set({ isDirty: false }),

      discardPending: () =>
        set({
          draftVertices: [],
          classifyDraft: null,
          attributeDraft: {},
          phase: 'drawing',
        }),
    }),
    {
      name: 'clap-plugin-polygon-annotation',
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
