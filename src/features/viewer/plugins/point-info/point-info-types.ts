export interface PointInfo {
  worldPos: { x: number; y: number; z: number };
  scanId: number | null;
  classification: number | null;
  intensity: number | null;
  gpsTime: number | null;
}

export type PointInfoPhase = 'idle' | 'picking';
