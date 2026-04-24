/**
 * HdMapRenderer — builds and manages Three.js geometry for all HD map layers.
 *
 * Four scene groups (all children of worldRoot):
 *   laneEdgesGroup  — left/right road boundary polylines (coloured by edge type)
 *   laneMarkersGroup — lane marking lines (solid/dashed/virtual)
 *   objectsGroup    — road surface objects: stop bars, crosswalks, etc.
 *   signsGroup      — traffic signs / lights (cross markers)
 *
 * All geometry uses LineSegments (pairs of vertices) for maximum GPU efficiency.
 * A small Y_LIFT offset prevents z-fighting with the point cloud ground surface.
 */

import {
  Group,
  BufferGeometry,
  Float32BufferAttribute,
  LineSegments,
  LineBasicMaterial,
  Color,
} from 'three';
import type { LxsxFile, LxsxMarker } from './parsers/lxsx-parser';
import type { RsgxFile } from './parsers/rsgx-parser';
import { project } from './projection';

// Lift map features this many metres above the point cloud surface to prevent
// z-fighting.  Road-surface objects are lifted less than elevated signs.
const Y_LIFT_ROAD   = 0.08;
const Y_LIFT_SIGN   = 0.4;
const SIGN_RADIUS   = 0.6;  // half-size of sign cross marker (metres)

// ── Edge type colours ─────────────────────────────────────────────────────────
const EDGE_COLORS: Record<string, number> = {
  'Curb':                   0xF97316, // orange
  'Paved to Non-Paved':     0xA8916A, // tan
  'Other Marked':           0xE5E5E5, // near-white
  'Driveway Threshold':     0x888888, // mid-gray
  'Barrier':                0xFBBF24, // amber
  'Inferred':               0x4B5563, // dark gray
};
const EDGE_COLOR_DEFAULT = 0x4B5563;

// ── Marker type colours ───────────────────────────────────────────────────────
function markerColor(marker: LxsxMarker): number {
  const t = marker.type;
  const c = marker.color;
  if (t.includes('Virtual') || t.includes('Inferred')) return 0x374151; // near-invisible
  if (c === 'Yellow')   return 0xEAB308;  // yellow
  if (t.includes('Double')) return 0xD4D4D4;
  return 0xC8C8C8;  // white-ish
}

// ── Object type colours ───────────────────────────────────────────────────────
function objectColor(type: string): number {
  if (type.includes('Stop Bar'))           return 0xEF4444; // red
  if (type.includes('Pedestrian'))         return 0x3B82F6; // blue
  if (type.includes('RR Crossing'))        return 0xF59E0B; // amber
  if (type.includes('Yield'))              return 0xA78BFA; // purple
  if (type.includes('Arrow'))              return 0x34D399; // green
  if (type.includes('ONLY') || type.includes('STOP')) return 0xF87171; // light red
  return 0x94A3B8; // slate
}

// ── Sign type colours ─────────────────────────────────────────────────────────
function signColor(type: string): number {
  if (type.includes('Traffic Light') || type.includes('Red Yellow Green')) return 0x22C55E;
  if (type.includes('Stop Sign'))    return 0xEF4444;
  if (type.includes('Yield'))        return 0xA78BFA;
  if (type.includes('Speed'))        return 0x60A5FA;
  return 0xFCD34D;
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

/** Build a LineSegments object from an array of [x,y,z] position tuples.
 *  Each consecutive pair of tuples forms one line segment. */
function makeLineSegments(
  positions: number[],
  color: number,
  linewidth = 1,
): LineSegments {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const mat = new LineBasicMaterial({ color: new Color(color), linewidth });
  return new LineSegments(geo, mat);
}

/** Convert consecutive points to line-segment pairs (p0→p1, p1→p2, …). */
function polylineToSegments(pts: [number, number, number][]): number[] {
  const out: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay, az] = pts[i];
    const [bx, by, bz] = pts[i + 1];
    out.push(ax, ay, az, bx, by, bz);
  }
  return out;
}

