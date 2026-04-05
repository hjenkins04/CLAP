import { Group, Mesh, MeshBasicMaterial, SphereGeometry, BufferGeometry, Float32BufferAttribute, DoubleSide } from 'three';
import type { Camera } from 'three';
import type { ViewerPluginContext } from '../../types';
import type {
  EditorShape,
  ShapeId,
  EditMode,
  SelectSubMode,
  TransformMode,
  ElevationFn,
  SelectionState,
  ShapeEditorEventMap,
  ShapeEditorInternalContext,
} from './shape-editor-types';
import { resolveConfig, type ShapeEditorConfig } from './shape-editor-config';
import { SnapEngine } from './snapping/snap-engine';
import { buildShapeVisual, buildElementHighlights } from './visuals/shape-visual-builder';
import { buildHandles } from './visuals/handle-visual-builder';
import { RENDER_ORDER_SHAPE } from './visuals/visual-constants';
import { clearGroup } from './utils/dispose-utils';
import { shapeCentroid } from './utils/geometry-utils';
import { BoxDrawController } from './drawing/box-draw-controller';
import { PolygonDrawController } from './drawing/polygon-draw-controller';
import { PolylineDrawController } from './drawing/polyline-draw-controller';
import { SelectionController } from './editing/selection-controller';
import { TransformController } from './editing/transform-controller';
import { VertexEditController } from './editing/vertex-edit-controller';
import { EdgeEditController } from './editing/edge-edit-controller';
import { FaceEditController } from './editing/face-edit-controller';

type EventCallback<T> = (data: T) => void;

/**
 * ShapeEditorEngine — the main entry point for the shape-editor module.
 *
 * Manages a collection of EditorShapes (OBB, polygon, polyline), their
 * Three.js visuals, and all drawing / editing interactions.
 *
 * All Three.js objects are added to `ctx.scene` directly (not worldRoot) so
 * that their positions in world/scene space are unambiguous.
 *
 * Usage:
 * ```typescript
 * const editor = new ShapeEditorEngine(pluginCtx, { snapToGrid: true });
 * editor.setElevationFn((x, z) => dem.getElevationClamped(x, z));
 * editor.startDrawBox();
 * editor.on('shape-created', (shape) => console.log('New shape:', shape));
 * ```
 */
export class ShapeEditorEngine {
  private pluginCtx: ViewerPluginContext;
  private config: ShapeEditorConfig;
  private snap: SnapEngine;

  // Shape storage
  private _shapes = new Map<ShapeId, EditorShape>();

  // Mode
  private _mode: EditMode = 'idle';
  private _subMode: SelectSubMode = 'shape';
  private _transformMode: TransformMode = 'translate';

  // Selection
  private _selection: SelectionState = { shapes: new Set(), elements: [] };

  // Elevation
  private _elevationFn: ElevationFn = () => 0;

  // Three.js scene objects
  /** Root group at scene level. Contains all shape visuals and handle groups. */
  private rootGroup: Group;
  /** Per-shape visual groups. */
  private shapeVisuals = new Map<ShapeId, Group>();
  /** Per-shape handle groups. */
  private shapeHandles = new Map<ShapeId, Group>();
  /** Per-shape element highlight overlay groups (selected edges/faces). */
  private elementHighlightGroups = new Map<ShapeId, Group>();
  /** Invisible pick meshes per shape (for shape-body selection). */
  private shapePickers = new Map<ShapeId, Mesh[]>();

  // Sub-controllers
  private boxDraw: BoxDrawController;
  private polyDraw: PolygonDrawController;
  private polylineDraw: PolylineDrawController;
  private selCtrl: SelectionController;
  private transformCtrl: TransformController;
  private vertexCtrl: VertexEditController;
  private edgeCtrl: EdgeEditController;
  private faceCtrl: FaceEditController;

  // Event handlers
  private handlers: Partial<{ [K in keyof ShapeEditorEventMap]: Array<EventCallback<ShapeEditorEventMap[K]>> }> = {};

