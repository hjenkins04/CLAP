// ── Geo Types ────────────────────────────────────────────────────────

export interface GeoPoint {
  lng: number;
  lat: number;
}

/**
 * A point on the local ground plane (XZ in Three.js Y-up convention).
 *   x = east/west (Three.js X)
 *   z = north/south (Three.js Z)
 */
export interface LocalPoint {
  x: number;
  z: number;
}

export interface WorldFrameTransform {
  /** Reference geo point (anchor 1 geo) */
  refGeo: GeoPoint;
  /** Offset to add to geo-in-meters coords (after rotation) to get PC coords */
  translation: { x: number; z: number };
  /** Rotation angle in radians (from geo frame to PC frame, around Y axis) */
  rotation: number;
}

// ── Meters per degree constants ──────────────────────────────────────

const METERS_PER_DEG_LAT = 110540;
const METERS_PER_DEG_LNG_AT_EQUATOR = 111320;

// ── Coordinate Conversion ────────────────────────────────────────────

/**
 * Convert a geo point to meters relative to a reference point using
 * a local tangent plane approximation.
 *
 * Returns { x: east meters, y: north meters } in the geo-meters frame.
 */
export function geoToMeters(
  point: GeoPoint,
  ref: GeoPoint,
): { x: number; y: number } {
  const latRad = ref.lat * (Math.PI / 180);
  return {
    x: (point.lng - ref.lng) * Math.cos(latRad) * METERS_PER_DEG_LNG_AT_EQUATOR,
    y: (point.lat - ref.lat) * METERS_PER_DEG_LAT,
  };
}

/**
 * Convert meters relative to a reference point back to geo coordinates.
 */
export function metersToGeo(
  meters: { x: number; y: number },
  ref: GeoPoint,
): GeoPoint {
  const latRad = ref.lat * (Math.PI / 180);
  return {
    lng: ref.lng + meters.x / (Math.cos(latRad) * METERS_PER_DEG_LNG_AT_EQUATOR),
    lat: ref.lat + meters.y / METERS_PER_DEG_LAT,
  };
}

/**
 * Convert a geo point to local PC coordinates (XZ ground plane, Y-up).
 *
 * 1. geoToMeters → (mx, my) in east/north meters
 * 2. Rotate by transform.rotation around origin
 * 3. Add translation → PC local (x, z)
 */
export function geoToLocal(
  point: GeoPoint,
  transform: WorldFrameTransform,
): LocalPoint {
  const m = geoToMeters(point, transform.refGeo);
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);
  return {
    x: m.x * cos - m.y * sin + transform.translation.x,
    z: m.x * sin + m.y * cos + transform.translation.z,
  };
}

/**
 * Convert local PC coordinates to geo.
 */
export function localToGeo(
  point: LocalPoint,
  transform: WorldFrameTransform,
): GeoPoint {
  const dx = point.x - transform.translation.x;
  const dz = point.z - transform.translation.z;
  const cos = Math.cos(-transform.rotation);
  const sin = Math.sin(-transform.rotation);
  const mx = dx * cos - dz * sin;
  const my = dx * sin + dz * cos;
  return metersToGeo({ x: mx, y: my }, transform.refGeo);
}

// ── Transform Computation ────────────────────────────────────────────

/**
 * Compute the world frame transform from anchor pairs.
 *
 * pc coordinates use Three.js Y-up: pc.x = east, pc.z = north/south.
 */
export function computeWorldFrameTransform(
  anchor1: { geo: GeoPoint; pc: { x: number; z: number } },
  anchor2: { geo: GeoPoint; pc: { x: number; z: number } } | null,
  rotationOffset: number,
  translationOffset: { x: number; z: number },
): WorldFrameTransform {
  let rotation: number;

  if (anchor2) {
    const geoM = geoToMeters(anchor2.geo, anchor1.geo);
    const geoAngle = Math.atan2(geoM.y, geoM.x);
    const pcDx = anchor2.pc.x - anchor1.pc.x;
    const pcDz = anchor2.pc.z - anchor1.pc.z;
    const pcAngle = Math.atan2(pcDz, pcDx);
    rotation = pcAngle - geoAngle + rotationOffset;
  } else {
    rotation = rotationOffset;
  }

  const translation = {
    x: anchor1.pc.x + translationOffset.x,
    z: anchor1.pc.z + translationOffset.z,
  };

  return {
    refGeo: anchor1.geo,
    translation,
    rotation,
  };
}

// ── Slippy Map Tile Math ─────────────────────────────────────────────

export function lngLatToTile(
  lng: number,
  lat: number,
  zoom: number,
): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const latRad = lat * (Math.PI / 180);
  return {
    x: Math.floor(((lng + 180) / 360) * n),
    y: Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
    ),
  };
}

export function tileToLngLat(
  x: number,
  y: number,
  zoom: number,
): GeoPoint {
  const n = Math.pow(2, zoom);
  const lng = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return { lng, lat: latRad * (180 / Math.PI) };
}
