import { create } from 'zustand';
import type { SlabViewType } from '../../modules/plan-profile';
import type { SelectSubMode, TransformMode } from '../../modules/shape-editor';

export type PlanProfilePhase =
  | 'idle'           // not active
  | 'drawing-first'  // awaiting 2-click line draw
  | 'active'         // secondary view showing, cut line fixed
  | 'editing';       // OBB face/vertex/transform editing active

export type PlanProfileEditSubMode = SelectSubMode | TransformMode;

interface PlanProfileState {
  phase: PlanProfilePhase;
  viewType: SlabViewType | null;
  halfDepth: number;
  /** Point size used only in the secondary (2D) viewport. 1 = Potree default. */
  pointSize: number;
  editSubMode: PlanProfileEditSubMode;
  /** When true, secondary camera is placed on the +viewDir side instead of -viewDir. */
  viewFlipped: boolean;

  setPhase:        (phase: PlanProfilePhase) => void;
  setViewType:     (vt: SlabViewType | null) => void;
  setHalfDepth:    (d: number) => void;
  setPointSize:    (s: number) => void;
  setEditSubMode:  (mode: PlanProfileEditSubMode) => void;
  setViewFlipped:  (flipped: boolean) => void;
  toggleViewFlip:  () => void;
  activate:        (viewType: SlabViewType) => void;
  startEdit:       () => void;
  stopEdit:        () => void;
  close:           () => void;
}

export const usePlanProfileStore = create<PlanProfileState>((set) => ({
  phase: 'idle',
  viewType: null,
  halfDepth: 0.5,
  pointSize: 1,
  editSubMode: 'shape',
  viewFlipped: false,

  setPhase:       (phase)       => set({ phase }),
  setViewType:    (viewType)    => set({ viewType }),
  setHalfDepth:   (halfDepth)   => set({ halfDepth: Math.min(15, Math.max(0.001, halfDepth)) }),
  setPointSize:   (pointSize)   => set({ pointSize: Math.min(10, Math.max(0.5, pointSize)) }),
  setEditSubMode: (editSubMode) => set({ editSubMode }),
  setViewFlipped: (viewFlipped) => set({ viewFlipped }),
  toggleViewFlip: ()            => set((s) => ({ viewFlipped: !s.viewFlipped })),

  activate:  (viewType) => set({ phase: 'drawing-first', viewType, viewFlipped: false }),
  startEdit: ()         => set({ phase: 'editing', editSubMode: 'shape' }),
  stopEdit:  ()         => set({ phase: 'active' }),
  close:     ()         => set({ phase: 'idle', viewType: null, viewFlipped: false }),
}));
