// ── CRS Types ────────────────────────────────────────────────────────

/**
 * Geo-reference info written by preprocess.py when a UTM CRS is detected.
 * Used by the viewer to auto-configure the world frame.
 */
export interface CrsInfo {
  type: 'utm';
  zone: number;
  hemisphere: 'N' | 'S';
  epsg: number;
  origin: { easting: number; northing: number; elevation: number };
  refLngLat: { lng: number; lat: number };
}

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

// ── UTM ↔ WGS84 Projection ───────────────────────────────────────────

const _UTM_K0 = 0.9996;
const _UTM_A  = 6378137.0;
const _UTM_E2 = 0.00669437999014;
const _UTM_EP2 = _UTM_E2 / (1 - _UTM_E2);

/**
 * Convert UTM easting/northing to WGS84 {lng, lat}.
 * Supports all zones 1–60, both hemispheres.
 */
export function utmToLngLat(
  easting: number,
  northing: number,
  zone: number,
  hemisphere: 'N' | 'S',
): GeoPoint {
  const x = easting - 500000;
  const y = hemisphere === 'S' ? northing - 10_000_000 : northing;
  const m = y / _UTM_K0;
  const mu = m / (_UTM_A * (1 - _UTM_E2 / 4 - (3 * _UTM_E2 ** 2) / 64 - (5 * _UTM_E2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - _UTM_E2)) / (1 + Math.sqrt(1 - _UTM_E2));
  const phi1 =
    mu +
    (1.5 * e1 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const n1  = _UTM_A / Math.sqrt(1 - _UTM_E2 * Math.sin(phi1) ** 2);
  const t1  = Math.tan(phi1) ** 2;
  const c1  = _UTM_EP2 * Math.cos(phi1) ** 2;
  const r1  = (_UTM_A * (1 - _UTM_E2)) / (1 - _UTM_E2 * Math.sin(phi1) ** 2) ** 1.5;
  const d   = x / (n1 * _UTM_K0);
  const latRad =
    phi1 -
    ((n1 * Math.tan(phi1)) / r1) *
      (d ** 2 / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * _UTM_EP2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * _UTM_EP2 - 3 * c1 ** 2) * d ** 6) / 720);
  const lngRad =
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * _UTM_EP2 + 24 * t1 ** 2) * d ** 5) / 120) /
    Math.cos(phi1);
  const centralMeridian = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  return {
    lng: (centralMeridian + lngRad) * (180 / Math.PI),
    lat: latRad * (180 / Math.PI),
  };
}

/**
 * Convert WGS84 {lng, lat} to UTM easting/northing for a given zone.
 */
export function lngLatToUtm(
  lng: number,
  lat: number,
  zone: number,
): { easting: number; northing: number } {
  const latRad = lat * (Math.PI / 180);
  const lngRad = lng * (Math.PI / 180);
  const cm = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const t   = Math.tan(latRad) ** 2;
  const c   = _UTM_EP2 * Math.cos(latRad) ** 2;
  const aa  = Math.cos(latRad) * (lngRad - cm);
  const sL  = Math.sin(latRad);
  const N   = _UTM_A / Math.sqrt(1 - _UTM_E2 * sL ** 2);
  const e2  = _UTM_E2, e4 = e2 ** 2, e6 = e2 ** 3;
  const M   = _UTM_A * (
    (1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * latRad -
    ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * latRad) +
    ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * latRad) -
    ((35 * e6) / 3072) * Math.sin(6 * latRad)
  );
  const easting =
    _UTM_K0 * N * (aa + ((1 - t + c) * aa ** 3) / 6 +
      ((5 - 18 * t + t ** 2 + 72 * c - 58 * _UTM_EP2) * aa ** 5) / 120) + 500000;
  const northing =
    _UTM_K0 * (M + N * Math.tan(latRad) * (aa ** 2 / 2 +
      ((5 - t + 9 * c + 4 * c ** 2) * aa ** 4) / 24 +
      ((61 - 58 * t + t ** 2 + 600 * c - 330 * _UTM_EP2) * aa ** 6) / 720));
  return { easting, northing: lat < 0 ? northing + 10_000_000 : northing };
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
