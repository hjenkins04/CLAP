import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  RoadExtractionPhase,
  ExtractionParams,
  RoadPrior,
  RoadBoundary,
  Vec3,
  ExtractionProgress,
} from './road-extraction-types';
import { DEFAULT_PARAMS } from './road-extraction-types';

// ── Store shape ───────────────────────────────────────────────────────────────

interface RoadExtractionState {
  // ── Phase ─────────────────────────────────────────────────────────────────
  phase: RoadExtractionPhase;
  setPhase: (p: RoadExtractionPhase) => void;

  // ── Centreline (drawn by user) ────────────────────────────────────────────
  /** Points of the currently drawn centreline (world space). */
  centerlinePoints: Vec3[];
  setCenterlinePoints: (pts: Vec3[]) => void;
  clearCenterline: () => void;

  // ── Extraction params ─────────────────────────────────────────────────────
  params: ExtractionParams;
  setParams: (p: Partial<ExtractionParams>) => void;
  resetParams: () => void;

  // ── Extraction progress ───────────────────────────────────────────────────
  progress: ExtractionProgress | null;
  setProgress: (p: ExtractionProgress | null) => void;

  // ── Live result (reviewing / editing-boundary) ────────────────────────────
  /** Smoothed left boundary points from the most recent extraction run. */
  pendingLeft:  Vec3[];
  /** Smoothed right boundary points from the most recent extraction run. */
  pendingRight: Vec3[];
  /** Per-section curb flags for the left side (same length as pendingLeft). */
  pendingLeftCurb:  boolean[];
  /** Per-section curb flags for the right side. */
  pendingRightCurb: boolean[];
  setPendingResult: (
    left: Vec3[],
    right: Vec3[],
    leftCurb: boolean[],
    rightCurb: boolean[],
  ) => void;
  clearPending: () => void;

  /** Update a single boundary vertex (used during editing-boundary). */
  updatePendingVertex: (side: 'left' | 'right', index: number, pos: Vec3) => void;

  // ── Prior information ─────────────────────────────────────────────────────
  prior: RoadPrior | null;
  setPrior: (p: RoadPrior | null) => void;

  // ── Committed results ─────────────────────────────────────────────────────
  boundaries: RoadBoundary[];
  boundaryCounter: number;
  commitPending: () => void;
  deleteBoundary: (id: string) => void;
  setBoundaryVisible: (id: string, visible: boolean) => void;

  // ── Derived helpers ───────────────────────────────────────────────────────
  /** True when there is a valid pending result with at least 2 points on each side. */
  hasPendingResult: () => boolean;
}

// ── Store implementation ──────────────────────────────────────────────────────

