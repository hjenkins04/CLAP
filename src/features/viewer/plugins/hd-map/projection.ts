/**
 * WGS84 → UTM Zone 18N → Three.js local coordinate projection.
 *
 * Axis convention (matches CLAP DEM terrain and point cloud):
 *   Three.js X  = UTM Easting  − origin.easting   (positive East)
 *   Three.js Y  = elevation    − elevationOffset   (positive Up)
 *   Three.js Z  = UTM Northing − origin.northing   (positive North)
 *
 * UTM Zone 18N covers 72°W–78°W, central meridian 75°W.
 * KCity (Kingston, Ontario) origin from crs.json:
 *   easting  = 378923.0495
 *   northing = 4902337.3695
 */

// ── WGS84 ellipsoid ───────────────────────────────────────────────────────────
const A   = 6378137.0;                    // semi-major axis (m)
const F   = 1 / 298.257223563;            // flattening
const E2  = 2 * F - F * F;               // eccentricity²
const EP2 = E2 / (1 - E2);               // second eccentricity²
const K0  = 0.9996;                       // UTM scale factor
const FE  = 500_000;                      // false easting (m)

// ── KCity CRS origin (from crs.json) — kept for backwards compatibility ───────
export const UTM_ORIGIN_E = 378923.0495;
export const UTM_ORIGIN_N = 4902337.3695;

// ── Forward projection ────────────────────────────────────────────────────────

/**
 * Convert WGS84 decimal degrees to UTM (easting, northing) in metres.
 * Works for any UTM zone in either hemisphere.
 *
 * @param zone  UTM zone number, 1–60
 * @param hemisphere  'N' (northern) or 'S' (southern)
 */
export function wgs84ToUtm(
  lat: number,
  lon: number,
  zone: number,
  hemisphere: 'N' | 'S' = 'N',
): [easting: number, northing: number] {
  // Central meridian for the given zone
  const lon0 = ((zone * 6) - 183) * (Math.PI / 180);
  // False northing: 0 for northern hemisphere, 10 000 000 for southern
  const FN = hemisphere === 'S' ? 10_000_000 : 0;

  const phi    = lat * (Math.PI / 180);
  const lambda = lon * (Math.PI / 180);

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);

  const N = A / Math.sqrt(1 - E2 * sinPhi * sinPhi);
  const T = tanPhi * tanPhi;
  const C = EP2 * cosPhi * cosPhi;
  const Av = cosPhi * (lambda - lon0);

  const M = A * (
      (1 - E2/4 - 3*E2*E2/64 - 5*E2*E2*E2/256)   * phi
    - (3*E2/8 + 3*E2*E2/32 + 45*E2*E2*E2/1024)   * Math.sin(2*phi)
    + (15*E2*E2/256 + 45*E2*E2*E2/1024)           * Math.sin(4*phi)
    - (35*E2*E2*E2/3072)                           * Math.sin(6*phi)
  );

  const easting = K0 * N * (
      Av
    + (1 - T + C) * Av*Av*Av / 6
    + (5 - 18*T + T*T + 72*C - 58*EP2) * Av*Av*Av*Av*Av / 120
  ) + FE;

  const northing = FN + K0 * (
    M + N * tanPhi * (
        Av*Av / 2
      + (5 - T + 9*C + 4*C*C) * Av*Av*Av*Av / 24
      + (61 - 58*T + T*T + 600*C - 330*EP2) * Av*Av*Av*Av*Av*Av / 720
    )
  );

  return [easting, northing];
}

/** Convenience alias: WGS84 → UTM Zone 18N (KCity). */
export function wgs84ToUtm18N(lat: number, lon: number): [easting: number, northing: number] {
  return wgs84ToUtm(lat, lon, 18, 'N');
}

// ── Inverse projection ────────────────────────────────────────────────────────

/** Convert UTM (easting, northing) back to WGS84 decimal degrees. */
export function utmToWgs84(
  easting: number,
  northing: number,
  zone: number,
  hemisphere: 'N' | 'S' = 'N',
): [lat: number, lon: number] {
  const lon0 = ((zone * 6) - 183) * (Math.PI / 180);
  const FN   = hemisphere === 'S' ? 10_000_000 : 0;

  const x = easting  - FE;
  const y = northing - FN;

  const M  = y / K0;
  const mu = M / (A * (1 - E2/4 - 3*E2*E2/64 - 5*E2*E2*E2/256));

  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 = mu
    + (3*e1/2      - 27*e1*e1*e1/32)       * Math.sin(2*mu)
    + (21*e1*e1/16 - 55*e1*e1*e1*e1/32)    * Math.sin(4*mu)
    + (151*e1*e1*e1/96)                     * Math.sin(6*mu)
    + (1097*e1*e1*e1*e1/512)               * Math.sin(8*mu);

  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = Math.tan(phi1);

  const N1  = A / Math.sqrt(1 - E2 * sin1 * sin1);
  const T1  = tan1 * tan1;
  const C1  = EP2 * cos1 * cos1;
  const R1  = A * (1 - E2) / Math.pow(1 - E2 * sin1 * sin1, 1.5);
  const D   = x / (N1 * K0);

  const latRad = phi1 - (N1 * tan1 / R1) * (
      D*D / 2
    - (5 + 3*T1 + 10*C1 - 4*C1*C1 - 9*EP2) * D*D*D*D / 24
    + (61 + 90*T1 + 298*C1 + 45*T1*T1 - 252*EP2 - 3*C1*C1) * D*D*D*D*D*D / 720
  );

  const lonRad = lon0 + (
      D
    - (1 + 2*T1 + C1)              * D*D*D / 6
    + (5 - 2*C1 + 28*T1 - 3*C1*C1 + 8*EP2 + 24*T1*T1) * D*D*D*D*D / 120
  ) / cos1;

  return [latRad * (180 / Math.PI), lonRad * (180 / Math.PI)];
}

/**
 * Unproject Three.js local coords back to WGS84 + absolute elevation.
 * Inverse of `project()`.
 */
export function unproject(
  x: number,
  y: number,
  z: number,
  elevationOffset: number,
  zone: number = 18,
  hemisphere: 'N' | 'S' = 'N',
  originE: number = UTM_ORIGIN_E,
  originN: number = UTM_ORIGIN_N,
): [lat: number, lon: number, elevation: number] {
  const [lat, lon] = utmToWgs84(x + originE, z + originN, zone, hemisphere);
  return [lat, lon, y + elevationOffset];
}

/**
 * Project a WGS84 coordinate to Three.js world space for a given HD map project.
 *
 * @param elevationOffset  Absolute elevation (m ASL) corresponding to Three.js Y=0.
 * @param zone             UTM zone number (default 18 for KCity).
 * @param hemisphere       UTM hemisphere (default 'N').
 * @param originE          UTM easting origin (default KCity value).
 * @param originN          UTM northing origin (default KCity value).
 */
export function project(
  lat: number,
  lon: number,
  elevation: number,
  elevationOffset: number,
  zone: number = 18,
  hemisphere: 'N' | 'S' = 'N',
  originE: number = UTM_ORIGIN_E,
  originN: number = UTM_ORIGIN_N,
): [x: number, y: number, z: number] {
  const [e, n] = wgs84ToUtm(lat, lon, zone, hemisphere);
  return [
    e - originE,
    elevation - elevationOffset,
    n - originN,
  ];
}
