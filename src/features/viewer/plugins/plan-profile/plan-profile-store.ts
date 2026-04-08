import { create } from 'zustand';
import type { SlabViewType } from '../../modules/plan-profile';
import type { SelectSubMode, TransformMode } from '../../modules/shape-editor';

/** Plan/profile view lifecycle — independent of trajectory follow state. */
export type PlanProfilePhase =
  | 'idle'          // not active
  | 'drawing-first' // awaiting 2-click line draw
  | 'active'        // secondary view showing, cut line fixed
  | 'editing';      // OBB face/vertex/transform editing active

/** Trajectory follow lifecycle — runs concurrently with the plan/profile phase. */
export type TrajectoryFollowPhase =
  | 'idle'             // follow mode not active
  | 'centroid-picking' // waiting for the user to click a start position in 3D
  | 'active';          // navigating along trajectory with < >

export type PlanProfileEditSubMode = SelectSubMode | TransformMode;

interface PlanProfileState {
  // ── Plan / profile ──────────────────────────────────────────────────────────
  phase: PlanProfilePhase;
  viewType: SlabViewType | null;
  halfDepth: number;
  /** Point size used only in the secondary (2D) viewport. 1 = Potree default. */
  pointSize: number;
  editSubMode: PlanProfileEditSubMode;
  /** When true, secondary camera is placed on the +viewDir side instead of -viewDir. */
  viewFlipped: boolean;

  // ── Trajectory follow ───────────────────────────────────────────────────────
  trajectoryPhase: TrajectoryFollowPhase;
  /** Index into trajectoryData.points for the current position. */
  followIndex: number;

  // Plan/profile actions
  setPhase:           (phase: PlanProfilePhase) => void;
  setViewType:        (vt: SlabViewType | null) => void;
  setHalfDepth:       (d: number) => void;
  setPointSize:       (s: number) => void;
  setEditSubMode:     (mode: PlanProfileEditSubMode) => void;
  setViewFlipped:     (flipped: boolean) => void;
  toggleViewFlip:     () => void;
  activate:           (viewType: SlabViewType) => void;
  startEdit:          () => void;
  stopEdit:           () => void;
  close:              () => void;


  // Trajectory follow actions
  setFollowIndex:  (i: number) => void;
  activateFollow:  () => void;   // → 'centroid-picking'
  stopFollow:      () => void;   // → 'idle'
  _setFollowIndex: (i: number) => void; // internal: sets index + transitions to 'active'
}

export const usePlanProfileStore = create<PlanProfileState>((set) => ({
  phase: 'idle',
  viewType: null,
  halfDepth: 0.5,
  pointSize: 1,
  editSubMode: 'shape',
  viewFlipped: false,

  trajectoryPhase: 'idle',
  followIndex: 0,

setPhase:           (phase)           => set({ phase }),
  setViewType:        (viewType)        => set({ viewType }),
  setHalfDepth:       (halfDepth)       => set({ halfDepth: Math.min(15, Math.max(0.001, halfDepth)) }),
  setPointSize:       (pointSize)       => set({ pointSize: Math.min(10, Math.max(0.5, pointSize)) }),
  setEditSubMode:     (editSubMode)     => set({ editSubMode }),
  setViewFlipped:     (viewFlipped)     => set({ viewFlipped }),
  toggleViewFlip:     ()                => set((s) => ({ viewFlipped: !s.viewFlipped })),

  // Plan/profile phase transitions
  activate:  (viewType) => set({ phase: 'drawing-first', viewType, viewFlipped: false, trajectoryPhase: 'idle' }),
  startEdit: ()         => set({ phase: 'editing', editSubMode: 'shape' }),
  stopEdit:  ()         => set({ phase: 'active' }),
  close:     ()         => set({ phase: 'idle', viewType: null, viewFlipped: false, trajectoryPhase: 'idle' }),

  // Trajectory follow phase transitions (independent of plan/profile phase)
  setFollowIndex:  (followIndex) => set({ followIndex }),
  activateFollow:  ()            => set({ trajectoryPhase: 'centroid-picking' }),
  stopFollow:          ()                 => set({ trajectoryPhase: 'idle' }),
  _setFollowIndex:     (followIndex)      => set({ followIndex, trajectoryPhase: 'active' }),

}));
