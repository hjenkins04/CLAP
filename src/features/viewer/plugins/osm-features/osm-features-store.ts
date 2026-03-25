import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type OsmLayerKey = 'buildings' | 'roads' | 'water' | 'railways' | 'vegetation';

export const OSM_LAYER_KEYS: OsmLayerKey[] = [
  'buildings',
  'roads',
  'water',
  'railways',
  'vegetation',
];

interface OsmFeaturesState {
  visible: boolean;
  opacity: number;
  /** Which layers are toggled on (visibility) */
  layers: Record<OsmLayerKey, boolean>;
  /** Which layers have been fetched from Overpass */
  loadedLayers: Record<OsmLayerKey, boolean>;
  loadingLayer: OsmLayerKey | null;

  setVisible: (v: boolean) => void;
  setOpacity: (o: number) => void;
  setLayerVisible: (key: OsmLayerKey, v: boolean) => void;
  setLoadedLayer: (key: OsmLayerKey) => void;
  setLoadingLayer: (key: OsmLayerKey | null) => void;
}

export const useOsmFeaturesStore = create<OsmFeaturesState>()(
  persist(
    (set) => ({
      visible: true,
      opacity: 0.8,
      layers: {
        buildings: false,
        roads: false,
        water: false,
        railways: false,
        vegetation: false,
      },
      loadedLayers: {
        buildings: false,
        roads: false,
        water: false,
        railways: false,
        vegetation: false,
      },
      loadingLayer: null,

      setVisible: (visible) => set({ visible }),
      setOpacity: (opacity) => set({ opacity }),
      setLayerVisible: (key, v) =>
        set((s) => ({ layers: { ...s.layers, [key]: v } })),
      setLoadedLayer: (key) =>
        set((s) => ({ loadedLayers: { ...s.loadedLayers, [key]: true } })),
      setLoadingLayer: (loadingLayer) => set({ loadingLayer }),
    }),
    {
      name: 'clap-plugin-osm-features',
      version: 1,
      partialize: (s) => ({ opacity: s.opacity, visible: s.visible }),
    },
  ),
);
