import {
  Group,
  Mesh,
  SphereGeometry,
  MeshBasicMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  DoubleSide,
  Vector3,
  CylinderGeometry,
  Quaternion,
} from 'three';
import type {
  EditorShape,
  ObbShape,
  PolygonShape,
  PolylineShape,
  HandleUserData,
  ShapeId,
  SelectionState,
  SelectSubMode,
} from '../shape-editor-types';
import type { ShapeEditorConfig } from '../shape-editor-config';
import {
  obbCorners,
  OBB_EDGES,
  OBB_FACES,
  OBB_FACE_AXES,
  obbFaceCenter,
  polygonTopPoints,
  polygonEdges,
  polylineEdges,
} from '../utils/geometry-utils';
import {
  HANDLE_COLOR_SELECTED,
  HANDLE_COLOR_HOVER,
  HANDLE_COLOR_VERTEX,
  HANDLE_OPACITY,
  RENDER_ORDER_HANDLE,
} from './visual-constants';

// ── Material factories ────────────────────────────────────────────────────────

function sphereMat(color: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: HANDLE_OPACITY,
    depthTest: false,
    depthWrite: false,
  });
}

/** Nearly-invisible material — transparent but still raycasted (visible: true required). */
function pickMat(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    transparent: true,
    opacity: 0.001,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
  });
}

function makeSphere(radius: number, color: number, segments: number): Mesh {
  const geo = new SphereGeometry(radius, segments, segments);
  const mesh = new Mesh(geo, sphereMat(color));
  mesh.renderOrder = RENDER_ORDER_HANDLE;
  return mesh;
}

function attachHandleData(mesh: Mesh, data: Omit<HandleUserData, '_seHandle'>): void {
  mesh.userData = { _seHandle: true, ...data } as HandleUserData;
}

// ── Vertex sphere handle ──────────────────────────────────────────────────────

function makeVertexSphere(
  pos: Vector3,
  shapeId: ShapeId,
  index: number,
  config: ShapeEditorConfig,
  sel: SelectionState,
  hovered: HandleUserData | null,
): Mesh {
  const isSelected = sel.elements.some(
    (e) => e.shapeId === shapeId && e.elementType === 'vertex' && e.index === index,
  );
  const isHovered = hovered?._seHandle && hovered.shapeId === shapeId &&
    hovered.kind === 'vertex' && hovered.index === index;
  const color = isSelected ? HANDLE_COLOR_SELECTED : isHovered ? HANDLE_COLOR_HOVER : HANDLE_COLOR_VERTEX;
  const r = config.vertexHandleRadius * (isSelected ? 1.35 : 1);
  const mesh = makeSphere(r, color, config.handleSegments);
  mesh.position.copy(pos);
  attachHandleData(mesh, { kind: 'vertex', shapeId, index });
  return mesh;
}

// ── Edge pick capsule (invisible tube along the edge) ─────────────────────────

function makeEdgePickMesh(
  a: Vector3,
  b: Vector3,
  shapeId: ShapeId,
  index: number,
  radius = 0.25,
): Mesh {
  const dir = b.clone().sub(a);
  const length = dir.length();
  if (length < 0.001) return new Mesh(); // degenerate edge

  // Cylinder aligned with Y, then rotated to align with edge
  const geo = new CylinderGeometry(radius, radius, length, 6, 1);
  const mat = pickMat();
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = RENDER_ORDER_HANDLE;

  // Position at midpoint
  mesh.position.copy(a).add(b).multiplyScalar(0.5);

  // Rotate from Y-up to edge direction
  const up = new Vector3(0, 1, 0);
  const edgeDir = dir.clone().normalize();
  const q = new Quaternion().setFromUnitVectors(up, edgeDir);
  mesh.quaternion.copy(q);

  attachHandleData(mesh, { kind: 'edge-mid', shapeId, index });
  return mesh;
}

// ── Face pick quad (invisible quad covering the face) ─────────────────────────

function makeFacePickMesh(
  faceCorners: Vector3[],
  shapeId: ShapeId,
  index: number,
  faceAxis: string,
): Mesh {
  const n = faceCorners.length;
  const posArr: number[] = [];
  // Fan-triangulate from corner 0
  for (let i = 1; i < n - 1; i++) {
    const a = faceCorners[0], b = faceCorners[i], c = faceCorners[i + 1];
    posArr.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(posArr), 3));
  const mat = pickMat();
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = RENDER_ORDER_HANDLE;
  attachHandleData(mesh, { kind: 'face-extrude', shapeId, index, faceAxis });
  return mesh;
}

// ── OBB handles ───────────────────────────────────────────────────────────────

