import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CustomMapCategory = 'lane_boundaries' | 'stop_lines' | 'virtual' | 'areas' | 'other';

export const CUSTOM_MAP_CATEGORIES: CustomMapCategory[] = [
  'lane_boundaries',
  'stop_lines',
  'virtual',
  'areas',
  'other',
];

export const CATEGORY_LABELS: Record<CustomMapCategory, string> = {
  lane_boundaries: 'Lane Boundaries',
  stop_lines: 'Stop Lines',
  virtual: 'Virtual Lines',
  areas: 'Areas',
  other: 'Other',
};

export interface ParsedWay {
  id: string;
  type: string;
  subtype: string;
  /** WGS84 lat/lon coordinates of each node */
  coords: Array<{ lat: number; lng: number }>;
}

interface CustomMapState {
  /** Display name of the loaded file (null = no file loaded) */
  fileName: string | null;
  /** Parsed ways from the OSM file (in-memory only, not persisted) */
  ways: ParsedWay[];

  visible: boolean;
  opacity: number;
  categories: Record<CustomMapCategory, boolean>;

  // Actions
  setFile: (fileName: string, ways: ParsedWay[]) => void;
  clearFile: () => void;
  setVisible: (v: boolean) => void;
  setOpacity: (o: number) => void;
  setCategoryVisible: (cat: CustomMapCategory, v: boolean) => void;
}

const DEFAULT_CATEGORIES: Record<CustomMapCategory, boolean> = {
  lane_boundaries: true,
  stop_lines: true,
  virtual: false,
  areas: true,
  other: false,
};

export const useCustomMapStore = create<CustomMapState>()(
  persist(
    (set) => ({
      fileName: null,
      ways: [],
      visible: true,
      opacity: 0.9,
      categories: { ...DEFAULT_CATEGORIES },

      setFile: (fileName, ways) => set({ fileName, ways }),
      clearFile: () => set({ fileName: null, ways: [] }),
      setVisible: (visible) => set({ visible }),
      setOpacity: (opacity) => set({ opacity }),
      setCategoryVisible: (cat, v) =>
        set((s) => ({ categories: { ...s.categories, [cat]: v } })),
    }),
    {
      name: 'clap-plugin-custom-map',
      // Only persist display prefs — ways are re-loaded each session
      partialize: (s) => ({
        visible: s.visible,
        opacity: s.opacity,
        categories: s.categories,
      }),
    },
  ),
);
