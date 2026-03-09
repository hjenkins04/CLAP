import { useEffect, useCallback, type RefObject } from 'react';
import { usePointCloud } from '../hooks/use-point-cloud';
import { useViewerStore } from '@/app/stores';
import type { ViewerEngine } from '../services/viewer-engine';

interface ViewerCanvasProps {
  containerRef: RefObject<HTMLDivElement | null>;
  engine: ViewerEngine | null;
}

export function ViewerCanvas({ containerRef, engine }: ViewerCanvasProps) {
  const { loadPointCloud, isLoading, error } = usePointCloud(engine);

  const pointSize = useViewerStore((s) => s.pointSize);
  const pointBudget = useViewerStore((s) => s.pointBudget);
  const colorMode = useViewerStore((s) => s.colorMode);
  const edlEnabled = useViewerStore((s) => s.edlEnabled);
  const edlStrength = useViewerStore((s) => s.edlStrength);
  const edlRadius = useViewerStore((s) => s.edlRadius);
  const cameraProjection = useViewerStore((s) => s.cameraProjection);
  const loadedFile = useViewerStore((s) => s.loadedFile);
  const setNumVisiblePoints = useViewerStore((s) => s.setNumVisiblePoints);

  useEffect(() => {
    engine?.setPointSize(pointSize);
  }, [engine, pointSize]);

  useEffect(() => {
    engine?.setPointBudget(pointBudget);
  }, [engine, pointBudget]);

  useEffect(() => {
    engine?.setColorMode(colorMode);
  }, [engine, colorMode]);

  useEffect(() => {
    engine?.setEdl(edlEnabled, edlStrength, edlRadius);
  }, [engine, edlEnabled, edlStrength, edlRadius]);

  useEffect(() => {
    engine?.setCameraProjection(cameraProjection);
  }, [engine, cameraProjection]);

  useEffect(() => {
    engine?.setOnStatsUpdate(setNumVisiblePoints);
  }, [engine, setNumVisiblePoints]);

  const handleLoad = useCallback(async () => {
    if (!loadedFile || !engine) return;
    await loadPointCloud('metadata.json', loadedFile);
  }, [loadedFile, engine, loadPointCloud]);

  useEffect(() => {
    handleLoad();
  }, [handleLoad]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <div className="text-foreground text-sm">
            Loading point cloud...
          </div>
        </div>
      )}

      {error && (
        <div className="absolute bottom-4 left-4 rounded-md bg-destructive/90 px-4 py-2 text-destructive-foreground text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
