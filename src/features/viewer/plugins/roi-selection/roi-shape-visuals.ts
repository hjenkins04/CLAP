import {
  Group,
  Mesh,
  MeshBasicMaterial,
  LineSegments,
  LineBasicMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  SphereGeometry,
  Line,
} from 'three';
import type { RoiShape } from './roi-types';

const PREVIEW_COLOR = 0x22aaff;
const COMMITTED_COLOR = 0x44ff88;
const LINE_OPACITY = 0.85;
const DOT_RADIUS = 0.2;

/** Callback to resolve Z elevation for a local (x,y) point */
export type GetDrawZ = (x: number, y: number) => number;

function makeLineMat(color: number): LineBasicMaterial {
  return new LineBasicMaterial({
    color,
    transparent: true,
    opacity: LINE_OPACITY,
    depthTest: false,
    depthWrite: false,
  });
}

function makeDotMat(color: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: LINE_OPACITY,
    depthTest: false,
    depthWrite: false,
  });
}

/**
 * Build a 2D visual for a shape. All coordinates are in PCO local space.
 * The getZ callback returns the draw-plane elevation for a given (east, north).
 * When isYUp is true the PCO local space uses X=east, Y=elevation, Z=north
 * (pre-transformed point clouds); otherwise X=east, Y=north, Z=elevation.
 */
export function buildShapeVisual(
  shape: RoiShape,
  getZ: GetDrawZ,
  isPreview = false,
  skipDots = false,
  isYUp = false,
): Group {
  const group = new Group();
  group.renderOrder = 910;
  const color = isPreview ? PREVIEW_COLOR : COMMITTED_COLOR;

  // Remap shape-space (east, north, elevation) → Three.js local position.
  // Shape space: x=east, y=north, z=elevation.
  // Y-up Three.js: x=east, y=elevation, z=north → swap y/z.
  const r = (sx: number, sy: number, sz: number): [number, number, number] =>
    isYUp ? [sx, sz, sy] : [sx, sy, sz];

  switch (shape.type) {
    case 'rect-2d': {
      const { min, max } = shape;
      const z00 = getZ(min.x, min.y);
      const z10 = getZ(max.x, min.y);
      const z11 = getZ(max.x, max.y);
      const z01 = getZ(min.x, max.y);
      const corners = [
        ...r(min.x, min.y, z00),
        ...r(max.x, min.y, z10),
        ...r(max.x, max.y, z11),
        ...r(min.x, max.y, z01),
        ...r(min.x, min.y, z00),
      ];
      addLineLoop(group, corners, color);
      if (!skipDots) {
        addDot(group, ...r(min.x, min.y, z00), color);
        addDot(group, ...r(max.x, min.y, z10), color);
        addDot(group, ...r(max.x, max.y, z11), color);
        addDot(group, ...r(min.x, max.y, z01), color);
      }
      break;
    }

    case 'box': {
      const { center, halfExtents } = shape;
      const x0 = center.x - halfExtents.x;
      const x1 = center.x + halfExtents.x;
      const y0 = center.y - halfExtents.y;
      const y1 = center.y + halfExtents.y;

      if (halfExtents.z > 0.01) {
        // 3D wireframe box — center.z/halfExtents.z are elevation in shape space
        const zBot = center.z - halfExtents.z;
        const zTop = center.z + halfExtents.z;
        // Bottom face
        addLineLoop(group, [
          ...r(x0, y0, zBot), ...r(x1, y0, zBot), ...r(x1, y1, zBot), ...r(x0, y1, zBot), ...r(x0, y0, zBot),
        ], color);
        // Top face
        addLineLoop(group, [
          ...r(x0, y0, zTop), ...r(x1, y0, zTop), ...r(x1, y1, zTop), ...r(x0, y1, zTop), ...r(x0, y0, zTop),
        ], color);
        // 4 vertical edges
        addLineLoop(group, [...r(x0, y0, zBot), ...r(x0, y0, zTop)], color);
        addLineLoop(group, [...r(x1, y0, zBot), ...r(x1, y0, zTop)], color);
        addLineLoop(group, [...r(x1, y1, zBot), ...r(x1, y1, zTop)], color);
        addLineLoop(group, [...r(x0, y1, zBot), ...r(x0, y1, zTop)], color);
      } else {
        // Flat footprint
        const corners = [
          ...r(x0, y0, getZ(x0, y0)),
          ...r(x1, y0, getZ(x1, y0)),
          ...r(x1, y1, getZ(x1, y1)),
          ...r(x0, y1, getZ(x0, y1)),
          ...r(x0, y0, getZ(x0, y0)),
        ];
        addLineLoop(group, corners, color);
      }
      break;
    }

    case 'cylinder': {
      const { center, radius, zMin, zMax } = shape;
      const segments = 48;
      const height = zMax - zMin;

      if (height > 0.01) {
        // 3D wireframe cylinder — zMin/zMax are elevation in shape space
        const botRing: number[] = [];
        const topRing: number[] = [];
        for (let i = 0; i <= segments; i++) {
          const angle = (i / segments) * Math.PI * 2;
          const px = center.x + Math.cos(angle) * radius;
          const py = center.y + Math.sin(angle) * radius;
          botRing.push(...r(px, py, zMin));
          topRing.push(...r(px, py, zMax));
        }
        addLineLoop(group, botRing, color);
        addLineLoop(group, topRing, color);
        // 4 vertical lines at cardinal points
        for (let i = 0; i < 4; i++) {
          const angle = (i / 4) * Math.PI * 2;
          const px = center.x + Math.cos(angle) * radius;
          const py = center.y + Math.sin(angle) * radius;
          addLineLoop(group, [...r(px, py, zMin), ...r(px, py, zMax)], color);
        }
      } else {
        // Flat circle footprint
        const positions: number[] = [];
        for (let i = 0; i <= segments; i++) {
          const angle = (i / segments) * Math.PI * 2;
          const px = center.x + Math.cos(angle) * radius;
          const py = center.y + Math.sin(angle) * radius;
          positions.push(...r(px, py, getZ(px, py)));
        }
        addLineLoop(group, positions, color);
        if (!skipDots) {
          addDot(group, ...r(center.x, center.y, getZ(center.x, center.y)), color);
        }
      }
      break;
    }

    case 'polygon-2d': {
      const verts = shape.vertices;
      if (verts.length === 0) break;

      const positions: number[] = [];
      for (const v of verts) {
        positions.push(...r(v.x, v.y, getZ(v.x, v.y)));
      }
      if (verts.length >= 3 && !isPreview) {
        positions.push(...r(verts[0].x, verts[0].y, getZ(verts[0].x, verts[0].y)));
      }
      addLineLoop(group, positions, color);

      if (!skipDots) {
        for (const v of verts) {
          addDot(group, ...r(v.x, v.y, getZ(v.x, v.y)), color);
        }
      }
      break;
    }
  }

  return group;
}

