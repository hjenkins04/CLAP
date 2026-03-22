import { create } from 'zustand';
import type { RoiShape, RoiDrawTool } from './roi-types';

/**
 * ROI Selection state machine:
 *   idle           – plugin not active
 *   choosing-tool  – user picks which shape to draw
 *   drawing        – user actively drawing a 2D footprint in the viewport
 *   extruding      – user dragging to set height (box/cylinder only)
 *   editing        – shape drawn, user can confirm or discard
 *   applied        – clip regions active, points filtered
 */
export type RoiPhase =
  | 'idle'
  | 'choosing-tool'
  | 'drawing'
  | 'extruding'
  | 'editing'
  | 'applied';

export type RoiEditSubMode = 'translate' | 'rotate' | 'points';

let nextId = 1;
function genId(): string {
  return `roi-${nextId++}`;
}

interface RoiState {
  phase: RoiPhase;
  activeTool: RoiDrawTool;
  shapes: RoiShape[];
  /** Shape currently being drawn (not yet committed) */
  pendingShape: RoiShape | null;
  /** Polygon vertices being placed (for polygon-2d drawing) */
  polyVertices: Array<{ x: number; y: number }>;
  /** Whether clip regions are currently applied to the point cloud */
  clipEnabled: boolean;
  /** Whether ROI shape visuals are visible in the viewport */
  clipVisible: boolean;
  /** Sub-mode when in 'editing' phase */
  editSubMode: RoiEditSubMode;
  /** Indices of selected control points (editing → points sub-mode) */
  selectedPoints: number[];

  setPhase: (phase: RoiPhase) => void;
  setActiveTool: (tool: RoiDrawTool) => void;
  setPendingShape: (shape: RoiShape | null) => void;
  commitPending: () => void;
  removeShape: (id: string) => void;
  removeLastShape: () => void;
  clearShapes: () => void;
  addPolyVertex: (v: { x: number; y: number }) => void;
  undoPolyVertex: () => void;
  clearPolyVertices: () => void;
  genId: () => string;
  setClipEnabled: (enabled: boolean) => void;
  setClipVisible: (visible: boolean) => void;
  setEditSubMode: (mode: RoiEditSubMode) => void;
  setSelectedPoints: (indices: number[]) => void;
  toggleSelectedPoint: (index: number) => void;
  clearSelectedPoints: () => void;
  /** True when an ROI has been defined (shapes exist, even if idle) */
  hasRoi: () => boolean;
}

export const useRoiStore = create<RoiState>()((set, get) => ({
  phase: 'idle',
  activeTool: 'rect-2d',
  shapes: [],
  pendingShape: null,
  polyVertices: [],
  clipEnabled: false,
  clipVisible: true,
  editSubMode: 'translate',
  selectedPoints: [],

  setPhase: (phase) => set({ phase }),

  setActiveTool: (tool) => set({ activeTool: tool }),

  setPendingShape: (shape) => set({ pendingShape: shape }),

  commitPending: () => {
    const { pendingShape, shapes } = get();
    if (!pendingShape) return;
    set({
      shapes: [...shapes, pendingShape],
      pendingShape: null,
      polyVertices: [],
    });
  },

  removeShape: (id) => {
    set({ shapes: get().shapes.filter((s) => s.id !== id) });
  },

  removeLastShape: () => {
    const { shapes } = get();
    if (shapes.length === 0) return;
    set({ shapes: shapes.slice(0, -1) });
  },

  clearShapes: () => set({ shapes: [], pendingShape: null, polyVertices: [] }),

  addPolyVertex: (v) => {
    set({ polyVertices: [...get().polyVertices, v] });
  },

  undoPolyVertex: () => {
    const verts = get().polyVertices;
    if (verts.length === 0) return;
    set({ polyVertices: verts.slice(0, -1) });
  },

  clearPolyVertices: () => set({ polyVertices: [] }),

  genId,

  setClipEnabled: (clipEnabled) => set({ clipEnabled }),
  setClipVisible: (clipVisible) => set({ clipVisible }),

  setEditSubMode: (editSubMode) => set({ editSubMode, selectedPoints: [] }),
  setSelectedPoints: (selectedPoints) => set({ selectedPoints }),
  toggleSelectedPoint: (index) => {
    const { selectedPoints } = get();
    if (selectedPoints.includes(index)) {
      set({ selectedPoints: selectedPoints.filter((i) => i !== index) });
    } else {
      set({ selectedPoints: [...selectedPoints, index] });
    }
  },
  clearSelectedPoints: () => set({ selectedPoints: [] }),

  hasRoi: () => get().shapes.length > 0 && get().phase === 'applied',
}));
