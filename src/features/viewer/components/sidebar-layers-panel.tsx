import { useState } from 'react';
import {
  Eye,
  EyeOff,
  Satellite,
  Cloud,
  Grid3x3,
  Crosshair,
  MapPin,
  ChevronDown,
  Building2,
  Route,
  Droplets,
  TrainFront,
  TreePine,
  Globe,
  Loader2,
  Box,
} from 'lucide-react';
import { useViewerStore } from '@/app/stores';
import { useBaseMapStore } from '../plugins/base-map';
import { useGridStore } from '../plugins/grid/grid-store';
import { usePoiStore } from '../plugins/poi/poi-store';
import { useWorldFrameStore } from '../plugins/world-frame';
import { useOsmFeaturesStore, OSM_LAYER_KEYS, type OsmLayerKey } from '../plugins/osm-features/osm-features-store';
import { useStaticObstacleStore } from '../plugins/static-obstacle';
import { usePolyAnnotStore } from '../plugins/polygon-annotation';
import { Pentagon } from 'lucide-react';

// ── Shared row components ────────────────────────────────────────────

interface LayerRowProps {
  icon: React.ReactNode;
  name: string;
  visible: boolean;
  onToggle: () => void;
  disabled?: boolean;
  indent?: boolean;
  loading?: boolean;
}

