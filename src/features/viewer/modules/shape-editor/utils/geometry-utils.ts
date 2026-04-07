import { Vector3, Matrix4, Euler } from 'three';
import type { Vec3, ObbShape, PolygonShape, PolylineShape, EditorShape, ElementRef, ShapeId } from '../shape-editor-types';

// ── Vec3 helpers ──────────────────────────────────────────────────────────────

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vec3Scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function vec3Lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function vec3LengthSq(v: Vec3): number {
  return v.x * v.x + v.y * v.y + v.z * v.z;
}

export function vec3Length(v: Vec3): number {
  return Math.sqrt(vec3LengthSq(v));
}

export function toThreeVec3(v: Vec3): Vector3 {
  return new Vector3(v.x, v.y, v.z);
}

export function fromThreeVec3(v: Vector3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

// ── OBB corner / edge / face utils ────────────────────────────────────────────

/**
 * Return the 8 corners of an OBB in world space.
 * Order: [0]=(-x,-y,-z), [1]=(+x,-y,-z), [2]=(+x,-y,+z), [3]=(-x,-y,+z),
 *        [4]=(-x,+y,-z), [5]=(+x,+y,-z), [6]=(+x,+y,+z), [7]=(-x,+y,+z)
 * (bottom ring 0-3, top ring 4-7, CCW from -z when viewed from below)
 */
export function obbCorners(shape: ObbShape): Vector3[] {
  const { center, halfExtents, rotationY } = shape;
  const mat = new Matrix4().makeRotationY(rotationY);
  const signs: [number, number, number][] = [
    [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1],
    [-1,  1, -1], [1,  1, -1], [1,  1, 1], [-1,  1, 1],
  ];
  return signs.map(([sx, sy, sz]) => {
    const v = new Vector3(
      sx * halfExtents.x,
      sy * halfExtents.y,
      sz * halfExtents.z,
    ).applyMatrix4(mat);
    return v.add(new Vector3(center.x, center.y, center.z));
  });
}

/**
 * 12 edges of the OBB as pairs of corner indices.
 * Bottom ring: 0-1, 1-2, 2-3, 3-0
 * Top ring:    4-5, 5-6, 6-7, 7-4
 * Verticals:   0-4, 1-5, 2-6, 3-7
 */
export const OBB_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/**
 * 6 faces of the OBB, each defined by 4 corner indices (bottom ring CCW).
 * Index: 0=-X, 1=+X, 2=-Y (bottom), 3=+Y (top), 4=-Z, 5=+Z
 */
export const OBB_FACES: [number, number, number, number][] = [
  [3, 0, 4, 7],  // -X face
  [1, 2, 6, 5],  // +X face
  [0, 1, 2, 3],  // -Y face (bottom)
  [4, 5, 6, 7],  // +Y face (top)
  [0, 3, 7, 4],  // -Z face
  [2, 1, 5, 6],  // +Z face
];

export type ObbFaceAxis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
export const OBB_FACE_AXES: ObbFaceAxis[] = ['-x', '+x', '-y', '+y', '-z', '+z'];

/** Center of an OBB face in world space. */
export function obbFaceCenter(shape: ObbShape, faceIdx: number): Vector3 {
  const corners = obbCorners(shape);
  const fi = OBB_FACES[faceIdx];
  const c = new Vector3();
  for (const ci of fi) c.add(corners[ci]);
  c.multiplyScalar(0.25);
  return c;
}

// ── Polygon utils ─────────────────────────────────────────────────────────────

/** Return the top-ring points (basePoints elevated by height). */
export function polygonTopPoints(shape: PolygonShape): Vec3[] {
  return shape.basePoints.map((p) => ({ x: p.x, y: p.y + shape.height, z: p.z }));
}

/** All edges of a polygon as pairs of [startIdx, endIdx] into basePoints. */
export function polygonEdges(shape: PolygonShape): [number, number][] {
  const n = shape.basePoints.length;
  const edges: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    edges.push([i, (i + 1) % n]);
  }
  return edges;
}