/** Project a GeoPoint to Three.js, adding a Y lift. */
function proj(
  lat: number, lon: number, elevation: number,
  elevOff: number, lift: number,
  zone: number, hemisphere: 'N' | 'S', originE: number, originN: number,
): [number, number, number] {
  const [x, y, z] = project(lat, lon, elevation, elevOff, zone, hemisphere, originE, originN);
  return [x, y + lift, z];
}

// ── Main renderer class ───────────────────────────────────────────────────────

export class HdMapRenderer {
  readonly laneEdgesGroup   = new Group();
  readonly laneMarkersGroup = new Group();
  readonly objectsGroup     = new Group();
  readonly signsGroup       = new Group();

  constructor() {
    this.laneEdgesGroup.name   = 'hdmap-lane-edges';
    this.laneMarkersGroup.name = 'hdmap-lane-markers';
    this.objectsGroup.name     = 'hdmap-objects';
    this.signsGroup.name       = 'hdmap-signs';
  }

  /** Build all geometry from parsed tile data. */
  buildFromTiles(
    lxsxFiles: LxsxFile[],
    rsgxFiles: RsgxFile[],
    elevationOffset: number,
    utmZone: number = 18,
    utmHemisphere: 'N' | 'S' = 'N',
    utmOriginE: number = 378923.0495,
    utmOriginN: number = 4902337.3695,
  ): void {
    this.clearGroups();
    this.buildLaneGeometry(lxsxFiles, elevationOffset, utmZone, utmHemisphere, utmOriginE, utmOriginN);
    this.buildObjectGeometry(rsgxFiles, elevationOffset, utmZone, utmHemisphere, utmOriginE, utmOriginN);
    this.buildSignGeometry(rsgxFiles, elevationOffset, utmZone, utmHemisphere, utmOriginE, utmOriginN);
  }

  /**
   * Build geometry from the edit model's element list.
   * Deleted/hidden elements are omitted; the active editing element is omitted
   * (ShapeEditorEngine renders it instead during vertex editing).
   */
  buildFromElements(
    elements: import('./hd-map-edit-model').HdMapElement[],
    elevationOffset: number,
    utmZone: number = 18,
    utmHemisphere: 'N' | 'S' = 'N',
    utmOriginE: number = 378923.0495,
    utmOriginN: number = 4902337.3695,
    excludeId: string | null = null,
  ): void {
    this.clearGroups();

    const edgeBuckets   = new Map<number, number[]>();
    const markerBuckets = new Map<number, number[]>();
    const objBuckets    = new Map<number, number[]>();
    const signBuckets   = new Map<number, number[]>();

    for (const elem of elements) {
      if (elem.deleted || elem.hidden || elem.id === excludeId) continue;

      const p_ = (lat: number, lon: number, elevation: number, lift: number): [number, number, number] => {
        const [x, y, z] = project(lat, lon, elevation, elevationOffset, utmZone, utmHemisphere, utmOriginE, utmOriginN);
        return [x, y + lift, z];
      };

      switch (elem.kind) {
        case 'edge-left':
        case 'edge-right': {
          const color = EDGE_COLORS[elem.edgeType] ?? EDGE_COLOR_DEFAULT;
          const pts = elem.geoPoints.map(g => p_(g.lat, g.lon, g.elevation, Y_LIFT_ROAD));
          pushInto(edgeBuckets, color, polylineToSegments(pts));
          break;
        }
        case 'marker-line': {
          const color = elem.markerType.includes('Virtual') || elem.markerType.includes('Inferred')
            ? 0x374151
            : elem.markerColor === 'Yellow' ? 0xEAB308 : 0xC8C8C8;
          const pts = elem.geoPoints.map(g => p_(g.lat, g.lon, g.elevation, Y_LIFT_ROAD));
          pushInto(markerBuckets, color, polylineToSegments(pts));
          break;
        }
        case 'road-object': {
          const color = objectColor(elem.type);
          const pts = elem.edgePoints.map(g => p_(g.lat, g.lon, g.elevation, Y_LIFT_ROAD));
          const segs = polylineToSegments(pts);
          if (elem.edgeClosed && pts.length >= 3) {
            const last = pts[pts.length - 1];
            const first = pts[0];
            segs.push(...last, ...first);
          }
          pushInto(objBuckets, color, segs);
          break;
        }
        case 'sign': {
          const color = signColor(elem.type);
          const [sx, sy, sz] = p_(elem.point.lat, elem.point.lon, elem.point.elevation, Y_LIFT_SIGN);
          const r = SIGN_RADIUS;
          pushInto(signBuckets, color, [
            sx - r, sy, sz,  sx + r, sy, sz,
            sx, sy, sz - r,  sx, sy, sz + r,
            sx - r, sy, sz - r,  sx + r, sy, sz + r,
            sx + r, sy, sz - r,  sx - r, sy, sz + r,
          ]);
          break;
        }
      }
    }

    for (const [c, p] of edgeBuckets)   if (p.length) this.laneEdgesGroup.add(makeLineSegments(p, c));
    for (const [c, p] of markerBuckets) if (p.length) this.laneMarkersGroup.add(makeLineSegments(p, c));
    for (const [c, p] of objBuckets)    if (p.length) this.objectsGroup.add(makeLineSegments(p, c));
    for (const [c, p] of signBuckets)   if (p.length) this.signsGroup.add(makeLineSegments(p, c));
  }

