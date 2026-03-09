import { useMemo } from 'react';
import type { ViewerEngine } from '../services/viewer-engine';
import type { ComponentType } from 'react';

export interface PluginPanelEntry {
  id: string;
  title: string;
  defaultOpen: boolean;
  Component: ComponentType;
}

export function usePluginPanels(
  engine: ViewerEngine | null
): PluginPanelEntry[] {
  return useMemo(() => {
    if (!engine) return [];

    return engine
      .getPlugins()
      .filter((p) => p.SidebarPanel !== undefined)
      .map((p) => ({
        id: p.id,
        title: p.sidebarTitle ?? p.name,
        defaultOpen: p.sidebarDefaultOpen ?? false,
        Component: p.SidebarPanel!,
      }));
  }, [engine]);
}
