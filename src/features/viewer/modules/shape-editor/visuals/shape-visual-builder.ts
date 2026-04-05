import {
  Group,
  Mesh,
  Line,
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  MeshBasicMaterial,
  DoubleSide,
} from 'three';
import type { EditorShape, ObbShape, PolygonShape, PolylineShape, SelectionState, HandleUserData, SelectSubMode } from '../shape-editor-types';
import {
  obbCorners,
  OBB_EDGES,
  OBB_FACES,
  polygonTopPoints,
  polygonEdges,
  polylineEdges,
} from '../utils/geometry-utils';
import {
  SHAPE_COLOR_DEFAULT,
  SHAPE_COLOR_SELECTED,
  SHAPE_LINE_OPACITY,
  SHAPE_FILL_OPACITY,
  RENDER_ORDER_SHAPE,
} from './visual-constants';

// ── Material factories ────────────────────────────────────────────────────────

function wireMat(color: number, opacity = SHAPE_LINE_OPACITY): LineBasicMaterial {
  return new LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
  });
}

function fillMat(color: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: SHAPE_FILL_OPACITY,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
  });
}

function makeLine(positions: number[], color: number): Line {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(positions), 3));
  const line = new Line(geo, wireMat(color));
  line.renderOrder = RENDER_ORDER_SHAPE;
  return line;
}

// ── OBB visual ────────────────────────────────────────────────────────────────

function buildObbWireframe(shape: ObbShape, color: number): Group {
  const group = new Group();
  const corners = obbCorners(shape);
  for (const [ai, bi] of OBB_EDGES) {
    const a = corners[ai];
    const b = corners[bi];
    group.add(makeLine([a.x, a.y, a.z, b.x, b.y, b.z], color));
  }
  return group;
}

/** Build a translucent fill quad for one OBB face (4-corner indices). */
function buildObbFaceFill(shape: ObbShape, faceCorners: [number, number, number, number], color: number): Mesh {
  const corners = obbCorners(shape);
  const [a, b, c, d] = faceCorners.map((i) => corners[i]);
  const positions = new Float32Array([
    a.x, a.y, a.z,
    b.x, b.y, b.z,
    c.x, c.y, c.z,
    a.x, a.y, a.z,
    c.x, c.y, c.z,
    d.x, d.y, d.z,
  ]);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const mesh = new Mesh(geo, fillMat(color));
  mesh.renderOrder = RENDER_ORDER_SHAPE - 1;
  return mesh;
}

// ── Polygon visual ────────────────────────────────────────────────────────────

function buildPolygonWireframe(shape: PolygonShape, color: number): Group {
  const group = new Group();
  const n = shape.basePoints.length;
  if (n < 2) return group;

  const top = polygonTopPoints(shape);
  const base = shape.basePoints;

  // Bottom loop
  const botPositions: number[] = [];
  for (const p of base) botPositions.push(p.x, p.y, p.z);
  botPositions.push(base[0].x, base[0].y, base[0].z);
  group.add(makeLine(botPositions, color));

  // Top loop
  const topPositions: number[] = [];
  for (const p of top) topPositions.push(p.x, p.y, p.z);
  topPositions.push(top[0].x, top[0].y, top[0].z);
  group.add(makeLine(topPositions, color));

  // Vertical edges
  for (let i = 0; i < n; i++) {
    group.add(makeLine([
      base[i].x, base[i].y, base[i].z,
      top[i].x, top[i].y, top[i].z,
    ], color));
  }

  return group;
}

// ── Polyline visual ───────────────────────────────────────────────────────────

function buildPolylineWireframe(shape: PolylineShape, color: number): Group {
  const group = new Group();
  if (shape.points.length < 2) return group;

  const positions: number[] = [];
  for (const p of shape.points) positions.push(p.x, p.y, p.z);
  if (shape.closed) {
    const p0 = shape.points[0];
    positions.push(p0.x, p0.y, p0.z);
  }
  group.add(makeLine(positions, color));
  return group;
}

// ── Public builder ────────────────────────────────────────────────────────────

/**
 * Build a Three.js Group containing the visual representation of a shape.
 * `selected` controls whether the selected colour is used.
 * All objects added to the group have `userData._seHandle = true` is NOT set
 * (handle picking is separate). The group is returned at the scene origin —
 * positions are already in world/scene space.
 */
export function buildShapeVisual(shape: EditorShape, selected: boolean): Group {
  const color = selected ? SHAPE_COLOR_SELECTED : SHAPE_COLOR_DEFAULT;
  switch (shape.type) {
    case 'obb':    return buildObbWireframe(shape, color);
    case 'polygon': return buildPolygonWireframe(shape, color);
    case 'polyline': return buildPolylineWireframe(shape, color);
  }
}

/**
 * Build a preview visual (used during drawing, before shape is committed).
 * Uses a distinct preview colour.
 */
export { SHAPE_COLOR_PREVIEW as PREVIEW_COLOR } from './visual-constants';

export { buildObbWireframe, buildPolygonWireframe, buildPolylineWireframe };

// ── Element highlight constants ───────────────────────────────────────────────

