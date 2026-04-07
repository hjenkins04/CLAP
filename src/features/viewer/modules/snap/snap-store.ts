import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SnapMode, SnapModeConfig } from './snap-types';
import { DEFAULT_SNAP_MODES } from './snap-types';

interface SnapState {
  /** Master on/off toggle. */
  enabled: boolean;
  /** Which snap modes are active (when enabled). */
  modes: SnapModeConfig;
  setEnabled: (enabled: boolean) => void;
  setMode: (mode: SnapMode, value: boolean) => void;
}

export const useSnapStore = create<SnapState>()(
  persist(
    (set) => ({
      enabled: true,
      modes: { ...DEFAULT_SNAP_MODES }, // vertex: true, dem: true by default
      setEnabled: (enabled) => set({ enabled }),
      setMode: (mode, value) =>
        set((s) => ({ modes: { ...s.modes, [mode]: value } })),
    }),
    { name: 'clap-snap-settings' },
  ),
);
