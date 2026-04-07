export type SnapMode = 'vertex' | 'edge' | 'face' | 'pointcloud' | 'surface' | 'dem';

export interface SnapModeConfig {
  vertex: boolean;
  edge: boolean;
  face: boolean;
  pointcloud: boolean;
  /** Point Cloud Surface — pick nearest PCO point to the cursor ray (buildings, walls, objects). */
  surface: boolean;
  dem: boolean;
}

export const DEFAULT_SNAP_MODES: SnapModeConfig = {
  vertex: true,
  edge: false,
  face: false,
  pointcloud: false,
  surface: false,
  dem: true,
};

export const SNAP_MODE_LABELS: Record<SnapMode, string> = {
  vertex:     'Vertex',
  edge:       'Edge',
  face:       'Face',
  pointcloud: 'Point Cloud',
  surface:    'Point Cloud Surface',
  dem:        'Terrain (DEM)',
};
