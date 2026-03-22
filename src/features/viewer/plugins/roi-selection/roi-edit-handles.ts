import type { RoiShape } from './roi-types';

export interface ControlPoint {
  x: number;
  y: number;
  /** Explicit Z — when set, handles use this instead of the DEM getZ callback */
  z?: number;
}

/** Extract editable control points from a shape. */
export function getControlPoints(shape: RoiShape): ControlPoint[] {
  switch (shape.type) {
    case 'rect-2d':
      // 2D shape — no explicit Z, handles will use DEM
      return [
        { x: shape.min.x, y: shape.min.y },
        { x: shape.max.x, y: shape.min.y },
        { x: shape.max.x, y: shape.max.y },
        { x: shape.min.x, y: shape.max.y },
      ];
    case 'box': {
      const { center, halfExtents } = shape;
      const x0 = center.x - halfExtents.x;
      const x1 = center.x + halfExtents.x;
      const y0 = center.y - halfExtents.y;
      const y1 = center.y + halfExtents.y;
      if (halfExtents.z > 0.01) {
        // 3D box — 8 corner handles at actual Z positions
        const zBot = center.z - halfExtents.z;
        const zTop = center.z + halfExtents.z;
        return [
          { x: x0, y: y0, z: zBot },
          { x: x1, y: y0, z: zBot },
          { x: x1, y: y1, z: zBot },
          { x: x0, y: y1, z: zBot },
          { x: x0, y: y0, z: zTop },
          { x: x1, y: y0, z: zTop },
          { x: x1, y: y1, z: zTop },
          { x: x0, y: y1, z: zTop },
        ];
      }
      // Flat box — 4 corners, no explicit Z
      return [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ];
    }
    case 'cylinder': {
      const cz = (shape.zMin + shape.zMax) / 2;
      const has3D = (shape.zMax - shape.zMin) > 0.01;
      return [
        { x: shape.center.x, y: shape.center.y, z: has3D ? cz : undefined },
        { x: shape.center.x + shape.radius, y: shape.center.y, z: has3D ? cz : undefined },
      ];
    }
    case 'polygon-2d':
      return shape.vertices.map((v) => ({ x: v.x, y: v.y }));
  }
}

/** Get the centroid of a shape (for gizmo placement). */
export function getShapeCenter(shape: RoiShape): ControlPoint {
  switch (shape.type) {
    case 'rect-2d':
      return {
        x: (shape.min.x + shape.max.x) / 2,
        y: (shape.min.y + shape.max.y) / 2,
      };
    case 'box':
      return { x: shape.center.x, y: shape.center.y };
    case 'cylinder':
      return { x: shape.center.x, y: shape.center.y };
    case 'polygon-2d': {
      if (shape.vertices.length === 0) return { x: 0, y: 0 };
      let sx = 0;
      let sy = 0;
      for (const v of shape.vertices) {
        sx += v.x;
        sy += v.y;
      }
      return { x: sx / shape.vertices.length, y: sy / shape.vertices.length };
    }
  }
}

/** Get the Z-center of a 3D shape (0 for 2D shapes). */
export function getShapeCenterZ(shape: RoiShape): number {
  switch (shape.type) {
    case 'box':
      return shape.center.z;
    case 'cylinder':
      return (shape.zMin + shape.zMax) / 2;
    default:
      return 0;
  }
}

/** Move a single control point, returning the updated shape. */
export function moveControlPoint(
  shape: RoiShape,
  index: number,
  newPos: ControlPoint,
): RoiShape {
  switch (shape.type) {
    case 'rect-2d': {
      const oppositeIdx = (index + 2) % 4;
      const corners = getControlPoints(shape);
      const fixed = corners[oppositeIdx];
      return {
        ...shape,
        min: {
          x: Math.min(newPos.x, fixed.x),
          y: Math.min(newPos.y, fixed.y),
        },
        max: {
          x: Math.max(newPos.x, fixed.x),
          y: Math.max(newPos.y, fixed.y),
        },
      };
    }
    case 'box': {
      const corners = getControlPoints(shape);
      const is3D = corners.length === 8;
      // For 3D box: indices 0-3 = bottom, 4-7 = top
      // Opposite XY corner: +2 mod 4 within the same face
      const faceIdx = is3D ? index % 4 : index;
      const oppFaceIdx = (faceIdx + 2) % 4;
      const oppositeIdx = is3D ? oppFaceIdx + (index < 4 ? 0 : 4) : oppFaceIdx;
      const fixed = corners[oppositeIdx];

      const minX = Math.min(newPos.x, fixed.x);
      const maxX = Math.max(newPos.x, fixed.x);
      const minY = Math.min(newPos.y, fixed.y);
      const maxY = Math.max(newPos.y, fixed.y);

      const result = {
        ...shape,
        center: {
          ...shape.center,
          x: (minX + maxX) / 2,
          y: (minY + maxY) / 2,
        },
        halfExtents: {
          ...shape.halfExtents,
          x: (maxX - minX) / 2,
          y: (maxY - minY) / 2,
        },
      };

      // If dragging a point with explicit Z, also update Z extent
      if (is3D && newPos.z !== undefined) {
        const isBottom = index < 4;
        const otherZ = isBottom
          ? shape.center.z + shape.halfExtents.z  // top Z
          : shape.center.z - shape.halfExtents.z; // bottom Z
        const newZMin = Math.min(newPos.z, otherZ);
        const newZMax = Math.max(newPos.z, otherZ);
        result.center = { ...result.center, z: (newZMin + newZMax) / 2 };
        result.halfExtents = { ...result.halfExtents, z: (newZMax - newZMin) / 2 };
      }

      return result;
    }
    case 'cylinder': {
      if (index === 0) {
        return { ...shape, center: { x: newPos.x, y: newPos.y } };
      }
      const dx = newPos.x - shape.center.x;
      const dy = newPos.y - shape.center.y;
      return {
        ...shape,
        radius: Math.max(0.1, Math.sqrt(dx * dx + dy * dy)),
      };
    }
    case 'polygon-2d': {
      const vertices = [...shape.vertices];
      vertices[index] = { x: newPos.x, y: newPos.y };
      return { ...shape, vertices };
    }
  }
}

