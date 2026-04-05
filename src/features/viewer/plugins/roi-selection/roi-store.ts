import { create } from 'zustand';
import type { SelectSubMode, TransformMode } from '../../modules/shape-editor';

/**
 * ROI Selection state machine:
 *
 *   idle     – plugin not active, no shapes defined
 *   editing  – in roi-selection viewer mode; user can draw new shapes and
 *              select / edit existing ones (was "choosing-tool")
 *   drawing  – a draw tool is active; the engine is handling pointer events
 *   applied  – clip regions active, viewer mode exited; shapes are preserved
 *
 * Transitions:
 *   idle    → editing   (enterRoiSelectionMode)
 *   editing → drawing   (startDrawingTool)
 *   drawing → editing   (shape-created or cancelDraw)
 *   editing → applied   (applySelection)
 *   applied → editing   (redefine  → re-enters roi-selection viewer mode)
 *   applied → idle      (clearRoi)
 *   editing → idle      (cancelSelection / exitMode without applying)
 */
export type RoiPhase = 'idle' | 'editing' | 'drawing' | 'applied';

export type RoiDrawTool = 'box' | 'polygon' | 'polyline';

/** Which sub-mode is active while in the editing phase. */
export type RoiEditSubMode = SelectSubMode | TransformMode;

interface RoiState {
  phase: RoiPhase;
  activeTool: RoiDrawTool;
  /** Number of committed shapes in the engine — kept in sync by the plugin. */
  shapeCount: number;
  /** IDs in insertion order — used for undo-last. */
  shapeIds: string[];
  clipEnabled: boolean;
  clipVisible: boolean;
  /** Sub-mode when in editing phase. */
  editSubMode: RoiEditSubMode;
  /** Counts of selected items for the UI. */
  selectionInfo: { shapes: number; elements: number };

  // ── Actions ───────────────────────────────────────────────────────────────

  setPhase: (phase: RoiPhase) => void;
  setActiveTool: (tool: RoiDrawTool) => void;
  addShapeId: (id: string) => void;
  removeShapeId: (id: string) => void;
  clearShapes: () => void;
  setClipEnabled: (enabled: boolean) => void;
  setClipVisible: (visible: boolean) => void;
  setEditSubMode: (mode: RoiEditSubMode) => void;
  setSelectionInfo: (info: { shapes: number; elements: number }) => void;

  /**
   * Atomically enter the editing phase and reset all transient editing state
   * (editSubMode → 'shape', selectionInfo → zeros).
   * Called by the plugin on mode entry and after draw completion.
   */
  enterEditing: () => void;

  /**
   * Full reset to idle — clears shapes, clip state, and editing state.
   * Called by the plugin when ROI is cleared or cancelled.
   */
  resetToIdle: () => void;

  /** True when an ROI has been applied. */
  hasRoi: () => boolean;
}

export const useRoiStore = create<RoiState>()((set, get) => ({
  phase: 'idle',
  activeTool: 'box',
  shapeCount: 0,
  shapeIds: [],
  clipEnabled: false,
  clipVisible: true,
  editSubMode: 'shape',
  selectionInfo: { shapes: 0, elements: 0 },

  setPhase: (phase) => set({ phase }),
  setActiveTool: (activeTool) => set({ activeTool }),

  addShapeId: (id) =>
    set((s) => ({
      shapeIds: [...s.shapeIds, id],
      shapeCount: s.shapeIds.length + 1,
    })),

  removeShapeId: (id) =>
    set((s) => {
      const shapeIds = s.shapeIds.filter((x) => x !== id);
      return { shapeIds, shapeCount: shapeIds.length };
    }),

  clearShapes: () => set({ shapeIds: [], shapeCount: 0 }),

  setClipEnabled: (clipEnabled) => set({ clipEnabled }),
  setClipVisible: (clipVisible) => set({ clipVisible }),

  setEditSubMode: (editSubMode) => set({ editSubMode }),
  setSelectionInfo: (selectionInfo) => set({ selectionInfo }),

  enterEditing: () =>
    set({
      phase: 'editing',
      editSubMode: 'shape',
      selectionInfo: { shapes: 0, elements: 0 },
    }),

  resetToIdle: () =>
    set({
      phase: 'idle',
      shapeIds: [],
      shapeCount: 0,
      clipEnabled: false,
      editSubMode: 'shape',
      selectionInfo: { shapes: 0, elements: 0 },
    }),

  hasRoi: () => get().phase === 'applied' && get().shapeCount > 0,
}));
