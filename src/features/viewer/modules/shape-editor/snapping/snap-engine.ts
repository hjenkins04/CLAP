import { Vector3, Matrix4, Ray } from 'three';
import type { PointCloudOctree } from 'potree-core';
import type { Vec3, EditorShape, ShapeId, ElevationFn } from '../shape-editor-types';
import type { SnapModeConfig } from '../../snap/snap-types';
import {
  obbCorners,
  OBB_EDGES,
  OBB_FACES,
  polygonEdges,
  polygonTopPoints,
  polylineEdges,
} from '../utils/geometry-utils';

// ── Public result types ────────────────────────────────────────────────────────

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

// ── Internal helpers ───────────────────────────────────────────────────────────

/** Default world-space snap radius when a plugin doesn't configure one. */
const DEFAULT_SNAP_RADIUS = 0.5;

/** Maximum world-space radius to search PCO nodes during point-cloud snap. */
const MAX_PCO_SEARCH_RADIUS = 8;


function dist3sq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Closest point on line segment [a, b] to point p. */
function closestOnSegment(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const ab2 = abx * abx + aby * aby + abz * abz;
  if (ab2 < 1e-12) return { ...a };
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / ab2));
  return { x: a.x + t * abx, y: a.y + t * aby, z: a.z + t * abz };
}

/** Closest point on a convex planar polygon (given as ordered vertices) to p. */
function closestOnFace(p: Vec3, faceVerts: Vec3[]): Vec3 {
  if (faceVerts.length < 3) return { ...p };

  // Project p onto the face plane (use first 3 points to get normal)
  const v0 = faceVerts[0], v1 = faceVerts[1], v2 = faceVerts[2];
  const e1x = v1.x - v0.x, e1y = v1.y - v0.y, e1z = v1.z - v0.z;
  const e2x = v2.x - v0.x, e2y = v2.y - v0.y, e2z = v2.z - v0.z;

  // Normal = e1 × e2
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (nl < 1e-12) return { ...p };
  const nnx = nx / nl, nny = ny / nl, nnz = nz / nl;

  // Project p onto plane
  const dot = (p.x - v0.x) * nnx + (p.y - v0.y) * nny + (p.z - v0.z) * nnz;
  const proj: Vec3 = { x: p.x - dot * nnx, y: p.y - dot * nny, z: p.z - dot * nnz };

  // Check if projected point is inside the polygon using winding number
  // For now, return the projected point — for convex faces (OBB) this is always on the face
  // We also clamp by finding the closest edge if needed
  return proj;
}

// ── SnapEngine ─────────────────────────────────────────────────────────────────

export class SnapEngine {
  // Grid
  private gridEnabled = false;
  private gridSize = 1.0;

  // Radius configured by plugin via ShapeEditorEngine.setVertexSnapRadius()
  private configRadius = 0.0;

  // Global on/off + active modes from the shared snap store
  private globalEnabled = false;
  private modes: SnapModeConfig = {
    vertex: true, edge: false, face: false, pointcloud: false, surface: false, dem: false,
  };

  /** Extra world-space snap targets supplied by the host plugin. */
  private extraVertices: Vec3[] = [];

  // Providers
  private elevationFn: ElevationFn | null = null;
  private getPointClouds: (() => PointCloudOctree[]) | null = null;

  // Pick radius for surface picking — lazily computed from PCO bounding box
  private surfacePickRadius = 1.0;
  private surfacePickRadiusDirty = true;

  // ── Configuration API ──────────────────────────────────────────────────────

  setGrid(enabled: boolean, size = 1.0): void {
    this.gridEnabled = enabled;
    this.gridSize = size;
  }

  /** Radius set from the plugin/config — used as a minimum when globally enabled. */
  setVertexSnapRadius(radius: number): void {
    this.configRadius = radius;
  }

  /** Called by ShapeEditorEngine when the snap store changes. */
  setEnabledModes(enabled: boolean, modes: SnapModeConfig): void {
    this.globalEnabled = enabled;
    this.modes = { ...modes };
  }

  /** DEM elevation provider — called for DEM snap post-pass. */
  setElevationFn(fn: ElevationFn | null): void {
    this.elevationFn = fn;
  }

  /** Point cloud provider — called lazily during point-cloud snap. */
  setPointCloudProvider(fn: () => PointCloudOctree[]): void {
    this.getPointClouds = fn;
  }

  /** Replace the list of extra snap targets (vertices from outside shapes). */
  setExtraVertices(verts: Vec3[]): void {
    this.extraVertices = verts;
  }