  // ── Lane geometry (from LXSX) ───────────────────────────────────────────────

  private buildLaneGeometry(files: LxsxFile[], elevOff: number, zone: number, hemi: 'N'|'S', originE: number, originN: number): void {
    // Accumulate positions per colour key to batch into few LineSegments objects
    const edgeBuckets   = new Map<number, number[]>();
    const markerBuckets = new Map<number, number[]>();

    for (const file of files) {
      for (const seg of file.segments) {
        const xs = seg.xSections;
        if (xs.length < 2) continue;

        // ── Left edge polyline ──────────────────────────────────────────────
        {
          const pts = xs.map(x =>
            proj(x.leftEdge.lat, x.leftEdge.lon, x.leftEdge.elevation, elevOff, Y_LIFT_ROAD, zone, hemi, originE, originN)
          );
          const color = EDGE_COLORS[xs[0].leftEdge.type] ?? EDGE_COLOR_DEFAULT;
          pushInto(edgeBuckets, color, polylineToSegments(pts));
        }

        // ── Right edge polyline ─────────────────────────────────────────────
        {
          const pts = xs.map(x =>
            proj(x.rightEdge.lat, x.rightEdge.lon, x.rightEdge.elevation, elevOff, Y_LIFT_ROAD, zone, hemi, originE, originN)
          );
          const color = EDGE_COLORS[xs[0].rightEdge.type] ?? EDGE_COLOR_DEFAULT;
          pushInto(edgeBuckets, color, polylineToSegments(pts));
        }

        // ── Interior points (point ids) — one polyline per point-id ────────
        const pointIds = new Set<number>();
        for (const x of xs) for (const p of x.points) pointIds.add(p.id);

        for (const pid of pointIds) {
          const pts: [number, number, number][] = [];
          for (const x of xs) {
            const p = x.points.find(p => p.id === pid);
            if (p) pts.push(proj(p.lat, p.lon, p.elevation, elevOff, Y_LIFT_ROAD, zone, hemi, originE, originN));
          }
          if (pts.length < 2) continue;

          // Find marker that references this point in first xSection with it
          let markerForPoint: LxsxMarker | undefined;
          for (const x of xs) {
            markerForPoint = x.markers.find(m => m.pointId === pid);
            if (markerForPoint) break;
          }

          const color = markerForPoint ? markerColor(markerForPoint) : 0x4B5563;
          pushInto(markerBuckets, color, polylineToSegments(pts));
        }
      }
    }

    for (const [color, positions] of edgeBuckets) {
      if (positions.length) this.laneEdgesGroup.add(makeLineSegments(positions, color));
    }
    for (const [color, positions] of markerBuckets) {
      if (positions.length) this.laneMarkersGroup.add(makeLineSegments(positions, color));
    }
  }

