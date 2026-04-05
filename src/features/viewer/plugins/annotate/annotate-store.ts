import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CLASSIFICATION_CLASSES } from './classification-classes';

interface AnnotateState {
  /** true = visible, false = hidden. Missing keys default to visible. */
  classVisibility: Record<string, boolean>;

  /** true = selectable in reclassify mode, false = excluded. Missing keys default to active. */
  classActive: Record<string, boolean>;

  toggleClassVisibility: (classId: string) => void;
  showAll: () => void;
  hideAll: () => void;

  toggleClassActive: (classId: string) => void;
  activateAll: () => void;
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

      showAll: () => set({ classVisibility: {} }),

      hideAll: () => {
        const next: Record<string, boolean> = {};
        for (const cls of CLASSIFICATION_CLASSES) {
          next[String(cls.id)] = false;
        }
        return set({ classVisibility: next });
      },

      toggleClassActive: (classId) =>
        set((s) => ({
          classActive: {
            ...s.classActive,
            [classId]: !(s.classActive[classId] ?? true),
          },
        })),

      activateAll: () => set({ classActive: {} }),
    }),
    {
      name: 'clap-plugin-annotate',
    },
  ),
);
