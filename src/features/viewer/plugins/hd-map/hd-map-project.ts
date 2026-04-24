/**
 * HdMapProject — the schema for a .hdmap project file.
 *
 * A .hdmap file is a JSON document that tells the HD map plugin where to find
 * DMP tile files and how to project them into the viewer's local coordinate
 * system.  It is region-agnostic: the same plugin can load KCity, MCity, or any
 * other GM DMP survey by pointing it at a different .hdmap file.
 *
 * Tile naming convention:
 *   <tilesDir>/<region>_<i>.lxsx   i = 0 .. numTiles-1
 *   <tilesDir>/<region>_<i>.rsgx
 *   <tilesDir>/<region>.risx        (one shared file, reserved for future use)
 *
 * tilesDir may be:
 *   - An absolute filesystem path  (C:\...\hdmaps\kcity)
 *   - A URL route                  (/hdmaps/kcity)
 *   electronFetch handles both transparently.
 */

export interface HdMapProject {
  /** Schema version — always 1 for now. */
  version: 1;

  /** Human-readable name shown in the panel (e.g. "KCity — GM HD Map"). */
  name: string;

  /** DMP region prefix used to construct tile filenames (e.g. "CAN_ONTARIO"). */
  region: string;

  /** Number of indexed tiles (0 … numTiles-1). */
  numTiles: number;

  /**
   * Directory (absolute path or URL route) that contains the DMP tile files.
   * Must NOT have a trailing slash.
   */
  tilesDir: string;

  /** UTM zone number (e.g. 18 for Kingston ON, 17 for Ann Arbor MI). */
  utmZone: number;

  /** UTM hemisphere ('N' for northern, 'S' for southern). */
  utmHemisphere: 'N' | 'S';

  /**
   * UTM easting of the local coordinate origin — must match the value used
   * when the companion point cloud was preprocessed (origin.json / crs.json).
   */
  utmOriginEasting: number;

  /**
   * UTM northing of the local coordinate origin — same source as above.
   */
  utmOriginNorthing: number;

  /**
   * Fallback elevation offset (metres ASL) used before the DEM auto-calibrates.
   * Omit to use 51.3 m (KCity ground level).
   */
  elevationOffsetDefault?: number;
}
