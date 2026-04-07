import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
  Line,
  DoubleSide,
} from 'three';
import type { PolygonAnnotation } from './polygon-annotation-types';

// ── Constants ─────────────────────────────────────────────────────────────────

const VERTEX_SPHERE_RADIUS = 0.08;
export const SNAP_VISUAL_COLOR = 0x00ffff;
export const DRAFT_COLOR       = 0xffffff;
export const DRAFT_ALPHA       = 0.55;
const FILL_ALPHA               = 0.25;
const RENDER_ORDER             = 910;

// ── Earcut triangulation (standalone — no npm dep needed for simple polygons) ─

/** Triangulate a flat XZ polygon (ignores Y). Returns index triples. */
function earcut2d(verts: Array<{ x: number; z: number }>): number[] {
  const n = verts.length;
  if (n < 3) return [];

  // Build index list
  const indices: number[] = Array.from({ length: n }, (_, i) => i);
  const result: number[] = [];

  const isEar = (prev: number, cur: number, next: number): boolean => {
    const a = verts[prev], b = verts[cur], c = verts[next];
    // Cross product to check convexity (CCW winding assumed)
    const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (cross <= 0) return false;
    // Check no other vertex inside triangle
    for (let i = 0; i < n; i++) {
      if (i === prev || i === cur || i === next) continue;
      const p = verts[i];
      if (pointInTriangle(p, a, b, c)) return false;
    }
    return true;
  };

  let remaining = [...indices];
  let safety = n * n;
  while (remaining.length > 3 && safety-- > 0) {
    let clipped = false;
    for (let i = 0; i < remaining.length; i++) {
      const prev = remaining[(i - 1 + remaining.length) % remaining.length];
      const cur  = remaining[i];
      const next = remaining[(i + 1) % remaining.length];
      if (isEar(prev, cur, next)) {
        result.push(prev, cur, next);
        remaining.splice(i, 1);
        clipped = true;
        break;
      }
    }
    if (!clipped) break; // degenerate polygon
  }
  if (remaining.length === 3) result.push(...remaining);
  return result;
}

function pointInTriangle(
  p: { x: number; z: number },
  a: { x: number; z: number },
  b: { x: number; z: number },
  c: { x: number; z: number },
): boolean {
  const sign = (p1: typeof p, p2: typeof p, p3: typeof p) =>
    (p1.x - p3.x) * (p2.z - p3.z) - (p2.x - p3.x) * (p1.z - p3.z);
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/** Ensure vertices are in CCW order (XZ plane) so earcut works correctly. */
function ensureCCW(verts: Array<{ x: number; y: number; z: number }>): Array<{ x: number; y: number; z: number }> {
  let area = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    area += (b.x - a.x) * (b.z + a.z);
  }
  return area > 0 ? [...verts].reverse() : verts;
}

// ── Polygon group builder ─────────────────────────────────────────────────────

export function buildPolygonGroup(
  vertices: Array<{ x: number; y: number; z: number }>,
  color: number | string,
  opts: { fillAlpha?: number; lineWidth?: number } = {},
): Group {
  const group = new Group();
  const fillAlpha = opts.fillAlpha ?? FILL_ALPHA;
  const colorHex = typeof color === 'string'
    ? parseInt(color.replace('#', ''), 16)
    : color;

  if (vertices.length < 2) return group;

  // ── Outline ──────────────────────────────────────────────────────────────
  const outlineGeo = new BufferGeometry();
  const outlinePositions = new Float32Array(vertices.length * 3);
  for (let i = 0; i < vertices.length; i++) {
    outlinePositions[i * 3]     = vertices[i].x;
    outlinePositions[i * 3 + 1] = vertices[i].y;
    outlinePositions[i * 3 + 2] = vertices[i].z;
  }
  outlineGeo.setAttribute('position', new Float32BufferAttribute(outlinePositions, 3));
  const outlineMat = new MeshBasicMaterial({ color: colorHex });
  const outline = new LineLoop(outlineGeo, outlineMat);
  outline.renderOrder = RENDER_ORDER;
  outline.material.depthTest = false;
  group.add(outline);

  // ── Fill ─────────────────────────────────────────────────────────────────
  if (vertices.length >= 3) {
    const ccwVerts = ensureCCW(vertices);
    const triIndices = earcut2d(ccwVerts.map((v) => ({ x: v.x, z: v.z })));
    if (triIndices.length > 0) {
      const fillGeo = new BufferGeometry();
      const fillPositions = new Float32Array(ccwVerts.length * 3);
      for (let i = 0; i < ccwVerts.length; i++) {
        fillPositions[i * 3]     = ccwVerts[i].x;
        fillPositions[i * 3 + 1] = ccwVerts[i].y + 0.02; // slight lift above ground
        fillPositions[i * 3 + 2] = ccwVerts[i].z;
      }
      fillGeo.setAttribute('position', new Float32BufferAttribute(fillPositions, 3));
      fillGeo.setIndex(triIndices);
      const fillMat = new MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: fillAlpha,
        side: DoubleSide,
        depthTest: false,
      });
      const fill = new Mesh(fillGeo, fillMat);
      fill.renderOrder = RENDER_ORDER - 1;
      group.add(fill);
    }
  }

  return group;
}

