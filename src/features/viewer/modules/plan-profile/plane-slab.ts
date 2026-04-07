import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { IClipBox } from 'potree-core';

export type SlabViewType = 'plan' | 'profile';

export interface PlaneSlab {
  center: Vector3;
  /** World Y of the ground (scene min Y) */
  groundY: number;
  /** Direction the camera looks along (perpendicular to the drawn line, horizontal) */
  viewDir: Vector3;
  /** "Right" / width axis in the 2D view — the drawn A→B direction */
  tangent: Vector3;
  /** "Up" in the 2D view — always world Y */
  up: Vector3;
  /** Half-thickness of the slab (buffer, user-adjustable). Min 0.001, max 15. */
  halfDepth: number;
  /** Half-height of the slab (half of scene Y extent) */
  halfHeight: number;
  /** Half-length of the drawn line A→B */
  halfLength: number;
  viewType: SlabViewType;
}

// ── Shared builder ────────────────────────────────────────────────────────────

/**
 * Build a slab from a two-point line with explicit vertical extent.
 *
 * - Width  = |A-B|  (the drawn line defines the 2D view width)
 * - Depth  = halfDepth * 2  (thin buffer perpendicular to A→B, user-adjustable)
 * - Height = halfHeight * 2, centred on centerY
 *
 * centerY and halfHeight should be derived from the DEM ground elevation and
 * the point cloud's tight bounding box Y extents so the slab sits correctly
 * in scene space.
 */
function buildSlab(
  a: Vector3,
  b: Vector3,
  halfDepth: number,
  viewType: SlabViewType,
  centerY: number,
  halfHeight: number,
): PlaneSlab {
  const dir = b.clone().sub(a);
  dir.y = 0;
  const halfLength = Math.max(dir.length() / 2, 0.5);
  dir.normalize();

  // Perpendicular in XZ — camera looks along this, into the drawn cut plane
  const perp = new Vector3(-dir.z, 0, dir.x);

  return {
    center: new Vector3((a.x + b.x) / 2, centerY, (a.z + b.z) / 2),
    groundY: centerY - halfHeight,
    viewDir: perp,
    tangent: dir,
    up: new Vector3(0, 1, 0),
    halfDepth,
    halfHeight,
    halfLength,
    viewType,
  };
}

export function buildPlanSlab(
  a: Vector3,
  b: Vector3,
  halfDepth: number,
  centerY: number,
  halfHeight: number,
): PlaneSlab {
  return buildSlab(a, b, halfDepth, 'plan', centerY, halfHeight);
}

export function buildProfileSlab(
  a: Vector3,
  b: Vector3,
  halfDepth: number,
  centerY: number,
  halfHeight: number,
): PlaneSlab {
  return buildSlab(a, b, halfDepth, 'profile', centerY, halfHeight);
}

// ── Clip box ──────────────────────────────────────────────────────────────────

/**
 * Build an IClipBox for potree. The clipped region is the thin oriented slab:
 *   - X axis = viewDir  (depth, halfDepth)
 *   - Y axis = up       (height, halfHeight)
 *   - Z axis = tangent  (length, halfLength)
 */
export function slabToClipBox(slab: PlaneSlab): IClipBox {
  const { center, viewDir, up, tangent, halfDepth, halfHeight, halfLength } = slab;

  const sx = halfDepth  * 2;
  const sy = halfHeight * 2;
  const sz = halfLength * 2;

  // worldMatrix: maps unit cube → slab in world space
  const worldMatrix = new Matrix4()
    .makeTranslation(center.x, center.y, center.z)
    .multiply(new Matrix4().makeBasis(viewDir, up, tangent))
    .multiply(new Matrix4().makeScale(sx, sy, sz));
  const inverse = worldMatrix.clone().invert();

  // Tight AABB for the clip box
  const box = new Box3();
  for (const fx of [-0.5, 0.5])
    for (const fy of [-0.5, 0.5])
      for (const fz of [-0.5, 0.5])
        box.expandByPoint(
          center.clone()
            .addScaledVector(viewDir, fx * sx)
            .addScaledVector(up,      fy * sy)
            .addScaledVector(tangent, fz * sz),
        );

  return { box, matrix: worldMatrix, inverse, position: center.clone() };
}

