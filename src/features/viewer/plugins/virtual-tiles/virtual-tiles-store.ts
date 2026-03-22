import { create } from 'zustand';

/**
 * Virtual Tiles state machine:
 *   idle      – plugin not active, no grid overlay
 *   selecting – grid shown, user clicks cells to select/deselect
 *   applied   – clip boxes active, points filtered to selected cells
 */
export type VirtualTilesPhase = 'idle' | 'selecting' | 'applied';

export function cellKey(row: number, col: number): string {
  return `${row}-${col}`;
}

interface VirtualTilesState {
  phase: VirtualTilesPhase;
  /** Cell size in metres — the primary user-facing control. */
  cellSize: number;
  /** Derived from bounding box and cellSize by the plugin. */
  rows: number;
  cols: number;
  selectedCells: string[];
  hoverCell: string | null;

  setPhase: (phase: VirtualTilesPhase) => void;
  setCellSize: (size: number) => void;
  setGridSize: (rows: number, cols: number) => void;
  toggleCell: (row: number, col: number) => void;
  selectAll: () => void;
  deselectAll: () => void;
  setHoverCell: (key: string | null) => void;
}

export const useVirtualTilesStore = create<VirtualTilesState>()((set, get) => ({
  phase: 'idle',
  cellSize: 50,
  rows: 3,
  cols: 3,
  selectedCells: [],
  hoverCell: null,

  setPhase: (phase) => set({ phase }),

  setCellSize: (cellSize) => {
    set({ cellSize, selectedCells: [] });
  },

  setGridSize: (rows, cols) => {
    set({ rows, cols, selectedCells: [] });
  },

  toggleCell: (row, col) => {
    const key = cellKey(row, col);
    const { selectedCells } = get();
    if (selectedCells.includes(key)) {
      set({ selectedCells: selectedCells.filter((k) => k !== key) });
    } else {
      set({ selectedCells: [...selectedCells, key] });
    }
  },

  selectAll: () => {
    const { rows, cols } = get();
    const all: string[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        all.push(cellKey(r, c));
      }
    }
    set({ selectedCells: all });
  },

  deselectAll: () => set({ selectedCells: [] }),

  setHoverCell: (hoverCell) => set({ hoverCell }),
}));
