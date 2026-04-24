/**
 * HD Map Edit Model — mutable, canonical representation of all editable elements.
 *
 * WGS84 (lat/lon/elevation) is the source-of-truth.  Three.js world coords are
 * always derived on the fly via project().
 *
 * Element kinds:
 *   edge-left / edge-right — left or right road boundary polyline of a segment
 *   marker-line            — interior lane marker polyline (read-only in v1)
 *   road-object            — closed or open polygon (stop bar, crosswalk…)
 *   sign                   — single-point sign / traffic light
 *
 * ID scheme:  `lxsx:fi:segId:left` | `lxsx:fi:segId:pt:pid` | `rsgx:fi:segId:obj:oid` …
 */

import type { LxsxFile } from './parsers/lxsx-parser';
import type { RsgxFile  } from './parsers/rsgx-parser';

// ── Geo coordinate ────────────────────────────────────────────────────────────

export interface GeoPoint {
  lat: number;
  lon: number;
  elevation: number;
}

// ── Element kinds ─────────────────────────────────────────────────────────────

export type HdMapElementKind =
  | 'edge-left'
  | 'edge-right'
  | 'marker-line'
  | 'road-object'
  | 'sign';

interface ElementBase {
  id: string;
  kind: HdMapElementKind;
  label: string;
  fileIndex: number;
  segmentId: number;
  deleted: boolean;
  hidden: boolean;
}

export interface HdMapEdgeElement extends ElementBase {
  kind: 'edge-left' | 'edge-right';
  xSectionIds: number[];
  geoPoints: GeoPoint[];    // one per xSection (mutable)
  edgeType: string;
}

export interface HdMapMarkerLineElement extends ElementBase {
  kind: 'marker-line';
  pointId: number;
  xSectionIds: number[];
  geoPoints: GeoPoint[];    // one per xSection that has this pointId
  markerType: string;
  markerColor: string;
}

export interface HdMapObjectElement extends ElementBase {
  kind: 'road-object';
  roadId: number;           // needed to scope XML patcher queries
  objectId: number;
  type: string;
  center: GeoPoint;         // <object> lat/lon/elevation attrs
  edgePoints: GeoPoint[];   // mutable polygon vertices
  edgeClosed: boolean;
}

export interface HdMapSignElement extends ElementBase {
  kind: 'sign';
  roadId: number;           // needed to scope XML patcher queries
  signId: number;
  type: string;
  point: GeoPoint;          // mutable position
  azimuth: number;
}

export type HdMapElement =
  | HdMapEdgeElement
  | HdMapMarkerLineElement
  | HdMapObjectElement
  | HdMapSignElement;

// ── Build from parsed tile data ───────────────────────────────────────────────