// ── 3D wireframe (shown in primary viewport) ──────────────────────────────────

export function buildSlabWireframe(slab: PlaneSlab): LineSegments {
  const geom = new EdgesGeometry(new BoxGeometry(1, 1, 1));
  const mat = new LineBasicMaterial({
    color: 0xffcc00,
    transparent: true,
    opacity: 0.75,
    depthTest: false,
  });
  const mesh = new LineSegments(geom, mat);
  mesh.renderOrder = 800;
  updateSlabWireframe(mesh, slab);
  return mesh;
}

export function updateSlabWireframe(mesh: LineSegments, slab: PlaneSlab): void {
  const { center, viewDir, up, tangent, halfDepth, halfHeight, halfLength } = slab;
  // setRotationFromMatrix requires a right-handed (det=+1) rotation matrix.
  // makeBasis(viewDir, up, tangent) has det=-1 (left-handed), which causes
  // setFromRotationMatrix to produce the wrong quaternion (identity in many cases).
  // Negating the first column flips the determinant to +1 without changing the
  // visual box (the X extent is symmetric, ±halfDepth in the viewDir direction).
  mesh.position.copy(center);
  mesh.setRotationFromMatrix(
    new Matrix4().makeBasis(viewDir.clone().negate(), up, tangent),
  );
  mesh.scale.set(halfDepth * 2, halfHeight * 2, halfLength * 2);
}

// ── Center gizmo (draggable sphere in primary viewport) ───────────────────────

export function buildCenterGizmo(slab: PlaneSlab, radius = 0.8): Mesh {
  const geom = new SphereGeometry(radius, 16, 8);
  const mat = new MeshBasicMaterial({
    color: 0xffcc00,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  });
  const mesh = new Mesh(geom, mat);
  mesh.position.copy(slab.center);
  mesh.renderOrder = 801;
  mesh.name = '__planProfileGizmo';
  return mesh;
}

// ── Preview line (shown during drawing) ───────────────────────────────────────

export function buildPreviewLine(): Line {
  const positions = new Float32Array(6);
  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const mat = new LineBasicMaterial({
    color: 0xffcc00,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
  });
  const line = new Line(geom, mat);
  line.renderOrder = 810;
  return line;
}

export function updatePreviewLine(line: Line, a: Vector3, b: Vector3): void {
  const pos = line.geometry.getAttribute('position');
  pos.setXYZ(0, a.x, a.y + 0.05, a.z);
  pos.setXYZ(1, b.x, b.y + 0.05, b.z);
  pos.needsUpdate = true;
}

// ── Secondary viewport camera ─────────────────────────────────────────────────

/**
 * Compute orthographic camera parameters so the secondary viewport frames
 * the full width × height face of the slab.
 * frustumSize = full height (scene Y extent) — width handled by aspect ratio.
 */
export function slabCameraParams(slab: PlaneSlab, flipped = false): {
  position: Vector3;
  target: Vector3;
  up: Vector3;
  frustumSize: number;
} {
  const { center, viewDir, up, halfHeight, halfLength } = slab;

  // Place camera far enough back to see the whole slab face
  const farDist = Math.max(halfHeight, halfLength) * 4 + 100;
  // Flipped = camera on the +viewDir side instead of the default -viewDir side.
  const sign = flipped ? 1 : -1;
  const position = center.clone().addScaledVector(viewDir, sign * farDist);

  // frustumSize = full height so the viewport shows the complete vertical extent
  // The width (halfLength * 2) will be visible as long as the aspect ratio covers it
  const frustumSize = halfHeight * 2;

  return { position, target: center.clone(), up: up.clone(), frustumSize };
}
