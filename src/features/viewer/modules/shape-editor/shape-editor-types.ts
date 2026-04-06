import type { Camera, Scene, WebGLRenderer } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SnapEngine } from './snapping/snap-engine';

// ── Primitives ────────────────────────────────────────────────────────────────

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type ShapeId = string;

// ── Shape definitions ─────────────────────────────────────────────────────────

/**
 * Oriented Bounding Box in Three.js scene/world space (Y-up).
 * x = east, y = elevation, z = north.
 */
export interface ObbShape {
  readonly type: 'obb';
  readonly id: ShapeId;
  center: Vec3;
  halfExtents: Vec3;
  /** Rotation about the world Y (up) axis, radians. */
  rotationY: number;
  metadata: Record<string, unknown>;
}

/**
 * Extruded polygon. `basePoints` hold the XZ footprint; each point's Y is the
 * ground elevation at that vertex. `height` is the extrusion distance upward.
 */
export interface PolygonShape {
  readonly type: 'polygon';
  readonly id: ShapeId;
  basePoints: Vec3[];
  height: number;
  metadata: Record<string, unknown>;
}

/** Sequence of 3D world-space points. */
export interface PolylineShape {
  readonly type: 'polyline';
  readonly id: ShapeId;
  points: Vec3[];
  closed: boolean;
  metadata: Record<string, unknown>;
}

export type EditorShape = ObbShape | PolygonShape | PolylineShape;

// ── Sub-element selection ─────────────────────────────────────────────────────

export type SubElementType = 'vertex' | 'edge' | 'face';

/** Reference to a specific vertex, edge, or face within a shape. */
export interface ElementRef {
  shapeId: ShapeId;
  elementType: SubElementType;
  /** Vertex/edge/face index within the shape. */
  index: number;
  /** For face handles: which axis face. */
  faceAxis?: '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
}

export interface SelectionState {
  /** IDs of fully-selected shapes. */
  shapes: ReadonlySet<ShapeId>;
  /** Sub-element selections (vertex/edge/face handles). */
  elements: ReadonlyArray<ElementRef>;
}

// ── Editor modes ──────────────────────────────────────────────────────────────

/** Top-level operating mode. */
export type EditMode =
  | 'idle'
  | 'select'
  | 'draw-box'
  | 'draw-flat-box'
  | 'draw-polygon'
  | 'draw-polyline';

/** Which sub-element type responds to clicks in 'select' mode. */
export type SelectSubMode = 'shape' | 'vertex' | 'edge' | 'face';

/** Three.js TransformControls mode for the gizmo. */
export type TransformMode = 'translate' | 'rotate' | 'scale';

// ── Draw phases ───────────────────────────────────────────────────────────────

export type BoxDrawPhase = 'footprint' | 'extrude';
export type PolyDrawPhase = 'placing';

// ── Handle metadata (stored in mesh.userData) ─────────────────────────────────

export type HandleKind =
  | 'vertex'        // corner / polygon vertex
  | 'edge-mid'      // edge midpoint (push-edge tool)
  | 'face-extrude'  // face centre (extrusion drag)
  | 'edge-resize'   // OBB face-normal handle (direct resize)
  | 'shape-body';   // the shape's fill mesh (for whole-shape selection)

export interface HandleUserData {
  _seHandle: true;
  kind: HandleKind;
  shapeId: ShapeId;
  index: number;
  faceAxis?: '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
}

// ── Events ────────────────────────────────────────────────────────────────────

export interface ShapeEditorEventMap {
  'shape-created':   EditorShape;
  'shape-updated':   EditorShape;
  'shape-deleted':   { id: ShapeId };
  'selection-changed': SelectionState;
  'mode-changed':    { mode: EditMode };
  'draw-cancelled':  { mode: EditMode };
}

// ── Elevation callback ────────────────────────────────────────────────────────

/** Returns world-space Y elevation at the given (worldX, worldZ) position. */
export type ElevationFn = (worldX: number, worldZ: number) => number;

// ── Internal context shared between sub-controllers ──────────────────────────

export interface ShapeEditorInternalContext {
  scene: Scene;
  domElement: HTMLElement;
  getCamera: () => Camera;
  renderer: WebGLRenderer;
  orbitControls: OrbitControls;
  /** Live map of all shapes — mutate in place, then call rebuildVisuals. */
  shapes: Map<ShapeId, EditorShape>;
  getElevation: ElevationFn;
  snap: SnapEngine;
  config: import('./shape-editor-config').ShapeEditorConfig;
  emit<K extends keyof ShapeEditorEventMap>(event: K, data: ShapeEditorEventMap[K]): void;
  /** Rebuild Three.js visuals for one shape (or all if id omitted). */
  rebuildVisuals(id?: ShapeId): void;
  /** Rebuild only handles + element highlights (cheaper than rebuildVisuals). */
  rebuildHandles(id?: ShapeId): void;
  /** Called by a draw controller when a new shape is finished. */
  finishDraw(shape: EditorShape): void;
  /** Called by a draw controller to abort without creating a shape. */
  cancelDraw(): void;
  /** Change the top-level mode (also updates listeners). */
  setMode(mode: EditMode): void;
  getMode(): EditMode;
  getSelection(): SelectionState;
  setSelection(sel: SelectionState): void;
}
