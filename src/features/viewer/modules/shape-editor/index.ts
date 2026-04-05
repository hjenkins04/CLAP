// ── Public API ────────────────────────────────────────────────────────────────

export { ShapeEditorEngine } from './shape-editor-engine';

export type { ShapeEditorConfig } from './shape-editor-config';
export { resolveConfig } from './shape-editor-config';

export type {
  Vec3,
  ShapeId,
  ObbShape,
  PolygonShape,
  PolylineShape,
  EditorShape,
  SubElementType,
  ElementRef,
  SelectionState,
  EditMode,
  SelectSubMode,
  TransformMode,
  HandleKind,
  HandleUserData,
  ShapeEditorEventMap,
  ElevationFn,
} from './shape-editor-types';

// ── Utility re-exports (for plugin authors) ───────────────────────────────────

export {
  shapeCentroid,
  translateShape,
  obbCorners,
  obbMoveFace,
  obbMoveCorner,
  polygonTopPoints,
  polygonEdges,
  polylineEdges,
  toThreeVec3,
  fromThreeVec3,
} from './utils/geometry-utils';

export { buildShapeVisual } from './visuals/shape-visual-builder';
export { buildHandles, getHandleData } from './visuals/handle-visual-builder';
export { buildLabel } from './visuals/label-visual-builder';
export { disposeObject3D, clearGroup } from './utils/dispose-utils';