const FACE_HIGHLIGHT_COLOR        = 0x4488ff;
const FACE_HIGHLIGHT_OPACITY      = 0.35;
const FACE_HOVER_OPACITY          = 0.18;
const EDGE_HIGHLIGHT_COLOR        = 0xffee44;
const EDGE_HOVER_COLOR            = 0xffcc00;

// ── Element highlight builder ─────────────────────────────────────────────────

/**
 * Build an overlay group that highlights selected/hovered edges (as bright lines) and
 * selected/hovered faces (as translucent quads) for the given shape.
 * Intended to be shown in addition to the normal wireframe / handle visuals.
 */
export function buildElementHighlights(
  shape: EditorShape,
  sel: SelectionState,
  hovered: HandleUserData | null = null,
  subMode: SelectSubMode = 'shape',
): Group {
  const group = new Group();

  // Track which indices are selected so we skip them for hover (selected takes priority)
  const selectedEdges = new Set<number>();
  const selectedFaces = new Set<number>();

  // Selected edge highlights
  for (const el of sel.elements) {
    if (el.shapeId !== shape.id || el.elementType !== 'edge') continue;
    selectedEdges.add(el.index);
    const line = buildHighlightEdge(shape, el.index, EDGE_HIGHLIGHT_COLOR, 1.0);
    if (line) group.add(line);
  }

  // Selected face highlights
  for (const el of sel.elements) {
    if (el.shapeId !== shape.id || el.elementType !== 'face') continue;
    selectedFaces.add(el.index);
    const mesh = buildHighlightFace(shape, el.index, FACE_HIGHLIGHT_COLOR, FACE_HIGHLIGHT_OPACITY);
    if (mesh) group.add(mesh);
  }

  // Hover edge highlight (only when in edge subMode, not already selected)
  if (subMode === 'edge' && hovered?.kind === 'edge-mid' && hovered.shapeId === shape.id) {
    if (!selectedEdges.has(hovered.index)) {
      const line = buildHighlightEdge(shape, hovered.index, EDGE_HOVER_COLOR, 0.6);
      if (line) group.add(line);
    }
  }

  // Hover face highlight (only when in face subMode, not already selected)
  if (subMode === 'face' && hovered?.kind === 'face-extrude' && hovered.shapeId === shape.id) {
    if (!selectedFaces.has(hovered.index)) {
      const mesh = buildHighlightFace(shape, hovered.index, FACE_HIGHLIGHT_COLOR, FACE_HOVER_OPACITY);
      if (mesh) group.add(mesh);
    }
  }

  return group;
}

function buildHighlightEdge(shape: EditorShape, edgeIdx: number, color: number, opacity: number): Line | null {
  let positions: number[] | null = null;

  switch (shape.type) {
    case 'obb': {
      const e = OBB_EDGES[edgeIdx]; if (!e) return null;
      const c = obbCorners(shape);
      const a = c[e[0]], b = c[e[1]];
      positions = [a.x, a.y, a.z, b.x, b.y, b.z];
      break;
    }
    case 'polygon': {
      const edges = polygonEdges(shape);
      const e = edges[edgeIdx]; if (!e) return null;
      const a = shape.basePoints[e[0]], b = shape.basePoints[e[1]];
      positions = [a.x, a.y, a.z, b.x, b.y, b.z];
      break;
    }
    case 'polyline': {
      const edges = polylineEdges(shape);
      const e = edges[edgeIdx]; if (!e) return null;
      const a = shape.points[e[0]], b = shape.points[e[1]];
      positions = [a.x, a.y, a.z, b.x, b.y, b.z];
      break;
    }
  }

  if (!positions) return null;
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(positions), 3));
  const mat = new LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthTest: false,
  });
  const line = new Line(geo, mat);
  line.renderOrder = RENDER_ORDER_SHAPE + 5;
  return line;
}

function buildHighlightFace(shape: EditorShape, faceIdx: number, color: number, opacity: number): Mesh | null {
  let posArr: number[] | null = null;

  switch (shape.type) {
    case 'obb': {
      const fi = OBB_FACES[faceIdx]; if (!fi) return null;
      const c = obbCorners(shape);
      const [a, b, cc, d] = fi.map((i) => c[i]);
      posArr = [
        a.x, a.y, a.z, b.x, b.y, b.z, cc.x, cc.y, cc.z,
        a.x, a.y, a.z, cc.x, cc.y, cc.z, d.x, d.y, d.z,
      ];
      break;
    }
    case 'polygon': {
      // Top face: fan triangulation
      const top = polygonTopPoints(shape);
      if (top.length < 3) return null;
      posArr = [];
      for (let i = 1; i < top.length - 1; i++) {
        posArr.push(top[0].x, top[0].y, top[0].z);
        posArr.push(top[i].x, top[i].y, top[i].z);
        posArr.push(top[i + 1].x, top[i + 1].y, top[i + 1].z);
      }
      break;
    }
    case 'polyline':
      return null;
  }

  if (!posArr) return null;
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(posArr), 3));
  const mat = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = RENDER_ORDER_SHAPE + 3;
  return mesh;
}
