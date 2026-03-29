import type { Annotation3D, AnnotationLayer3D, NormalFace } from './static-obstacle-types';
import { faceDirection } from './static-obstacle-visuals';

/** Normalised world-space direction vector for a face */
function faceVector(face: NormalFace): { x: number; y: number; z: number } {
  const v = faceDirection(face);
  return { x: +v.x.toFixed(4), y: +v.y.toFixed(4), z: +v.z.toFixed(4) };
}

function classificationProps(ann: Annotation3D): Record<string, unknown> {
  const cls = ann.classification;
  const base: Record<string, unknown> = { kind: cls.kind, subtype: cls.subtype };
  if (cls.kind === 'Sign' && cls.subtype === 'SpeedLimit') {
    base.speed = cls.speed ?? 0;
    base.speedUnit = cls.unit ?? 'kph';
  }
  return base;
}

/**
 * Export all annotations as a GeoJSON FeatureCollection.
 * When `hasWorldFrame` is false, coordinates are raw PCO local (in metres).
 */
export function annotationsToGeoJson(
  annotations: Annotation3D[],
  layers: AnnotationLayer3D[],
): string {
  const layerMap = new Map(layers.map((l) => [l.id, l]));

  const features = annotations.map((ann) => {
    const layer = layerMap.get(ann.layerId);
    const hasGeo = !!ann.geoCenter;

    // Coordinates: [lng, lat, elevation] (GeoJSON standard) or [x, z, y] local
    const coords = hasGeo
      ? [ann.geoCenter!.lng, ann.geoCenter!.lat, ann.geoCenter!.elevation]
      : [ann.center.x, ann.center.z, ann.center.y];

    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: coords,
      },
      properties: {
        id: ann.id,
        label: ann.label,
        layer: layer?.name ?? 'unknown',
        layerId: ann.layerId,
        ...classificationProps(ann),
        frontFace: ann.frontFace,
        frontVector: faceVector(ann.frontFace),
        center_local: ann.center,
        halfExtents: ann.halfExtents,
        attributes: ann.attributes,
        coordinateSystem: hasGeo ? 'WGS84' : 'local-metres',
      },
    };
  });

  const collection = {
    type: 'FeatureCollection',
    metadata: {
      exportedAt: new Date().toISOString(),
      annotationCount: annotations.length,
      layerCount: layers.length,
    },
    features,
  };

  return JSON.stringify(collection, null, 2);
}

/** Trigger a browser download of the GeoJSON string. */
export function downloadGeoJson(json: string, filename = 'annotations.geojson'): void {
  const blob = new Blob([json], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
