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

export interface EdgeBridge {
  /** Successor segment id whose xSection-0 edge point we copied. */
  toSegmentId: number;
  /** File index of the LXSX file containing the successor segment. */
  toFileIndex: number;
}

export interface HdMapEdgeElement extends ElementBase {
  kind: 'edge-left' | 'edge-right';
  xSectionIds: number[];
  geoPoints: GeoPoint[];    // length === xSectionIds.length, OR length+1 when bridge present
  edgeType: string;
  /**
   * When set, geoPoints.length === xSectionIds.length + 1 and the last point
   * is a render-time bridge to the successor segment's xSection-0 edge point
   * (closing the inter-segment gap that GM DMP leaves at segment boundaries).
   * On save, the patcher persists this as a new <xSection> in the predecessor
   * segment; on next reload the endpoints will be coincident and no further
   * bridging happens.
   */
  bridge?: EdgeBridge;
}

export interface HdMapMarkerLineElement extends ElementBase {
  kind: 'marker-line';
  pointId: number;
  xSectionIds: number[];
  geoPoints: GeoPoint[];    // length === xSectionIds.length, OR length+1 when bridge present
  markerType: string;
  markerColor: string;
  /**
   * When set, geoPoints.length === xSectionIds.length + 1 and the last point
   * is a render-time bridge to the successor segment's marker line with the
   * same pointId (mirrors the edge bridge mechanism).
   */
  bridge?: EdgeBridge;
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