  constructor(pluginCtx: ViewerPluginContext, config?: Partial<ShapeEditorConfig>) {
    this.pluginCtx = pluginCtx;
    this.config = resolveConfig(config);
    this.snap = new SnapEngine();
    this.snap.setGrid(this.config.snapToGrid, this.config.snapGridSize);
    this.snap.setVertexSnapRadius(this.config.snapToVertexRadius);

    // Root group at scene level (never inside worldRoot)
    this.rootGroup = new Group();
    this.rootGroup.name = 'shape-editor-root';
    pluginCtx.scene.add(this.rootGroup);

    // Build internal context shared with sub-controllers
    const iCtx = this.buildInternalContext();

    this.boxDraw      = new BoxDrawController(iCtx);
    this.polyDraw     = new PolygonDrawController(iCtx);
    this.polylineDraw = new PolylineDrawController(iCtx);
    this.selCtrl      = new SelectionController(iCtx);
    this.transformCtrl = new TransformController(iCtx);
    this.vertexCtrl   = new VertexEditController(iCtx);
    this.edgeCtrl     = new EdgeEditController(iCtx);
    this.faceCtrl     = new FaceEditController(iCtx);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Called each frame — updates camera, manages OrbitControls blocking. */
  onUpdate(_delta: number): void {
    this.transformCtrl.onUpdate();
  }

  // ── Shape management ───────────────────────────────────────────────────────

  addShape(shape: EditorShape): void {
    this._shapes.set(shape.id, shape);
    this.rebuildShapeVisuals(shape.id);
  }

  removeShape(id: ShapeId): void {
    this._shapes.delete(id);
    this.removeShapeVisuals(id);
    // Remove from selection
    const shapes = new Set(this._selection.shapes);
    shapes.delete(id);
    const elements = this._selection.elements.filter((e) => e.shapeId !== id);
    this.setSelection({ shapes, elements });
    this.emit('shape-deleted', { id });
  }

  updateShape(shape: EditorShape): void {
    this._shapes.set(shape.id, shape);
    this.rebuildShapeVisuals(shape.id);
    this.emit('shape-updated', shape);
  }

  getShape(id: ShapeId): EditorShape | undefined {
    return this._shapes.get(id);
  }

  getShapes(): EditorShape[] {
    return Array.from(this._shapes.values());
  }

  clearShapes(): void {
    for (const id of this._shapes.keys()) {
      this.removeShapeVisuals(id);
    }
    this._shapes.clear();
    this.setSelection({ shapes: new Set(), elements: [] });
  }

  // ── Mode control ───────────────────────────────────────────────────────────

  /** Enter box-drawing mode. */
  startDrawBox(): void {
    this.setMode('draw-box');
  }

  /** Enter polygon-drawing mode. */
  startDrawPolygon(): void {
    this.setMode('draw-polygon');
  }

  /** Enter polyline-drawing mode. */
  startDrawPolyline(): void {
    this.setMode('draw-polyline');
  }

  /** Enter selection/editing mode. */
  startSelect(subMode: SelectSubMode = 'shape'): void {
    this._subMode = subMode;
    this.setMode('select');
  }

  /** Cancel the current drawing operation without creating a shape. */
  cancelDraw(): void {
    const prevMode = this._mode;
    this.deactivateCurrentMode();
    this._mode = 'idle';
    this.emit('draw-cancelled', { mode: prevMode });
    this.emit('mode-changed', { mode: 'idle' });
  }

  /** Exit current mode and return to idle. */
  setModeIdle(): void {
    this.setMode('idle');
  }

  getMode(): EditMode {
    return this._mode;
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  getSelection(): SelectionState {
    return this._selection;
  }

  selectShape(id: ShapeId, additive = false): void {
    this.selCtrl.selectShape(id, additive);
  }

  clearSelection(): void {
    this.selCtrl.clearSelection();
  }

  setSubMode(mode: SelectSubMode): void {
    this._subMode = mode;
    this.selCtrl.setSubMode(mode);

    if (this._mode === 'select') {
      // Activate/deactivate sub-element edit controllers based on sub-mode
      this.vertexCtrl.deactivate();
      this.edgeCtrl.deactivate();
      this.faceCtrl.deactivate();
      if (mode === 'vertex') this.vertexCtrl.activate();
      else if (mode === 'edge') this.edgeCtrl.activate();
      else if (mode === 'face') this.faceCtrl.activate();
    }

    this.rebuildAllHandles();
  }

  // ── Transform ──────────────────────────────────────────────────────────────

  setTransformMode(mode: TransformMode): void {
    this._transformMode = mode;
    this.transformCtrl.setMode(mode);
  }

  /**
   * Switch to a transform sub-mode (translate/rotate/scale) from any state.
   * Unlike `setTransformMode`, this also deactivates vertex/edge/face controllers
   * and re-anchors the gizmo — so it works correctly when called after vertex/edge/face editing.
   */
  startTransform(mode: TransformMode): void {
    this._transformMode = mode;

    if (this._mode === 'select') {
      const sel = this._selection;
      if (sel.elements.length > 0) {
        // Element mode: always translate, just update anchor
        this.transformCtrl.activate('translate');
        this.transformCtrl.updateAnchorToElements();
      } else {
        // Shape mode: use selected transform mode
        this._subMode = 'shape';
        this.selCtrl.setSubMode('shape');
        this.vertexCtrl.deactivate();
        this.edgeCtrl.deactivate();
        this.faceCtrl.deactivate();
        this.transformCtrl.setMode(mode);
        if (sel.shapes.size > 0) {
          this.transformCtrl.activate(mode);
          this.transformCtrl.updateAnchorToSelection();
        }
      }
    } else {
      this.setMode('select');
    }

    this.rebuildAllHandles();
  }

  // ── Elevation ──────────────────────────────────────────────────────────────

  setElevationFn(fn: ElevationFn): void {
    this._elevationFn = fn;
  }

  // ── Snapping ───────────────────────────────────────────────────────────────

  setSnapToGrid(enabled: boolean, size = 1.0): void {
    this.config.snapToGrid = enabled;
    this.config.snapGridSize = size;
    this.snap.setGrid(enabled, size);
  }

  setVertexSnapRadius(radius: number): void {
    this.config.snapToVertexRadius = radius;
    this.snap.setVertexSnapRadius(radius);
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  on<K extends keyof ShapeEditorEventMap>(
    event: K,
    handler: EventCallback<ShapeEditorEventMap[K]>,
  ): void {
    if (!this.handlers[event]) this.handlers[event] = [] as never;
    (this.handlers[event] as Array<EventCallback<ShapeEditorEventMap[K]>>).push(handler);
  }

  off<K extends keyof ShapeEditorEventMap>(
    event: K,
    handler: EventCallback<ShapeEditorEventMap[K]>,
  ): void {
    const arr = this.handlers[event] as Array<EventCallback<ShapeEditorEventMap[K]>> | undefined;
    if (!arr) return;
    const idx = arr.indexOf(handler);
    if (idx >= 0) arr.splice(idx, 1);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  dispose(): void {
    this.setMode('idle');
    this.transformCtrl.dispose();
    clearGroup(this.rootGroup);
    this.pluginCtx.scene.remove(this.rootGroup);
    this._shapes.clear();
    this.shapeVisuals.clear();
    this.shapeHandles.clear();
    this.elementHighlightGroups.clear();
    this.shapePickers.clear();
    this.handlers = {};
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private setMode(mode: EditMode): void {
    if (mode === this._mode) return;
    this.deactivateCurrentMode();
    this._mode = mode;
    this.activateMode(mode);
    this.emit('mode-changed', { mode });
  }

  private deactivateCurrentMode(): void {
    switch (this._mode) {
      case 'draw-box':      this.boxDraw.deactivate(); break;
      case 'draw-polygon':  this.polyDraw.deactivate(); break;
      case 'draw-polyline': this.polylineDraw.deactivate(); break;
      case 'select':
        this.selCtrl.deactivate();
        this.transformCtrl.deactivate();
        this.vertexCtrl.deactivate();
        this.edgeCtrl.deactivate();
        this.faceCtrl.deactivate();
        break;
    }
  }

  private activateMode(mode: EditMode): void {
    switch (mode) {
      case 'draw-box':      this.boxDraw.activate(); break;
      case 'draw-polygon':  this.polyDraw.activate(); break;
      case 'draw-polyline': this.polylineDraw.activate(); break;
      case 'select':
        this.selCtrl.activate(this._subMode);
        if (this._selection.shapes.size > 0) {
          this.transformCtrl.activate(this._transformMode);
        }
        if (this._subMode === 'vertex') this.vertexCtrl.activate();
        else if (this._subMode === 'edge') this.edgeCtrl.activate();
        else if (this._subMode === 'face') this.faceCtrl.activate();
        this.rebuildAllHandles();
        break;
    }
  }

  private buildInternalContext(): ShapeEditorInternalContext {
    return {
      scene: this.pluginCtx.scene,
      domElement: this.pluginCtx.domElement,
      getCamera: () => this.pluginCtx.getActiveCamera() as Camera,
      renderer: this.pluginCtx.renderer,
      orbitControls: this.pluginCtx.controls,
      shapes: this._shapes,
      getElevation: (x, z) => this._elevationFn(x, z),
      config: this.config,
      snap: this.snap,
      emit: <K extends keyof ShapeEditorEventMap>(event: K, data: ShapeEditorEventMap[K]) =>
        this.emit(event, data),
      rebuildVisuals: (id?: ShapeId) => {
        if (id) this.rebuildShapeVisuals(id);
        else this.rebuildAllVisuals();
      },
      rebuildHandles: (id?: ShapeId) => {
        if (id) {
          const shape = this._shapes.get(id);
          if (shape) {
            this.rebuildHandlesForShape(id, shape);
            this.rebuildElementHighlightsForShape(id, shape);
            this.syncPickLists();
          }
        } else {
          this.rebuildAllHandles(); // includes syncPickLists
        }
      },
      finishDraw: (shape: EditorShape) => {
        this._shapes.set(shape.id, shape);
        this.deactivateCurrentMode();
        this._mode = 'idle';
        this.rebuildShapeVisuals(shape.id);
        this.emit('shape-created', shape);
        this.emit('mode-changed', { mode: 'idle' });
      },
      cancelDraw: () => this.cancelDraw(),
      setMode: (mode: EditMode) => this.setMode(mode),
      getMode: () => this._mode,
      getSelection: () => this._selection,
      setSelection: (sel: SelectionState) => {
        this._selection = sel;
        this.onSelectionChanged(sel);
      },
    };
  }

  private emit<K extends keyof ShapeEditorEventMap>(event: K, data: ShapeEditorEventMap[K]): void {
    const arr = this.handlers[event] as Array<EventCallback<ShapeEditorEventMap[K]>> | undefined;
    if (arr) arr.forEach((h) => h(data));
  }

  private setSelection(sel: SelectionState): void {
    this._selection = sel;
    this.onSelectionChanged(sel);
  }

  private onSelectionChanged(sel: SelectionState): void {
    this.rebuildAllHandles();

    if (this._mode === 'select') {
      if (sel.shapes.size > 0) {
        // Shape-level: activate gizmo with current transform mode
        this.transformCtrl.activate(this._transformMode);
        this.transformCtrl.updateAnchorToSelection();
      } else if (sel.elements.length > 0) {
        // Element-level: activate translate gizmo at element centroid
        this.transformCtrl.activate('translate');
        this.transformCtrl.updateAnchorToElements();
      } else {
        this.transformCtrl.deactivate();
      }
    }

    this.emit('selection-changed', sel);
  }

  // ── Visual management ──────────────────────────────────────────────────────

  private rebuildShapeVisuals(id: ShapeId): void {
    const shape = this._shapes.get(id);

    // Remove old visuals
    this.removeShapeVisuals(id);
    if (!shape) return;

    const isSelected = this._selection.shapes.has(id);

    // 1. Wireframe visual
    const visual = buildShapeVisual(shape, isSelected);
    this.rootGroup.add(visual);
    this.shapeVisuals.set(id, visual);

    // 2. Invisible pick mesh for shape-body selection
    const pickers = this.buildPickMeshes(shape);
    const pickerGroup = new Group();
    for (const m of pickers) pickerGroup.add(m);
    this.rootGroup.add(pickerGroup);
    this.shapePickers.set(id, pickers);

    // 3. Handles + element highlights (only show in select mode)
    if (this._mode === 'select') {
      this.rebuildHandlesForShape(id, shape);
      this.rebuildElementHighlightsForShape(id, shape);
    }

    // Update selection controller's pick lists
    this.syncPickLists();
  }

  private rebuildAllVisuals(): void {
    for (const id of this._shapes.keys()) {
      this.rebuildShapeVisuals(id);
    }
  }

  private rebuildHandlesForShape(id: ShapeId, shape: EditorShape): void {
    const old = this.shapeHandles.get(id);
    if (old) {
      clearGroup(old);
      this.rootGroup.remove(old);
    }

    const hovered = this.selCtrl.hoveredHandle;
    const handles = buildHandles(shape, this.config, this._selection, hovered, this._subMode);
    this.rootGroup.add(handles);
    this.shapeHandles.set(id, handles);
  }

  private rebuildAllHandles(): void {
    for (const [id, shape] of this._shapes) {
      this.rebuildHandlesForShape(id, shape);
      this.rebuildElementHighlightsForShape(id, shape);
    }
    this.syncPickLists();
  }

  private rebuildElementHighlightsForShape(id: ShapeId, shape: EditorShape): void {
    const old = this.elementHighlightGroups.get(id);
    if (old) {
      clearGroup(old);
      this.rootGroup.remove(old);
      this.elementHighlightGroups.delete(id);
    }
    if (this._mode === 'select') {
      const hovered = this.selCtrl.hoveredHandle;
      const highlights = buildElementHighlights(shape, this._selection, hovered, this._subMode);
      this.rootGroup.add(highlights);
      this.elementHighlightGroups.set(id, highlights);
    }
  }

  private removeShapeVisuals(id: ShapeId): void {
    const visual = this.shapeVisuals.get(id);
    if (visual) {
      clearGroup(visual);
      this.rootGroup.remove(visual);
      this.shapeVisuals.delete(id);
    }
    const pickers = this.shapePickers.get(id);
    if (pickers) {
      for (const m of pickers) {
        m.geometry.dispose();
        if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
        else m.material.dispose();
        this.rootGroup.remove(m);
      }
      this.shapePickers.delete(id);
    }
    const handles = this.shapeHandles.get(id);
    if (handles) {
      clearGroup(handles);
      this.rootGroup.remove(handles);
      this.shapeHandles.delete(id);
    }
    const highlights = this.elementHighlightGroups.get(id);
    if (highlights) {
      clearGroup(highlights);
      this.rootGroup.remove(highlights);
      this.elementHighlightGroups.delete(id);
    }
  }

  /** Sync selection controller's and vertex/edge/face controller's mesh lists. */
  private syncPickLists(): void {
    const allHandleMeshes: Mesh[] = [];
    const allShapeMeshes: Mesh[] = [];

    for (const group of this.shapeHandles.values()) {
      group.traverse((obj) => {
        if (obj instanceof Mesh) allHandleMeshes.push(obj);
      });
    }
    for (const pickers of this.shapePickers.values()) {
      allShapeMeshes.push(...pickers);
    }

    this.selCtrl.handleMeshes   = allHandleMeshes;
    this.selCtrl.shapeMeshes    = allShapeMeshes;
    this.vertexCtrl.handleMeshes = allHandleMeshes;
    this.edgeCtrl.handleMeshes   = allHandleMeshes;
    this.faceCtrl.handleMeshes   = allHandleMeshes;
  }

  /**
   * Build invisible pick meshes for a shape so that shape-body clicking works.
   * These are translucent (opacity 0) meshes that cover the shape's volume.
   */
  private buildPickMeshes(shape: EditorShape): Mesh[] {
    const meshes: Mesh[] = [];
    const mat = new MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthTest: false,
      side: DoubleSide,
    });

    switch (shape.type) {
      case 'obb': {
        // Single box pick mesh using BoxGeometry would be nice, but we need
        // it to respect rotationY. Use a simple convex hull approach: just
        // an invisible mesh at the OBB center.
        // For simplicity, create 6 face quads.
        const { center, halfExtents, rotationY } = shape;
        const { x: cx, y: cy, z: cz } = center;
        const { x: hx, y: hy, z: hz } = halfExtents;

        // 6 faces, each a quad
        const faces: [number, number, number, number, number, number, number, number, number, number, number, number][] = [
          [-hx, -hy, -hz,  hx, -hy, -hz,  hx, -hy,  hz, -hx, -hy,  hz],  // bottom
          [-hx,  hy, -hz, -hx,  hy,  hz,  hx,  hy,  hz,  hx,  hy, -hz],  // top
          [-hx, -hy, -hz, -hx,  hy, -hz,  hx,  hy, -hz,  hx, -hy, -hz],  // front
          [ hx, -hy,  hz,  hx,  hy,  hz, -hx,  hy,  hz, -hx, -hy,  hz],  // back
          [-hx, -hy, -hz, -hx, -hy,  hz, -hx,  hy,  hz, -hx,  hy, -hz],  // left
          [ hx, -hy, -hz,  hx,  hy, -hz,  hx,  hy,  hz,  hx, -hy,  hz],  // right
        ];

        for (const f of faces) {
          const pos = new Float32Array([
            f[0], f[1], f[2],   f[3], f[4], f[5],   f[6], f[7], f[8],
            f[0], f[1], f[2],   f[6], f[7], f[8],   f[9], f[10], f[11],
          ]);
          const geo = new BufferGeometry();
          geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
          const m = new Mesh(geo, mat.clone());
          m.renderOrder = RENDER_ORDER_SHAPE - 1;
          m.position.set(cx, cy, cz);
          m.rotation.y = rotationY;
          m.userData = { shapeId: shape.id, _seHandle: false };
          meshes.push(m);
        }
        break;
      }

      case 'polygon': {
        if (shape.basePoints.length < 3) break;
        // Top face as triangulated polygon
        const n = shape.basePoints.length;
        const posArr: number[] = [];
        const c = shapeCentroid(shape);
        for (let i = 0; i < n; i++) {
          const a = shape.basePoints[i];
          const b = shape.basePoints[(i + 1) % n];
          posArr.push(c.x, c.y, c.z, a.x, a.y + shape.height, a.z, b.x, b.y + shape.height, b.z);
        }
        const geo = new BufferGeometry();
        geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(posArr), 3));
        const m = new Mesh(geo, mat.clone());
        m.renderOrder = RENDER_ORDER_SHAPE - 1;
        m.userData = { shapeId: shape.id, _seHandle: false };
        meshes.push(m);
        break;
      }

      case 'polyline':
        // Polylines have no fill volume; selection requires clicking near the line.
        // For simplicity, add a small sphere at each point.
        for (const p of shape.points) {
          const geo = new SphereGeometry(0.3, 4, 4);
          const m = new Mesh(geo, mat.clone());
          m.position.set(p.x, p.y, p.z);
          m.renderOrder = RENDER_ORDER_SHAPE;
          m.userData = { shapeId: shape.id, _seHandle: false };
          meshes.push(m);
        }
        break;
    }

    return meshes;
  }
}
