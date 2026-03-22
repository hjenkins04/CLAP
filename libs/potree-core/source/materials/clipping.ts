import {Box3, Matrix4, Vector3} from 'three';

export enum ClipMode {
  DISABLED = 0,
  CLIP_OUTSIDE = 1,
  CLIP_INSIDE = 2,
  HIGHLIGHT_INSIDE = 3,
}

export interface IClipBox {
  box: Box3;
  inverse: Matrix4;
  matrix: Matrix4;
  position: Vector3;
}

export interface IClipCylinder {
  inverse: Matrix4;
  matrix: Matrix4;
  position: Vector3;
}

export interface IClipPolygon {
  /** Polygon vertices in world space XY (closed — last connects to first) */
  vertices: Array<{ x: number; y: number }>;
  /** World-space Z range for the polygon extrusion */
  zMin: number;
  zMax: number;
  /** Matrix to transform world-space points into the polygon's local space */
  worldToLocal: Matrix4;
}
