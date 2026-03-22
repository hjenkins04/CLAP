import { Box3, Matrix4, Vector3 } from 'three';
import type { IClipBox, IClipCylinder, IClipPolygon } from 'potree-core';
import type { RoiShape } from './roi-types';

interface ClipResult {
  boxes: IClipBox[];
  cylinders: IClipCylinder[];
  polygons: IClipPolygon[];
}

/**
 * Convert ROI shapes (in PCO local space) into potree clip regions.
 * The caller must provide the transform group's world matrix so that
 * local coordinates are correctly projected into world space.
 */
export function shapesToClipRegions(
  shapes: RoiShape[],
  localBBox: Box3,
  groupWorldMatrix: Matrix4,
): ClipResult {
  const boxes: IClipBox[] = [];
  const cylinders: IClipCylinder[] = [];
  const polygons: IClipPolygon[] = [];
  const zMin = localBBox.min.z;
  const zMax = localBBox.max.z;
  const zExtent = zMax - zMin;
  const zCenter = (zMin + zMax) / 2;

  for (const shape of shapes) {
    switch (shape.type) {
      case 'box': {
        const { center, halfExtents } = shape;
        const local = new Matrix4();
        local.makeTranslation(center.x, center.y, center.z);
        local.scale(
          new Vector3(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2),
        );
        const world = groupWorldMatrix.clone().multiply(local);
        boxes.push({
          box: new Box3(
            new Vector3(
              center.x - halfExtents.x,
              center.y - halfExtents.y,
              center.z - halfExtents.z,
            ),
            new Vector3(
              center.x + halfExtents.x,
              center.y + halfExtents.y,
              center.z + halfExtents.z,
            ),
          ),
          matrix: world,
          inverse: world.clone().invert(),
          position: new Vector3(center.x, center.y, center.z).applyMatrix4(
            groupWorldMatrix,
          ),
        });
        break;
      }

      case 'rect-2d': {
        const dx = shape.max.x - shape.min.x;
        const dy = shape.max.y - shape.min.y;
        const cx = (shape.min.x + shape.max.x) / 2;
        const cy = (shape.min.y + shape.max.y) / 2;
        const local = new Matrix4();
        local.makeTranslation(cx, cy, zCenter);
        local.scale(new Vector3(dx, dy, zExtent));
        const world = groupWorldMatrix.clone().multiply(local);
        boxes.push({
          box: new Box3(
            new Vector3(shape.min.x, shape.min.y, zMin),
            new Vector3(shape.max.x, shape.max.y, zMax),
          ),
          matrix: world,
          inverse: world.clone().invert(),
          position: new Vector3(cx, cy, zCenter).applyMatrix4(
            groupWorldMatrix,
          ),
        });
        break;
      }

      case 'cylinder': {
        const { center, radius, zMin: czMin, zMax: czMax } = shape;
        const cHeight = czMax - czMin;
        const cz = (czMin + czMax) / 2;
        const local = new Matrix4();
        local.makeTranslation(center.x, center.y, cz);
        local.scale(new Vector3(radius * 2, radius * 2, cHeight));
        const world = groupWorldMatrix.clone().multiply(local);
        cylinders.push({
          matrix: world,
          inverse: world.clone().invert(),
          position: new Vector3(center.x, center.y, cz).applyMatrix4(
            groupWorldMatrix,
          ),
        });
        break;
      }

      case 'polygon-2d': {
        // Native polygon clipping — pass vertices directly to shader
        const worldToLocal = groupWorldMatrix.clone().invert();
        polygons.push({
          vertices: shape.vertices,
          zMin,
          zMax,
          worldToLocal,
        });
        break;
      }
    }
  }

  return { boxes, cylinders, polygons };
}