export function buildEditModel(
  lxsxFiles: LxsxFile[],
  rsgxFiles:  RsgxFile[],
): HdMapElement[] {
  const elements: HdMapElement[] = [];

  // ── LXSX ──────────────────────────────────────────────────────────────────
  for (let fi = 0; fi < lxsxFiles.length; fi++) {
    for (const seg of lxsxFiles[fi].segments) {
      const xs = seg.xSections;
      if (xs.length < 2) continue;

      // Left edge
      elements.push({
        id:         `lxsx:${fi}:${seg.id}:left`,
        kind:       'edge-left',
        label:      `Seg ${seg.id} — Left Edge`,
        fileIndex:  fi,
        segmentId:  seg.id,
        deleted:    false,
        hidden:     false,
        xSectionIds: xs.map(x => x.id),
        geoPoints:   xs.map(x => ({ lat: x.leftEdge.lat, lon: x.leftEdge.lon, elevation: x.leftEdge.elevation })),
        edgeType:    xs[0].leftEdge.type,
      });

      // Right edge
      elements.push({
        id:         `lxsx:${fi}:${seg.id}:right`,
        kind:       'edge-right',
        label:      `Seg ${seg.id} — Right Edge`,
        fileIndex:  fi,
        segmentId:  seg.id,
        deleted:    false,
        hidden:     false,
        xSectionIds: xs.map(x => x.id),
        geoPoints:   xs.map(x => ({ lat: x.rightEdge.lat, lon: x.rightEdge.lon, elevation: x.rightEdge.elevation })),
        edgeType:    xs[0].rightEdge.type,
      });

      // Interior marker polylines (one per unique pointId that appears in ≥2 xSections)
      const pointIds = new Set<number>();
      for (const x of xs) for (const p of x.points) pointIds.add(p.id);

      for (const pid of pointIds) {
        const xsWithPt = xs.filter(x => x.points.some(p => p.id === pid));
        if (xsWithPt.length < 2) continue;

        const markerDef = xsWithPt[0].markers.find(m => m.pointId === pid);

        elements.push({
          id:         `lxsx:${fi}:${seg.id}:pt:${pid}`,
          kind:       'marker-line',
          label:      `Seg ${seg.id} — Marker ${pid}`,
          fileIndex:  fi,
          segmentId:  seg.id,
          deleted:    false,
          hidden:     false,
          pointId:    pid,
          xSectionIds: xsWithPt.map(x => x.id),
          geoPoints:   xsWithPt.map(x => {
            const p = x.points.find(p => p.id === pid)!;
            return { lat: p.lat, lon: p.lon, elevation: p.elevation };
          }),
          markerType:  markerDef?.type  ?? 'Unknown',
          markerColor: markerDef?.color ?? 'White',
        });
      }
    }
  }

  // ── RSGX ──────────────────────────────────────────────────────────────────
  // ID format: `rsgx:fi:r{roadId}s{segId}:obj:{objId}` — roadId scopes segId
  // so that two roads sharing a segId don't collide.
  for (let fi = 0; fi < rsgxFiles.length; fi++) {
    for (const seg of rsgxFiles[fi].segments) {
      const scope = `r${seg.roadId}s${seg.id}`;

      for (const obj of seg.objects) {
        if (obj.edgePoints.length < 2) continue;
        elements.push({
          id:        `rsgx:${fi}:${scope}:obj:${obj.id}:${elements.length}`,
          kind:      'road-object',
          label:     `${obj.type}`,
          fileIndex: fi,
          segmentId: seg.id,
          roadId:    seg.roadId,
          deleted:   false,
          hidden:    false,
          objectId:  obj.id,
          type:      obj.type,
          center:    { lat: obj.lat, lon: obj.lon, elevation: obj.elevation },
          edgePoints: obj.edgePoints.map(p => ({ lat: p.lat, lon: p.lon, elevation: p.elevation })),
          edgeClosed: obj.edgeClosed,
        });
      }

      for (const sign of seg.signs) {
        elements.push({
          id:        `rsgx:${fi}:${scope}:sign:${sign.id}:${elements.length}`,
          kind:      'sign',
          label:     `${sign.type}`,
          fileIndex: fi,
          segmentId: seg.id,
          roadId:    seg.roadId,
          deleted:   false,
          hidden:    false,
          signId:    sign.id,
          type:      sign.type,
          point:     { lat: sign.lat, lon: sign.lon, elevation: sign.elevation },
          azimuth:   sign.azimuth,
        });
      }
    }
  }

  // Cross-file dedup: the same physical road-object (same roadId+objectId) can
  // appear in multiple RSGX tile files when it sits at a tile boundary.
  // Keep only the copy with the most edge points.
  const bestByRoadObj = new Map<string, HdMapObjectElement>();
  for (const e of elements) {
    if (e.kind !== 'road-object') continue;
    const key = `${e.roadId}:${e.objectId}`;
    const prev = bestByRoadObj.get(key);
    if (!prev || e.edgePoints.length > prev.edgePoints.length) bestByRoadObj.set(key, e);
  }
  const keepIds = new Set(Array.from(bestByRoadObj.values(), e => e.id));
  return elements.filter(e => e.kind !== 'road-object' || keepIds.has(e.id));
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

/** GeoPoints for a given element (the "spine" used for picking/highlight). */
export function getElementGeoPoints(elem: HdMapElement): GeoPoint[] {
  switch (elem.kind) {
    case 'edge-left':
    case 'edge-right':
    case 'marker-line': return elem.geoPoints;
    case 'road-object':  return elem.edgePoints;
    case 'sign':         return [elem.point];
  }
}

/** True if the element's geometry forms a closed ring (for polygon rendering). */
export function isElementClosed(elem: HdMapElement): boolean {
  return elem.kind === 'road-object' && elem.edgeClosed;
}
