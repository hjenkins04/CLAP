import { usePluginPanels } from '../hooks/use-plugin-panels';
import type { ViewerEngine } from '../services/viewer-engine';
import { SidebarPointCloudPanel } from './sidebar-point-cloud-panel';
import { SidebarColoringPanel } from './sidebar-coloring-panel';
import { SidebarEdlPanel } from './sidebar-edl-panel';
import { SidebarCameraPanel } from './sidebar-camera-panel';
import { SidebarSection } from './sidebar-section';
import { SidebarTabs } from './sidebar-tabs';
import { SidebarLayersPanel } from './sidebar-layers-panel';

interface ViewerSidebarPanelProps {
  engine: ViewerEngine | null;
}

export function ViewerSidebarPanel({ engine }: ViewerSidebarPanelProps) {
  const pluginPanels = usePluginPanels(engine);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Point cloud loader — always visible above tabs */}
      <div className="border-b border-border p-4 pb-3">
        <SidebarPointCloudPanel />
      </div>

      <SidebarTabs>
        {(tab) =>
          tab === 'layers' ? (
            <SidebarLayersPanel />
          ) : (
            <div className="flex flex-col gap-4 p-4">
              <SidebarSection title="Coloring & Points" defaultOpen>
                <SidebarColoringPanel />
              </SidebarSection>

              <SidebarSection title="Eye-Dome Lighting">
                <SidebarEdlPanel />
              </SidebarSection>

              <SidebarSection title="Camera">
                <SidebarCameraPanel />
              </SidebarSection>

              {pluginPanels.map(({ id, title, defaultOpen, Component }) => (
                <SidebarSection key={id} title={title} defaultOpen={defaultOpen}>
                  <Component />
                </SidebarSection>
              ))}
            </div>
          )
        }
      </SidebarTabs>
    </div>
  );
}
