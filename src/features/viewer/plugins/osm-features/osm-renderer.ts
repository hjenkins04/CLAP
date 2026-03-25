import {
  Group,
  Line,
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  Mesh,
  ShapeGeometry,
  MeshBasicMaterial,
  DoubleSide,
  Shape,
  Vector2,
} from 'three';
import type { WorldFrameTransform } from '../world-frame/geo-utils';
import { geoToMeters } from '../world-frame/geo-utils';
import type { OsmLayerKey } from './osm-features-store';

// ── Colors per layer ─────────────────────────────────────────────────

export const LAYER_COLORS: Record<OsmLayerKey, number> = {
  buildings: 0xf59e0b,
  roads: 0xa3a3a3,
  water: 0x3b82f6,
  railways: 0xef4444,
  vegetation: 0x22c55e,
};

// ── Feature classification ───────────────────────────────────────────

export function classifyFeature(props: Record<string, unknown>): OsmLayerKey | null {
  if (props.building) return 'buildings';
  if (props.highway) return 'roads';
  if (props.waterway || props.natural === 'water') return 'water';
  if (props.railway) return 'railways';
  if (
    props.landuse === 'forest' ||
    props.landuse === 'meadow' ||
    props.leisure === 'park' ||
    props.natural === 'wood'
  )
    return 'vegetation';
  return null;
}

/**
 * Elevation lookup callback. Given geo-meters coordinates (x=east, y=north)
 * in the group's local frame, returns the Y elevation in group-local space.
 * Returns 0 if no DEM available.
 */
export type ElevationFn = (geoX: number, geoZ: number) => number;

// ── Geometry builders ────────────────────────────────────────────────

function coordsToMeters(
  coords: number[][],
  refGeo: { lng: number; lat: number },
): { x: number; y: number }[] {
  return coords.map(([lng, lat]) => geoToMeters({ lng, lat }, refGeo));
}

const ELEV_OFFSET = 0.3; // meters above DEM surface

export function buildLineGeometry(
  coords: number[][],
  transform: WorldFrameTransform,
  color: number,
  opacity: number,
  getElev: ElevationFn,
): Line {
  const meters = coordsToMeters(coords, transform.refGeo);
  const verts: number[] = [];
  for (const pt of meters) {
    const y = getElev(pt.x, pt.y) + ELEV_OFFSET;
    verts.push(pt.x, y, pt.y);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(verts, 3));
  const mat = new LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const line = new Line(geo, mat);
  line.renderOrder = 1;
  return line;
}

// ── Road width by highway tag ────────────────────────────────────────

const ROAD_HALF_WIDTHS: Record<string, number> = {
  motorway: 6,
  trunk: 5,
  primary: 4.5,
  secondary: 4,
  tertiary: 3.5,
  residential: 3,
  unclassified: 3,
  service: 2.5,
};

function getRoadHalfWidth(props: Record<string, unknown>): number {
  const hw = String(props.highway ?? '');
  return ROAD_HALF_WIDTHS[hw] ?? 3;
}

/**
 * Build a road surface as a quad-strip ribbon extruded from the center line.
 * Each segment becomes two triangles with width based on the highway tag.
 */
