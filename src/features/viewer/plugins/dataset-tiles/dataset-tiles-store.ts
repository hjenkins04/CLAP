import { create } from 'zustand';
import type { DatasetManifest } from './dataset-tiles-types';

interface DatasetTilesState {
  manifest: DatasetManifest | null;
  baseUrl: string | null;
  /** IDs of tiles whose PCO is attached to the scene right now. */
  loadedTileIds: Set<string>;
  /** IDs of tiles currently being loaded (in-flight). */
  loadingTileIds: Set<string>;
  /** Whether the tile selection panel is open. */
  panelOpen: boolean;
  /** Whether the "Tile Bounds" scene overlay is visible. */
  boundsLayerVisible: boolean;

  setManifest: (manifest: DatasetManifest | null, baseUrl: string | null) => void;
  setTileLoaded: (id: string, loaded: boolean) => void;
  setTileLoading: (id: string, loading: boolean) => void;
  clearLoaded: () => void;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  setBoundsLayerVisible: (visible: boolean) => void;
}

export const useDatasetTilesStore = create<DatasetTilesState>()((set, get) => ({
  manifest: null,
  baseUrl: null,
  loadedTileIds: new Set(),
  loadingTileIds: new Set(),
  panelOpen: false,
  boundsLayerVisible: false,

  setManifest: (manifest, baseUrl) =>
    set({
      manifest,
      baseUrl,
      loadedTileIds: new Set(),
      loadingTileIds: new Set(),
    }),

  setTileLoaded: (id, loaded) => {
    const next = new Set(get().loadedTileIds);
    if (loaded) next.add(id);
    else next.delete(id);
    set({ loadedTileIds: next });
  },

  setTileLoading: (id, loading) => {
    const next = new Set(get().loadingTileIds);
    if (loading) next.add(id);
    else next.delete(id);
    set({ loadingTileIds: next });
  },

  clearLoaded: () =>
    set({
      loadedTileIds: new Set(),
      loadingTileIds: new Set(),
    }),

  setPanelOpen: (panelOpen) => set({ panelOpen }),
  togglePanel: () => set({ panelOpen: !get().panelOpen }),
  setBoundsLayerVisible: (boundsLayerVisible) => set({ boundsLayerVisible }),
}));