function addLineLoop(
  group: Group,
  positions: number[],
  color: number,
): void {
  if (positions.length < 6) return;
  const geo = new BufferGeometry();
  geo.setAttribute(
    'position',
    new Float32BufferAttribute(new Float32Array(positions), 3),
  );
  const line = new Line(geo, makeLineMat(color));
  line.renderOrder = 911;
  group.add(line);
}

function addDot(
  group: Group,
  x: number,
  y: number,
  z: number,
  color: number,
): void {
  const geo = new SphereGeometry(DOT_RADIUS, 8, 8);
  const mesh = new Mesh(geo, makeDotMat(color));
  mesh.position.set(x, y, z);
  mesh.renderOrder = 912;
  group.add(mesh);
}

const HANDLE_RADIUS = 0.15;
const HANDLE_RADIUS_SELECTED = 0.2;
const HANDLE_DEFAULT_COLOR = 0xdddddd;
const HANDLE_SELECTED_COLOR = 0xff8800;

/**
 * Build small edit handles (one per control point / corner).
 * Selected handles are rendered in orange and slightly larger.
 * If a point has an explicit `z`, that is used; otherwise falls back to `getZ`.
 * When isYUp is true, positions are remapped to Y-up Three.js space.
 */
export function buildEditHandles(
  points: Array<{ x: number; y: number; z?: number }>,
  getZ: GetDrawZ,
  selectedIndices: number[],
  isYUp = false,
): Group {
  const group = new Group();
  group.renderOrder = 920;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const isSelected = selectedIndices.includes(i);
    const color = isSelected ? HANDLE_SELECTED_COLOR : HANDLE_DEFAULT_COLOR;
    const radius = isSelected ? HANDLE_RADIUS_SELECTED : HANDLE_RADIUS;
    const geo = new SphereGeometry(radius, 8, 8);
    const mat = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new Mesh(geo, mat);
    // p.x=east, p.y=north, p.z/getZ=elevation in shape space
    const elev = p.z ?? getZ(p.x, p.y);
    if (isYUp) {
      mesh.position.set(p.x, elev, p.y);
    } else {
      mesh.position.set(p.x, p.y, elev);
    }
    mesh.renderOrder = 920;
    group.add(mesh);
  }

  return group;
}

export function disposeGroup(group: Group): void {
  group.traverse((obj) => {
    if (obj instanceof Mesh || obj instanceof LineSegments || obj instanceof Line) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m.dispose());
      } else {
        obj.material.dispose();
      }
    }
  });
}
