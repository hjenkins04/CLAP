import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface GridState {
  visible: boolean;
  size: number;
  cellSize: number;

  setVisible: (visible: boolean) => void;
  setSize: (size: number) => void;
  setCellSize: (cellSize: number) => void;
}

export const useGridStore = create<GridState>()(
  persist(
    (set) => ({
      visible: true,
      size: 100,
      cellSize: 1,

      setVisible: (visible) => set({ visible }),
      setSize: (size) => set({ size }),
      setCellSize: (cellSize) => set({ cellSize }),
    }),
    {
      name: 'clap-plugin-grid',
    }
  )
);