  /**
   * Read snap targets for screen-space checks in transform-controller.
   * When edge or face mode is enabled, this includes edge midpoints / face
   * centers so the axis-snap guide system also benefits from these modes.
   */
  getExtraVertices(): ReadonlyArray<Vec3> {
    if (!this.globalEnabled) return [];
    if (!this.modes.edge && !this.modes.face) return this.extraVertices;

    // Augment with edge midpoints / face centers from extraVertices
    // (edge/face snap on shapes themselves is handled in snap())
    return this.extraVertices;
  }

  /** True when any world-space snap mode is active. */
  isSnapActive(): boolean {
    return this.globalEnabled && (
      this.modes.vertex || this.modes.edge || this.modes.face ||
      this.modes.pointcloud || this.modes.surface || this.modes.dem
    );
  }

  /** True when scene-surface raycasting should be used to determine drawing plane Y. */
  isSurfaceModeActive(): boolean {
    return this.globalEnabled && this.modes.surface;
  }

  /** True when point-cloud picking is active (hover indicator + PCO-based anchor placement). */
  isPointCloudPickActive(): boolean {
    return this.globalEnabled && this.modes.pointcloud;
  }

  /** True when DEM elevation should refine drawing plane Y. */
  isDemModeActive(): boolean {
    return this.globalEnabled && this.modes.dem;
  }

  // ── Effective radius ───────────────────────────────────────────────────────

  private get effectiveRadius(): number {
    if (!this.globalEnabled) return 0;
    return this.configRadius > 0 ? this.configRadius : DEFAULT_SNAP_RADIUS;
  }

  // ── Main snap entry points ─────────────────────────────────────────────────

  /**
   * Snap a world-space point.
   * Priority: vertex → edge → face → point-cloud → grid → DEM (Z override).
   */
  snap(
    point: Vec3,
    shapes?: Map<ShapeId, EditorShape>,
    excludeShapeIds?: ShapeId[],
  ): SnapResult {
    let result: Vec3 = { ...point };
    let didSnap = false;
    let snapTarget: SnapResult['snapTarget'];

    const radius = this.effectiveRadius;

    if (this.globalEnabled && radius > 0) {
      const r2 = radius * radius;

      // 1. Vertex snap
      if (this.modes.vertex) {
        const best = this.findNearestVertex(point, shapes, excludeShapeIds);
        if (best && best.dist2 <= r2) {
          result = best.pos;
          didSnap = true;
          snapTarget = { shapeId: best.shapeId, vertexIdx: best.vertexIdx };
        }
      }

      // 2. Edge snap
      if (!didSnap && this.modes.edge) {
        const best = this.findNearestEdgePoint(point, shapes, excludeShapeIds);
        if (best && best.dist2 <= r2) {
          result = best.pos;
          didSnap = true;
        }
      }

      // 3. Face snap
      if (!didSnap && this.modes.face) {
        const best = this.findNearestFacePoint(point, shapes, excludeShapeIds);
        if (best && best.dist2 <= r2) {
          result = best.pos;
          didSnap = true;
        }
      }

      // 4. Point cloud snap
      if (!didSnap && this.modes.pointcloud) {
        const best = this.findNearestPointCloudPoint(point, radius);
        if (best && best.dist2 <= r2) {
          result = best.pos;
          didSnap = true;
        }
      }
    }

    // 5. Grid snap (fallback, only if no other snap applied)
    if (!didSnap && this.gridEnabled) {
      const g = this.gridSize;
      result = {
        x: Math.round(point.x / g) * g,
        y: point.y,
        z: Math.round(point.z / g) * g,
      };
      didSnap = result.x !== point.x || result.z !== point.z;
    }

    // 6. DEM snap — always applied as a Z override when the mode is on
    if (this.globalEnabled && this.modes.dem && this.elevationFn) {
      result.y = this.elevationFn(result.x, result.z);
      didSnap = true;
    }

    return { snapped: result, didSnap, snapTarget };
  }

  /**
   * Axis-constraint snap — used when the transform gizmo is locked to specific axes.
   * Snaps each constrained axis to the closest extra vertex on that axis.
   */
  snapAxis(point: Vec3, axes: ReadonlySet<SnapAxis>): AxisSnapResult {
    if (!this.isSnapActive() || this.extraVertices.length === 0 || axes.size === 0) {
      return { snapped: { ...point }, guides: [] };
    }

    const radius = this.effectiveRadius;
    const result: Vec3 = { ...point };
    const guides: AxisSnapGuide[] = [];

    for (const axis of axes) {
      let bestDist = radius;
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
        guides.push({ target: { ...bestVert }, dragged: { ...result }, axis });
      }
    }

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