// ── Polyline utils ────────────────────────────────────────────────────────────

export function polylineEdges(shape: PolylineShape): [number, number][] {
  const n = shape.points.length;
  const edges: [number, number][] = [];
  for (let i = 0; i + 1 < n; i++) edges.push([i, i + 1]);
  if (shape.closed && n >= 2) edges.push([n - 1, 0]);
  return edges;
}

// ── Shape centroid ────────────────────────────────────────────────────────────

export function shapeCentroid(shape: EditorShape): Vec3 {
  switch (shape.type) {
    case 'obb':
      return { ...shape.center };
    case 'polygon': {
      if (shape.basePoints.length === 0) return { x: 0, y: 0, z: 0 };
      let sx = 0, sy = 0, sz = 0;
      for (const p of shape.basePoints) { sx += p.x; sy += p.y; sz += p.z; }
      const n = shape.basePoints.length;
      return { x: sx / n, y: sy / n + shape.height / 2, z: sz / n };
    }
    case 'polyline': {
      if (shape.points.length === 0) return { x: 0, y: 0, z: 0 };
      let sx = 0, sy = 0, sz = 0;
      for (const p of shape.points) { sx += p.x; sy += p.y; sz += p.z; }
      const n = shape.points.length;
      return { x: sx / n, y: sy / n, z: sz / n };
    }
  }
}

// ── Translation helpers ───────────────────────────────────────────────────────

export function translateShape(shape: EditorShape, dx: number, dy: number, dz: number): EditorShape {
  switch (shape.type) {
    case 'obb':
      return {
        ...shape,
        center: { x: shape.center.x + dx, y: shape.center.y + dy, z: shape.center.z + dz },
      };
    case 'polygon':
      return {
        ...shape,
        basePoints: shape.basePoints.map((p) => ({ x: p.x + dx, y: p.y + dy, z: p.z + dz })),
      };
    case 'polyline':
      return {
        ...shape,
        points: shape.points.map((p) => ({ x: p.x + dx, y: p.y + dy, z: p.z + dz })),
      };
  }
}

// ── OBB mutation helpers ──────────────────────────────────────────────────────

/**
 * Move an OBB face by `delta` world units along the face normal.
 * Returns a new ObbShape with updated center and halfExtents.
 */
export function obbMoveFace(shape: ObbShape, faceAxis: ObbFaceAxis, delta: number): ObbShape {
  const { center, halfExtents } = shape;
  const halfDelta = delta / 2;
  switch (faceAxis) {
    case '+x': return {
      ...shape,
      center: { ...center, x: center.x + halfDelta },
      halfExtents: { ...halfExtents, x: Math.max(0.01, halfExtents.x + halfDelta) },
    };
    case '-x': return {
      ...shape,
      center: { ...center, x: center.x - halfDelta },
      halfExtents: { ...halfExtents, x: Math.max(0.01, halfExtents.x + halfDelta) },
    };
    case '+y': return {
      ...shape,
      center: { ...center, y: center.y + halfDelta },
      halfExtents: { ...halfExtents, y: Math.max(0.01, halfExtents.y + halfDelta) },
    };
    case '-y': return {
      ...shape,
      center: { ...center, y: center.y - halfDelta },
      halfExtents: { ...halfExtents, y: Math.max(0.01, halfExtents.y + halfDelta) },
    };
    case '+z': return {
      ...shape,
      center: { ...center, z: center.z + halfDelta },
      halfExtents: { ...halfExtents, z: Math.max(0.01, halfExtents.z + halfDelta) },
    };
    case '-z': return {
      ...shape,
      center: { ...center, z: center.z - halfDelta },
      halfExtents: { ...halfExtents, z: Math.max(0.01, halfExtents.z + halfDelta) },
    };
  }
}

/**
 * Move an OBB corner (vertex) to a new world-space position.
 * The opposite corner stays fixed; center and halfExtents are recomputed.
 * NOTE: for non-zero rotationY, the result may not maintain exact alignment.
 * This implementation works correctly only for rotationY=0 (AABB case).
 */
