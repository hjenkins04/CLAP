import { Box3, Matrix4, Vector3 } from 'three';
import type { IClipBox, IClipCylinder, IClipPolygon } from 'potree-core';
import type { RoiShape } from './roi-types';
import type { EditorShape } from '../../modules/shape-editor';
import { obbCorners } from '../../modules/shape-editor';

interface ClipResult {
  boxes: IClipBox[];
  cylinders: IClipCylinder[];
  polygons: IClipPolygon[];
}

/**
 * Convert ROI shapes (in shape space: x=east, y=north, z=elevation) into
 * potree clip regions. The caller must provide the transform group's world
 * matrix so that local coordinates are correctly projected into world space.
 *
 * isYUp: true when the PCO local Three.js space uses X=east, Y=elevation,
 * Z=north (pre-transformed point clouds). When false, X=east, Y=north,
 * Z=elevation (Z-up, e.g. point clouds with a -90° X GlobalTransform).
 */
export function shapesToClipRegions(
  shapes: RoiShape[],
  localBBox: Box3,
  groupWorldMatrix: Matrix4,
  isYUp = false,
): ClipResult {
  const boxes: IClipBox[] = [];
  const cylinders: IClipCylinder[] = [];
  const polygons: IClipPolygon[] = [];

  // Full elevation span from the bounding box in Three.js local space.
  // Y-up: elevation is in the Y axis. Z-up: elevation is in the Z axis.
  const elevMin = isYUp ? localBBox.min.y : localBBox.min.z;
  const elevMax = isYUp ? localBBox.max.y : localBBox.max.z;
  const elevExtent = elevMax - elevMin;
  const elevCenter = (elevMin + elevMax) / 2;

  // Translate shape-space (east, north, elevation) to Three.js local position.
  const toLocal = (east: number, north: number, elev: number): Vector3 =>
    isYUp ? new Vector3(east, elev, north) : new Vector3(east, north, elev);

  for (const shape of shapes) {
    switch (shape.type) {
      case 'box': {
        // center: {x: east, y: north, z: elevation}, halfExtents same axes
        const { center, halfExtents } = shape;
        const localCenter = toLocal(center.x, center.y, center.z);
        const local = new Matrix4();
        local.makeTranslation(localCenter.x, localCenter.y, localCenter.z);
        local.scale(
          isYUp
            ? new Vector3(halfExtents.x * 2, halfExtents.z * 2, halfExtents.y * 2)
            : new Vector3(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2),
        );
        const world = groupWorldMatrix.clone().multiply(local);
        const bMin = toLocal(
          center.x - halfExtents.x,
          center.y - halfExtents.y,
          center.z - halfExtents.z,
        );
        const bMax = toLocal(
          center.x + halfExtents.x,
          center.y + halfExtents.y,
          center.z + halfExtents.z,
        );
        boxes.push({
          box: new Box3(bMin, bMax),
          matrix: world,
          inverse: world.clone().invert(),
          position: localCenter.clone().applyMatrix4(groupWorldMatrix),
        });
        break;
      }

      case 'rect-2d': {
        // min/max: {x: east, y: north}; covers full elevation span
        const dx = shape.max.x - shape.min.x;
        const dy = shape.max.y - shape.min.y;
        const cx = (shape.min.x + shape.max.x) / 2;
        const cy = (shape.min.y + shape.max.y) / 2;
        const localCenter = toLocal(cx, cy, elevCenter);
        const local = new Matrix4();
        local.makeTranslation(localCenter.x, localCenter.y, localCenter.z);
        local.scale(
          isYUp
            ? new Vector3(dx, elevExtent, dy)
            : new Vector3(dx, dy, elevExtent),
        );
        const world = groupWorldMatrix.clone().multiply(local);
        boxes.push({
          box: new Box3(
            toLocal(shape.min.x, shape.min.y, elevMin),
            toLocal(shape.max.x, shape.max.y, elevMax),
          ),
          matrix: world,
          inverse: world.clone().invert(),
          position: localCenter.clone().applyMatrix4(groupWorldMatrix),
        });
        break;
      }

      case 'cylinder': {
        // center: {x: east, y: north}; zMin/zMax: elevation
        const { center, radius, zMin: czMin, zMax: czMax } = shape;
        const cHeight = czMax - czMin;
        const cElevCenter = (czMin + czMax) / 2;
        const localCenter = toLocal(center.x, center.y, cElevCenter);
        const local = new Matrix4();
        local.makeTranslation(localCenter.x, localCenter.y, localCenter.z);
        local.scale(
          isYUp
            ? new Vector3(radius * 2, cHeight, radius * 2)
            : new Vector3(radius * 2, radius * 2, cHeight),
        );
        const world = groupWorldMatrix.clone().multiply(local);
        cylinders.push({
          matrix: world,
          inverse: world.clone().invert(),
          position: localCenter.clone().applyMatrix4(groupWorldMatrix),
        });
        break;
      }

      case 'polygon-2d': {
        // Native polygon clipping — vertices are east/north in shape space
        const worldToLocal = groupWorldMatrix.clone().invert();
        polygons.push({
          vertices: shape.vertices,
          zMin: elevMin,
          zMax: elevMax,
          worldToLocal,
        });
        break;
      }
    }
  }

  return { boxes, cylinders, polygons };
}

