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
 * OBB shapes  → clip boxes (full rotation support).
 * Polygon shapes → IClipPolygon (exact footprint; potree supports one at a time).
 * Polyline shapes → no clip region (they have no volume).
 *
 * worldToLocal for polygon clipping:
 *   Potree's shader tests `localPos.xy` for the 2D polygon and `localPos.z` for
 *   elevation. Three.js world space is Y-up (elevation = Y, north = Z), so we
 *   apply a YZ-swap: localX = worldX, localY = worldZ, localZ = worldY.
 */

// YZ-swap matrix: maps Three.js Y-up world space → potree polygon-local space
// where XY = horizontal footprint and Z = elevation.
const YZ_SWAP = new Matrix4().set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1,
);

export function editorShapesToClipRegions(shapes: EditorShape[]): {
  boxes: IClipBox[];
  cylinders: IClipCylinder[];
  polygons: IClipPolygon[];
} {
  const boxes: IClipBox[] = [];
  const polygons: IClipPolygon[] = [];

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
        if (shape.basePoints.length < 3) break;

        // Exact polygon clip using potree's IClipPolygon.
        // basePoints are in Three.js world space: X=east, Y=elevation, Z=north.
        // Shader tests localPos.xy for the footprint and localPos.z for elevation,
        // so vertices use world {x, z} and zMin/zMax are world Y values.
        let minY = Infinity, maxY = -Infinity;
        for (const p of shape.basePoints) {
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }

        polygons.push({
          vertices: shape.basePoints.map((p) => ({ x: p.x, y: p.z })),
          zMin: minY,
          zMax: maxY + shape.height,
          worldToLocal: YZ_SWAP,
        });
        break;
      }

      // Polylines have no volume — no clip region generated
    }
  }

  return { boxes, cylinders: [], polygons };
}