export function obbMoveCorner(shape: ObbShape, cornerIdx: number, newPos: Vec3): ObbShape {
  const corners = obbCorners(shape);
  // Opposite corner stays fixed (index is (cornerIdx + 6) % 8, accounting for layout)
  // Bottom ring: 0-3, top ring 4-7. Diagonal opposite = cornerIdx XOR 0b110
  const oppIdx = cornerIdx ^ 6;
  const opp = corners[oppIdx];

  const minX = Math.min(newPos.x, opp.x);
  const maxX = Math.max(newPos.x, opp.x);
  const minY = Math.min(newPos.y, opp.y);
  const maxY = Math.max(newPos.y, opp.y);
  const minZ = Math.min(newPos.z, opp.z);
  const maxZ = Math.max(newPos.z, opp.z);

  return {
    ...shape,
    center: {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2,
    },
    halfExtents: {
      x: Math.max(0.01, (maxX - minX) / 2),
      y: Math.max(0.01, (maxY - minY) / 2),
      z: Math.max(0.01, (maxZ - minZ) / 2),
    },
    rotationY: 0, // reset rotation since corners are now world-axis-aligned
  };
}

/** Move an edge midpoint of an OBB to a new position (moves the two adjacent corners). */
export function obbMoveEdgeMid(shape: ObbShape, edgeIdx: number, newMid: Vec3): ObbShape {
  const [ai, bi] = OBB_EDGES[edgeIdx];
  const corners = obbCorners(shape);
  const oldMid = corners[ai].clone().add(corners[bi]).multiplyScalar(0.5);
  const delta = new Vector3(newMid.x - oldMid.x, newMid.y - oldMid.y, newMid.z - oldMid.z);

  // Move both corners by delta
  const newA = fromThreeVec3(corners[ai].clone().add(delta));
  const newB = fromThreeVec3(corners[bi].clone().add(delta));

  // Recompute AABB from all moved corners
  const allCorners = corners.map((c, i) =>
    i === ai ? new Vector3(newA.x, newA.y, newA.z) :
    i === bi ? new Vector3(newB.x, newB.y, newB.z) : c
  );

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const c of allCorners) {
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
    minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
  }

  return {
    ...shape,
    center: {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2,
    },
    halfExtents: {
      x: Math.max(0.01, (maxX - minX) / 2),
      y: Math.max(0.01, (maxY - minY) / 2),
      z: Math.max(0.01, (maxZ - minZ) / 2),
    },
    rotationY: 0,
  };
}

// ── Polygon mutation helpers ──────────────────────────────────────────────────

export function polygonMoveVertex(shape: PolygonShape, idx: number, newPos: Vec3): PolygonShape {
  const pts = [...shape.basePoints];
  pts[idx] = { ...newPos };
  return { ...shape, basePoints: pts };
}

/**
 * Insert a new vertex into the polygon after edge `edgeIdx`.
 * The new vertex is spliced at index `edgeIdx + 1` in basePoints.
 * Returns the updated shape; the new vertex is at `basePoints[edgeIdx + 1]`.
 */
export function polygonInsertVertex(shape: PolygonShape, edgeIdx: number, pos: Vec3): PolygonShape {
  const pts = [...shape.basePoints];
  pts.splice(edgeIdx + 1, 0, { ...pos });
  return { ...shape, basePoints: pts };
}

export function polygonMoveEdgeMid(shape: PolygonShape, edgeIdx: number, newMid: Vec3): PolygonShape {
  const n = shape.basePoints.length;
  const a = edgeIdx;
  const b = (edgeIdx + 1) % n;
  const pts = [...shape.basePoints];
  const oldMid: Vec3 = {
    x: (pts[a].x + pts[b].x) / 2,
    y: (pts[a].y + pts[b].y) / 2,
    z: (pts[a].z + pts[b].z) / 2,
  };
  const dx = newMid.x - oldMid.x;
  const dy = newMid.y - oldMid.y;
  const dz = newMid.z - oldMid.z;
  pts[a] = { x: pts[a].x + dx, y: pts[a].y + dy, z: pts[a].z + dz };
  pts[b] = { x: pts[b].x + dx, y: pts[b].y + dy, z: pts[b].z + dz };
  return { ...shape, basePoints: pts };
}