function LayerRow({ icon, name, visible, onToggle, disabled, indent, loading }: LayerRowProps) {
  return (
    <div className={`flex items-center justify-between py-1.5 ${indent ? 'pl-5' : ''}`}>
      <div className="flex items-center gap-2">
        <span className={visible && !disabled ? 'text-muted-foreground' : 'text-muted-foreground/40'}>
          {icon}
        </span>
        <span className={`text-xs ${!visible || disabled ? 'text-muted-foreground/50' : ''}`}>
          {name}
        </span>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
      <button
        onClick={onToggle}
        disabled={disabled || loading}
        className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
      >
        {visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

interface LayerGroupProps {
  icon: React.ReactNode;
  name: string;
  visible: boolean;
  onToggle: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

function LayerGroup({ icon, name, visible, onToggle, disabled, children }: LayerGroupProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <div className="flex items-center justify-between py-1.5">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setExpanded(!expanded)}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={`h-3 w-3 transition-transform ${expanded ? '' : '-rotate-90'}`}
            />
          </button>
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
          {visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
      </div>
      {expanded && children}
    </>
  );
}

// ── OSM sub-layer config ─────────────────────────────────────────────

const OSM_LAYER_META: Record<OsmLayerKey, { name: string; icon: React.ReactNode }> = {
  buildings: { name: 'Buildings', icon: <Building2 className="h-3.5 w-3.5" /> },
  roads: { name: 'Roads', icon: <Route className="h-3.5 w-3.5" /> },
  water: { name: 'Water', icon: <Droplets className="h-3.5 w-3.5" /> },
  railways: { name: 'Railways', icon: <TrainFront className="h-3.5 w-3.5" /> },
  vegetation: { name: 'Vegetation', icon: <TreePine className="h-3.5 w-3.5" /> },
};

// ── Main panel ───────────────────────────────────────────────────────

export function SidebarLayersPanel() {
  const pcVisible = useViewerStore((s) => s.pointCloudVisible);
  const setPcVisible = useViewerStore((s) => s.setPointCloudVisible);

  const baseMapVisible = useBaseMapStore((s) => s.visible);
  const setBaseMapVisible = useBaseMapStore((s) => s.setVisible);
  const hasWorldFrame = useWorldFrameStore((s) => s.phase) === 'confirmed';

  const gridVisible = useGridStore((s) => s.visible);
  const setGridVisible = useGridStore((s) => s.setVisible);

  const poiPosition = usePoiStore((s) => s.position);
  const poiMarkerVisible = usePoiStore((s) => s.markerVisible);
  const setPoiMarkerVisible = usePoiStore((s) => s.setMarkerVisible);

  const wfAnchor1 = useWorldFrameStore((s) => s.anchor1);
  const wfMarkersVisible = useWorldFrameStore((s) => s.markersVisible);
  const setWfMarkersVisible = useWorldFrameStore((s) => s.setMarkersVisible);

  // Static obstacle annotation layers
  const annotationLayers = useStaticObstacleStore((s) => s.layers);
  const annotations = useStaticObstacleStore((s) => s.annotations);
  const setAnnotationLayerVisible = useStaticObstacleStore((s) => s.setLayerVisible);
  const setAnnotationVisible = useStaticObstacleStore((s) => s.setAnnotationVisible);

  // Polygon annotation layers
  const polyLayers = usePolyAnnotStore((s) => s.layers);
  const polyAnnotations = usePolyAnnotStore((s) => s.annotations);
  const setPolyLayerVisible = usePolyAnnotStore((s) => s.setLayerVisible);
  const setPolyAnnotVisible = usePolyAnnotStore((s) => s.setAnnotationVisible);

  // OSM features
  const osmVisible = useOsmFeaturesStore((s) => s.visible);
  const setOsmVisible = useOsmFeaturesStore((s) => s.setVisible);
  const osmLayers = useOsmFeaturesStore((s) => s.layers);
  const osmLoadingLayer = useOsmFeaturesStore((s) => s.loadingLayer);
  const setOsmLayerVisible = useOsmFeaturesStore((s) => s.setLayerVisible);

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
        icon={<Satellite className="h-3.5 w-3.5" />}
        name="Base Satellite Map"
        visible={baseMapVisible}
        onToggle={() => setBaseMapVisible(!baseMapVisible)}
        disabled={!hasWorldFrame}
      />

      <LayerGroup
        icon={<Globe className="h-3.5 w-3.5" />}
        name="OSM Features"
        visible={osmVisible}
        onToggle={() => setOsmVisible(!osmVisible)}
        disabled={!hasWorldFrame}
      >
        {OSM_LAYER_KEYS.map((key) => (
          <LayerRow
            key={key}
            icon={OSM_LAYER_META[key].icon}
            name={OSM_LAYER_META[key].name}
            visible={osmLayers[key]}
            onToggle={() => setOsmLayerVisible(key, !osmLayers[key])}
            disabled={!hasWorldFrame || !osmVisible}
            loading={osmLoadingLayer === key}
            indent
          />
        ))}
      </LayerGroup>

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

      {/* Static obstacle annotation layers */}
      {annotationLayers.length > 0 && (
        <>
          <h3 className="mt-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Annotations
          </h3>
          {annotationLayers.map((layer) => {
            const layerAnnotations = annotations.filter((a) => a.layerId === layer.id);
            return (
              <LayerGroup
                key={layer.id}
                icon={
                  <span
                    className="inline-block h-3 w-3 rounded-sm border border-border flex-shrink-0"
                    style={{ backgroundColor: layer.color }}
                  />
                }
                name={`${layer.name} (${layerAnnotations.length})`}
                visible={layer.visible}
                onToggle={() => setAnnotationLayerVisible(layer.id, !layer.visible)}
              >
                {layerAnnotations.map((ann) => (
                  <LayerRow
                    key={ann.id}
                    icon={<Box className="h-3.5 w-3.5" />}
                    name={ann.label}
                    visible={ann.visible}
                    onToggle={() => setAnnotationVisible(ann.id, !ann.visible)}
                    disabled={!layer.visible}
                    indent
                  />
                ))}
              </LayerGroup>
            );
          })}
        </>
      )}

      {/* Polygon annotation layers */}
      {polyLayers.length > 0 && (
        <>
          <h3 className="mt-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Polygons
          </h3>
          {polyLayers.map((layer) => {
            const layerPolys = polyAnnotations.filter((a) => a.layerId === layer.id);
            return (
              <LayerGroup
                key={layer.id}
                icon={
                  <span
                    className="inline-block h-3 w-3 rounded-sm border border-border flex-shrink-0"
                    style={{ backgroundColor: layer.color }}
                  />
                }
                name={`${layer.name} (${layerPolys.length})`}
                visible={layer.visible}
                onToggle={() => setPolyLayerVisible(layer.id, !layer.visible)}
              >
                {layerPolys.map((ann) => (
                  <LayerRow
                    key={ann.id}
                    icon={<Pentagon className="h-3.5 w-3.5" />}
                    name={ann.label}
                    visible={ann.visible}
                    onToggle={() => setPolyAnnotVisible(ann.id, !ann.visible)}
                    disabled={!layer.visible}
                    indent
                  />
                ))}
              </LayerGroup>
            );
          })}
        </>
      )}
    </div>
  );
}
