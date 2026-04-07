import type { Camera, Matrix4 } from 'three';

/** How a drag-select interacts with the existing selection. */
export type DragSelectMode = 'replace' | 'add' | 'subtract';

/**
 * A view-projection frustum slice captured at drag-end time.
 * NDC bounds are in Three.js NDC space: X∈[-1,1] left→right, Y∈[-1,1] bottom→top.
 */
export interface SelectionFrustum {
  ndcMinX: number;
  ndcMaxX: number;
  ndcMinY: number;
  ndcMaxY: number;
  /** Camera VP matrix captured at the moment the selection rect was released. */
  vpMatrix: Matrix4;
}

export interface DragSelectOptions {
  domElement: HTMLElement;
  getCamera: () => Camera;
  /**
   * Called when the user finishes a drag large enough to constitute a selection rect.
   * The frustum describes the screen-space rect in NDC + VP matrix space.
   */
  onSelect: (frustum: SelectionFrustum, mode: DragSelectMode) => void;
  /**
   * Called when the user releases without dragging (click rather than drag).
   * Useful for clearing a selection on empty-click.
   */
  onClickEmpty?: () => void;
  /** Minimum movement in pixels before a drag starts. Default: 5. */
  minDragPx?: number;
}