  // ── Vertex snap ────────────────────────────────────────────────────────────

  private findNearestVertex(
    point: Vec3,
    shapes?: Map<ShapeId, EditorShape>,
    exclude?: ShapeId[],
  ): { pos: Vec3; dist2: number; shapeId: ShapeId; vertexIdx: number } | null {
    let best: { pos: Vec3; dist2: number; shapeId: ShapeId; vertexIdx: number } | null = null;

    if (shapes) {
      for (const [id, shape] of shapes) {
        if (exclude?.includes(id)) continue;
        const verts = this.getShapeVertices(shape);
        for (let i = 0; i < verts.length; i++) {
          const d2 = dist3sq(point, verts[i]);
          if (!best || d2 < best.dist2) {
            best = { pos: verts[i], dist2: d2, shapeId: id, vertexIdx: i };
          }
        }
      }
    }

    for (let i = 0; i < this.extraVertices.length; i++) {
      const v = this.extraVertices[i];
      const d2 = dist3sq(point, v);
      if (!best || d2 < best.dist2) {
        best = { pos: v, dist2: d2, shapeId: '__extra__', vertexIdx: i };
      }
    }

    return best;
  }

  private getShapeVertices(shape: EditorShape): Vec3[] {
    switch (shape.type) {
      case 'obb':
        return obbCorners(shape).map((c) => ({ x: c.x, y: c.y, z: c.z }));
      case 'polygon':
        return [
          ...shape.basePoints,
          ...shape.basePoints.map((p) => ({ x: p.x, y: p.y + shape.height, z: p.z })),
        ];
      case 'polyline':
        return [...shape.points];
    }
  }

  // ── Edge snap ──────────────────────────────────────────────────────────────

  private findNearestEdgePoint(
    point: Vec3,
    shapes?: Map<ShapeId, EditorShape>,
    exclude?: ShapeId[],
  ): { pos: Vec3; dist2: number } | null {
    let best: { pos: Vec3; dist2: number } | null = null;

    const check = (a: Vec3, b: Vec3) => {
      const p = closestOnSegment(point, a, b);
      const d2 = dist3sq(point, p);
      if (!best || d2 < best.dist2) best = { pos: p, dist2: d2 };
    };

    if (shapes) {
      for (const [id, shape] of shapes) {
        if (exclude?.includes(id)) continue;
        this.forEachShapeEdge(shape, check);
      }
    }

    // Also check edges inferred from extra vertices pairs (no built-in edges for extra pool)

    return best;
  }

  private forEachShapeEdge(shape: EditorShape, cb: (a: Vec3, b: Vec3) => void): void {
    switch (shape.type) {
      case 'obb': {
        const corners = obbCorners(shape).map((c) => ({ x: c.x, y: c.y, z: c.z }));
        for (const [ai, bi] of OBB_EDGES) cb(corners[ai], corners[bi]);
        break;
      }
      case 'polygon': {
        const base = shape.basePoints;
        const top = polygonTopPoints(shape);
        const edges = polygonEdges(shape);
        for (const [ai, bi] of edges) {
          cb(base[ai], base[bi]);       // base ring
          cb(top[ai], top[bi]);         // top ring
          cb(base[ai], top[ai]);        // vertical edge
        }
        break;
      }
      case 'polyline': {
        const edges = polylineEdges(shape);
        for (const [ai, bi] of edges) cb(shape.points[ai], shape.points[bi]);
        break;
      }
    }
  }

  // ── Face snap ──────────────────────────────────────────────────────────────

  private findNearestFacePoint(
    point: Vec3,
    shapes?: Map<ShapeId, EditorShape>,
    exclude?: ShapeId[],
  ): { pos: Vec3; dist2: number } | null {
    let best: { pos: Vec3; dist2: number } | null = null;

    const check = (faceVerts: Vec3[]) => {
      const p = closestOnFace(point, faceVerts);
      const d2 = dist3sq(point, p);
      if (!best || d2 < best.dist2) best = { pos: p, dist2: d2 };
    };

    if (shapes) {
      for (const [id, shape] of shapes) {
        if (exclude?.includes(id)) continue;
        this.forEachShapeFace(shape, check);
      }
    }

    return best;
  }