// ── Polyline mutation helpers ─────────────────────────────────────────────────

export function polylineMoveVertex(shape: PolylineShape, idx: number, newPos: Vec3): PolylineShape {
  const pts = [...shape.points];
  pts[idx] = { ...newPos };
  return { ...shape, points: pts };
}

/**
 * Insert a new vertex into the polyline after edge `edgeIdx`.
 * The new vertex is spliced at index `edgeIdx + 1` in points.
 * Returns the updated shape; the new vertex is at `points[edgeIdx + 1]`.
 */
export function polylineInsertVertex(shape: PolylineShape, edgeIdx: number, pos: Vec3): PolylineShape {
  const pts = [...shape.points];
  pts.splice(edgeIdx + 1, 0, { ...pos });
  return { ...shape, points: pts };
}

export function polylineMoveEdgeMid(shape: PolylineShape, edgeIdx: number, newMid: Vec3): PolylineShape {
  const edges = polylineEdges(shape);
  const [a, b] = edges[edgeIdx];
  const pts = [...shape.points];
  const oldMid: Vec3 = {
    x: (pts[a].x + pts[b].x) / 2,
    y: (pts[a].y + pts[b].y) / 2,
    z: (pts[a].z + pts[b].z) / 2,
  };
  const dx = newMid.x - oldMid.x;
  const dy = newMid.y - oldMid.y;
  const dz = newMid.z - oldMid.z;
  pts[a] = { x: pts[a].x + dx, y: pts[a].y + dy, z: pts[a].z + dz };
  pts[b] = { x: pts[b].x + dx, y: pts[b].y + dy, z: pts[b].z + dz };
  return { ...shape, points: pts };
}

// ── Element-level helpers ─────────────────────────────────────────────────────

/** Returns the vertex indices in the shape that are "affected" by a given element selection.
 *  vertex → [index]
 *  edge   → the two endpoint vertex indices
 *  face   → the four corner vertex indices (OBB), or all basePoint indices (polygon)
 */
export function getAffectedVertexIndices(shape: EditorShape, el: ElementRef): number[] {
  switch (el.elementType) {
    case 'vertex':
      return [el.index];
    case 'edge': {
      switch (shape.type) {
        case 'obb': {
          const e = OBB_EDGES[el.index];
          return e ? [e[0], e[1]] : [];
        }
        case 'polygon': {
          const edges = polygonEdges(shape);
          const e = edges[el.index];
          return e ? [e[0], e[1]] : [];
        }
        case 'polyline': {
          const edges = polylineEdges(shape);
          const e = edges[el.index];
          return e ? [e[0], e[1]] : [];
        }
      }
      break;
    }
    case 'face': {
      switch (shape.type) {
        case 'obb': {
          const f = OBB_FACES[el.index];
          return f ? [...f] : [];
        }
        case 'polygon':
          // face = top face → moving it changes height, represented as all base indices
          return shape.basePoints.map((_, i) => i);
        case 'polyline':
          return [];
      }
      break;
    }
  }
  return [];
}

/** Apply a translation delta to a set of vertex indices within a shape.
 *  OBB: recomputes center + halfExtents from moved corners (clears rotationY).
 *  Polygon: moves basePoints; top-vertex indices (>= n) adjust height.
 *  Polyline: moves points directly.
 */
