import { create } from 'zustand';
import type { TrajectoryData, ScanFilterPhase } from './scan-filter-types';

interface ScanFilterState {
  phase: ScanFilterPhase;

  /** Loaded from trajectory.json; null until a point cloud with trajectory data is loaded. */
  trajectoryData: TrajectoryData | null;

  /** Scan IDs directly selected by the user (sorted ascending). */
  selectedScanIds: number[];

  /** Extend effective range by this many scans before the selection minimum (0-100). */
  windowBefore: number;

  /** Extend effective range by this many scans after the selection maximum (0-100). */
  windowAfter: number;

  /** Whether the trajectory point cloud is visible in the scene. */
  trajectoryVisible: boolean;

  /** Whether the scan_id filter is currently applied to the point cloud. */
  filterEnabled: boolean;

  /** Whether the filter EXCLUDES the selected range (true) or INCLUDES it (false). */
  filterMode: 'include' | 'exclude';

  /**
   * In exclude mode the shader hides [excludeRangeMin, excludeRangeMax].
   * These are set to the effective range captured at the moment of inversion so
   * that the complement IDs in selectedScanIds can be shown on the trajectory
   * while the correct (original) range is passed to the shader.
   */
  excludeRangeMin: number;
  excludeRangeMax: number;

  // ── Computed (derived, kept in sync) ───────────────────────────────────────
  effectiveScanIdMin: number;
  effectiveScanIdMax: number;

  // ── Actions ────────────────────────────────────────────────────────────────
  setTrajectoryData: (data: TrajectoryData | null) => void;
  setPhase: (phase: ScanFilterPhase) => void;
  setSelectedScanIds: (ids: number[]) => void;
  toggleScanId: (id: number) => void;
  setWindowBefore: (n: number) => void;
  setWindowAfter: (n: number) => void;
  setTrajectoryVisible: (v: boolean) => void;
  setFilterEnabled: (enabled: boolean) => void;
  setFilterMode: (mode: 'include' | 'exclude') => void;
  setExcludeRange: (min: number, max: number) => void;
  /** Atomically flip include↔exclude so subscribers see one consistent state. */
  invertSelection: () => void;
  /** Step the single selected scan by +1 or -1. No-op if not in single-scan mode. */
  stepScan: (delta: number) => void;
  resetToIdle: () => void;
}

function computeEffective(
  selected: number[],
  windowBefore: number,
  windowAfter: number,
  data: TrajectoryData | null,
): { min: number; max: number } {
  if (selected.length === 0 || !data) {
    return { min: 0, max: data?.scanIdRange[1] ?? 0 };
  }
  const selMin = selected[0];
  const selMax = selected[selected.length - 1];
  const [globalMin, globalMax] = data.scanIdRange;
  return {
    min: Math.max(globalMin, selMin - windowBefore),
    max: Math.min(globalMax, selMax + windowAfter),
  };
}

export const useScanFilterStore = create<ScanFilterState>((set, get) => ({
  phase: 'idle',
  trajectoryData: null,
  selectedScanIds: [],
  windowBefore: 0,
  windowAfter: 0,
  trajectoryVisible: false,
  filterEnabled: false,
  filterMode: 'include',
  excludeRangeMin: 0,
  excludeRangeMax: 0,
  effectiveScanIdMin: 0,
  effectiveScanIdMax: 0,

  setTrajectoryData: (data) =>
    set((s) => {
      const eff = computeEffective(s.selectedScanIds, s.windowBefore, s.windowAfter, data);
      return { trajectoryData: data, effectiveScanIdMin: eff.min, effectiveScanIdMax: eff.max };
    }),

  setPhase: (phase) => set({ phase }),

  setSelectedScanIds: (ids) =>
    set((s) => {
      const sorted = [...ids].sort((a, b) => a - b);
      const eff = computeEffective(sorted, s.windowBefore, s.windowAfter, s.trajectoryData);
      return { selectedScanIds: sorted, effectiveScanIdMin: eff.min, effectiveScanIdMax: eff.max };
    }),

  toggleScanId: (id) => {
    const { selectedScanIds, windowBefore, windowAfter, trajectoryData } = get();
    const idx = selectedScanIds.indexOf(id);
    const next = idx >= 0
      ? selectedScanIds.filter((x) => x !== id)
      : [...selectedScanIds, id].sort((a, b) => a - b);
    const eff = computeEffective(next, windowBefore, windowAfter, trajectoryData);
    set({ selectedScanIds: next, effectiveScanIdMin: eff.min, effectiveScanIdMax: eff.max });
  },

  setWindowBefore: (n) =>
    set((s) => {
      const eff = computeEffective(s.selectedScanIds, n, s.windowAfter, s.trajectoryData);
      return { windowBefore: n, effectiveScanIdMin: eff.min, effectiveScanIdMax: eff.max };
    }),

  setWindowAfter: (n) =>
    set((s) => {
      const eff = computeEffective(s.selectedScanIds, s.windowBefore, n, s.trajectoryData);
      return { windowAfter: n, effectiveScanIdMin: eff.min, effectiveScanIdMax: eff.max };
    }),

  setTrajectoryVisible: (v) => set({ trajectoryVisible: v }),

  setFilterEnabled: (enabled) => set({ filterEnabled: enabled }),

  setFilterMode: (mode) => set({ filterMode: mode }),

  setExcludeRange: (min, max) => set({ excludeRangeMin: min, excludeRangeMax: max }),

  invertSelection: () => set((s) => {
    if (!s.trajectoryData) return {};
    const [gMin, gMax] = s.trajectoryData.scanIdRange;
    if (s.filterMode === 'include') {
      const exMin = s.effectiveScanIdMin;
      const exMax = s.effectiveScanIdMax;
      const selectedSet = new Set(s.selectedScanIds);
      const inverted: number[] = [];
      for (let i = gMin; i <= gMax; i++) {
        if (!selectedSet.has(i)) inverted.push(i);
      }
      const eff = computeEffective(inverted, s.windowBefore, s.windowAfter, s.trajectoryData);
      return {
        filterMode: 'exclude' as const,
        excludeRangeMin: exMin,
        excludeRangeMax: exMax,
        selectedScanIds: inverted,
        effectiveScanIdMin: eff.min,
        effectiveScanIdMax: eff.max,
      };
    } else {
      const restored: number[] = [];
      for (let i = s.excludeRangeMin; i <= s.excludeRangeMax; i++) restored.push(i);
      const eff = computeEffective(restored, s.windowBefore, s.windowAfter, s.trajectoryData);
      return {
        filterMode: 'include' as const,
        selectedScanIds: restored,
        effectiveScanIdMin: eff.min,
        effectiveScanIdMax: eff.max,
      };
    }
  }),

  stepScan: (delta) => set((s) => {
    if (s.selectedScanIds.length !== 1 || s.filterMode !== 'include' || !s.trajectoryData) return {};
    const [gMin, gMax] = s.trajectoryData.scanIdRange;
    const next = Math.max(gMin, Math.min(gMax, s.selectedScanIds[0] + delta));
    const eff = computeEffective([next], s.windowBefore, s.windowAfter, s.trajectoryData);
    return { selectedScanIds: [next], effectiveScanIdMin: eff.min, effectiveScanIdMax: eff.max };
  }),

  resetToIdle: () =>
    set({
      phase: 'idle',
      selectedScanIds: [],
      windowBefore: 0,
      windowAfter: 0,
      filterEnabled: false,
      filterMode: 'include',
      excludeRangeMin: 0,
      excludeRangeMax: 0,
      effectiveScanIdMin: 0,
      effectiveScanIdMax: 0,
    }),
}));
