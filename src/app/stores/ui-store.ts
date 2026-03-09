import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark' | 'system';

const THEMES: Theme[] = ['light', 'dark', 'system'];

interface UIState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
      cycleTheme: () => {
        const currentIndex = THEMES.indexOf(get().theme);
        const nextIndex = (currentIndex + 1) % THEMES.length;
        set({ theme: THEMES[nextIndex] });
      },
    }),
    {
      name: 'clap-ui-storage',
    }
  )
);
