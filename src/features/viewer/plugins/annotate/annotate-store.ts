import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CLASSIFICATION_CLASSES } from './classification-classes';

interface AnnotateState {
  /** true = visible, false = hidden. Missing keys default to visible. */
  classVisibility: Record<string, boolean>;

  toggleClassVisibility: (classId: string) => void;
  showAll: () => void;
  hideAll: () => void;
}

export const useAnnotateStore = create<AnnotateState>()(
  persist(
    (set) => ({
      classVisibility: {},

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
    }),
    {
      name: 'clap-plugin-annotate',
    },
  ),
);
