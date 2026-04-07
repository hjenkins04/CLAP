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

export type SnapAxis = 'x' | 'y' | 'z';

export interface AxisSnapGuide {
  /** World position of the vertex being snapped to. */
  target: Vec3;
  /** World position of the vertex being dragged (after snap). */
  dragged: Vec3;
  /** Which axis this guide represents. */
  axis: SnapAxis;
}

export interface AxisSnapResult {
  snapped: Vec3;
  guides: AxisSnapGuide[];
}

export class SnapEngine {
  private gridEnabled = false;
  private gridSize = 1.0;
  private vertexSnapRadius = 0.0;
  /** Extra world-space snap targets supplied by the host plugin (e.g. other annotations). */
  private extraVertices: Vec3[] = [];

  setGrid(enabled: boolean, size = 1.0): void {
    this.gridEnabled = enabled;
    this.gridSize = size;
  }

  setVertexSnapRadius(radius: number): void {
    this.vertexSnapRadius = radius;
  }

  /** Replace the list of extra snap targets (vertices from outside shapes). */
  setExtraVertices(verts: Vec3[]): void {
    this.extraVertices = verts;
  }

  /** Read the current extra snap targets (used by controllers for screen-space checks). */
  getExtraVertices(): ReadonlyArray<Vec3> {
    return this.extraVertices;
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

  /**
   * Axis-constraint snap — used when the transform gizmo is locked to specific axes.
   *
   * For each axis in `constrainedAxes`, finds the closest extra vertex whose coordinate
   * on that axis is within `vertexSnapRadius` of `point[axis]` and snaps to it.
   * Each snapping axis may resolve to a different target vertex.
   *
   * @param point   The proposed world-space position of the dragged element.
   * @param axes    Set of axes currently constrained by the gizmo ('x' | 'y' | 'z').
   * @returns       Snapped position and guide-line descriptors for rendering.
   */
  snapAxis(point: Vec3, axes: ReadonlySet<SnapAxis>): AxisSnapResult {
    if (this.vertexSnapRadius <= 0 || this.extraVertices.length === 0 || axes.size === 0) {
      return { snapped: { ...point }, guides: [] };
    }

    const result: Vec3 = { ...point };
    const guides: AxisSnapGuide[] = [];

    for (const axis of axes) {
      let bestDist = this.vertexSnapRadius;
      let bestVert: Vec3 | null = null;

      for (const v of this.extraVertices) {
        const d = Math.abs(v[axis] - point[axis]);
        if (d < bestDist) {
          bestDist = d;
          bestVert = v;
        }
      }

      if (bestVert) {
        result[axis] = bestVert[axis];
        guides.push({
          target: { ...bestVert },
          dragged: { ...result },   // will be updated to final snapped pos below
          axis,
        });
      }
    }

    // Update dragged position in guides to reflect all axis snaps
    for (const g of guides) g.dragged = { ...result };

    return { snapped: result, guides };
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

    // Also check extra vertices supplied externally (e.g. other annotation layers)
    for (let i = 0; i < this.extraVertices.length; i++) {
      const v = this.extraVertices[i];
      const d = origin.distanceTo(new Vector3(v.x, v.y, v.z));
      if (!best || d < best.dist) {
        best = { pos: v, dist: d, shapeId: '__extra__', vertexIdx: i };
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