export function buildRoadGeometry(
  coords: number[][],
  transform: WorldFrameTransform,
  color: number,
  opacity: number,
  getElev: ElevationFn,
  props: Record<string, unknown>,
): Group {
  const group = new Group();
  const meters = coordsToMeters(coords, transform.refGeo);
  if (meters.length < 2) return group;

  const halfW = getRoadHalfWidth(props);

  // Build vertices + UVs for a triangle-strip ribbon
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < meters.length; i++) {
    const cur = meters[i];

    // Compute direction as average of prev→cur and cur→next
    let dx = 0, dz = 0;
    if (i < meters.length - 1) {
      dx += meters[i + 1].x - cur.x;
      dz += meters[i + 1].y - cur.y;
    }
    if (i > 0) {
      dx += cur.x - meters[i - 1].x;
      dz += cur.y - meters[i - 1].y;
    }
    // Perpendicular (rotate 90°)
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;

    const y = getElev(cur.x, cur.y) + ELEV_OFFSET;

    // Left and right edge vertices
    positions.push(cur.x + nx * halfW, y, cur.y + nz * halfW); // left
    positions.push(cur.x - nx * halfW, y, cur.y - nz * halfW); // right
  }

  // Build triangle indices for the strip
  for (let i = 0; i < meters.length - 1; i++) {
    const l0 = i * 2;
    const r0 = l0 + 1;
    const l1 = l0 + 2;
    const r1 = l0 + 3;
    indices.push(l0, r0, l1, r0, r1, l1);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: opacity * 0.5,
    side: DoubleSide,
    depthWrite: false,
  });
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = 0;
  group.add(mesh);

  // Center line on top
  const lineVerts: number[] = [];
  for (const pt of meters) {
    const y = getElev(pt.x, pt.y) + ELEV_OFFSET + 0.1;
    lineVerts.push(pt.x, y, pt.y);
  }
  const lineGeo = new BufferGeometry();
  lineGeo.setAttribute('position', new Float32BufferAttribute(lineVerts, 3));
  const lineMat = new LineBasicMaterial({
    color: 0x737373,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const centerLine = new Line(lineGeo, lineMat);
  centerLine.renderOrder = 1;
  group.add(centerLine);

  return group;
}

export function buildPolygonGeometry(
  coords: number[][][],
  transform: WorldFrameTransform,
  color: number,
  opacity: number,
  getElev: ElevationFn,
): Group {
  const group = new Group();

  const outerRing = coords[0];
  if (!outerRing || outerRing.length < 3) return group;

  const meters = coordsToMeters(outerRing, transform.refGeo);

  // Compute average elevation for the filled polygon
  let avgY = 0;
  for (const pt of meters) {
    avgY += getElev(pt.x, pt.y);
  }
  avgY = avgY / meters.length + ELEV_OFFSET;

  // Outline — per-vertex DEM draping
  const lineVerts: number[] = [];
  for (const pt of meters) {
    const y = getElev(pt.x, pt.y) + ELEV_OFFSET;
    lineVerts.push(pt.x, y, pt.y);
  }
  lineVerts.push(meters[0].x, getElev(meters[0].x, meters[0].y) + ELEV_OFFSET, meters[0].y);
  const lineGeo = new BufferGeometry();
  lineGeo.setAttribute('position', new Float32BufferAttribute(lineVerts, 3));
  const lineMat = new LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const outline = new Line(lineGeo, lineMat);
  outline.renderOrder = 2;
  group.add(outline);

  // Filled polygon — ShapeGeometry at average elevation
  const shape = new Shape();
  shape.moveTo(meters[0].x, meters[0].y);
  for (let i = 1; i < meters.length; i++) {
    shape.lineTo(meters[i].x, meters[i].y);
  }
  shape.closePath();

  for (let r = 1; r < coords.length; r++) {
    const holePts = coordsToMeters(coords[r], transform.refGeo);
    if (holePts.length < 3) continue;
    const hole = new Shape();
    hole.moveTo(holePts[0].x, holePts[0].y);
    for (let i = 1; i < holePts.length; i++) {
      hole.lineTo(holePts[i].x, holePts[i].y);
    }
    hole.closePath();
    shape.holes.push(hole);
  }

  const fillGeo = new ShapeGeometry(shape);
  fillGeo.rotateX(-Math.PI / 2);
  const fillMat = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: opacity * 0.3,
    side: DoubleSide,
    depthWrite: false,
  });
  const fill = new Mesh(fillGeo, fillMat);
  fill.position.y = avgY;
  fill.renderOrder = 0;
  group.add(fill);

  return group;
}
