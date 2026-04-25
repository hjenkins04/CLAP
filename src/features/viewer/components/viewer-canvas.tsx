import { useEffect, useCallback, type RefObject } from 'react';
import { usePointCloud } from '../hooks/use-point-cloud';
import { useViewerStore } from '@/app/stores';
import type { ViewerEngine } from '../services/viewer-engine';
import { electronFetch } from '../services/electron-fetch';
import { useDatasetTilesStore, type DatasetManifest } from '../plugins/dataset-tiles';
import {
  fetchProjectLegend,
  loadDefaultLegend,
  useClassificationLegendStore,
} from '../services/classification-legend';
import { useAnnotateStore } from '../plugins/annotate/annotate-store';

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
  const pointCloudVisible = useViewerStore((s) => s.pointCloudVisible);

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

  useEffect(() => {
    engine?.setPointCloudVisible(pointCloudVisible);
  }, [engine, pointCloudVisible]);

  const handleLoad = useCallback(async () => {
    if (!loadedFile || !engine) return;

    // Clear any previous tiled-dataset state when the folder changes
    useDatasetTilesStore.getState().setManifest(null, null);

    // Load the per-project classification legend (or fall back to the bundled
    // default) BEFORE any PCO load so annotate-plugin's onPointCloudLoaded
    // picks up the right colours on first paint.
    const projectLegend = await fetchProjectLegend(loadedFile);
    if (projectLegend) {
      useClassificationLegendStore
        .getState()
        .setLegend(projectLegend, 'project', loadedFile);
      useAnnotateStore.getState().applyLegendDefaults(projectLegend);
    } else {
      const fallback = loadDefaultLegend();
      useClassificationLegendStore.getState().setLegend(fallback, 'default', null);
      useAnnotateStore.getState().applyLegendDefaults(fallback);
    }

    // Tiled dataset detection: if manifest.json exists, the user picks tiles
    // via the tile-selection panel; don't auto-load.
    try {
      const resp = await electronFetch(`${loadedFile}manifest.json`);
      if (resp.ok) {
        const manifest = (await resp.json()) as DatasetManifest;
        if (manifest.type === 'tiled' && Array.isArray(manifest.tiles)) {
          engine.unloadAll();
          useDatasetTilesStore
            .getState()
            .setManifest(manifest, loadedFile);
          useDatasetTilesStore.getState().setPanelOpen(true);
          useDatasetTilesStore.getState().setBoundsLayerVisible(true);
          return;
        }
      }
    } catch {
      // fall through to legacy single-cloud load
    }

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
