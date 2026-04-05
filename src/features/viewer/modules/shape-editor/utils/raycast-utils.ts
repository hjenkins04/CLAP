import {
  Raycaster,
  Vector2,
  Vector3,
  Plane,
  Camera,
  PerspectiveCamera,
  Object3D,
  Intersection,
} from 'three';

// ── NDC helpers ───────────────────────────────────────────────────────────────

export function clientToNdc(
  clientX: number,
  clientY: number,
  domElement: HTMLElement,
): Vector2 {
  const rect = domElement.getBoundingClientRect();
  return new Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
}

// ── Ray from camera ───────────────────────────────────────────────────────────

export function makeRaycaster(ndc: Vector2, camera: Camera): Raycaster {
  const rc = new Raycaster();
  rc.setFromCamera(ndc, camera);
  return rc;
}

// ── Plane intersection ────────────────────────────────────────────────────────

/**
 * Intersect a ray from the given NDC position with a world-space horizontal
 * plane at `y`. Returns null if ray is nearly horizontal.
 */
export function raycastHorizontalPlane(
  ndc: Vector2,
  camera: Camera,
  planeY: number,
): Vector3 | null {
  const rc = makeRaycaster(ndc, camera);
  const plane = new Plane(new Vector3(0, 1, 0), -planeY);
  const target = new Vector3();
  const result = rc.ray.intersectPlane(plane, target);
  return result ? target.clone() : null;
}

/**
 * Intersect a ray with a world-space vertical plane defined by a normal
 * and a point on the plane.
 */
export function raycastVerticalPlane(
  ndc: Vector2,
  camera: Camera,
  planeNormal: Vector3,
  planePoint: Vector3,
): Vector3 | null {
  const rc = makeRaycaster(ndc, camera);
  const d = -planeNormal.dot(planePoint);
  const plane = new Plane(planeNormal, d);
  const target = new Vector3();
  const result = rc.ray.intersectPlane(plane, target);
  return result ? target.clone() : null;
}

// ── Object intersection ───────────────────────────────────────────────────────

/**
 * Raycast against a list of objects, returning the first hit (closest).
 * Returns null if nothing was hit.
 */
export function raycastObjects(
  ndc: Vector2,
  camera: Camera,
  objects: Object3D[],
  recursive = false,
): Intersection | null {
  if (objects.length === 0) return null;
  const rc = makeRaycaster(ndc, camera);
  const hits = rc.intersectObjects(objects, recursive);
  return hits.length > 0 ? hits[0] : null;
}

// ── Meters per pixel ──────────────────────────────────────────────────────────

/**
 * Estimate world-space distance per screen pixel at a given distance from
 * the camera. Useful for converting screen-drag deltas to world-space deltas.
 */
export function metersPerPixel(
  camera: Camera,
  distanceToPoint: number,
  screenHeight: number,
): number {
  if (camera instanceof PerspectiveCamera) {
    const fovRad = (camera.fov * Math.PI) / 180;
    return (2 * distanceToPoint * Math.tan(fovRad / 2)) / screenHeight;
  }
  // Orthographic fallback — return a small constant
  return 0.01;
}
