import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// --- Mode definitions ---

export type ViewerMode = 'idle' | 'transform' | 'poi';
export type TransformSubMode = 'translate' | 'rotate';

// --- State ---

interface ViewerModeState {
  /** Current top-level viewer mode */
  mode: ViewerMode;

  /** Sub-mode when in transform mode */
  transformSubMode: TransformSubMode;

  /** Whether the command popup is expanded (persisted per-mode) */
  commandPanelExpanded: Record<string, boolean>;

  // Actions
  enterTransformMode: (subMode?: TransformSubMode) => void;
  setTransformSubMode: (subMode: TransformSubMode) => void;
  enterPoiMode: () => void;
  exitMode: () => void;

  isCommandPanelExpanded: () => boolean;
  setCommandPanelExpanded: (expanded: boolean) => void;
}

export const useViewerModeStore = create<ViewerModeState>()(
  persist(
    (set, get) => ({
      mode: 'idle',
      transformSubMode: 'translate',
      commandPanelExpanded: {},

      enterTransformMode: (subMode) =>
        set({
          mode: 'transform',
          ...(subMode !== undefined && { transformSubMode: subMode }),
        }),

      setTransformSubMode: (transformSubMode) => set({ transformSubMode }),

      enterPoiMode: () => set({ mode: 'poi' }),

      exitMode: () => set({ mode: 'idle' }),

      isCommandPanelExpanded: () => {
        const { mode, commandPanelExpanded } = get();
        return commandPanelExpanded[mode] ?? false;
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