function buildObbHandles(
  shape: ObbShape,
  config: ShapeEditorConfig,
  sel: SelectionState,
  hovered: HandleUserData | null,
  subMode: SelectSubMode,
): Group {
  const group = new Group();
  const corners = obbCorners(shape);

  if (subMode === 'vertex') {
    for (let i = 0; i < 8; i++) {
      group.add(makeVertexSphere(corners[i], shape.id, i, config, sel, hovered));
    }
  } else if (subMode === 'edge') {
    for (let i = 0; i < OBB_EDGES.length; i++) {
      const [ai, bi] = OBB_EDGES[i];
      group.add(makeEdgePickMesh(corners[ai], corners[bi], shape.id, i));
    }
  } else if (subMode === 'face') {
    for (let i = 0; i < 6; i++) {
      const faceCornerIdxs = OBB_FACES[i];
      const faceVerts = faceCornerIdxs.map((ci) => corners[ci]);
      group.add(makeFacePickMesh(faceVerts, shape.id, i, OBB_FACE_AXES[i]));
    }
  }
  // 'shape' and transform modes: no element handles — shape body pickers handle selection

  return group;
}

// ── Polygon handles ───────────────────────────────────────────────────────────

function buildPolygonHandles(
  shape: PolygonShape,
  config: ShapeEditorConfig,
  sel: SelectionState,
  hovered: HandleUserData | null,
  subMode: SelectSubMode,
): Group {
  const group = new Group();
  const n = shape.basePoints.length;
  const top = polygonTopPoints(shape);

  if (subMode === 'vertex') {
    // Base vertices
    for (let i = 0; i < n; i++) {
      const p = shape.basePoints[i];
      group.add(makeVertexSphere(new Vector3(p.x, p.y, p.z), shape.id, i, config, sel, hovered));
    }
    // Top vertices (index n..2n-1)
    for (let i = 0; i < n; i++) {
      const p = top[i];
      group.add(makeVertexSphere(new Vector3(p.x, p.y, p.z), shape.id, n + i, config, sel, hovered));
    }
  } else if (subMode === 'edge') {
    const edges = polygonEdges(shape);
    for (let i = 0; i < edges.length; i++) {
      const [a, b] = edges[i];
      const pa = new Vector3(shape.basePoints[a].x, shape.basePoints[a].y, shape.basePoints[a].z);
      const pb = new Vector3(shape.basePoints[b].x, shape.basePoints[b].y, shape.basePoints[b].z);
      group.add(makeEdgePickMesh(pa, pb, shape.id, i));
    }
  } else if (subMode === 'face') {
    // Top face only
    if (n >= 3) {
      const topVerts = top.map((p) => new Vector3(p.x, p.y, p.z));
      group.add(makeFacePickMesh(topVerts, shape.id, 0, '+y'));
    }
  }

  return group;
}

// ── Polyline handles ──────────────────────────────────────────────────────────

function buildPolylineHandles(
  shape: PolylineShape,
  config: ShapeEditorConfig,
  sel: SelectionState,
  hovered: HandleUserData | null,
  subMode: SelectSubMode,
): Group {
  const group = new Group();

  if (subMode === 'vertex') {
    for (let i = 0; i < shape.points.length; i++) {
      const p = shape.points[i];
      group.add(makeVertexSphere(new Vector3(p.x, p.y, p.z), shape.id, i, config, sel, hovered));
    }
  } else if (subMode === 'edge') {
    const edges = polylineEdges(shape);
    for (let i = 0; i < edges.length; i++) {
      const [a, b] = edges[i];
      const pa = new Vector3(shape.points[a].x, shape.points[a].y, shape.points[a].z);
      const pb = new Vector3(shape.points[b].x, shape.points[b].y, shape.points[b].z);
      group.add(makeEdgePickMesh(pa, pb, shape.id, i));
    }
  }

  return group;
}

// ── Public builder ────────────────────────────────────────────────────────────

/**
 * Build the handle group for a shape based on the current selection sub-mode.
 *
 * - `vertex`: visible sphere handles at each corner (selectable, hoverable).
 * - `edge`:   invisible pick capsules along each edge (no floating spheres).
 * - `face`:   invisible pick quads over each face (no floating boxes).
 * - `shape` / transform modes: empty group (shape-body pickers handle selection).
 */
export function buildHandles(
  shape: EditorShape,
  config: ShapeEditorConfig,
  sel: SelectionState,
  hovered: HandleUserData | null,
  subMode: SelectSubMode = 'shape',
): Group {
  switch (shape.type) {
    case 'obb':      return buildObbHandles(shape, config, sel, hovered, subMode);
    case 'polygon':  return buildPolygonHandles(shape, config, sel, hovered, subMode);
    case 'polyline': return buildPolylineHandles(shape, config, sel, hovered, subMode);
  }
}

/** Extract HandleUserData from a mesh's userData. Returns null if not a handle. */
export function getHandleData(userData: Record<string, unknown>): HandleUserData | null {
  if (userData._seHandle === true) return userData as unknown as HandleUserData;
  return null;
}
