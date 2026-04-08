import {
  Group,
  Matrix4,
  Vector3,
} from 'three';
import type { PointCloudOctree } from 'potree-core';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { useViewerModeStore } from '@/app/stores';
import { usePolyAnnotStore } from './polygon-annotation-store';
import { PolygonAnnotationPanel } from './polygon-annotation-panel';
import {
  buildPolygonGroup,
  buildDraftPreview,
  buildCloseIndicator,
  disposeGroup,
} from './polygon-annotation-visuals';
import { clientToNdc, raycastHorizontalPlane } from '../../modules/shape-editor/utils/raycast-utils';
import { setPolyAnnotPluginRef } from './polygon-annotation-plugin-ref';
import type { PolygonAnnotation } from './polygon-annotation-types';
import {
  ShapeEditorEngine,
  type PolylineShape,
  type EditorShape,
} from '../../modules/shape-editor';
import { geoAnnotHistory } from '../../services/geometry-annotations-history';
import { useSnapStore } from '../../modules/snap/snap-store';

/** Screen-space px radius for snapping to an existing vertex while drawing. */
const SNAP_PX = 18;
/** Screen-space px radius for clicking the first vertex to close a polygon. */
const CLOSE_PX = 22;

type Vec3 = { x: number; y: number; z: number };

export class PolygonAnnotationPlugin implements ViewerPlugin {
  readonly id            = 'polygon-annotation';
  readonly name          = 'Polygon Annotations';
  readonly order         = 9;
  readonly SidebarPanel  = PolygonAnnotationPanel;
  readonly sidebarTitle  = 'Polygons';
  readonly sidebarDefaultOpen = false;

  private ctx: ViewerPluginContext | null = null;
  private rootGroup: Group | null = null;

  /** Three.js groups keyed by annotation id. */
  private annotationGroups = new Map<string, Group>();

  /** Live draft preview group (rebuilt each pointer-move). */
  private draftGroup: Group | null = null;

  /** Cached ground elevation from DEM or point cloud bounding box. */
  private fallbackY = 0;

  /** ShapeEditorEngine used exclusively for vertex-edit mode on completed annotations. */
  private editEngine: ShapeEditorEngine | null = null;

  /** ID of the PolylineShape currently loaded into editEngine (= annotation id). */
  private editingShapeId: string | null = null;

  private unsubMode: (() => void) | null = null;
  private unsubStore: (() => void) | null = null;

  /**
   * Guard flag: suppresses the engine↔store sync loop.
   * Set to true whenever one side is writing to the other so the listener on
   * the other side skips its echo. Covers both directions:
   *   engine → store  (shape-updated → setAnnotationVertices)
   *   store  → engine (undo/redo applySnapshot → updateShape)
   */
  private suppressSync = false;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;
    setPolyAnnotPluginRef(this);

    this.rootGroup = new Group();
    this.rootGroup.name = 'polygon-annotations';
    ctx.scene.add(this.rootGroup);

    // Engine for vertex editing — smaller handles, no face/extrude handles
    this.editEngine = new ShapeEditorEngine(ctx, {
      vertexHandleRadius:    0.08,
      edgeHandleRadius:      0.06,
      faceHandleRadius:      0.08,
      showFaceExtrudeHandles: false,
      escapeHandled:         true,
      deleteHandled:         false,  // we handle Delete to remove selected vertices
      rootGroupName:         'polygon-edit-root',
    });

    this.updateElevationFn();

    // Sync shape changes back to the annotation store.
    // suppressSync guards against the store subscriber echoing the change back into the engine.
    this.editEngine.on('shape-updated', (shape: EditorShape) => {
      if (shape.type !== 'polyline' || !this.editingShapeId) return;
      if (this.suppressSync) return;
      geoAnnotHistory.record(); // snapshot pre-mutation state (fires once per drag end)
      this.suppressSync = true;
      usePolyAnnotStore.getState().setAnnotationVertices(this.editingShapeId, shape.points);
      this.suppressSync = false;
    });

    const { annotations, layers } = usePolyAnnotStore.getState();
    for (const ann of annotations) {
      const layer = layers.find((l) => l.id === ann.layerId);
      this.rebuildAnnotationVisual(ann, layer?.color ?? '#22d3ee');
    }