/**
 * Move multiple selected control points by a screen-space delta converted
 * to local-space (dx, dy). Uses the original point positions so sequential
 * updates don't compound.
 */
export function moveSelectedPoints(
  shape: RoiShape,
  selectedIndices: number[],
  dx: number,
  dy: number,
): RoiShape {
  if (selectedIndices.length === 0) return shape;
  const origPoints = getControlPoints(shape);

  // If all points selected, translate the whole shape
  if (selectedIndices.length === origPoints.length) {
    return translateShape(shape, dx, dy);
  }

  switch (shape.type) {
    case 'polygon-2d': {
      const newVerts = shape.vertices.map((v, i) =>
        selectedIndices.includes(i)
          ? { x: v.x + dx, y: v.y + dy }
          : v,
      );
      return { ...shape, vertices: newVerts };
    }
    case 'rect-2d': {
      const corners = origPoints.map((p, i) =>
        selectedIndices.includes(i)
          ? { x: p.x + dx, y: p.y + dy }
          : p,
      );
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const c of corners) {
        minX = Math.min(minX, c.x);
        minY = Math.min(minY, c.y);
        maxX = Math.max(maxX, c.x);
        maxY = Math.max(maxY, c.y);
      }
      return {
        ...shape,
        min: { x: minX, y: minY },
        max: { x: maxX, y: maxY },
      };
    }
    case 'box': {
      const corners = origPoints.map((p, i) =>
        selectedIndices.includes(i)
          ? { x: p.x + dx, y: p.y + dy, z: p.z }
          : p,
      );
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const c of corners) {
        minX = Math.min(minX, c.x);
        minY = Math.min(minY, c.y);
        maxX = Math.max(maxX, c.x);
        maxY = Math.max(maxY, c.y);
      }
      return {
        ...shape,
        center: {
          ...shape.center,
          x: (minX + maxX) / 2,
          y: (minY + maxY) / 2,
        },
        halfExtents: {
          ...shape.halfExtents,
          x: (maxX - minX) / 2,
          y: (maxY - minY) / 2,
        },
      };
    }
    case 'cylinder': {
      let result = { ...shape };
      for (const idx of selectedIndices) {
        const p = origPoints[idx];
        if (idx === 0) {
          result = {
            ...result,
            center: { x: p.x + dx, y: p.y + dy },
          };
        } else if (idx === 1) {
          const newRadX = p.x + dx - result.center.x;
          const newRadY = p.y + dy - result.center.y;
          result = {
            ...result,
            radius: Math.max(
              0.1,
              Math.sqrt(newRadX * newRadX + newRadY * newRadY),
            ),
          };
        }
      }
      return result;
    }
  }
}

/** Translate entire shape by delta. */
export function translateShape(
  shape: RoiShape,
  dx: number,
  dy: number,
  dz = 0,
): RoiShape {
  switch (shape.type) {
    case 'rect-2d':
      return {
        ...shape,
        min: { x: shape.min.x + dx, y: shape.min.y + dy },
        max: { x: shape.max.x + dx, y: shape.max.y + dy },
      };
    case 'box':
      return {
        ...shape,
        center: {
          x: shape.center.x + dx,
          y: shape.center.y + dy,
          z: shape.center.z + dz,
        },
      };
    case 'cylinder':
      return {
        ...shape,
        center: { x: shape.center.x + dx, y: shape.center.y + dy },
        zMin: shape.zMin + dz,
        zMax: shape.zMax + dz,
      };
    case 'polygon-2d':
      return {
        ...shape,
        vertices: shape.vertices.map((v) => ({
          x: v.x + dx,
          y: v.y + dy,
        })),
      };
  }
}

/** Rotate shape around a pivot point (Z axis). */
export function rotateShapeZ(
  shape: RoiShape,
  angleRad: number,
  pivotX: number,
  pivotY: number,
): RoiShape {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const rot = (x: number, y: number) => ({
    x: pivotX + (x - pivotX) * cos - (y - pivotY) * sin,
    y: pivotY + (x - pivotX) * sin + (y - pivotY) * cos,
  });

  switch (shape.type) {
    case 'rect-2d': {
      // Rotation breaks axis-alignment → convert to polygon
      const corners = getControlPoints(shape);
      return {
        id: shape.id,
        type: 'polygon-2d',
        vertices: corners.map((c) => rot(c.x, c.y)),
      };
    }
    case 'box': {
      // Rotate just the center — box stays axis-aligned in its own frame
      const nc = rot(shape.center.x, shape.center.y);
      return { ...shape, center: { ...shape.center, x: nc.x, y: nc.y } };
    }
    case 'cylinder': {
      // Circular — just rotate the center
      const nc = rot(shape.center.x, shape.center.y);
      return { ...shape, center: nc };
    }
    case 'polygon-2d':
      return {
        ...shape,
        vertices: shape.vertices.map((v) => rot(v.x, v.y)),
      };
  }
}