/**
 * Convert world-space EditorShapes (from ShapeEditorEngine) directly to
 * potree clip regions. All matrices are in world/scene space — no additional
 * transform group is needed.
 *
 * OBB shapes map to clip boxes (full rotation support).
 * Polygon shapes map to clip boxes (conservative AABB approximation).
 * Polyline shapes produce no clip region (they have no volume).
 */
export function editorShapesToClipRegions(shapes: EditorShape[]): {
  boxes: IClipBox[];
  cylinders: IClipCylinder[];
  polygons: IClipPolygon[];
} {
  const boxes: IClipBox[] = [];

  for (const shape of shapes) {
    switch (shape.type) {
      case 'obb': {
        const { center, halfExtents, rotationY } = shape;

        // World matrix: translate → rotate → scale to unit cube
        // Potree checks: inverse * worldPoint → unit cube test
        const worldMatrix = new Matrix4()
          .makeTranslation(center.x, center.y, center.z)
          .multiply(new Matrix4().makeRotationY(rotationY))
          .multiply(
            new Matrix4().makeScale(
              halfExtents.x * 2,
              halfExtents.y * 2,
              halfExtents.z * 2,
            ),
          );
        const inverse = worldMatrix.clone().invert();

        // World-space AABB for BVH culling
        const worldBox = new Box3();
        for (const c of obbCorners(shape)) worldBox.expandByPoint(c);

        boxes.push({
          box: worldBox,
          matrix: worldMatrix,
          inverse,
          position: new Vector3(center.x, center.y, center.z),
        });
        break;
      }

      case 'polygon': {
        // Conservative AABB clip box from the polygon footprint + height.
        if (shape.basePoints.length < 3) break;

        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        let minY = Infinity;

        for (const p of shape.basePoints) {
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
          minY = Math.min(minY, p.y);
        }

        const cx = (minX + maxX) / 2;
        const cy = minY + shape.height / 2;
        const cz = (minZ + maxZ) / 2;
        const hx = Math.max(0.01, (maxX - minX) / 2);
        const hy = Math.max(0.01, shape.height / 2);
        const hz = Math.max(0.01, (maxZ - minZ) / 2);

        const worldMatrix = new Matrix4()
          .makeTranslation(cx, cy, cz)
          .multiply(new Matrix4().makeScale(hx * 2, hy * 2, hz * 2));
        const inverse = worldMatrix.clone().invert();

        boxes.push({
          box: new Box3(
            new Vector3(cx - hx, cy - hy, cz - hz),
            new Vector3(cx + hx, cy + hy, cz + hz),
          ),
          matrix: worldMatrix,
          inverse,
          position: new Vector3(cx, cy, cz),
        });
        break;
      }

      // Polylines have no volume — no clip region generated
    }
  }

  return { boxes, cylinders: [], polygons: [] };
}
