import { Vector3 } from 'three';
import type { Vec3, EditorShape, ShapeId } from '../shape-editor-types';
import { obbCorners } from '../utils/geometry-utils';

export interface SnapResult {
  snapped: Vec3;
  /** Whether snap was applied (false = returned original). */
  didSnap: boolean;
  /** Which shape/vertex was snapped to, if any. */
  snapTarget?: { shapeId: ShapeId; vertexIdx: number };
}

export class SnapEngine {
  private gridEnabled = false;
  private gridSize = 1.0;
  private vertexSnapRadius = 0.0;

  setGrid(enabled: boolean, size = 1.0): void {
    this.gridEnabled = enabled;
    this.gridSize = size;
  }

  setVertexSnapRadius(radius: number): void {
    this.vertexSnapRadius = radius;
  }

  /**
   * Snap a world-space point. Grid snapping is applied first;
   * vertex snapping (to existing shape corners) takes priority if
   * `shapes` is provided and a nearby vertex is within `vertexSnapRadius`.
   */
  snap(
    point: Vec3,
    shapes?: Map<ShapeId, EditorShape>,
    excludeShapeIds?: ShapeId[],
  ): SnapResult {
    let result: Vec3 = { ...point };
    let didSnap = false;
    let snapTarget: SnapResult['snapTarget'];

    // 1. Vertex snapping (highest priority)
    if (this.vertexSnapRadius > 0 && shapes) {
      const best = this.findNearestVertex(point, shapes, excludeShapeIds);
      if (best && best.dist <= this.vertexSnapRadius) {
        result = best.pos;
        didSnap = true;
        snapTarget = { shapeId: best.shapeId, vertexIdx: best.vertexIdx };
      }
    }

    // 2. Grid snapping (only if vertex snap not applied)
    if (!didSnap && this.gridEnabled) {
      const g = this.gridSize;
      result = {
        x: Math.round(point.x / g) * g,
        y: point.y, // don't snap Y (elevation) to grid
        z: Math.round(point.z / g) * g,
      };
      didSnap = result.x !== point.x || result.z !== point.z;
    }

    return { snapped: result, didSnap, snapTarget };
  }

  /** Snap only on the XZ plane (grid), leaving Y unchanged. */
  snapXZ(x: number, z: number): { x: number; z: number } {
    if (!this.gridEnabled) return { x, z };
    const g = this.gridSize;
    return {
      x: Math.round(x / g) * g,
      z: Math.round(z / g) * g,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private findNearestVertex(
    point: Vec3,
    shapes: Map<ShapeId, EditorShape>,
    exclude?: ShapeId[],
  ): { pos: Vec3; dist: number; shapeId: ShapeId; vertexIdx: number } | null {
    const origin = new Vector3(point.x, point.y, point.z);
    let best: { pos: Vec3; dist: number; shapeId: ShapeId; vertexIdx: number } | null = null;

    for (const [id, shape] of shapes) {
      if (exclude?.includes(id)) continue;

      const verts = this.getShapeVertices(shape);
      for (let i = 0; i < verts.length; i++) {
        const v = verts[i];
        const d = origin.distanceTo(new Vector3(v.x, v.y, v.z));
        if (!best || d < best.dist) {
          best = { pos: v, dist: d, shapeId: id, vertexIdx: i };
        }
      }
    }
    return best;
  }

  private getShapeVertices(shape: EditorShape): Vec3[] {
    switch (shape.type) {
      case 'obb': {
        return obbCorners(shape).map((c) => ({ x: c.x, y: c.y, z: c.z }));
      }
      case 'polygon':
        return [
          ...shape.basePoints,
          ...shape.basePoints.map((p) => ({ x: p.x, y: p.y + shape.height, z: p.z })),
        ];
      case 'polyline':
        return [...shape.points];
    }
  }
}
