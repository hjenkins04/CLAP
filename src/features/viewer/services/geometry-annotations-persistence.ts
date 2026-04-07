/**
 * Binary persistence for geometry annotations (polygon annotations + static obstacles).
 *
 * Format: small fixed header followed by a UTF-8 JSON payload.
 *
 * Header (12 bytes):
 *   Magic   : 4 bytes  — 'CLGA' (0x43 0x4C 0x47 0x41)
 *   Version : 2 bytes  — uint16LE  (currently 1)
 *   Flags   : 2 bytes  — uint16LE  (reserved, must be 0)
 *   Length  : 4 bytes  — uint32LE  — byte length of the JSON payload
 *
 * Payload: UTF-8 encoded JSON matching GeometryAnnotationsFile.
 */

import type { PolygonAnnotation, PolygonLayer } from '../plugins/polygon-annotation/polygon-annotation-types';
import type { Annotation3D, AnnotationLayer3D } from '../plugins/static-obstacle/static-obstacle-types';

// ── File schema ────────────────────────────────────────────────────────────────

export interface GeometryAnnotationsFile {
  version: 1;
  polygons: {
    layers: PolygonLayer[];
    annotations: PolygonAnnotation[];
    labelCounters: Record<string, number>;
  };
  obstacles: {
    layers: AnnotationLayer3D[];
    annotations: Annotation3D[];
    labelCounters: Record<string, number>;
  };
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MAGIC = 0x41474c43; // 'CLGA' as uint32LE
const VERSION = 1;
const HEADER_SIZE = 12;

// ── Serialization ──────────────────────────────────────────────────────────────

export function serializeGeometryAnnotations(data: GeometryAnnotationsFile): ArrayBuffer {
  const json = JSON.stringify(data);
  const payload = new TextEncoder().encode(json);

  const buffer = new ArrayBuffer(HEADER_SIZE + payload.byteLength);
  const view = new DataView(buffer);

  view.setUint32(0, MAGIC, true);
  view.setUint16(4, VERSION, true);
  view.setUint16(6, 0, true); // flags
  view.setUint32(8, payload.byteLength, true);

  new Uint8Array(buffer, HEADER_SIZE).set(payload);
  return buffer;
}

// ── Deserialization ────────────────────────────────────────────────────────────

export function deserializeGeometryAnnotations(buffer: ArrayBuffer): GeometryAnnotationsFile | null {
  if (buffer.byteLength < HEADER_SIZE) return null;

  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) return null;

  const version = view.getUint16(4, true);
  if (version > VERSION) {
    console.warn(`[CLAP] geometry-annotations.bin: unsupported version ${version}`);
    return null;
  }

  const length = view.getUint32(8, true);
  if (HEADER_SIZE + length > buffer.byteLength) return null;

  const payload = new Uint8Array(buffer, HEADER_SIZE, length);
  const json = new TextDecoder().decode(payload);

  try {
    return JSON.parse(json) as GeometryAnnotationsFile;
  } catch {
    console.error('[CLAP] geometry-annotations.bin: failed to parse JSON payload');
    return null;
  }
}
