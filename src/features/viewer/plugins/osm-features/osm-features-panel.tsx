import { useOsmFeaturesStore } from './osm-features-store';
import { useWorldFrameStore } from '../world-frame';

export function OsmFeaturesPanel() {
  const opacity = useOsmFeaturesStore((s) => s.opacity);
  const loading = useOsmFeaturesStore((s) => s.loading);
  const setOpacity = useOsmFeaturesStore((s) => s.setOpacity);
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
      {loading && (
        <div className="mb-2 text-xs text-muted-foreground">
          Loading OSM data...
        </div>
      )}

      <div className="mb-3">
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
