import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AxisState {
  flipX: boolean;
  flipY: boolean;
  flipZ: boolean;

  toggleFlipX: () => void;
  toggleFlipY: () => void;
  toggleFlipZ: () => void;
}

export const useAxisStore = create<AxisState>()(
  persist(
    (set) => ({
      flipX: false,
      flipY: false,
      flipZ: false,

      toggleFlipX: () => set((s) => ({ flipX: !s.flipX })),
      toggleFlipY: () => set((s) => ({ flipY: !s.flipY })),
      toggleFlipZ: () => set((s) => ({ flipZ: !s.flipZ })),
    }),
    {
      name: 'clap-plugin-axis',
      version: 1,
      partialize: (state) => ({
        flipX: state.flipX,
        flipY: state.flipY,
        flipZ: state.flipZ,
      }),
    },
  ),
);
