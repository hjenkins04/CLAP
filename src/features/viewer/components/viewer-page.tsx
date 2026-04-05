import { useRef } from 'react';
import { Crosshair, Sun, Moon, Monitor } from 'lucide-react';
import { Button } from '@clap/design-system';
import { useUIStore, useViewerModeStore } from '@/app/stores';
import { useViewerEngine } from '../hooks/use-viewer-engine';
import { ViewerCanvas } from './viewer-canvas';
import { ViewerToolbar } from './viewer-toolbar';
import { ViewportToolbar } from './viewport-toolbar';
import { ViewerSidebarPanel } from './viewer-sidebar-panel';
import { TransformCommandPanel } from './transform-command-panel';
import { VirtualTilesCommandPanel } from './virtual-tiles-command-panel';
import { PoiOverlay } from './poi-overlay';
import { VirtualTilesOverlay } from './virtual-tiles-overlay';
import { RoiCommandPanel } from './roi-command-panel';
import { RoiOverlay } from './roi-overlay';
import { PointSelectOverlay } from './point-select-overlay';
import { AnnotatePanel } from '../plugins/annotate';
import { WorldFrameOverlay } from './world-frame-overlay';
import { WorldFrameMapModal } from './world-frame-map-modal';
import { StaticObstacleOverlay } from '../plugins/static-obstacle';
import { ReclassifyGizmo, ReclassifyOverlay } from '../plugins/reclassify';
import { RoadExtractionOverlay } from '../plugins/road-extraction';

export function ViewerPage() {
  const { theme, cycleTheme } = useUIStore();
  const mode = useViewerModeStore((s) => s.mode);
  const containerRef = useRef<HTMLDivElement>(null);
  const engine = useViewerEngine(containerRef);

  const ThemeIcon =
    theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  return (
    <div className="flex h-full w-full">
      {/* Sidebar */}
      <aside className="flex w-64 flex-shrink-0 flex-col border-r border-border bg-card">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Crosshair className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold">CLAP</span>
          </div>
          <Button variant="ghost" size="icon" onClick={cycleTheme}>
            <ThemeIcon className="h-4 w-4" />
          </Button>
        </div>

        {/* Panel Content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <ViewerSidebarPanel engine={engine} />
        </div>
      </aside>

      {/* Main Viewport */}
      <main className="relative flex-1 bg-background">
        <ViewportToolbar engine={engine} />
        <ViewerToolbar engine={engine} />
        <ViewerCanvas containerRef={containerRef} engine={engine} />
        {mode === 'transform' && <TransformCommandPanel />}
        <VirtualTilesCommandPanel engine={engine} />
        <PoiOverlay engine={engine} />
        <VirtualTilesOverlay engine={engine} />
        <RoiCommandPanel engine={engine} />
        <RoiOverlay engine={engine} />
        <PointSelectOverlay engine={engine} />
        <AnnotatePanel />
        <WorldFrameOverlay engine={engine} />
        <WorldFrameMapModal engine={engine} />
        <StaticObstacleOverlay engine={engine} />
        <ReclassifyOverlay engine={engine} />
        <RoadExtractionOverlay engine={engine} />
        <ReclassifyGizmo />
      </main>
    </div>
  );
}
