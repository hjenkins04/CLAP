import { create } from 'zustand';
import { DEFAULT_CLASSIFICATION_LEGEND } from './default-legend';
import type { ClassificationLegend } from './types';

interface LegendState {
  legend: ClassificationLegend;
  /** 'default' = bundled fallback, 'project' = loaded from dataset folder. */
  source: 'default' | 'project';
  /** baseUrl of the project folder the current legend was loaded from (null
   *  when the default bundled legend is in use). Used for debugging / reloads. */
  sourceBaseUrl: string | null;
  /** Per-group expanded state in the panel. */
  expanded: Record<string, boolean>;

  setLegend: (
    legend: ClassificationLegend,
    source: 'default' | 'project',
    baseUrl: string | null,
  ) => void;
  resetToDefault: () => void;
  toggleGroup: (groupId: string) => void;
  setGroupExpanded: (groupId: string, expanded: boolean) => void;
}

function deriveExpanded(legend: ClassificationLegend): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const g of legend.groups) {
    out[g.id] = g.defaultExpanded ?? true;
  }
  return out;
}

export const useClassificationLegendStore = create<LegendState>()((set, get) => ({
  legend: DEFAULT_CLASSIFICATION_LEGEND,
  source: 'default',
  sourceBaseUrl: null,
  expanded: deriveExpanded(DEFAULT_CLASSIFICATION_LEGEND),

  setLegend: (legend, source, baseUrl) =>
    set({
      legend,
      source,
      sourceBaseUrl: baseUrl,
      expanded: deriveExpanded(legend),
    }),

  resetToDefault: () =>
    set({
      legend: DEFAULT_CLASSIFICATION_LEGEND,
      source: 'default',
      sourceBaseUrl: null,
      expanded: deriveExpanded(DEFAULT_CLASSIFICATION_LEGEND),
    }),

  toggleGroup: (groupId) =>
    set({
      expanded: { ...get().expanded, [groupId]: !get().expanded[groupId] },
    }),

  setGroupExpanded: (groupId, expanded) =>
    set({ expanded: { ...get().expanded, [groupId]: expanded } }),
}));
