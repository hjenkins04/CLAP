import type { PolygonAnnotationPlugin } from './polygon-annotation-plugin';

let ref: PolygonAnnotationPlugin | null = null;

export function setPolyAnnotPluginRef(p: PolygonAnnotationPlugin | null) { ref = p; }
export function getPolyAnnotPlugin(): PolygonAnnotationPlugin | null { return ref; }
