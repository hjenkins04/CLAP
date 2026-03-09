import { useState, useCallback } from 'react';
import type { ViewerEngine } from '../services/viewer-engine';

interface UsePointCloudResult {
  isLoading: boolean;
  error: string | null;
  loadPointCloud: (url: string, baseUrl: string) => Promise<void>;
}

/**
 * Hook for loading point cloud data into the viewer engine.
 */
export function usePointCloud(
  engine: ViewerEngine | null
): UsePointCloudResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPointCloud = useCallback(
    async (url: string, baseUrl: string) => {
      if (!engine) {
        console.warn('[CLAP] loadPointCloud called but engine is null');
        setError('Viewer engine not initialized');
        return;
      }

      console.info('[CLAP] Loading point cloud:', url, 'from', baseUrl);
      setIsLoading(true);
      setError(null);

      try {
        engine.unloadAll();
        await engine.loadPointCloud(url, baseUrl);
        console.info('[CLAP] Point cloud loaded successfully');
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load point cloud';
        setError(message);
        console.error('[CLAP] Point cloud load error:', err);
      } finally {
        setIsLoading(false);
      }
    },
    [engine]
  );

  return { isLoading, error, loadPointCloud };
}
