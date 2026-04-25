export interface TileInfo {
  id: string;
  path: string;
  points: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
}

export interface DatasetManifest {
  version: number;
  type: 'tiled';
  totalPoints: number;
  origin: { originX: number; originY: number };
  crs: Record<string, unknown> | null;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  } | null;
  tiles: TileInfo[];
}