// ── Draft preview (in-progress polygon + cursor line) ────────────────────────

export function buildDraftPreview(
  vertices: Array<{ x: number; y: number; z: number }>,
  cursor: { x: number; y: number; z: number } | null,
  snapActive: boolean,
): Group {
  const group = new Group();
  if (vertices.length === 0) return group;

  const color = snapActive ? SNAP_VISUAL_COLOR : DRAFT_COLOR;

  // Existing edges
  if (vertices.length >= 2) {
    const pts: number[] = [];
    for (const v of vertices) { pts.push(v.x, v.y, v.z); }
    // Closed preview line
    pts.push(vertices[0].x, vertices[0].y, vertices[0].z);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(pts), 3));
    const line = new Line(geo, new MeshBasicMaterial({ color: DRAFT_COLOR, depthTest: false }));
    line.renderOrder = RENDER_ORDER + 1;
    group.add(line);
  }

  // Cursor edge
  if (cursor) {
    const last = vertices[vertices.length - 1];
    const pts = new Float32Array([last.x, last.y, last.z, cursor.x, cursor.y, cursor.z]);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pts, 3));
    const line = new Line(geo, new MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: DRAFT_ALPHA }));
    line.renderOrder = RENDER_ORDER + 2;
    group.add(line);
  }

  // Vertex spheres
  const sphereGeo = new SphereGeometry(VERTEX_SPHERE_RADIUS, 8, 8);
  for (let i = 0; i < vertices.length; i++) {
    const mat = new MeshBasicMaterial({
      color: i === 0 ? 0xff4444 : 0xffffff,
      depthTest: false,
    });
    const sphere = new Mesh(sphereGeo, mat);
    sphere.position.set(vertices[i].x, vertices[i].y, vertices[i].z);
    sphere.renderOrder = RENDER_ORDER + 3;
    group.add(sphere);
  }

  // Snap vertex indicator on cursor
  if (cursor && snapActive) {
    const mat = new MeshBasicMaterial({ color: SNAP_VISUAL_COLOR, depthTest: false });
    const sphere = new Mesh(sphereGeo, mat);
    sphere.position.set(cursor.x, cursor.y, cursor.z);
    sphere.renderOrder = RENDER_ORDER + 4;
    group.add(sphere);
  }

  return group;
}

// ── Vertex sphere for close-loop indicator ────────────────────────────────────

export function buildCloseIndicator(pos: { x: number; y: number; z: number }): Mesh {
  const geo = new SphereGeometry(VERTEX_SPHERE_RADIUS * 1.8, 10, 10);
  const mat = new MeshBasicMaterial({ color: 0x00ff88, depthTest: false });
  const sphere = new Mesh(geo, mat);
  sphere.position.set(pos.x, pos.y, pos.z);
  sphere.renderOrder = RENDER_ORDER + 5;
  return sphere;
}

// ── Dispose helper ────────────────────────────────────────────────────────────

export function disposeGroup(group: Group): void {
  group.traverse((obj) => {
    if (obj instanceof Mesh || obj instanceof LineLoop || obj instanceof LineSegments || obj instanceof Line) {
      (obj as Mesh).geometry?.dispose();
      const mat = (obj as Mesh).material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    }
  });
  group.clear();
}
