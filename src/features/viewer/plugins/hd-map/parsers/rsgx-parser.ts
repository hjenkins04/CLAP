/**
 * RSGX Parser — GM HD Map Road Segment Geometry Schema (v3.1)
 *
 * Each RSGX file contains <region> → <road> → <segment> elements.
 * Each segment can contain:
 *   objects — road surface markings (stop bars, crosswalks, arrows, etc.)
 *             each object has an optional closed <edge> polygon
 *   signs   — traffic signs/lights with a single position
 */

export interface RsgxGeoPoint {
  lat: number;
  lon: number;
  elevation: number;
}

export interface RsgxObject {
  id: number;
  type: string;   // "Stop Bar" | "Pedestrian Crossing" | "RR Crossing Marking" | …
  lat: number;
  lon: number;
  elevation: number;
  edgeClosed: boolean;
  edgePoints: RsgxGeoPoint[];
}

export interface RsgxSign {
  id: number;
  type: string;   // "Stop Sign" | "Vertical Stack Red Yellow Green…" | …
  lat: number;
  lon: number;
  elevation: number;
  azimuth: number;
}

export interface RsgxSegment {
  id: number;
  roadId: number;
  roadName: string;
  objects: RsgxObject[];
  signs: RsgxSign[];
}

export interface RsgxFile {
  regionId: number;
  regionName: string;
  segments: RsgxSegment[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function attr(el: Element, name: string): string {
  return el.getAttribute(name) ?? '';
}

function numAttr(el: Element, name: string): number {
  return parseFloat(el.getAttribute(name) ?? '0');
}

function geoKey(lat: number, lon: number, elevation: number): string {
  return `${lat.toFixed(9)},${lon.toFixed(9)},${elevation.toFixed(4)}`;
}

function parseObject(el: Element): RsgxObject {
  const edgeEl = el.querySelector(':scope > edge');
  const rawPoints: RsgxGeoPoint[] = [];
  let edgeClosed = false;

  if (edgeEl) {
    edgeClosed = attr(edgeEl, 'closed') === 'true';
    for (const ptEl of edgeEl.querySelectorAll(':scope > point')) {
      rawPoints.push({
        lat:       numAttr(ptEl, 'lat'),
        lon:       numAttr(ptEl, 'long'),
        elevation: numAttr(ptEl, 'elevation'),
      });
    }
  }

  // Strip consecutive duplicate points that create degenerate geometry
  const edgePoints: RsgxGeoPoint[] = [];
  for (const pt of rawPoints) {
    const prev = edgePoints[edgePoints.length - 1];
    if (!prev || geoKey(pt.lat, pt.lon, pt.elevation) !== geoKey(prev.lat, prev.lon, prev.elevation)) {
      edgePoints.push(pt);
    }
  }

  return {
    id:         parseInt(attr(el, 'id'), 10),
    type:       attr(el, 'type'),
    lat:        numAttr(el, 'lat'),
    lon:        numAttr(el, 'long'),
    elevation:  numAttr(el, 'elevation'),
    edgeClosed,
    edgePoints,
  };
}

function parseSign(el: Element): RsgxSign {
  return {
    id:        parseInt(attr(el, 'id'), 10),
    type:      attr(el, 'type'),
    lat:       numAttr(el, 'lat'),
    lon:       numAttr(el, 'long'),
    elevation: numAttr(el, 'elevation'),
    azimuth:   numAttr(el, 'azimuth'),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Parse the XML text content of a single .rsgx file. */
export function parseRsgx(xmlText: string): RsgxFile {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');

  const regionEl = doc.querySelector('region');
  const regionId   = parseInt(attr(regionEl ?? doc.documentElement, 'id'), 10);
  const regionName = attr(regionEl ?? doc.documentElement, 'name');

  const segments: RsgxSegment[] = [];

  // Objects and signs can appear in multiple road segments (e.g. at intersections).
  // Track IDs globally within the file to emit each physical marking only once,
  // preferring the copy with the most edge points (the most complete geometry).
  const seenObjects = new Map<number, { segIdx: number; objIdx: number; pts: number }>();
  const seenSigns   = new Set<number>();

  for (const roadEl of doc.querySelectorAll('region > road')) {
    const roadId   = parseInt(attr(roadEl, 'id'), 10);
    const roadName = attr(roadEl, 'name');

    for (const segEl of roadEl.querySelectorAll(':scope > segment')) {
      const objects: RsgxObject[] = [];
      const signs:   RsgxSign[]   = [];

      for (const objEl of segEl.querySelectorAll(':scope > objects > object')) {
        const obj = parseObject(objEl);
        const prev = seenObjects.get(obj.id);
        if (!prev) {
          seenObjects.set(obj.id, { segIdx: segments.length, objIdx: objects.length, pts: obj.edgePoints.length });
          objects.push(obj);
        } else if (obj.edgePoints.length > prev.pts) {
          // This copy has better geometry — replace the earlier one
          segments[prev.segIdx].objects[prev.objIdx] = obj;
          seenObjects.set(obj.id, { ...prev, pts: obj.edgePoints.length });
        }
        // else: skip — earlier copy is at least as good
      }

      for (const signEl of segEl.querySelectorAll(':scope > signs > sign')) {
        const sign = parseSign(signEl);
        if (!seenSigns.has(sign.id)) {
          seenSigns.add(sign.id);
          signs.push(sign);
        }
      }

      segments.push({
        id: parseInt(attr(segEl, 'id'), 10),
        roadId,
        roadName,
        objects,
        signs,
      });
    }
  }

  return { regionId, regionName, segments };
}
