/** Configuration for ShapeEditorEngine with sensible defaults. */
export interface ShapeEditorConfig {
  /** Radius of vertex handles in world units. Default 0.18. */
  vertexHandleRadius: number;
  /** Radius of edge-midpoint handles. Default 0.13. */
  edgeHandleRadius: number;
  /** Radius of face-extrude handles. Default 0.15. */
  faceHandleRadius: number;
  /** Enable grid snapping during draw/edit. Default false. */
  snapToGrid: boolean;
  /** Grid cell size in world units when snap is enabled. Default 1.0. */
  snapGridSize: number;
  /** Snap drawn vertices to existing shape vertices within this radius. Default 0. (0 = disabled) */
  snapToVertexRadius: number;
  /** Whether to show edge-midpoint handles in vertex sub-mode. Default true. */
  showEdgeMidHandles: boolean;
  /** Whether to show face-extrude handles for OBB shapes. Default true. */
  showFaceExtrudeHandles: boolean;
  /** Number of polygon segments used for sphere handles. Default 8. */
  handleSegments: number;
  /** Minimum box half-extent in world units (prevents zero-size boxes). Default 0.01. */
  minHalfExtent: number;
  /** Minimum polygon extrusion height in world units. Default 0.05. */
  minExtrudeHeight: number;
  /** Whether Escape key cancels drawing / clears selection. Default true. */
  escapeHandled: boolean;
  /** Whether Delete / Backspace key deletes selected shapes. Default true. */
  deleteHandled: boolean;
}

const DEFAULTS: ShapeEditorConfig = {
  vertexHandleRadius: 0.18,
  edgeHandleRadius: 0.13,
  faceHandleRadius: 0.15,
  snapToGrid: false,
  snapGridSize: 1.0,
  snapToVertexRadius: 0,
  showEdgeMidHandles: true,
  showFaceExtrudeHandles: true,
  handleSegments: 8,
  minHalfExtent: 0.01,
  minExtrudeHeight: 0.05,
  escapeHandled: true,
  deleteHandled: true,
};

export function resolveConfig(partial?: Partial<ShapeEditorConfig>): ShapeEditorConfig {
  return { ...DEFAULTS, ...partial };
}
