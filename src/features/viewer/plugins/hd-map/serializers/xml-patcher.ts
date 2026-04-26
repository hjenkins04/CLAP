/**
 * XML Patcher — applies HD map edits to raw DMP XML without touching
 * any attributes we didn't parse.  Uses DOMParser + XMLSerializer so
 * the full XML structure (including unparsed lanes, flags, etc.) is
 * preserved.
 *
 * Supported operations:
 *   LXSX — update leftEdge / rightEdge lat/long/elevation per xSection
 *          update interior point lat/long/elevation per xSection+pointId
 *          delete an entire segment
 *   RSGX — update object edge-point lat/long/elevation
 *          update sign lat/long/elevation/azimuth
 *          delete an object or sign
 */

import type { GeoPoint } from '../hd-map-edit-model';

// ── Internal helpers ──────────────────────────────────────────────────────────

function parseXml(xmlText: string): Document {
  return new DOMParser().parseFromString(xmlText, 'application/xml');
}

function serializeXml(doc: Document): string {
  return new XMLSerializer().serializeToString(doc);
}

function setGeo(el: Element, pt: GeoPoint): void {
  el.setAttribute('lat',       pt.lat.toFixed(9));
  el.setAttribute('long',      pt.lon.toFixed(9));
  el.setAttribute('elevation', pt.elevation.toFixed(4));
}

// ── LXSX patching ─────────────────────────────────────────────────────────────

export interface LxsxEdgeUpdate {
  segmentId: number;
  side: 'left' | 'right';
  xSectionIds: number[];
  geoPoints: GeoPoint[];   // one per xSectionId
}

export interface LxsxMarkerUpdate {
  segmentId: number;
  pointId: number;
  xSectionIds: number[];
  geoPoints: GeoPoint[];   // one per xSectionId
}

export interface LxsxSegmentDelete {
  segmentId: number;
}

/**
 * Append a new <xSection> to a segment to persist render-time boundary
 * bridges (edge gaps and/or marker-line gaps at segment boundaries).
 *
 * Implementation strategy: deep-clone the segment's last existing <xSection>
 * (which already has the correct <leftEdge>/<point>/<lane>/<marker>/<rightEdge>
 * structure), then apply targeted geo updates. This means a single insert
 * naturally covers edges + any number of bridged marker pointIds, and any
 * structural fields we don't care about (lane/marker metadata, point
 * curvature/heading, etc.) are inherited from the source segment unchanged.
 *
 * Geo fields not provided are left at the cloned position (which is the
 * predecessor's last-xSection position — close to the bridge target, but
 * a small offset for non-bridged interior points). That's a known minor
 * geometric inaccuracy on un-bridged points, accepted in exchange for
 * structural completeness.
 */
export interface LxsxXSectionInsert {
  segmentId:     number;
  newXSectionId: number;     // computed by caller (max existing + 1)
  leftEdge?:     GeoPoint;   // overrides cloned <leftEdge> position when set
  rightEdge?:    GeoPoint;   // overrides cloned <rightEdge> position when set
  /** Per-pointId geo overrides for cloned <point id="N"> children. */
  pointUpdates?: Array<{ id: number; geo: GeoPoint }>;
}

export interface LxsxPatchSet {
  edgeUpdates:      LxsxEdgeUpdate[];
  markerUpdates:    LxsxMarkerUpdate[];
  segmentDeletes:   LxsxSegmentDelete[];
  xSectionInserts?: LxsxXSectionInsert[];
}

