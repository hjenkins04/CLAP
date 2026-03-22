export type RoiShapeType = 'box' | 'cylinder' | 'rect-2d' | 'polygon-2d';

export type RoiDrawTool = RoiShapeType;

interface RoiShapeBase {
  id: string;
  type: RoiShapeType;
}

export interface BoxRoiShape extends RoiShapeBase {
  type: 'box';
  /** Center in PCO local space */
  center: { x: number; y: number; z: number };
  /** Half-extents in PCO local space */
  halfExtents: { x: number; y: number; z: number };
}

export interface CylinderRoiShape extends RoiShapeBase {
  type: 'cylinder';
  /** Center XY in PCO local space */
  center: { x: number; y: number };
  radius: number;
  zMin: number;
  zMax: number;
}

export interface Rect2dRoiShape extends RoiShapeBase {
  type: 'rect-2d';
  /** Min corner in local XY, extruded full Z */
  min: { x: number; y: number };
  max: { x: number; y: number };
}

export interface Polygon2dRoiShape extends RoiShapeBase {
  type: 'polygon-2d';
  /** Vertices in local XY, extruded full Z */
  vertices: Array<{ x: number; y: number }>;
}

export type RoiShape = BoxRoiShape | CylinderRoiShape | Rect2dRoiShape | Polygon2dRoiShape;
