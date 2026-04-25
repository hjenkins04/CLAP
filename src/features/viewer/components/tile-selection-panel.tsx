import { useMemo, useState } from 'react';
import { Button } from '@clap/design-system';
import { Loader2, X, Check, Square, Focus } from 'lucide-react';
import { useDatasetTilesStore } from '../plugins/dataset-tiles';
import type { ViewerEngine } from '../services/viewer-engine';

interface TileSelectionPanelProps {
  engine: ViewerEngine | null;
}

/**
 * Persistent panel for enabling/disabling individual tiles of a tiled dataset.
 * Shows a top-down 2D projection of all tile bounds and a flat list.
 *
 * Appears when:
 *   - the dataset has a manifest.json (tiled dataset), AND
 *   - the user clicks the "Tile Selection" toolbar button
 */
export function TileSelectionPanel({ engine }: TileSelectionPanelProps) {
  const manifest = useDatasetTilesStore((s) => s.manifest);
  const baseUrl = useDatasetTilesStore((s) => s.baseUrl);
  const panelOpen = useDatasetTilesStore((s) => s.panelOpen);
  const loadedIds = useDatasetTilesStore((s) => s.loadedTileIds);
  const loadingIds = useDatasetTilesStore((s) => s.loadingTileIds);
  const setTileLoaded = useDatasetTilesStore((s) => s.setTileLoaded);
  const setTileLoading = useDatasetTilesStore((s) => s.setTileLoading);
  const setPanelOpen = useDatasetTilesStore((s) => s.setPanelOpen);

  const [hoverTile, setHoverTile] = useState<string | null>(null);

  // Compute the 2D projection of all tile bounds onto the X/Z plane (top-down).
  // Three.js convention here: X = east, Z = north; Y is elevation.
  const projection = useMemo(() => {
    if (!manifest?.tiles.length) return null;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const t of manifest.tiles) {
      minX = Math.min(minX, t.bounds.min[0]);
      minZ = Math.min(minZ, t.bounds.min[2]);
      maxX = Math.max(maxX, t.bounds.max[0]);
      maxZ = Math.max(maxZ, t.bounds.max[2]);
    }
    return { minX, minZ, maxX, maxZ };
  }, [manifest]);

  if (!manifest || !panelOpen) return null;

  const totalTiles = manifest.tiles.length;
  const loadedCount = loadedIds.size;

  const toggleTile = async (id: string) => {
    if (!engine || !baseUrl) return;
    if (loadingIds.has(id)) return;

    if (loadedIds.has(id)) {
      engine.unloadTile(id);
      setTileLoaded(id, false);
      return;
    }

    const tile = manifest.tiles.find((t) => t.id === id);
    if (!tile) return;
    setTileLoading(id, true);
    try {
      await engine.loadTile(id, tile.path, baseUrl);
      setTileLoaded(id, true);
    } catch (err) {
      console.error('[CLAP] tile load failed', id, err);
    } finally {
      setTileLoading(id, false);
    }
  };

  const loadAll = async () => {
    if (!engine || !baseUrl) return;
    for (const tile of manifest.tiles) {
      if (loadedIds.has(tile.id) || loadingIds.has(tile.id)) continue;
      setTileLoading(tile.id, true);
      try {
        await engine.loadTile(tile.id, tile.path, baseUrl);
        setTileLoaded(tile.id, true);
      } catch (err) {
        console.error('[CLAP] tile load failed', tile.id, err);
      } finally {
        setTileLoading(tile.id, false);
      }
    }
  };

  const unloadAllTiles = () => {
    if (!engine) return;
    for (const id of [...loadedIds]) {
      engine.unloadTile(id);
      setTileLoaded(id, false);
    }
  };

  const fitCamera = () => engine?.fitCameraToLoadedTiles();

  // SVG projection: flip Z so north is up
  const SVG_SIZE = 260;
  const svgView = projection
    ? (() => {
        const w = projection.maxX - projection.minX;
        const h = projection.maxZ - projection.minZ;
        const pad = Math.max(w, h) * 0.02;
        return {
          x: projection.minX - pad,
          y: -(projection.maxZ + pad),
          w: w + pad * 2,
          h: h + pad * 2,
        };
      })()
    : null;

  return (
    <div className="absolute left-14 top-4 z-20 flex max-h-[calc(100%-2rem)] w-80 flex-col rounded-lg border border-border bg-card/95 shadow-lg backdrop-blur-sm">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div>
          <h3 className="text-sm font-semibold">Tiles</h3>
          <p className="text-[10px] text-muted-foreground">
            {loadedCount} / {totalTiles} loaded
          </p>
        </div>
        <button
          onClick={() => setPanelOpen(false)}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="flex gap-1 px-3 pt-2">
        <Button variant="outline" size="sm" className="h-7 flex-1 gap-1 text-[11px]" onClick={loadAll}>
          <Check className="h-3 w-3" /> Load all
        </Button>
        <Button variant="outline" size="sm" className="h-7 flex-1 gap-1 text-[11px]" onClick={unloadAllTiles}>
          <Square className="h-3 w-3" /> Clear
        </Button>
        <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={fitCamera} disabled={loadedCount === 0}>
          <Focus className="h-3 w-3" />
        </Button>
      </div>

      {projection && svgView && (
        <div className="px-3 pt-2">
          <svg
            viewBox={`${svgView.x} ${svgView.y} ${svgView.w} ${svgView.h}`}
            width={SVG_SIZE}
            height={SVG_SIZE}
            className="block w-full rounded border border-border bg-background/60"
            preserveAspectRatio="xMidYMid meet"
          >
            {manifest.tiles.map((tile) => {
              const isLoaded = loadedIds.has(tile.id);
              const isLoading = loadingIds.has(tile.id);
              const isHover = hoverTile === tile.id;
              const x = tile.bounds.min[0];
              const zMax = tile.bounds.max[2];
              const w = tile.bounds.max[0] - tile.bounds.min[0];
              const h = tile.bounds.max[2] - tile.bounds.min[2];
              const strokeWidth = Math.max(w, h) * 0.004;
              return (
                <rect
                  key={tile.id}
                  x={x}
                  y={-zMax}
                  width={w}
                  height={h}
                  fill={isLoaded ? 'rgb(79 195 247 / 0.45)' : isHover ? 'rgb(148 163 184 / 0.25)' : 'rgb(148 163 184 / 0.08)'}
                  stroke={isLoaded ? 'rgb(79 195 247)' : isHover ? 'rgb(148 163 184)' : 'rgb(100 116 139 / 0.6)'}
                  strokeWidth={strokeWidth}
                  opacity={isLoading ? 0.6 : 1}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHoverTile(tile.id)}
                  onMouseLeave={() => setHoverTile(null)}
                  onClick={() => toggleTile(tile.id)}
                />
              );
            })}
          </svg>
        </div>
      )}

      <ul className="flex-1 overflow-y-auto px-2 py-2 text-xs">
        {manifest.tiles.map((tile) => {
          const isLoaded = loadedIds.has(tile.id);
          const isLoading = loadingIds.has(tile.id);
          const isHover = hoverTile === tile.id;
          return (
            <li
              key={tile.id}
              onMouseEnter={() => setHoverTile(tile.id)}
              onMouseLeave={() => setHoverTile(null)}
              onClick={() => toggleTile(tile.id)}
              className={`flex cursor-pointer items-center justify-between rounded px-2 py-1 ${
                isLoaded
                  ? 'bg-primary/10 text-foreground'
                  : isHover
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60'
              }`}
            >
              <div className="min-w-0 flex-1 truncate">
                <span className="font-mono text-[10px]">{tile.id}</span>
                <span className="ml-2 text-[10px] text-muted-foreground">
                  {(tile.points / 1_000_000).toFixed(1)} M
                </span>
              </div>
              {isLoading ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
              ) : isLoaded ? (
                <Check className="h-3 w-3 shrink-0 text-primary" />
              ) : (
                <Square className="h-3 w-3 shrink-0 text-muted-foreground/50" />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
