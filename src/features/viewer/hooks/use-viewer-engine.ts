import { useEffect, useRef, useState, useMemo, type RefObject } from 'react';
import { ViewerEngine } from '../services/viewer-engine';
import { DEFAULT_VIEWER_CONFIG } from '../types';
import { AxisPlugin, GridPlugin, PoiPlugin, TransformPlugin, ViewCubePlugin, VirtualTilesPlugin, RoiSelectionPlugin, PointSelectPlugin, AnnotatePlugin, ReclassifyPlugin, WorldFramePlugin, BaseMapPlugin, OsmFeaturesPlugin, CustomMapPlugin, StaticObstaclePlugin, RoadExtractionPlugin, ScanFilterPlugin, PointInfoPlugin, PolygonAnnotationPlugin } from '../plugins';

export function useViewerEngine(
  containerRef: RefObject<HTMLDivElement | null>
): ViewerEngine | null {
  const [engine, setEngine] = useState<ViewerEngine | null>(null);
  const engineRef = useRef<ViewerEngine | null>(null);

  const plugins = useMemo(
    () => [new TransformPlugin(), new PoiPlugin(), new PointInfoPlugin(), new VirtualTilesPlugin(), new RoiSelectionPlugin(), new PointSelectPlugin(), new AnnotatePlugin(), new ReclassifyPlugin(), new BaseMapPlugin(), new OsmFeaturesPlugin(), new CustomMapPlugin(), new StaticObstaclePlugin(), new PolygonAnnotationPlugin(), new RoadExtractionPlugin(), new ScanFilterPlugin(), new WorldFramePlugin(), new GridPlugin(), new AxisPlugin(), new ViewCubePlugin()],
    []
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const instance = new ViewerEngine(container, DEFAULT_VIEWER_CONFIG, plugins);
    engineRef.current = instance;
    setEngine(instance);

    const resizeObserver = new ResizeObserver(() => {
      instance.resize();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      instance.dispose();
      engineRef.current = null;
      setEngine(null);
    };
  }, [containerRef, plugins]);

  return engine;
}