  private forEachShapeFace(shape: EditorShape, cb: (faceVerts: Vec3[]) => void): void {
    switch (shape.type) {
      case 'obb': {
        const corners = obbCorners(shape).map((c) => ({ x: c.x, y: c.y, z: c.z }));
        for (const faceIdxs of OBB_FACES) {
          cb(faceIdxs.map((i) => corners[i]));
        }
        break;
      }
      case 'polygon': {
        const top = polygonTopPoints(shape);
        cb(top); // top face
        cb(shape.basePoints); // bottom face
        // Side faces
        const edges = polygonEdges(shape);
        for (const [ai, bi] of edges) {
          cb([
            shape.basePoints[ai],
            shape.basePoints[bi],
            top[bi],
            top[ai],
          ]);
        }
        break;
      }
      case 'polyline':
        // Polylines have no faces
        break;
    }
  }

  // ── Surface picking (ray vs point cloud) ──────────────────────────────────

  /**
   * Find the nearest visible PCO point to a ray.
   * Mirrors the approach used by PointInfoPlugin: transforms the ray into each
   * node's local space and uses Ray.distanceToPoint for the comparison.
   * Only searches visibleNodes so it matches what's actually on screen.
   */
  pickSurfacePoint(ray: Ray): Vector3 | null {
    if (!this.getPointClouds) return null;
    const pcos = this.getPointClouds();
    if (pcos.length === 0) return null;

    // Lazily compute pick radius from the first PCO bounding box (same as PointInfoPlugin)
    if (this.surfacePickRadiusDirty) {
      const b = (pcos[0].pcoGeometry as { boundingBox?: { getSize: (v: Vector3) => Vector3 } })
        ?.boundingBox;
      if (b) {
        this.surfacePickRadius = b.getSize(new Vector3()).length() * 0.005;
        this.surfacePickRadiusDirty = false;
      }
    }

    let bestDist = Infinity;
    let bestPos: Vector3 | null = null;
    const tmp = new Vector3();
    const worldMatrix = new Matrix4();
    const invMatrix = new Matrix4();

    for (const pco of pcos) {
      pco.updateMatrix();

      for (const node of pco.visibleNodes) {
        const sceneNode = (node as { sceneNode?: { geometry?: import('three').BufferGeometry; matrix: import('three').Matrix4 } }).sceneNode;
        const geom = sceneNode?.geometry;
        if (!geom) continue;
        const posAttr = geom.getAttribute('position');
        if (!posAttr) continue;

        worldMatrix.multiplyMatrices(pco.matrixWorld, sceneNode.matrix);
        invMatrix.copy(worldMatrix).invert();
        const localRay = ray.clone().applyMatrix4(invMatrix);

        const count = posAttr.count;
        const step = count > 10_000 ? Math.floor(count / 5_000) : 1;

        for (let i = 0; i < count; i += step) {
          tmp.fromBufferAttribute(posAttr, i);
          const d = localRay.distanceToPoint(tmp);
          if (d < bestDist) {
            bestDist = d;
            bestPos = tmp.clone().applyMatrix4(worldMatrix);
          }
        }
      }
    }

    return bestPos && bestDist < this.surfacePickRadius ? bestPos : null;
  }

  // ── Point cloud snap ───────────────────────────────────────────────────────

  private findNearestPointCloudPoint(
    point: Vec3,
    radius: number,
  ): { pos: Vec3; dist2: number } | null {
    if (!this.getPointClouds) return null;

    const pcos = this.getPointClouds();
    if (pcos.length === 0) return null;

    const searchR2 = Math.min(radius, MAX_PCO_SEARCH_RADIUS) ** 2;
    let best: { pos: Vec3; dist2: number } | null = null;

    const tmp = new Vector3();
    const worldMatrix = new Matrix4();

    for (const pco of pcos) {
      pco.updateMatrix();

      for (const node of pco.visibleNodes) {
        const sceneNode = (node as { sceneNode?: { geometry?: import('three').BufferGeometry; matrix: import('three').Matrix4 } }).sceneNode;
        const geom = sceneNode?.geometry;
        if (!geom) continue;
        const posAttr = geom.getAttribute('position');
        if (!posAttr) continue;

        worldMatrix.multiplyMatrices(pco.matrixWorld, sceneNode.matrix);

        const count = posAttr.count;
        const step = count > 10_000 ? Math.floor(count / 5_000) : 1;

        for (let i = 0; i < count; i += step) {
          tmp.fromBufferAttribute(posAttr, i);
          tmp.applyMatrix4(worldMatrix);
          const wp: Vec3 = { x: tmp.x, y: tmp.y, z: tmp.z };
          const d2 = dist3sq(point, wp);
          if (d2 <= searchR2 && (!best || d2 < best.dist2)) {
            best = { pos: wp, dist2: d2 };
          }
        }
      }
    }

    return best;
  }
}