    this.unsubMode = useViewerModeStore.subscribe((state, prev) => {
      const was = prev.mode === 'polygon-annotation';
      const is  = state.mode === 'polygon-annotation';
      if (is && !was) this.enterMode();
      else if (!is && was) this.exitMode();
    });

    this.unsubStore = usePolyAnnotStore.subscribe((state, prev) => {
      const prevIds = new Set(prev.annotations.map((a) => a.id));
      const curIds  = new Set(state.annotations.map((a) => a.id));

      for (const id of prevIds) {
        if (!curIds.has(id)) this.removeAnnotationVisual(id);
      }
      for (const ann of state.annotations) {
        const layer = state.layers.find((l) => l.id === ann.layerId);
        if (!prevIds.has(ann.id) || state.annotations !== prev.annotations) {
          this.rebuildAnnotationVisual(ann, layer?.color ?? '#22d3ee');
        }
      }

      for (const ann of state.annotations) {
        const layer = state.layers.find((l) => l.id === ann.layerId);
        const group = this.annotationGroups.get(ann.id);
        if (group) group.visible = ann.visible && (layer?.visible ?? true);
      }

      // When vertices of the currently-edited annotation change externally
      // (undo/redo via geoAnnotHistory), sync the new positions into the engine
      // so vertex handles and the transform gizmo move to match.
      // suppressSync prevents the resulting shape-updated emission from looping back.
      if (!this.suppressSync && this.editingShapeId && this.editEngine) {
        const curr  = state.annotations.find((a) => a.id === this.editingShapeId);
        const prev_ = prev.annotations.find((a) => a.id === this.editingShapeId);
        if (curr && prev_ && curr.vertices !== prev_.vertices) {
          const engineShape = this.editEngine.getShape(this.editingShapeId);
          if (engineShape && engineShape.type === 'polyline') {
            this.suppressSync = true;
            this.editEngine.updateShape({
              ...engineShape,
              points: curr.vertices.map((v) => ({ ...v })),
            });
            this.editEngine.refreshGizmoAnchor();
            this.suppressSync = false;
          }
        }
      }
    });
  }

  onUpdate(delta: number): void {
    this.editEngine?.onUpdate(delta);
  }

  onPointCloudLoaded(pco: PointCloudOctree): void {
    const box = pco.pcoGeometry.boundingBox;
    const midLocal = new Vector3(
      (box.min.x + box.max.x) / 2,
      (box.min.y + box.max.y) / 2,
      (box.min.z + box.max.z) / 2,
    );
    this.fallbackY = midLocal.clone().add(pco.position).y;
    this.updateElevationFn();
  }

  dispose(): void {
    setPolyAnnotPluginRef(null);
    this.exitMode();
    this.unsubMode?.();
    this.unsubMode = null;
    this.unsubStore?.();
    this.unsubStore = null;

    this.editEngine?.dispose();
    this.editEngine = null;

    for (const group of this.annotationGroups.values()) {
      disposeGroup(group);
      this.rootGroup?.remove(group);
    }
    this.annotationGroups.clear();

    if (this.rootGroup) {
      this.ctx?.scene.remove(this.rootGroup);
      this.rootGroup = null;
    }
    this.ctx = null;
  }

  // ── Mode entry / exit ──────────────────────────────────────────────────────

  private enterMode(): void {
    // Polygon annotation snaps to terrain — enable DEM, disable scene-surface raycast
    const snapState = useSnapStore.getState();
    snapState.setMode('dem', true);
    snapState.setMode('surface', false);

    const store = usePolyAnnotStore.getState();
    if (store.phase === 'editing' && store.editingAnnotationId) {
      const ann = store.annotations.find((a) => a.id === store.editingAnnotationId);
      if (ann) { this.loadAnnotationIntoEngine(ann); this.attachEditKeyListener(); return; }
    }
    if (!store.activeLayerId && store.layers.length === 0) {
      store.setPhase('idle');
    } else {
      if (!store.activeLayerId && store.layers.length > 0) {
        store.setActiveLayer(store.layers[0].id);
      }
      store.clearDraft();
      store.setPhase('drawing');
      this.attachDrawListeners();
    }
  }

  private exitMode(): void {
    this.detachDrawListeners();
    this.detachEditKeyListener();
    this.clearDraftVisual();
    this.unloadAnnotationFromEngine();
    const store = usePolyAnnotStore.getState();
    store.setEditingAnnotationId(null);
    if (store.phase !== 'idle') {
      store.clearDraft();
      store.setPhase('idle');
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  startDrawing(): void {
    this.stopEditing();
    const store = usePolyAnnotStore.getState();
    store.clearDraft();
    store.setPhase('drawing');
    this.attachDrawListeners();
  }

  cancelDraft(): void {
    usePolyAnnotStore.getState().discardPending();
    this.clearDraftVisual();
    this.attachDrawListeners();
  }

  commitPolygon(): void {
    geoAnnotHistory.record();
    usePolyAnnotStore.getState().commitPolygon();
    this.attachDrawListeners();
  }

  /** Enter vertex-edit mode for a specific annotation (called from panel). */
  startEditing(annId: string): void {
    const store = usePolyAnnotStore.getState();
    const ann = store.annotations.find((a) => a.id === annId);
    if (!ann) return;

    this.detachDrawListeners();
    this.clearDraftVisual();
    store.clearDraft();

    store.setEditingAnnotationId(annId);
    store.setPhase('editing');
    this.loadAnnotationIntoEngine(ann);
    this.attachEditKeyListener();
  }

  /** Finish vertex editing and return to draw mode. */
  stopEditing(): void {
    this.detachEditKeyListener();
    this.unloadAnnotationFromEngine();
    const store = usePolyAnnotStore.getState();
    store.setEditingAnnotationId(null);
    if (store.phase === 'editing') {
      store.setPhase('drawing');
      this.attachDrawListeners();
    }
  }

  /** Expose edit engine for secondary-viewport vertex interaction. */
  getEditEngine(): ShapeEditorEngine | null {
    return this.editEngine;
  }

  /** Insert a vertex into the editing annotation at the given edge index.
   *  Records undo history before mutating. Called from the 2D secondary viewport. */
  insertVertexAt2D(annId: string, edgeIndex: number, pos: { x: number; y: number; z: number }): void {
    geoAnnotHistory.record();
    usePolyAnnotStore.getState().insertVertex(annId, edgeIndex, pos);
  }

  /** Insert multiple vertices into the editing annotation from 2D pierce point selections.
   *  Sorts insertions descending by edge index so later indices don't shift earlier ones.
   *  Records a single undo snapshot before all mutations. */
  insertMultipleVerticesAt2D(
    annId: string,
    insertions: Array<{ edgeIndex: number; pos: { x: number; y: number; z: number } }>,
  ): void {
    if (insertions.length === 0) return;
    geoAnnotHistory.record();
    // Sort descending — insert at higher indices first so lower indices aren't shifted.
    const sorted = [...insertions].sort((a, b) => b.edgeIndex - a.edgeIndex);
    for (const { edgeIndex, pos } of sorted) {
      usePolyAnnotStore.getState().insertVertex(annId, edgeIndex, pos);
    }
  }

  // ── Edit engine helpers ────────────────────────────────────────────────────

  private loadAnnotationIntoEngine(ann: PolygonAnnotation): void {
    if (!this.editEngine) return;
    this.unloadAnnotationFromEngine();

    const shape: PolylineShape = {
      type: 'polyline',
      id: ann.id,
      points: ann.vertices.map((v) => ({ ...v })),
      closed: true,
      metadata: {},
    };

    // Supply snap targets: all annotation vertices (own + others = vertex-to-vertex snap)
    const { annotations } = usePolyAnnotStore.getState();
    const extraVerts = annotations.flatMap((a) => a.vertices.map((v) => ({ ...v })));
    this.editEngine.setSnapExtraVertices(extraVerts);

    this.editingShapeId = ann.id;
    this.editEngine.addShape(shape);
    this.editEngine.startSelect('vertex');
    this.editEngine.selectShape(ann.id);
  }

  private unloadAnnotationFromEngine(): void {
    if (!this.editEngine || !this.editingShapeId) return;
    this.editEngine.setSnapExtraVertices([]);
    this.editEngine.clearShapes();
    this.editEngine.setModeIdle();
    this.editingShapeId = null;
  }

  /** Delete the currently selected vertices (min 3 must remain). */
  private deleteSelectedVertices(): void {
    if (!this.editEngine || !this.editingShapeId) return;
    geoAnnotHistory.record();
    const sel = this.editEngine.getSelection();

    // Collect selected vertex indices for this shape, sorted descending so splice is safe
    const toDelete = sel.elements
      .filter((el) => el.shapeId === this.editingShapeId && el.elementType === 'vertex')
      .map((el) => el.index)
      .sort((a, b) => b - a);

    if (toDelete.length === 0) return;

    const store = usePolyAnnotStore.getState();
    const ann = store.annotations.find((a) => a.id === this.editingShapeId);
    if (!ann) return;

    // Must keep at least 3 vertices to remain a valid polygon
    if (ann.vertices.length - toDelete.length < 3) return;

    const newVertices = [...ann.vertices];
    for (const idx of toDelete) newVertices.splice(idx, 1);

    // Update the engine shape (fires shape-updated → setAnnotationVertices → visual rebuild)
    const shape = this.editEngine.getShape(this.editingShapeId);
    if (shape && shape.type === 'polyline') {
      this.editEngine.updateShape({
        ...shape,
        points: newVertices.map((v) => ({ ...v })),
      });
    }

    this.editEngine.clearSelection();
  }

  // ── Draw listeners ─────────────────────────────────────────────────────────

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const store = usePolyAnnotStore.getState();
    if (store.phase !== 'drawing') return;

    const worldPos = this.screenToWorld(e.clientX, e.clientY);
    if (!worldPos) return;

    const snapped = this.snapToVertex(e.clientX, e.clientY) ?? worldPos;
    const verts = store.draftVertices;

    if (verts.length >= 3) {
      const closePx = this.worldToScreenPx(verts[0], e.clientX, e.clientY);
      if (closePx !== null && closePx < CLOSE_PX) {
        store.setPhase('classifying');
        this.detachDrawListeners();
        this.clearDraftVisual();
        return;
      }
    }

    store.setDraftVertices([...verts, snapped]);
    this.rebuildDraftVisual(null, false);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const store = usePolyAnnotStore.getState();
    if (store.phase !== 'drawing' || store.draftVertices.length === 0) return;

    const snappedVert = this.snapToVertex(e.clientX, e.clientY);
    const worldPos = snappedVert ?? this.screenToWorld(e.clientX, e.clientY);
    if (!worldPos) return;

    const verts = store.draftVertices;
    let showClose = false;
    if (verts.length >= 3) {
      const closePx = this.worldToScreenPx(verts[0], e.clientX, e.clientY);
      showClose = closePx !== null && closePx < CLOSE_PX;
    }

    this.rebuildDraftVisual(showClose ? verts[0] : worldPos, snappedVert !== null, showClose);
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    // Don't intercept keys while the user is typing in an input or textarea
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

    const store = usePolyAnnotStore.getState();

    if (e.key === 'Escape') {
      if (store.phase === 'editing') {
        this.stopEditing();
      } else if (store.draftVertices.length > 0) {
        store.clearDraft();
        this.rebuildDraftVisual(null, false);
      } else {
        useViewerModeStore.getState().exitMode();
      }
    }
    if (e.key === 'Enter' && store.phase === 'drawing') {
      if (store.draftVertices.length >= 3) {
        store.setPhase('classifying');
        this.detachDrawListeners();
        this.clearDraftVisual();
      }
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (store.phase === 'editing') {
        this.deleteSelectedVertices();
      } else if (store.phase === 'drawing') {
        const verts = store.draftVertices;
        if (verts.length > 0) {
          store.setDraftVertices(verts.slice(0, -1));
          this.rebuildDraftVisual(null, false);
        }
      }
    }
  };

  private attachDrawListeners(): void {
    if (!this.ctx) return;
    this.ctx.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.ctx.domElement.addEventListener('pointermove', this.onPointerMove);
    this.ctx.domElement.addEventListener('keydown',     this.onKeyDown);
  }

  private detachDrawListeners(): void {
    if (!this.ctx) return;
    this.ctx.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.ctx.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.ctx.domElement.removeEventListener('keydown',     this.onKeyDown);
  }

  // ── Edit key listener (engine handles pointer events) ─────────────────────

  private attachEditKeyListener(): void {
    window.addEventListener('keydown', this.onKeyDown);
  }

  private detachEditKeyListener(): void {
    window.removeEventListener('keydown', this.onKeyDown);
  }

  // ── Raycasting + snapping ──────────────────────────────────────────────────

  private screenToWorld(clientX: number, clientY: number): Vec3 | null {
    if (!this.ctx) return null;
    const camera = this.ctx.getActiveCamera();
    const ndc = clientToNdc(clientX, clientY, this.ctx.domElement);

    let planeY = this.fallbackY;
    let hit = raycastHorizontalPlane(ndc, camera, planeY);
    if (!hit) return null;

    for (let i = 0; i < 8; i++) {
      const demY = this.getElevation(hit.x, hit.z);
      if (Math.abs(demY - planeY) < 0.005) break;
      planeY = demY;
      hit = raycastHorizontalPlane(ndc, camera, planeY) ?? hit;
    }

    hit.y = this.getElevation(hit.x, hit.z);
    return { x: hit.x, y: hit.y, z: hit.z };
  }

  private getElevation(worldX: number, worldZ: number): number {
    const dem = this.ctx?.getDem();
    if (dem && this.ctx) {
      const tg = this.ctx.getEditor().getTransformGroup();
      tg.updateMatrixWorld(true);
      const local = new Vector3(worldX, 0, worldZ)
        .applyMatrix4(new Matrix4().copy(tg.matrixWorld).invert());
      const elev = dem.getElevationClamped(local.x, local.z);
      if (elev !== null) return elev as number;
    }
    return this.fallbackY;
  }

  private updateElevationFn(): void {
    if (!this.editEngine) return;
    const self = this;
    this.editEngine.setElevationFn((worldX: number, worldZ: number) =>
      self.getElevation(worldX, worldZ),
    );
  }

  private snapToVertex(clientX: number, clientY: number): Vec3 | null {
    if (!this.ctx) return null;
    const { annotations, draftVertices } = usePolyAnnotStore.getState();

    let best: Vec3 | null = null;
    let bestPx = SNAP_PX;

    const check = (v: Vec3) => {
      const px = this.worldToScreenPx(v, clientX, clientY);
      if (px !== null && px < bestPx) { bestPx = px; best = v; }
    };

    for (const ann of annotations) {
      for (const v of ann.vertices) check(v);
    }
    for (let i = 1; i < draftVertices.length; i++) check(draftVertices[i]);

    return best;
  }

  private worldToScreenPx(world: Vec3, clientX: number, clientY: number): number | null {
    if (!this.ctx) return null;
    const camera = this.ctx.getActiveCamera();
    const rect   = this.ctx.domElement.getBoundingClientRect();

    const v3 = new Vector3(world.x, world.y, world.z);
    v3.project(camera);

    const sx = (v3.x *  0.5 + 0.5) * rect.width  + rect.left;
    const sy = (v3.y * -0.5 + 0.5) * rect.height + rect.top;
    return Math.sqrt((sx - clientX) ** 2 + (sy - clientY) ** 2);
  }

  // ── Draft visual ───────────────────────────────────────────────────────────

  private rebuildDraftVisual(cursor: Vec3 | null, snapActive: boolean, showClose = false): void {
    this.clearDraftVisual();
    if (!this.rootGroup) return;

    const { draftVertices } = usePolyAnnotStore.getState();
    if (draftVertices.length === 0) return;

    const g = buildDraftPreview(draftVertices, cursor, snapActive);
    if (showClose) g.add(buildCloseIndicator(draftVertices[0]));

    this.draftGroup = g;
    this.rootGroup.add(g);
  }

  private clearDraftVisual(): void {
    if (this.draftGroup && this.rootGroup) {
      disposeGroup(this.draftGroup);
      this.rootGroup.remove(this.draftGroup);
      this.draftGroup = null;
    }
  }

  // ── Annotation visuals ─────────────────────────────────────────────────────

  private rebuildAnnotationVisual(ann: PolygonAnnotation, layerColor: string): void {
    this.removeAnnotationVisual(ann.id);
    if (!this.rootGroup) return;

    const group = buildPolygonGroup(ann.vertices, layerColor);
    group.visible = ann.visible;
    group.userData.annotationId = ann.id;
    this.annotationGroups.set(ann.id, group);
    this.rootGroup.add(group);
  }

  private removeAnnotationVisual(id: string): void {
    const group = this.annotationGroups.get(id);
    if (group) {
      disposeGroup(group);
      this.rootGroup?.remove(group);
      this.annotationGroups.delete(id);
    }
  }
}
