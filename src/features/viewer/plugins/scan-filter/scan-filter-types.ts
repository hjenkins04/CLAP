/** One trajectory/pose point extracted during preprocessing. */
export interface TrajectoryPoint {
  x: number;
  y: number;
  z: number;
  scanId: number;
  gpsTime: number;
}

/** Contents of trajectory.json co-located with metadata.json. */
export interface TrajectoryData {
  version: number;
  count: number;
  scanIdRange: [number, number];
  gpsTimeRange: [number, number];
  points: TrajectoryPoint[];
}

/**
 * State machine phases:
 *   idle        — no filter active, trajectory not visible
 *   configuring — user is in scan-filter mode, selecting trajectory points
 *   applied     — scan_id filter active on point cloud
 */
export type ScanFilterPhase = 'idle' | 'configuring' | 'applied';