  // ── Object geometry (from RSGX) ─────────────────────────────────────────────

  private buildObjectGeometry(files: RsgxFile[], elevOff: number, zone: number, hemi: 'N'|'S', originE: number, originN: number): void {
    const buckets = new Map<number, number[]>();

    for (const file of files) {
      for (const seg of file.segments) {
        for (const obj of seg.objects) {
          if (obj.edgePoints.length < 2) continue;

          const color = objectColor(obj.type);
          const pts: [number, number, number][] = obj.edgePoints.map(p =>
            proj(p.lat, p.lon, p.elevation, elevOff, Y_LIFT_ROAD, zone, hemi, originE, originN)
          );

          // Closed polygon → connect last back to first
          const segs = polylineToSegments(pts);
          if (obj.edgeClosed && pts.length >= 3) {
            const last = pts[pts.length - 1];
            const first = pts[0];
            segs.push(...last, ...first);
          }

          pushInto(buckets, color, segs);
        }
      }
    }

    for (const [color, positions] of buckets) {
      if (positions.length) this.objectsGroup.add(makeLineSegments(positions, color));
    }
  }

  // ── Sign geometry (from RSGX) ───────────────────────────────────────────────

  private buildSignGeometry(files: RsgxFile[], elevOff: number, zone: number, hemi: 'N'|'S', originE: number, originN: number): void {
    const buckets = new Map<number, number[]>();

    for (const file of files) {
      for (const seg of file.segments) {
        for (const sign of seg.signs) {
          const color = signColor(sign.type);
          const [sx, sy, sz] = proj(sign.lat, sign.lon, sign.elevation, elevOff, Y_LIFT_SIGN, zone, hemi, originE, originN);
          const r = SIGN_RADIUS;

          // Draw a small ✕ cross to mark sign location
          const cross: number[] = [
            sx - r, sy, sz,  sx + r, sy, sz,  // horizontal bar
            sx, sy, sz - r,  sx, sy, sz + r,  // vertical bar (in XZ plane)
            sx - r, sy, sz - r,  sx + r, sy, sz + r,  // diagonal 1
            sx + r, sy, sz - r,  sx - r, sy, sz + r,  // diagonal 2
          ];

          pushInto(buckets, color, cross);
        }
      }
    }

    for (const [color, positions] of buckets) {
      if (positions.length) this.signsGroup.add(makeLineSegments(positions, color));
    }
  }

  // ── Layer visibility ────────────────────────────────────────────────────────

  setEdgesVisible(v: boolean):   void { this.laneEdgesGroup.visible   = v; }
  setMarkersVisible(v: boolean): void { this.laneMarkersGroup.visible  = v; }
  setObjectsVisible(v: boolean): void { this.objectsGroup.visible      = v; }
  setSignsVisible(v: boolean):   void { this.signsGroup.visible        = v; }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  private clearGroups(): void {
    for (const group of [
      this.laneEdgesGroup,
      this.laneMarkersGroup,
      this.objectsGroup,
      this.signsGroup,
    ]) {
      for (const child of [...group.children]) {
        if (child instanceof LineSegments) {
          child.geometry.dispose();
          (child.material as LineBasicMaterial).dispose();
        }
      }
      group.clear();
    }
  }

  dispose(): void {
    this.clearGroups();
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function pushInto(map: Map<number, number[]>, key: number, values: number[]): void {
  let arr = map.get(key);
  if (!arr) { arr = []; map.set(key, arr); }
  for (const v of values) arr.push(v);
}