export function applyVertexDelta(
  shape: EditorShape,
  vertexIndices: ReadonlySet<number>,
  dx: number,
  dy: number,
  dz: number,
): EditorShape {
  switch (shape.type) {
    case 'obb': {
      const corners = obbCorners(shape);
      const moved = corners.map((c, i) =>
        vertexIndices.has(i) ? new Vector3(c.x + dx, c.y + dy, c.z + dz) : c,
      );
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const c of moved) {
        if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x;
        if (c.y < minY) minY = c.y; if (c.y > maxY) maxY = c.y;
        if (c.z < minZ) minZ = c.z; if (c.z > maxZ) maxZ = c.z;
      }
      return {
        ...shape,
        center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
        halfExtents: {
          x: Math.max(0.01, (maxX - minX) / 2),
          y: Math.max(0.01, (maxY - minY) / 2),
          z: Math.max(0.01, (maxZ - minZ) / 2),
        },
        rotationY: 0,
      };
    }
    case 'polygon': {
      const n = shape.basePoints.length;
      const pts = [...shape.basePoints];
      let heightDelta = 0;
      for (const idx of vertexIndices) {
        if (idx < n) {
          pts[idx] = { x: pts[idx].x + dx, y: pts[idx].y + dy, z: pts[idx].z + dz };
        } else {
          heightDelta = dy;
        }
      }
      const base = { ...shape, basePoints: pts };
      if (heightDelta !== 0) {
        return { ...base, height: Math.max(0.01, shape.height + heightDelta) };
      }
      return base;
    }
    case 'polyline': {
      const pts = [...shape.points];
      for (const idx of vertexIndices) {
        if (pts[idx]) {
          pts[idx] = { x: pts[idx].x + dx, y: pts[idx].y + dy, z: pts[idx].z + dz };
        }
      }
      return { ...shape, points: pts };
    }
  }
}

/** World-space position of a specific element (vertex position, edge midpoint, face centre). */
export function elementWorldPos(shape: EditorShape, el: ElementRef): Vec3 | null {
  switch (el.elementType) {
    case 'vertex': {
      switch (shape.type) {
        case 'obb': {
          const c = obbCorners(shape)[el.index];
          return c ? fromThreeVec3(c) : null;
        }
        case 'polygon': {
          const n = shape.basePoints.length;
          if (el.index < n) return shape.basePoints[el.index];
          const p = shape.basePoints[el.index - n];
          return p ? { x: p.x, y: p.y + shape.height, z: p.z } : null;
        }
        case 'polyline':
          return shape.points[el.index] ?? null;
      }
      break;
    }
    case 'edge': {
      switch (shape.type) {
        case 'obb': {
          const e = OBB_EDGES[el.index];
          if (!e) return null;
          const corners = obbCorners(shape);
          return fromThreeVec3(corners[e[0]].clone().add(corners[e[1]]).multiplyScalar(0.5));
        }
        case 'polygon': {
          const edges = polygonEdges(shape);
          const e = edges[el.index];
          if (!e) return null;
          const a = shape.basePoints[e[0]], b = shape.basePoints[e[1]];
          return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
        }
        case 'polyline': {
          const edges = polylineEdges(shape);
          const e = edges[el.index];
          if (!e) return null;
          const a = shape.points[e[0]], b = shape.points[e[1]];
          return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
        }
      }
      break;
    }
    case 'face': {
      switch (shape.type) {
        case 'obb':
          return fromThreeVec3(obbFaceCenter(shape, el.index));
        case 'polygon': {
          const top = polygonTopPoints(shape);
          let x = 0, y = 0, z = 0;
          for (const p of top) { x += p.x; y += p.y; z += p.z; }
          return { x: x / top.length, y: y / top.length, z: z / top.length };
        }
        case 'polyline':
          return null;
      }
      break;
    }
  }
  return null;
}

/** Centroid of a list of element references. */
export function elementsCentroid(
  elements: ReadonlyArray<ElementRef>,
  shapes: Map<ShapeId, EditorShape>,
): Vec3 {
  let x = 0, y = 0, z = 0, count = 0;
  for (const el of elements) {
    const shape = shapes.get(el.shapeId);
    if (!shape) continue;
    const pos = elementWorldPos(shape, el);
    if (!pos) continue;
    x += pos.x; y += pos.y; z += pos.z; count++;
  }
  if (count === 0) return { x: 0, y: 0, z: 0 };
  return { x: x / count, y: y / count, z: z / count };
}