  // ── Boundary bridging (edges + markers) ──────────────────────────────────
  // GM DMP doesn't share vertices at segment boundaries — successor's xSection 0
  // sits one xSection-step *past* the predecessor's last xSection, leaving a
  // visible ~1 m gap between consecutive segment edges AND lane markers. We
  // close them by appending the successor's first vertex as a "bridge" point
  // on the predecessor. Idempotent: skipped when endpoints are already
  // coincident (e.g. after a previous save persisted the bridge).
  bridgeEdges(elements, lxsxFiles, rsgxFiles);
  bridgeMarkers(elements, rsgxFiles);

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

/**
 * Append a bridge vertex to each segment edge whose successor(s) start at a
 * point offset from the predecessor's last vertex.
 *
 * Multi-successor handling: when a segment forks (e.g. lane split), the fork
 * is allowed only when **every** successor agrees on the boundary point
 * (within COINCIDENT_DEG) — that's the case for "fork right after the
 * boundary" where both branches inherit the same start position. When
 * successors disagree on the boundary (true split-at-boundary), we skip:
 * picking one would pull the polyline in an arbitrary direction.
 */
function bridgeEdges(
  elements: HdMapElement[],
  lxsxFiles: LxsxFile[],
  rsgxFiles: RsgxFile[],
): void {
  // segId → { fi, leftFirst, rightFirst } from the LXSX layer
  const segFirsts = new Map<number, { fi: number; leftFirst: GeoPoint; rightFirst: GeoPoint }>();
  for (let fi = 0; fi < lxsxFiles.length; fi++) {
    for (const seg of lxsxFiles[fi].segments) {
      if (seg.xSections.length === 0) continue;
      const first = seg.xSections[0];
      segFirsts.set(seg.id, {
        fi,
        leftFirst:  { lat: first.leftEdge.lat,  lon: first.leftEdge.lon,  elevation: first.leftEdge.elevation },
        rightFirst: { lat: first.rightEdge.lat, lon: first.rightEdge.lon, elevation: first.rightEdge.elevation },
      });
    }
  }

  // segId → list of successor segIds (no self-loops)
  const succsBySeg = new Map<number, number[]>();
  for (const rf of rsgxFiles) {
    for (const seg of rf.segments) {
      const succs = seg.successors.filter(s => s !== seg.id);
      if (succs.length > 0) succsBySeg.set(seg.id, succs);
    }
  }

  // ~1.1 cm at this latitude — well below DMP precision, comfortably above FP noise
  const COINCIDENT_DEG = 1e-7;
  // Bridge sanity limit: ~5 m gap. If the nearest successor is further than
  // this, the segments aren't really continuous — skip rather than draw a
  // long misleading line.
  const MAX_BRIDGE_DEG2 = (5 / 111_000) ** 2; // 5 m at this latitude, squared
  const sameGeo = (a: GeoPoint, b: GeoPoint) =>
    Math.abs(a.lat - b.lat) < COINCIDENT_DEG &&
    Math.abs(a.lon - b.lon) < COINCIDENT_DEG;
  const dist2 = (a: GeoPoint, b: GeoPoint) =>
    (a.lat - b.lat) ** 2 + (a.lon - b.lon) ** 2;

  for (const el of elements) {
    if (el.kind !== 'edge-left' && el.kind !== 'edge-right') continue;
    const succIds = succsBySeg.get(el.segmentId);
    if (!succIds || succIds.length === 0) continue;

    // Collect each successor's first edge point on the matching side
    const succFirsts: { id: number; fi: number; geo: GeoPoint }[] = [];
    for (const sid of succIds) {
      const sf = segFirsts.get(sid);
      if (!sf) continue;
      succFirsts.push({
        id: sid,
        fi: sf.fi,
        geo: el.kind === 'edge-left' ? sf.leftFirst : sf.rightFirst,
      });
    }
    if (succFirsts.length === 0) continue;

    // Choose the bridge target:
    //   - Single successor / unanimous agreement: that point.
    //   - Disagreeing successors (true fork): the one nearest to pred's last
    //     vertex — typically the "main continuation"; other branches will
    //     diverge later and just remain visually disconnected for now.
    const lastGeo = el.geoPoints[el.geoPoints.length - 1];
    let target = succFirsts[0];
    let targetD2 = dist2(lastGeo, target.geo);
    for (let i = 1; i < succFirsts.length; i++) {
      const d2 = dist2(lastGeo, succFirsts[i].geo);
      if (d2 < targetD2) { target = succFirsts[i]; targetD2 = d2; }
    }
    if (targetD2 > MAX_BRIDGE_DEG2) continue; // gap too large — likely a real disconnect
    if (sameGeo(lastGeo, target.geo)) continue; // already coincident

    el.geoPoints.push({ ...target.geo });
    el.bridge = { toSegmentId: target.id, toFileIndex: target.fi };
  }
}

/**
 * Append a bridge vertex to each marker line, pairing it with the nearest
 * marker in any successor segment.
 *
 * Note: pointIds are NOT stable across segments — they renumber when the
 * lane count changes (e.g. predecessor numLanes=2 has pointIds 1..3,
 * successor numLanes=1 has pointIds 1..2). So we match by geographic
 * proximity instead, with a 5 m sanity cap.
 */
function bridgeMarkers(elements: HdMapElement[], rsgxFiles: RsgxFile[]): void {
  const succsBySeg = new Map<number, number[]>();
  for (const rf of rsgxFiles) {
    for (const seg of rf.segments) {
      const succs = seg.successors.filter(s => s !== seg.id);
      if (succs.length > 0) succsBySeg.set(seg.id, succs);
    }
  }

  // Index ALL markers by segmentId so we can scan every marker in each
  // successor regardless of its pointId.
  const markersBySeg = new Map<number, HdMapMarkerLineElement[]>();
  for (const e of elements) {
    if (e.kind !== 'marker-line') continue;
    const m = e as HdMapMarkerLineElement;
    let arr = markersBySeg.get(m.segmentId);
    if (!arr) { arr = []; markersBySeg.set(m.segmentId, arr); }
    arr.push(m);
  }

  const COINCIDENT_DEG = 1e-7;
  const MAX_BRIDGE_DEG2 = (5 / 111_000) ** 2;
  const sameGeo = (a: GeoPoint, b: GeoPoint) =>
    Math.abs(a.lat - b.lat) < COINCIDENT_DEG &&
    Math.abs(a.lon - b.lon) < COINCIDENT_DEG;
  const dist2 = (a: GeoPoint, b: GeoPoint) =>
    (a.lat - b.lat) ** 2 + (a.lon - b.lon) ** 2;

  for (const e of elements) {
    if (e.kind !== 'marker-line') continue;
    const pred = e as HdMapMarkerLineElement;
    const succIds = succsBySeg.get(pred.segmentId);
    if (!succIds || succIds.length === 0) continue;

    const lastGeo = pred.geoPoints[pred.geoPoints.length - 1];
    if (!lastGeo) continue;

    // Across all successors' markers (any pointId), find the nearest first vertex
    let bestSegId = -1;
    let bestFi = -1;
    let bestGeo: GeoPoint | null = null;
    let bestD2 = Infinity;
    for (const sid of succIds) {
      const succMarkers = markersBySeg.get(sid);
      if (!succMarkers) continue;
      for (const succ of succMarkers) {
        const first = succ.geoPoints[0];
        if (!first) continue;
        const d2 = dist2(lastGeo, first);
        if (d2 < bestD2) {
          bestD2 = d2;
          bestSegId = sid;
          bestFi = succ.fileIndex;
          bestGeo = first;
        }
      }
    }
    if (!bestGeo) continue;
    if (bestD2 > MAX_BRIDGE_DEG2) continue;
    if (sameGeo(lastGeo, bestGeo)) continue;

    pred.geoPoints.push({ ...bestGeo });
    pred.bridge = { toSegmentId: bestSegId, toFileIndex: bestFi };
  }
}

// ── Vertex linking (boundary continuity across segment seams) ─────────────────

/** Reference to a single editable vertex on a specific element. */
export interface VertexLinkRef {
  elementId: string;
  vertexIndex: number;
}

/**
 * Build the load-time vertex link map: for each (predecessor, successor) edge
 * pair where the predecessor's last vertex is coincident with the successor's
 * xSection-0 vertex, register a bidirectional link so an edit on one
 * propagates to the other. Stable across reloads — once a bridge is persisted
 * (or the source data already shares boundary positions), the coincidence
 * check passes and the link gets registered again.
 *
 * Key format: `${elementId}|${vertexIndex}`.
 * Value: list of OTHER linked vertices (excludes self).
 */
export function buildVertexLinks(
  elements: HdMapElement[],
  rsgxFiles: RsgxFile[],
): Map<string, VertexLinkRef[]> {
  const links = new Map<string, VertexLinkRef[]>();

  // Multi-successor lookup. Forks are linked to every successor whose
  // boundary point is coincident with the predecessor's last vertex; this
  // covers the common "fork after the boundary" case where multiple branches
  // share their starting point.
  const succsBySeg = new Map<number, number[]>();
  for (const rf of rsgxFiles) {
    for (const seg of rf.segments) {
      const succs = seg.successors.filter(s => s !== seg.id);
      if (succs.length > 0) succsBySeg.set(seg.id, succs);
    }
  }

  // Index edges by (segmentId, side) so we can look up the matching side
  // of each successor in O(1).
  const edgeIdx = new Map<string, HdMapEdgeElement>();
  for (const e of elements) {
    if (e.kind === 'edge-left' || e.kind === 'edge-right') {
      edgeIdx.set(`${e.segmentId}:${e.kind}`, e as HdMapEdgeElement);
    }
  }

  const COINCIDENT_DEG = 1e-7; // ~1.1 cm at this latitude
  const sameGeo = (a: GeoPoint, b: GeoPoint) =>
    Math.abs(a.lat - b.lat) < COINCIDENT_DEG &&
    Math.abs(a.lon - b.lon) < COINCIDENT_DEG;
  const addLink = (key: string, ref: VertexLinkRef) => {
    const existing = links.get(key);
    if (existing) existing.push(ref);
    else links.set(key, [ref]);
  };

  for (const e of elements) {
    if (e.kind !== 'edge-left' && e.kind !== 'edge-right') continue;
    const pred = e as HdMapEdgeElement;
    const succIds = succsBySeg.get(pred.segmentId);
    if (!succIds) continue;

    const predLast = pred.geoPoints[pred.geoPoints.length - 1];
    if (!predLast) continue;
    const predIdx = pred.geoPoints.length - 1;

    for (const sid of succIds) {
      const succ = edgeIdx.get(`${sid}:${pred.kind}`);
      if (!succ) continue;
      const succFirst = succ.geoPoints[0];
      if (!succFirst) continue;
      if (!sameGeo(predLast, succFirst)) continue;

      addLink(`${pred.id}|${predIdx}`, { elementId: succ.id, vertexIndex: 0 });
      addLink(`${succ.id}|0`,           { elementId: pred.id, vertexIndex: predIdx });
    }
  }

  // Marker lines: pointIds aren't stable across segments (they renumber when
  // lane count changes), so iterate every marker in each successor and pair
  // by geographic coincidence rather than pointId match.
  const markersBySeg = new Map<number, HdMapMarkerLineElement[]>();
  for (const e of elements) {
    if (e.kind !== 'marker-line') continue;
    const m = e as HdMapMarkerLineElement;
    let arr = markersBySeg.get(m.segmentId);
    if (!arr) { arr = []; markersBySeg.set(m.segmentId, arr); }
    arr.push(m);
  }

  for (const e of elements) {
    if (e.kind !== 'marker-line') continue;
    const pred = e as HdMapMarkerLineElement;
    const succIds = succsBySeg.get(pred.segmentId);
    if (!succIds) continue;

    const predLast = pred.geoPoints[pred.geoPoints.length - 1];
    if (!predLast) continue;
    const predIdx = pred.geoPoints.length - 1;

    for (const sid of succIds) {
      const succMarkers = markersBySeg.get(sid);
      if (!succMarkers) continue;
      for (const succ of succMarkers) {
        const succFirst = succ.geoPoints[0];
        if (!succFirst) continue;
        if (!sameGeo(predLast, succFirst)) continue;

        addLink(`${pred.id}|${predIdx}`, { elementId: succ.id, vertexIndex: 0 });
        addLink(`${succ.id}|0`,           { elementId: pred.id, vertexIndex: predIdx });
      }
    }
  }

  return links;
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
