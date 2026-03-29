import type { ParsedWay, CustomMapCategory } from './custom-map-store';

interface NodeEntry {
  lat: number;
  lng: number;
}

/**
 * Parse a Lanelet2 OSM XML string into a flat list of ways with coordinates.
 * Handles standard WGS84 lat/lon nodes (no local_x/local_y).
 * Ways with action="delete" are skipped.
 */
export function parseLanelet2Osm(xmlText: string): ParsedWay[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error(`OSM XML parse error: ${parseError.textContent?.slice(0, 200)}`);
  }

  // Build node lookup: id → {lat, lng}
  const nodes = new Map<string, NodeEntry>();
  for (const node of doc.querySelectorAll('node')) {
    if (node.getAttribute('action') === 'delete') continue;
    const id = node.getAttribute('id');
    const lat = parseFloat(node.getAttribute('lat') ?? '');
    const lng = parseFloat(node.getAttribute('lon') ?? '');
    if (id && !isNaN(lat) && !isNaN(lng)) {
      nodes.set(id, { lat, lng });
    }
  }

  // Parse ways
  const ways: ParsedWay[] = [];

  for (const wayEl of doc.querySelectorAll('way')) {
    if (wayEl.getAttribute('action') === 'delete') continue;

    const id = wayEl.getAttribute('id') ?? '';

    // Get tags
    let type = '';
    let subtype = '';
    for (const tag of wayEl.querySelectorAll('tag')) {
      const k = tag.getAttribute('k');
      const v = tag.getAttribute('v') ?? '';
      if (k === 'type') type = v;
      else if (k === 'subtype') subtype = v;
    }

    // Collect node coordinates in order
    const coords: Array<{ lat: number; lng: number }> = [];
    for (const nd of wayEl.querySelectorAll('nd')) {
      const ref = nd.getAttribute('ref');
      if (ref) {
        const node = nodes.get(ref);
        if (node) coords.push(node);
      }
    }

    if (coords.length >= 2) {
      ways.push({ id, type, subtype, coords });
    }
  }

  return ways;
}

/**
 * Map a Lanelet2 way type to a display category.
 */
export function categorizeWay(type: string): CustomMapCategory {
  switch (type) {
    case 'line_thin':
    case 'line_thick':
      return 'lane_boundaries';
    case 'stop_line':
      return 'stop_lines';
    case 'virtual':
      return 'virtual';
    case 'area':
      return 'areas';
    default:
      return 'other';
  }
}
