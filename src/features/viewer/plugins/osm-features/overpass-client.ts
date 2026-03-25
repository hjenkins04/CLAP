import osmtogeojson from 'osmtogeojson';
import type { OsmLayerKey } from './osm-features-store';

const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export interface OverpassBBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

const cache = new Map<string, GeoJSON.FeatureCollection>();

/** Per-layer Overpass QL — ways only, kept minimal */
const LAYER_QUERIES: Record<OsmLayerKey, string> = {
  buildings: 'way["building"]',
  roads: 'way["highway"~"primary|secondary|tertiary|residential|service|unclassified|trunk|motorway"]',
  water: 'way["waterway"];way["natural"="water"]',
  railways: 'way["railway"~"rail|light_rail|subway|tram"]',
  vegetation: 'way["landuse"~"forest|meadow"];way["leisure"="park"];way["natural"="wood"]',
};

function buildQuery(bbox: OverpassBBox, layerKey: OsmLayerKey): string {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const statements = LAYER_QUERIES[layerKey]
    .split(';')
    .map((q) => `  ${q}(${b});`)
    .join('\n');

  return `[out:json][timeout:25][maxsize:10485760];\n(\n${statements}\n);\nout body geom;`;
}

function layerCacheKey(bbox: OverpassBBox, key: OsmLayerKey): string {
  const b = `${bbox.south.toFixed(4)},${bbox.west.toFixed(4)},${bbox.north.toFixed(4)},${bbox.east.toFixed(4)}`;
  return `${b}|${key}`;
}

async function fetchWithFallback(query: string): Promise<unknown> {
  for (const server of OVERPASS_SERVERS) {
    try {
      const resp = await fetch(server, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (resp.ok) return await resp.json();
      console.warn(`[CLAP] Overpass ${server} returned ${resp.status}, trying next...`);
    } catch (err) {
      console.warn(`[CLAP] Overpass ${server} failed:`, err);
    }
  }
  throw new Error('All Overpass servers failed');
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch OSM features one layer at a time, merging results.
 * Fetching per-layer avoids timeouts from large combined queries.
 * Adds a 2s delay between requests to avoid 429 rate limits.
 */
export async function fetchOsmFeatures(
  bbox: OverpassBBox,
  layerKeys: OsmLayerKey[],
  onLayerLoaded?: (key: OsmLayerKey) => void,
): Promise<GeoJSON.FeatureCollection> {
  const allFeatures: GeoJSON.Feature[] = [];
  let needsDelay = false;

  for (const key of layerKeys) {
    const cacheK = layerCacheKey(bbox, key);
    const cached = cache.get(cacheK);
    if (cached) {
      allFeatures.push(...cached.features);
      onLayerLoaded?.(key);
      continue;
    }

    // Rate-limit: wait between non-cached requests
    if (needsDelay) await delay(2000);
    needsDelay = true;

    try {
      const query = buildQuery(bbox, key);
      const osmData = await fetchWithFallback(query);
      const geojson = osmtogeojson(osmData) as GeoJSON.FeatureCollection;
      cache.set(cacheK, geojson);
      allFeatures.push(...geojson.features);
      console.info(`[CLAP] OSM ${key}: ${geojson.features.length} features`);
      onLayerLoaded?.(key);
    } catch (err) {
      console.warn(`[CLAP] OSM ${key} fetch failed:`, err);
    }
  }

  return { type: 'FeatureCollection', features: allFeatures };
}
