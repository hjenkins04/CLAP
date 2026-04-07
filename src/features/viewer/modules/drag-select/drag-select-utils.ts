import { Matrix4 } from 'three';
import type { Camera } from 'three';
import type { DragSelectMode, SelectionFrustum } from './drag-select-types';

/**
 * Build a SelectionFrustum from a screen-space drag rectangle.
 * Handles coordinate system conversion: screen Y (top=0) → NDC Y (top=+1).
 */
export function buildFrustum(
  domElement: HTMLElement,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  camera: Camera,
): SelectionFrustum {
  const rect = domElement.getBoundingClientRect();

  // Normalise to [0,1] within the canvas
  const x0 = (Math.min(startX, endX) - rect.left) / rect.width;
  const x1 = (Math.max(startX, endX) - rect.left) / rect.width;
  const y0 = (Math.min(startY, endY) - rect.top) / rect.height; // screen top
  const y1 = (Math.max(startY, endY) - rect.top) / rect.height; // screen bottom

  camera.updateMatrixWorld(true);
  const vpMatrix = new Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );

  return {
    ndcMinX: x0 * 2 - 1,
    ndcMaxX: x1 * 2 - 1,
    ndcMinY: 1 - y1 * 2, // screen bottom → NDC min Y
    ndcMaxY: 1 - y0 * 2, // screen top    → NDC max Y
    vpMatrix,
  };
}

/**
 * Test whether a world-space point projects inside a SelectionFrustum.
 * Uses the same inline matrix math as reclassify-plugin for maximum performance.
 */
export function isWorldPointInFrustum(
  wx: number,
  wy: number,
  wz: number,
  frustum: SelectionFrustum,
): boolean {
  const m = frustum.vpMatrix.elements; // column-major
  const cw = m[3] * wx + m[7] * wy + m[11] * wz + m[15];
  if (cw <= 0) return false; // behind camera
  const ndcX = (m[0] * wx + m[4] * wy + m[8] * wz + m[12]) / cw;
  const ndcY = (m[1] * wx + m[5] * wy + m[9] * wz + m[13]) / cw;
  return (
    ndcX >= frustum.ndcMinX && ndcX <= frustum.ndcMaxX &&
    ndcY >= frustum.ndcMinY && ndcY <= frustum.ndcMaxY
  );
}

/**
 * Map modifier keys on a pointer/mouse event to a DragSelectMode.
 * Alt → subtract, Ctrl/Meta → add, none → replace.
 */
export function getDragSelectMode(
  e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean },
): DragSelectMode {
  if (e.altKey) return 'subtract';
  if (e.ctrlKey || e.metaKey) return 'add';
  return 'replace';
}