export function patchLxsx(xmlText: string, patches: LxsxPatchSet): string {
  const doc = parseXml(xmlText);

  // Deletes first (avoid selecting just-removed nodes)
  for (const del of patches.segmentDeletes) {
    const segEl = doc.querySelector(`segment[id="${del.segmentId}"]`);
    segEl?.parentElement?.removeChild(segEl);
  }

  for (const upd of patches.edgeUpdates) {
    const segEl = doc.querySelector(`segment[id="${upd.segmentId}"]`);
    if (!segEl) continue;
    const tag = upd.side === 'left' ? 'leftEdge' : 'rightEdge';
    for (let i = 0; i < upd.xSectionIds.length; i++) {
      const xsEl = segEl.querySelector(`xSection[id="${upd.xSectionIds[i]}"]`);
      if (!xsEl) continue;
      const edgeEl = xsEl.querySelector(`:scope > ${tag}`);
      if (!edgeEl) continue;
      setGeo(edgeEl, upd.geoPoints[i]);
    }
  }

  for (const upd of patches.markerUpdates) {
    const segEl = doc.querySelector(`segment[id="${upd.segmentId}"]`);
    if (!segEl) continue;
    for (let i = 0; i < upd.xSectionIds.length; i++) {
      const xsEl = segEl.querySelector(`xSection[id="${upd.xSectionIds[i]}"]`);
      if (!xsEl) continue;
      const ptEl = xsEl.querySelector(`:scope > point[id="${upd.pointId}"]`);
      if (!ptEl) continue;
      setGeo(ptEl, upd.geoPoints[i]);
    }
  }

  for (const ins of patches.xSectionInserts ?? []) {
    const segEl = doc.querySelector(`segment[id="${ins.segmentId}"]`);
    if (!segEl) continue;
    const xsEls = Array.from(segEl.querySelectorAll(':scope > xSection'));
    const tpl = xsEls[xsEls.length - 1];
    if (!tpl) continue;   // no template to clone; skip rather than emit empty xSection

    const newXs = tpl.cloneNode(true) as Element;
    newXs.setAttribute('id', String(ins.newXSectionId));

    if (ins.leftEdge) {
      const left = newXs.querySelector(':scope > leftEdge');
      if (left) setGeo(left, ins.leftEdge);
    }
    if (ins.rightEdge) {
      const right = newXs.querySelector(':scope > rightEdge');
      if (right) setGeo(right, ins.rightEdge);
    }
    for (const pu of ins.pointUpdates ?? []) {
      const ptEl = newXs.querySelector(`:scope > point[id="${pu.id}"]`);
      if (ptEl) setGeo(ptEl, pu.geo);
    }

    segEl.appendChild(newXs);
  }

  return serializeXml(doc);
}

// ── RSGX patching ─────────────────────────────────────────────────────────────

export interface RsgxObjectUpdate {
  roadId: number;
  segmentId: number;
  objectId: number;
  edgePoints: GeoPoint[];
}

export interface RsgxSignUpdate {
  roadId: number;
  segmentId: number;
  signId: number;
  point: GeoPoint;
  azimuth: number;
}

export interface RsgxObjectDelete {
  roadId: number;
  segmentId: number;
  objectId: number;
}

export interface RsgxSignDelete {
  roadId: number;
  segmentId: number;
  signId: number;
}

export interface RsgxPatchSet {
  objectUpdates: RsgxObjectUpdate[];
  signUpdates:   RsgxSignUpdate[];
  objectDeletes: RsgxObjectDelete[];
  signDeletes:   RsgxSignDelete[];
}

function rsgxSeg(doc: Document, roadId: number, segmentId: number): Element | null {
  return doc.querySelector(`road[id="${roadId}"] > segment[id="${segmentId}"]`);
}

export function patchRsgx(xmlText: string, patches: RsgxPatchSet): string {
  const doc = parseXml(xmlText);

  for (const del of patches.objectDeletes) {
    const segEl = rsgxSeg(doc, del.roadId, del.segmentId);
    if (!segEl) continue;
    const objEl = segEl.querySelector(`objects > object[id="${del.objectId}"]`);
    objEl?.parentElement?.removeChild(objEl);
  }

  for (const del of patches.signDeletes) {
    const segEl = rsgxSeg(doc, del.roadId, del.segmentId);
    if (!segEl) continue;
    const signEl = segEl.querySelector(`signs > sign[id="${del.signId}"]`);
    signEl?.parentElement?.removeChild(signEl);
  }

  for (const upd of patches.objectUpdates) {
    const segEl = rsgxSeg(doc, upd.roadId, upd.segmentId);
    if (!segEl) continue;
    const objEl = segEl.querySelector(`objects > object[id="${upd.objectId}"]`);
    if (!objEl) continue;
    const edgeEl = objEl.querySelector(':scope > edge');
    if (!edgeEl) continue;
    const ptEls = Array.from(edgeEl.querySelectorAll(':scope > point'));
    for (let i = 0; i < Math.min(ptEls.length, upd.edgePoints.length); i++) {
      setGeo(ptEls[i], upd.edgePoints[i]);
    }
  }

  for (const upd of patches.signUpdates) {
    const segEl = rsgxSeg(doc, upd.roadId, upd.segmentId);
    if (!segEl) continue;
    const signEl = segEl.querySelector(`signs > sign[id="${upd.signId}"]`);
    if (!signEl) continue;
    setGeo(signEl, upd.point);
    signEl.setAttribute('azimuth', upd.azimuth.toFixed(4));
  }

  return serializeXml(doc);
}
