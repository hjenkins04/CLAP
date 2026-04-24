/**
 * LXSX Parser — GM HD Map Lane Cross-Section Schema (v3.1)
 *
 * Each LXSX file contains <segments> → <segment> → <xSection> elements.
 * Each xSection represents a lane cross-section slice at one position along
 * a road segment, containing:
 *   leftEdge  — left road/lane boundary point
 *   point(s)  — interior lane geometry points (id 1..N)
 *   lane(s)   — lane attributes referencing a point by pointId
 *   marker(s) — lane marking lines referencing a point by pointId
 *   rightEdge — right road/lane boundary point
 *
 * The renderer connects corresponding elements across consecutive xSections
 * to produce polylines for each edge/interior-line.
 */

export interface GeoPoint {
  lat: number;
  lon: number;
  elevation: number;
}

export interface LxsxEdge extends GeoPoint {
  type: string;   // "Inferred" | "Curb" | "Paved to Non-Paved" | "Other Marked" | "Driveway Threshold"
  width: number;
}

export interface LxsxPoint extends GeoPoint {
  id: number;
  curvature: number;
  heading: number;
}

export interface LxsxLane {
  id: number;
  pointId: number;
  laneClass: string;
  width: number;
  speedLimit: number;
}

export interface LxsxMarker {
  id: number;
  pointId: number;
  type: string;   // "Thin Solid Single Line…" | "Virtual Inferred Line" | …
  color: string;  // "White" | "Yellow" | "Unknown"
  width: number;
}

export interface LxsxXSection {
  id: number;
  leftEdge: LxsxEdge;
  rightEdge: LxsxEdge;
  points: LxsxPoint[];      // id 1..N, ordered
  lanes: LxsxLane[];
  markers: LxsxMarker[];
}

export interface LxsxSegment {
  id: number;
  xSections: LxsxXSection[]; // ordered by xSection.id ascending
}

export interface LxsxFile {
  segments: LxsxSegment[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function attr(el: Element, name: string): string {
  return el.getAttribute(name) ?? '';
}

function numAttr(el: Element, name: string): number {
  return parseFloat(el.getAttribute(name) ?? '0');
}

function parseEdge(el: Element): LxsxEdge {
  return {
    lat:       numAttr(el, 'lat'),
    lon:       numAttr(el, 'long'),
    elevation: numAttr(el, 'elevation'),
    type:      attr(el, 'type'),
    width:     numAttr(el, 'width'),
  };
}

function parsePoint(el: Element): LxsxPoint {
  return {
    id:        parseInt(attr(el, 'id'), 10),
    lat:       numAttr(el, 'lat'),
    lon:       numAttr(el, 'long'),
    elevation: numAttr(el, 'elevation'),
    curvature: numAttr(el, 'curvature'),
    heading:   numAttr(el, 'heading'),
  };
}

function parseMarker(el: Element): LxsxMarker {
  return {
    id:      parseInt(attr(el, 'id'), 10),
    pointId: parseInt(attr(el, 'pointId'), 10),
    type:    attr(el, 'type'),
    color:   attr(el, 'color'),
    width:   numAttr(el, 'width'),
  };
}

function parseLane(el: Element): LxsxLane {
  return {
    id:         parseInt(attr(el, 'id'), 10),
    pointId:    parseInt(attr(el, 'pointId'), 10),
    laneClass:  attr(el, 'class'),
    width:      numAttr(el, 'width'),
    speedLimit: numAttr(el, 'speedLimit'),
  };
}

function parseXSection(el: Element): LxsxXSection {
  const leftEdgeEl  = el.querySelector(':scope > leftEdge');
  const rightEdgeEl = el.querySelector(':scope > rightEdge');

  const points:  LxsxPoint[]  = [];
  const lanes:   LxsxLane[]   = [];
  const markers: LxsxMarker[] = [];

  for (const child of el.children) {
    switch (child.tagName) {
      case 'point':  points.push(parsePoint(child));   break;
      case 'lane':   lanes.push(parseLane(child));     break;
      case 'marker': markers.push(parseMarker(child)); break;
    }
  }

  // Sort points by id so connectivity is deterministic
  points.sort((a, b) => a.id - b.id);

  return {
    id:        parseInt(attr(el, 'id'), 10),
    leftEdge:  leftEdgeEl  ? parseEdge(leftEdgeEl)  : { lat: 0, lon: 0, elevation: 0, type: 'Inferred', width: 0 },
    rightEdge: rightEdgeEl ? parseEdge(rightEdgeEl) : { lat: 0, lon: 0, elevation: 0, type: 'Inferred', width: 0 },
    points,
    lanes,
    markers,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Parse the XML text content of a single .lxsx file. */
export function parseLxsx(xmlText: string): LxsxFile {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');

  const segments: LxsxSegment[] = [];

  for (const segEl of doc.querySelectorAll('segments > segment')) {
    const xSections: LxsxXSection[] = [];

    for (const xsEl of segEl.querySelectorAll(':scope > xSection')) {
      xSections.push(parseXSection(xsEl));
    }

    // Ensure xSections are in ascending id order (they should be, but guarantee it)
    xSections.sort((a, b) => a.id - b.id);

    segments.push({
      id: parseInt(attr(segEl, 'id'), 10),
      xSections,
    });
  }

  return { segments };
}
