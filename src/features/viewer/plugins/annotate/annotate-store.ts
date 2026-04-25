import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useClassificationLegendStore } from '../../services/classification-legend';
import type { ClassificationLegend } from '../../services/classification-legend';

interface AnnotateState {
  /** true = visible, false = hidden. Missing keys default to visible. */
  classVisibility: Record<string, boolean>;

  /** true = selectable in reclassify mode, false = excluded. Missing keys default to active. */
  classActive: Record<string, boolean>;

  toggleClassVisibility: (classId: string) => void;
  setClassVisibility: (classId: string, visible: boolean) => void;
  showAll: () => void;
  hideAll: () => void;

  toggleClassActive: (classId: string) => void;
  setClassActive: (classId: string, active: boolean) => void;
  activateAll: () => void;

  /** Group helpers — apply the same toggle to every class in a group. */
  setGroupVisibility: (classIds: string[], visible: boolean) => void;
  setGroupActive: (classIds: string[], active: boolean) => void;

  /** Reset visibility/active to the legend's enabledByDefault values.
   *  Called when a new dataset's legend is loaded so each project's
   *  default-enabled/disabled classes take effect. */
  applyLegendDefaults: (legend: ClassificationLegend) => void;
}

export const useAnnotateStore = create<AnnotateState>()(
  persist(
    (set) => ({
      classVisibility: {},
      classActive: {},

      toggleClassVisibility: (classId) =>
        set((s) => ({
          classVisibility: {
            ...s.classVisibility,
            [classId]: !(s.classVisibility[classId] ?? true),
          },
        })),

      setClassVisibility: (classId, visible) =>
        set((s) => ({
          classVisibility: { ...s.classVisibility, [classId]: visible },
        })),

      showAll: () => set({ classVisibility: {} }),

      hideAll: () => {
        const legend = useClassificationLegendStore.getState().legend;
        const next: Record<string, boolean> = {};
        for (const cls of legend.classes) next[String(cls.id)] = false;
        return set({ classVisibility: next });
      },

      toggleClassActive: (classId) =>
        set((s) => ({
          classActive: {
            ...s.classActive,
            [classId]: !(s.classActive[classId] ?? true),
          },
        })),

      setClassActive: (classId, active) =>
        set((s) => ({
          classActive: { ...s.classActive, [classId]: active },
        })),

      activateAll: () => set({ classActive: {} }),

      setGroupVisibility: (classIds, visible) =>
        set((s) => {
          const next = { ...s.classVisibility };
          for (const id of classIds) next[id] = visible;
          return { classVisibility: next };
        }),

      setGroupActive: (classIds, active) =>
        set((s) => {
          const next = { ...s.classActive };
          for (const id of classIds) next[id] = active;
          return { classActive: next };
        }),

      applyLegendDefaults: (legend) => {
        const vis: Record<string, boolean> = {};
        for (const cls of legend.classes) {
          // Only write explicit entries when the legend says so — leaving
          // the key absent means "default true" which matches the usual case.
          if (cls.enabledByDefault === false) vis[String(cls.id)] = false;
        }
        set({ classVisibility: vis, classActive: {} });
      },
    }),
    {
      name: 'clap-plugin-annotate',
    },
  ),
);
