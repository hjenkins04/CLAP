import { useOsmFeaturesStore, OSM_LAYER_KEYS, type OsmLayerKey } from './osm-features-store';
import { useWorldFrameStore } from '../world-frame';

const LAYER_LABELS: Record<OsmLayerKey, string> = {
  buildings: 'Buildings',
  roads: 'Roads',
  water: 'Water',
  railways: 'Railways',
  vegetation: 'Vegetation',
};

export function OsmFeaturesPanel() {
  const opacity = useOsmFeaturesStore((s) => s.opacity);
  const loadingLayer = useOsmFeaturesStore((s) => s.loadingLayer);
  const layers = useOsmFeaturesStore((s) => s.layers);
  const loadedLayers = useOsmFeaturesStore((s) => s.loadedLayers);
  const setOpacity = useOsmFeaturesStore((s) => s.setOpacity);
  const setLayerVisible = useOsmFeaturesStore((s) => s.setLayerVisible);
  const transform = useWorldFrameStore((s) => s.transform);

  if (!transform) {
    return (
      <div className="text-xs text-muted-foreground">
        Set a world frame to enable OSM features.
      </div>
    );
  }

  return (
    <>
      <div className="mb-3 space-y-1">
        {OSM_LAYER_KEYS.map((key) => (
          <div key={key} className="flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={(e) => setLayerVisible(key, e.target.checked)}
                className="accent-primary"
              />
              {LAYER_LABELS[key]}
            </label>
            <span className="text-xs text-muted-foreground">
              {loadingLayer === key
                ? 'Loading…'
                : loadedLayers[key]
                  ? 'Loaded'
                  : ''}
            </span>
          </div>
        ))}
      </div>

      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Opacity: {Math.round(opacity * 100)}%
        </label>
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))}
          className="w-full accent-primary"
        />
      </div>
    </>
  );
}
