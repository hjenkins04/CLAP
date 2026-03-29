import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// --- Mode definitions ---

export type ViewerMode = 'idle' | 'transform' | 'poi' | 'virtual-tiles' | 'roi-selection' | 'point-select' | 'annotate' | 'world-frame' | 'static-obstacle';
export type TransformSubMode = 'translate' | 'rotate';

// --- State ---

interface ViewerModeState {
  /** Current top-level viewer mode */
  mode: ViewerMode;

  /** Sub-mode when in transform mode */
  transformSubMode: TransformSubMode;

  /** Whether the camera orientation is locked (no rotate/pan/zoom) */
  cameraLocked: boolean;

  /** Whether the command popup is expanded (persisted per-mode) */
  commandPanelExpanded: Record<string, boolean>;

  // Actions
  enterTransformMode: (subMode?: TransformSubMode) => void;
  setTransformSubMode: (subMode: TransformSubMode) => void;
  enterPoiMode: () => void;
  enterVirtualTilesMode: () => void;
  enterRoiSelectionMode: () => void;
  enterPointSelectMode: () => void;
  enterAnnotateMode: () => void;
  enterWorldFrameMode: () => void;
  enterStaticObstacleMode: () => void;
  exitMode: () => void;
  setCameraLocked: (locked: boolean) => void;
  toggleCameraLocked: () => void;

  isCommandPanelExpanded: () => boolean;
  setCommandPanelExpanded: (expanded: boolean) => void;
}

export const useViewerModeStore = create<ViewerModeState>()(
  persist(
    (set, get) => ({
      mode: 'idle',
      transformSubMode: 'translate',
      cameraLocked: false,
      commandPanelExpanded: {},

      enterTransformMode: (subMode) =>
        set({
          mode: 'transform',
          ...(subMode !== undefined && { transformSubMode: subMode }),
        }),

      setTransformSubMode: (transformSubMode) => set({ transformSubMode }),

      enterPoiMode: () => set({ mode: 'poi' }),

      enterVirtualTilesMode: () => set({ mode: 'virtual-tiles' }),

      enterRoiSelectionMode: () => set({ mode: 'roi-selection' }),

      enterPointSelectMode: () => set({ mode: 'point-select' }),

      enterAnnotateMode: () => set({ mode: 'annotate' }),

      enterWorldFrameMode: () => set({ mode: 'world-frame' }),

      enterStaticObstacleMode: () => set({ mode: 'static-obstacle' }),

      exitMode: () => set({ mode: 'idle', cameraLocked: false }),

      setCameraLocked: (cameraLocked) => set({ cameraLocked }),
      toggleCameraLocked: () => set((s) => ({ cameraLocked: !s.cameraLocked })),

      isCommandPanelExpanded: () => {
        const { mode, commandPanelExpanded } = get();
        return commandPanelExpanded[mode] ?? true;
      },

      setCommandPanelExpanded: (expanded) => {
        const { mode, commandPanelExpanded } = get();
        set({
          commandPanelExpanded: { ...commandPanelExpanded, [mode]: expanded },
        });
      },
    }),
    {
      name: 'clap-viewer-mode',
      partialize: (state) => ({
        commandPanelExpanded: state.commandPanelExpanded,
      }),
    }
  )
);