export const useRoadExtractionStore = create<RoadExtractionState>()(
  persist(
    (set, get) => ({
      // ── Phase ──────────────────────────────────────────────────────────────
      phase: 'idle',
      setPhase: (phase) => set({ phase }),

      // ── Centreline ─────────────────────────────────────────────────────────
      centerlinePoints: [],
      setCenterlinePoints: (centerlinePoints) => set({ centerlinePoints }),
      clearCenterline: () => set({ centerlinePoints: [] }),

      // ── Params ─────────────────────────────────────────────────────────────
      params: { ...DEFAULT_PARAMS },
      setParams: (partial) =>
        set((s) => ({ params: { ...s.params, ...partial } })),
      resetParams: () => set({ params: { ...DEFAULT_PARAMS } }),

      // ── Progress ───────────────────────────────────────────────────────────
      progress: null,
      setProgress: (progress) => set({ progress }),

      // ── Pending result ─────────────────────────────────────────────────────
      pendingLeft:      [],
      pendingRight:     [],
      pendingLeftCurb:  [],
      pendingRightCurb: [],

      setPendingResult: (left, right, leftCurb, rightCurb) =>
        set({
          pendingLeft:      left,
          pendingRight:     right,
          pendingLeftCurb:  leftCurb,
          pendingRightCurb: rightCurb,
        }),

      clearPending: () =>
        set({
          pendingLeft:      [],
          pendingRight:     [],
          pendingLeftCurb:  [],
          pendingRightCurb: [],
        }),

      updatePendingVertex: (side, index, pos) =>
        set((s) => {
          if (side === 'left') {
            const arr = [...s.pendingLeft];
            arr[index] = pos;
            return { pendingLeft: arr };
          } else {
            const arr = [...s.pendingRight];
            arr[index] = pos;
            return { pendingRight: arr };
          }
        }),

      // ── Prior ──────────────────────────────────────────────────────────────
      prior: null,
      setPrior: (prior) => set({ prior }),

      // ── Committed results ──────────────────────────────────────────────────
      boundaries: [],
      boundaryCounter: 0,

      commitPending: () => {
        const s = get();
        if (s.pendingLeft.length < 2 || s.pendingRight.length < 2) return;

        const count = s.boundaryCounter + 1;
        const boundary: RoadBoundary = {
          id: `road-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          label: `Road ${count}`,
          centerlinePoints: [...s.centerlinePoints],
          leftPoints:  [...s.pendingLeft],
          rightPoints: [...s.pendingRight],
          prior: s.prior ?? computePriorFromResult(
            s.pendingLeft,
            s.pendingRight,
            s.pendingLeftCurb,
            s.pendingRightCurb,
          ),
          params: { ...s.params },
          createdAt: Date.now(),
          visible: true,
        };

        // Derive a new prior from this accepted chunk
        const newPrior = computePriorFromResult(
          s.pendingLeft,
          s.pendingRight,
          s.pendingLeftCurb,
          s.pendingRightCurb,
        );

        set({
          boundaries: [...s.boundaries, boundary],
          boundaryCounter: count,
          prior: newPrior,
          pendingLeft:      [],
          pendingRight:     [],
          pendingLeftCurb:  [],
          pendingRightCurb: [],
          centerlinePoints: [],
          phase: 'committed',
        });
      },

      deleteBoundary: (id) =>
        set((s) => ({ boundaries: s.boundaries.filter((b) => b.id !== id) })),

      setBoundaryVisible: (id, visible) =>
        set((s) => ({
          boundaries: s.boundaries.map((b) =>
            b.id === id ? { ...b, visible } : b,
          ),
        })),

      // ── Derived ────────────────────────────────────────────────────────────
      hasPendingResult: () => {
        const s = get();
        return s.pendingLeft.length >= 2 && s.pendingRight.length >= 2;
      },
    }),
    {
      name: 'clap-plugin-road-extraction',
      partialize: (s) => ({
        boundaries:      s.boundaries,
        boundaryCounter: s.boundaryCounter,
        prior:           s.prior,
        params:          s.params,
      }),
    },
  ),
);

// ── Helper: derive prior from an accepted result ──────────────────────────────

function computePriorFromResult(
  leftPts:  Vec3[],
  rightPts: Vec3[],
  leftCurb:  boolean[],
  rightCurb: boolean[],
): RoadPrior {
  // Average half-widths (approximate — we only have world points, not lateral distances,
  // so we use the raw point count as a proxy via the centreline midpoint)
  const leftCount  = leftPts.length;
  const rightCount = rightPts.length;
  const allPts     = [...leftPts, ...rightPts];
  const n          = allPts.length;

  // We don't have raw intensities at this point, so set a neutral prior.
  // The analyzer will update this in future once we expose intensity stats.
  const halfWidthLeft  = leftCount  > 0 ? 5 : 4;  // rough default
  const halfWidthRight = rightCount > 0 ? 5 : 4;

  const curbCount = leftCurb.filter(Boolean).length + rightCurb.filter(Boolean).length;
  const hasCurbs  = curbCount > (leftCurb.length + rightCurb.length) * 0.5;

  return {
    intensityMean:  128,  // neutral — updated by analyzer on next run
    intensityStd:   20,
    halfWidthLeft,
    halfWidthRight,
    hasCurbs,
    curbHeightMean: 0.12,
  };
}

// Re-export for convenience
export type { RoadExtractionPhase };
