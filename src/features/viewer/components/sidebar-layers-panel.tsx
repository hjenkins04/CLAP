import {
  Eye,
  EyeOff,
  Map,
  Cloud,
  Grid3x3,
  Crosshair,
  MapPin,
} from 'lucide-react';
import { useViewerStore } from '@/app/stores';
import { useBaseMapStore } from '../plugins/base-map';
import { useGridStore } from '../plugins/grid/grid-store';
import { usePoiStore } from '../plugins/poi/poi-store';
import { useWorldFrameStore } from '../plugins/world-frame';

interface LayerRowProps {
  icon: React.ReactNode;
  name: string;
  visible: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

function LayerRow({ icon, name, visible, onToggle, disabled }: LayerRowProps) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <span className={`text-xs ${disabled ? 'text-muted-foreground/50' : ''}`}>
          {name}
        </span>
      </div>
      <button
        onClick={onToggle}
        disabled={disabled}
        className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
      >
        {visible ? (
          <Eye className="h-3.5 w-3.5" />
        ) : (
          <EyeOff className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

export function SidebarLayersPanel() {
  // Point cloud
  const pcVisible = useViewerStore((s) => s.pointCloudVisible);
  const setPcVisible = useViewerStore((s) => s.setPointCloudVisible);

  // Base map
  const baseMapVisible = useBaseMapStore((s) => s.visible);
  const setBaseMapVisible = useBaseMapStore((s) => s.setVisible);
  const hasWorldFrame = useWorldFrameStore((s) => s.phase) === 'confirmed';

  // Grid
  const gridVisible = useGridStore((s) => s.visible);
  const setGridVisible = useGridStore((s) => s.setVisible);

  // POI
  const poiPosition = usePoiStore((s) => s.position);
  const poiMarkerVisible = usePoiStore((s) => s.markerVisible);
  const setPoiMarkerVisible = usePoiStore((s) => s.setMarkerVisible);

  // Geo reference markers
  const wfAnchor1 = useWorldFrameStore((s) => s.anchor1);
  const wfMarkersVisible = useWorldFrameStore((s) => s.markersVisible);
  const setWfMarkersVisible = useWorldFrameStore((s) => s.setMarkersVisible);

  return (
    <div className="flex flex-col gap-0.5 p-4">
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Scene Layers
      </h3>

      <LayerRow
        icon={<Cloud className="h-3.5 w-3.5" />}
        name="Point Cloud"
        visible={pcVisible}
        onToggle={() => setPcVisible(!pcVisible)}
      />

      <LayerRow
        icon={<Map className="h-3.5 w-3.5" />}
        name="Base Map"
        visible={baseMapVisible}
        onToggle={() => setBaseMapVisible(!baseMapVisible)}
        disabled={!hasWorldFrame}
      />

      <LayerRow
        icon={<Grid3x3 className="h-3.5 w-3.5" />}
        name="Grid"
        visible={gridVisible}
        onToggle={() => setGridVisible(!gridVisible)}
      />

      <LayerRow
        icon={<Crosshair className="h-3.5 w-3.5" />}
        name="POI Marker"
        visible={poiMarkerVisible}
        onToggle={() => setPoiMarkerVisible(!poiMarkerVisible)}
        disabled={!poiPosition}
      />

      <LayerRow
        icon={<MapPin className="h-3.5 w-3.5" />}
        name="Geo Reference Points"
        visible={wfMarkersVisible}
        onToggle={() => setWfMarkersVisible(!wfMarkersVisible)}
        disabled={!wfAnchor1}
      />
    </div>
  );
}
