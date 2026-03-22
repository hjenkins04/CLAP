import {
  Group,
  Object3D,
  Vector2,
  Vector3,
  Box3,
  Matrix4,
  Raycaster,
} from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { PointCloudOctree } from 'potree-core';
import { ClipMode } from 'potree-core';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { useRoiStore, type RoiPhase, type RoiEditSubMode } from './roi-store';
import { useViewerModeStore } from '@/app/stores';
import type { RoiShape, RoiDrawTool } from './roi-types';
import { shapesToClipRegions } from './roi-clip-adapter';
import { buildShapeVisual, buildEditHandles, disposeGroup } from './roi-shape-visuals';
import {
  getShapeCenter,
  getShapeCenterZ,
  getControlPoints,
  translateShape,
  rotateShapeZ,
  moveSelectedPoints,
} from './roi-edit-handles';
import type { ViewCubePlugin } from '../view-cube/view-cube-plugin';

export class RoiSelectionPlugin implements ViewerPlugin {
  readonly id = 'roi-selection';
  readonly name = 'ROI Selection';
  readonly order = 90;

  private ctx: ViewerPluginContext | null = null;
  private visualsGroup: Group | null = null;
  private localBBox: Box3 | null = null;

  private unsubMode: (() => void) | null = null;
  private unsubStore: (() => void) | null = null;
  private listening = false;

  // Drawing state
  private drawStart: Vector3 | null = null;
  private mouseDownPos = new Vector2();
  private previewGroup: Group | null = null;
  private rotationDisabled = false;

  // Extrusion state (box/cylinder height drag)
  private extruding = false;
  private extrudeScreenY = 0;
  private extrudeBaseZ = 0;

  // Editing state (shape manipulation)
  private editGizmo: TransformControls | null = null;
  private editGroup: Group | null = null;
  private shapeAnchor: Object3D | null = null;
  private originalShape: RoiShape | null = null;
  private originalAnchorPos = new Vector3();
  private originalAnchorRotZ = 0;
  private gizmoDragging = false;
  private editListening = false;
  private pointDragOriginShape: RoiShape | null = null;
  private pointDragScreenStart: { x: number; y: number } | null = null;
  private boxSelecting = false;
  private boxSelectScreenStart: { x: number; y: number } | null = null;
  private boxSelectEl: HTMLDivElement | null = null;

  // ---- Lifecycle ----

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;
    this.visualsGroup = new Group();
    this.visualsGroup.visible = false;
    this.visualsGroup.matrixAutoUpdate = false;
    this.visualsGroup.renderOrder = 910;
    ctx.scene.add(this.visualsGroup);

    this.unsubMode = useViewerModeStore.subscribe((state, prev) => {
      const was = prev.mode === 'roi-selection';
      const is = state.mode === 'roi-selection';
      if (is && !was) this.enterMode();
      else if (!is && was) this.exitMode();
    });

    this.unsubStore = useRoiStore.subscribe((state, prev) => {
      if (state.phase !== prev.phase) {
        this.onPhaseChanged(state.phase, prev.phase);
      }
      if (
        state.shapes !== prev.shapes ||
        state.pendingShape !== prev.pendingShape ||
        state.selectedPoints !== prev.selectedPoints
      ) {
        this.rebuildVisuals();
      }
      if (state.editSubMode !== prev.editSubMode) {
        this.onEditSubModeChanged(state.editSubMode);
      }
    });
  }

  onUpdate(_delta: number): void {
    if (!this.ctx) return;
    const tg = this.ctx.getEditor().getTransformGroup();
    tg.updateMatrixWorld(true);

    if (this.visualsGroup?.visible) {
      this.visualsGroup.matrix.copy(tg.matrixWorld);
      this.visualsGroup.matrixWorldNeedsUpdate = true;
    }
    if (this.editGroup) {
      this.editGroup.matrix.copy(tg.matrixWorld);
      this.editGroup.matrixWorldNeedsUpdate = true;
    }
    if (this.editGizmo) {
      const cam = this.ctx.getActiveCamera();
      if (this.editGizmo.camera !== cam) {
        this.editGizmo.camera = cam;
      }
    }
  }

  onPointCloudLoaded(_pco: PointCloudOctree): void {
    this.computeLocalBBox();
  }

  dispose(): void {
    this.exitMode();
    this.stopEditing();
    this.unsubMode?.();
    this.unsubMode = null;
    this.unsubStore?.();
    this.unsubStore = null;
    this.clearVisuals();
    if (this.visualsGroup && this.ctx) {
      this.ctx.scene.remove(this.visualsGroup);
    }
    this.visualsGroup = null;
    this.ctx = null;
  }

  // ---- Mode lifecycle ----

  private enterMode(): void {
    this.computeLocalBBox();
    const store = useRoiStore.getState();
    // If re-entering with an existing applied ROI (redefine), clear old shapes
    store.clearShapes();
    store.setClipEnabled(false);
    store.setPhase('choosing-tool');
    if (this.visualsGroup) this.visualsGroup.visible = true;
  }

  private exitMode(): void {
    this.stopDrawing();
    if (this.rotationDisabled && this.ctx) {
      this.ctx.controls.enableRotate = true;
      this.rotationDisabled = false;
    }
    const store = useRoiStore.getState();
    if (store.clipEnabled) {
      // ROI was applied — keep shapes, clip, and visuals intact
      if (this.visualsGroup) {
        this.visualsGroup.visible = store.clipVisible;
      }
    } else {
      // User cancelled without applying — clean up
      this.clearClipRegions();
      store.clearShapes();
      store.setPhase('idle');
      if (this.visualsGroup) this.visualsGroup.visible = false;
    }
  }

  private onPhaseChanged(phase: RoiPhase, prev: RoiPhase): void {
    if (phase === 'drawing' && prev !== 'drawing') {
      this.startDrawing();
    } else if (prev === 'drawing' && phase !== 'drawing') {
      this.stopDrawing();
    }
    if (phase === 'extruding' && prev !== 'extruding') {
      this.startExtruding();
    } else if (prev === 'extruding' && phase !== 'extruding') {
      this.stopExtruding();
    }
    if (phase === 'editing' && prev !== 'editing') {
      this.startEditing();
    } else if (prev === 'editing' && phase !== 'editing') {
      this.stopEditing();
    }
    if (phase === 'applied') {
      this.applyClipRegions();
    }
  }

  // ---- Public API (called by UI) ----

  startDrawingTool(tool: RoiDrawTool): void {
    const store = useRoiStore.getState();
    store.setActiveTool(tool);
    store.setPendingShape(null);
    store.clearPolyVertices();

    // For 2D tools, snap to top-down view and disable rotation (keep pan/zoom)
    if (tool === 'rect-2d' || tool === 'polygon-2d') {
      const viewCube = this.ctx?.host.getPlugin<ViewCubePlugin>('view-cube');
      viewCube?.snapToTopDown();
      if (this.ctx) {
        this.ctx.controls.enableRotate = false;
        this.rotationDisabled = true;
      }
    }

    store.setPhase('drawing');
  }

  confirmShape(): void {
    const store = useRoiStore.getState();
    if (!store.pendingShape) return;
    store.commitPending();
    store.setPhase('choosing-tool');
  }

  discardShape(): void {
    const store = useRoiStore.getState();
    store.setPendingShape(null);
    store.clearPolyVertices();
    store.setPhase('choosing-tool');
  }

  applySelection(): void {
    const store = useRoiStore.getState();
    if (store.shapes.length === 0) return;
    store.setPhase('applied');
  }

  cancelSelection(): void {
    this.clearClipRegions();
    useViewerModeStore.getState().exitMode();
  }

  /** Enable clip regions (re-apply from stored shapes) */
  enableClip(): void {
    const store = useRoiStore.getState();
    if (store.shapes.length === 0) return;
    this.computeLocalBBox();
    this.applyClipRegionsOnly();
    store.setClipEnabled(true);
    store.setPhase('applied');
    if (this.visualsGroup && store.clipVisible) {
      this.rebuildVisuals();
      this.visualsGroup.visible = true;
    }
  }

  /** Disable clip regions without losing the shape definitions */
  disableClip(): void {
    this.clearClipRegions();
    const store = useRoiStore.getState();
    store.setClipEnabled(false);
    if (this.visualsGroup) this.visualsGroup.visible = false;
  }

  /** Toggle shape visuals visibility */
  toggleClipVisible(): void {
    const store = useRoiStore.getState();
    const next = !store.clipVisible;
    store.setClipVisible(next);
    if (this.visualsGroup) {
      this.visualsGroup.visible = next && store.clipEnabled;
    }
  }

  /** Enter redefine mode — clears old clip and starts fresh drawing */
  redefine(): void {
    this.clearClipRegions();
    useViewerModeStore.getState().enterRoiSelectionMode();
  }

  /** Completely remove the ROI — clear shapes, clip, and visuals */
  clearRoi(): void {
    this.clearClipRegions();
    const store = useRoiStore.getState();
    store.clearShapes();
    store.setClipEnabled(false);
    store.setPhase('idle');
    if (this.visualsGroup) this.visualsGroup.visible = false;
  }

  // ---- Bounding box ----

  private computeLocalBBox(): void {
    if (!this.ctx) return;
    const pcos = this.ctx.getPointClouds();
    if (pcos.length === 0) return;
    const box = new Box3();
    for (const pco of pcos) {
      const b = pco.pcoGeometry.boundingBox;
      box.expandByPoint(b.min.clone().add(pco.position));
      box.expandByPoint(b.max.clone().add(pco.position));
    }
    this.localBBox = box;
  }

  // ---- Drawing ----

  private startDrawing(): void {
    if (this.listening || !this.ctx) return;
    this.listening = true;
    this.drawStart = null;
    this.ctx.domElement.style.cursor = 'crosshair';
    this.ctx.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.ctx.domElement.addEventListener('pointermove', this.onPointerMove);
    this.ctx.domElement.addEventListener('pointerup', this.onPointerUp);
    this.ctx.domElement.addEventListener('dblclick', this.onDoubleClick);
  }

  private stopDrawing(): void {
    if (!this.listening || !this.ctx) return;
    this.listening = false;
    this.drawStart = null;
    this.ctx.domElement.style.cursor = '';
    this.ctx.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.ctx.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.ctx.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.ctx.domElement.removeEventListener('dblclick', this.onDoubleClick);
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return; // left click only
    this.mouseDownPos.set(e.clientX, e.clientY);
    const tool = useRoiStore.getState().activeTool;
    if (tool === 'polygon-2d') return; // polygon uses click-per-vertex
    const hit = this.raycastDrawPlane(e);
    if (hit) this.drawStart = hit;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const store = useRoiStore.getState();
    const tool = store.activeTool;

    if (tool === 'polygon-2d') {
      // Show preview edge from last vertex to cursor
      if (store.polyVertices.length > 0) {
        const hit = this.raycastDrawPlane(e);
        if (hit) this.updatePolygonPreview(store.polyVertices, hit);
      }
      return;
    }

    if (!this.drawStart) return;
    const hit = this.raycastDrawPlane(e);
    if (!hit) return;

    this.updateDragPreview(tool, this.drawStart, hit);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const store = useRoiStore.getState();
    const tool = store.activeTool;

    if (tool === 'polygon-2d') {
      const dx = e.clientX - this.mouseDownPos.x;
      const dy = e.clientY - this.mouseDownPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) return; // was a drag, ignore
      const hit = this.raycastDrawPlane(e);
      if (!hit) return;

      const verts = store.polyVertices;
      // Close polygon if clicking near first vertex (screen distance < 15px)
      if (verts.length >= 3) {
        const firstScreen = this.localToScreen(verts[0].x, verts[0].y);
        if (firstScreen) {
          const dist = Math.sqrt(
            (e.clientX - firstScreen.x) ** 2 + (e.clientY - firstScreen.y) ** 2,
          );
          if (dist < 15) {
            this.finishPolygon(verts);
            return;
          }
        }
      }
      store.addPolyVertex({ x: hit.x, y: hit.y });
      return;
    }

    // For drag-based tools: require minimum drag distance
    if (!this.drawStart) return;
    const hit = this.raycastDrawPlane(e);
    if (!hit) { this.drawStart = null; return; }

    const shape = this.buildFootprint(tool, hit);
    this.drawStart = null;
    if (!shape) return;

    store.setPendingShape(shape);

    // 3D tools → enter extrusion phase, 2D tools → go straight to editing
    if (tool === 'box' || tool === 'cylinder') {
      this.extrudeScreenY = e.clientY;
      this.extrudeBaseZ = hit.z;
      store.setPhase('extruding');
    } else {
      store.setPhase('editing');
    }
  };

  private readonly onDoubleClick = (_e: MouseEvent): void => {
    const store = useRoiStore.getState();
    if (store.activeTool !== 'polygon-2d') return;
    const verts = store.polyVertices;
    if (verts.length >= 3) {
      this.finishPolygon(verts);
    }
  };

  private finishPolygon(verts: Array<{ x: number; y: number }>): void {
    if (verts.length < 3) return;
    const store = useRoiStore.getState();
    const shape: RoiShape = {
      id: store.genId(),
      type: 'polygon-2d',
      vertices: [...verts],
    };
    store.setPendingShape(shape);
    store.setPhase('editing');
  }

  /**
   * Build a 2D footprint shape from the drag. For box/cylinder, the Z extent
   * starts minimal — the user will extrude height in the next phase.
   */
  private buildFootprint(
    tool: RoiDrawTool,
    endLocal: Vector3,
  ): RoiShape | null {
    if (!this.drawStart || !this.localBBox) return null;
    const s = this.drawStart;
    const store = useRoiStore.getState();
    const id = store.genId();
    const baseZ = this.getDrawZ(
      (s.x + endLocal.x) / 2,
      (s.y + endLocal.y) / 2,
    );

    switch (tool) {
      case 'rect-2d': {
        const minX = Math.min(s.x, endLocal.x);
        const maxX = Math.max(s.x, endLocal.x);
        const minY = Math.min(s.y, endLocal.y);
        const maxY = Math.max(s.y, endLocal.y);
        if (maxX - minX < 0.1 || maxY - minY < 0.1) return null;
        return {
          id,
          type: 'rect-2d',
          min: { x: minX, y: minY },
          max: { x: maxX, y: maxY },
        };
      }

      case 'box': {
        const minX = Math.min(s.x, endLocal.x);
        const maxX = Math.max(s.x, endLocal.x);
        const minY = Math.min(s.y, endLocal.y);
        const maxY = Math.max(s.y, endLocal.y);
        if (maxX - minX < 0.1 || maxY - minY < 0.1) return null;
        // Start with zero height — extrusion phase will set it
        return {
          id,
          type: 'box',
          center: {
            x: (minX + maxX) / 2,
            y: (minY + maxY) / 2,
            z: baseZ,
          },
          halfExtents: {
            x: (maxX - minX) / 2,
            y: (maxY - minY) / 2,
            z: 0,
          },
        };
      }

      case 'cylinder': {
        const dx = endLocal.x - s.x;
        const dy = endLocal.y - s.y;
        const radius = Math.sqrt(dx * dx + dy * dy);
        if (radius < 0.1) return null;
        // Start with zero height — extrusion phase will set it
        return {
          id,
          type: 'cylinder',
          center: { x: s.x, y: s.y },
          radius,
          zMin: baseZ,
          zMax: baseZ,
        };
      }

      default:
        return null;
    }
  }

  private updateDragPreview(
    tool: RoiDrawTool,
    start: Vector3,
    end: Vector3,
  ): void {
    if (!this.localBBox) return;
    const store = useRoiStore.getState();
    const id = 'preview';
    const baseZ = this.getDrawZ(
      (start.x + end.x) / 2,
      (start.y + end.y) / 2,
    );

    let shape: RoiShape | null = null;
    switch (tool) {
      case 'rect-2d': {
        shape = {
          id,
          type: 'rect-2d',
          min: { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) },
          max: { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y) },
        };
        break;
      }
      case 'box': {
        const minX = Math.min(start.x, end.x);
        const maxX = Math.max(start.x, end.x);
        const minY = Math.min(start.y, end.y);
        const maxY = Math.max(start.y, end.y);
        // Show flat footprint during drag — extrusion comes next
        shape = {
          id,
          type: 'box',
          center: {
            x: (minX + maxX) / 2,
            y: (minY + maxY) / 2,
            z: baseZ,
          },
          halfExtents: {
            x: (maxX - minX) / 2,
            y: (maxY - minY) / 2,
            z: 0,
          },
        };
        break;
      }
      case 'cylinder': {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const radius = Math.sqrt(dx * dx + dy * dy);
        shape = {
          id,
          type: 'cylinder',
          center: { x: start.x, y: start.y },
          radius,
          zMin: baseZ,
          zMax: baseZ,
        };
        break;
      }
    }

    if (shape) {
      store.setPendingShape(shape);
    }
  }

  private updatePolygonPreview(
    verts: Array<{ x: number; y: number }>,
    cursor: Vector3,
  ): void {
    if (!this.localBBox || verts.length === 0) return;
    const allVerts = [...verts, { x: cursor.x, y: cursor.y }];
    const store = useRoiStore.getState();
    store.setPendingShape({
      id: 'preview',
      type: 'polygon-2d',
      vertices: allVerts,
    });
  }

  // ---- Extrusion (height drag for box/cylinder) ----

  private startExtruding(): void {
    if (!this.ctx) return;
    this.extruding = true;
    this.ctx.domElement.style.cursor = 'ns-resize';
    this.ctx.domElement.addEventListener('pointermove', this.onExtrudeMove);
    this.ctx.domElement.addEventListener('pointerdown', this.onExtrudeUp);
  }

  private stopExtruding(): void {
    if (!this.ctx) return;
    this.extruding = false;
    this.ctx.domElement.style.cursor = '';
    this.ctx.domElement.removeEventListener('pointermove', this.onExtrudeMove);
    this.ctx.domElement.removeEventListener('pointerdown', this.onExtrudeUp);
  }

  private readonly onExtrudeMove = (e: PointerEvent): void => {
    if (!this.extruding) return;
    const store = useRoiStore.getState();
    const pending = store.pendingShape;
    if (!pending) return;

    // Map screen Y delta to local Z height.
    // Moving mouse up (negative dY) = increase height.
    const screenDelta = this.extrudeScreenY - e.clientY;
    // Scale: 1 screen pixel ≈ 0.05 local units — gentle ramp
    const height = Math.max(0, Math.abs(screenDelta) * 0.05);
    const direction = screenDelta >= 0 ? 1 : -1;

    if (pending.type === 'box') {
      const halfZ = height / 2;
      store.setPendingShape({
        ...pending,
        center: {
          ...pending.center,
          z: this.extrudeBaseZ + (direction * halfZ),
        },
        halfExtents: {
          ...pending.halfExtents,
          z: halfZ,
        },
      });
    } else if (pending.type === 'cylinder') {
      const zMin = direction >= 0
        ? this.extrudeBaseZ
        : this.extrudeBaseZ - height;
      const zMax = direction >= 0
        ? this.extrudeBaseZ + height
        : this.extrudeBaseZ;
      store.setPendingShape({
        ...pending,
        zMin,
        zMax,
      });
    }
  };

  private readonly onExtrudeUp = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const store = useRoiStore.getState();
    const pending = store.pendingShape;
    if (!pending) return;

    // Require minimum height
    const hasHeight =
      (pending.type === 'box' && pending.halfExtents.z > 0.05) ||
      (pending.type === 'cylinder' && (pending.zMax - pending.zMin) > 0.1);

    if (hasHeight) {
      store.setPhase('editing');
    }
    // If too small, stay in extruding — user needs to move more
  };

  // ---- Shape Editing (gizmo + control point manipulation) ----

  private startEditing(): void {
    if (!this.ctx) return;
    const store = useRoiStore.getState();
    store.setEditSubMode('translate');
    store.clearSelectedPoints();
    this.setupGizmo();
    this.startEditListeners();
  }

  private stopEditing(): void {
    this.stopEditListeners();
    this.teardownGizmo();
    this.removeBoxSelectOverlay();
    useRoiStore.getState().clearSelectedPoints();
  }

  private setupGizmo(): void {
    if (!this.ctx) return;
    const pending = useRoiStore.getState().pendingShape;
    if (!pending) return;

    // Local-space group mirroring the transform group's world matrix
    this.editGroup = new Group();
    this.editGroup.matrixAutoUpdate = false;
    const tg = this.ctx.getEditor().getTransformGroup();
    tg.updateMatrixWorld(true);
    this.editGroup.matrix.copy(tg.matrixWorld);
    this.ctx.scene.add(this.editGroup);

    // Position anchor at shape center in local space
    this.shapeAnchor = new Object3D();
    const center = getShapeCenter(pending);
    const centerZ = getShapeCenterZ(pending);
    const z = centerZ !== 0 ? centerZ : this.getDrawZ(center.x, center.y);
    this.shapeAnchor.position.set(center.x, center.y, z);
    this.editGroup.add(this.shapeAnchor);

    // TransformControls gizmo
    this.editGizmo = new TransformControls(
      this.ctx.getActiveCamera(),
      this.ctx.domElement,
    );
    this.editGizmo.attach(this.shapeAnchor);
    this.editGizmo.setMode('translate');
    this.editGizmo.setSpace('local');
    this.ctx.scene.add(this.editGizmo);

    this.editGizmo.addEventListener(
      'dragging-changed',
      this.onGizmoDragChanged,
    );
    this.editGizmo.addEventListener('objectChange', this.onGizmoObjectChange);
  }

  private teardownGizmo(): void {
    if (this.editGizmo) {
      this.editGizmo.removeEventListener(
        'dragging-changed',
        this.onGizmoDragChanged,
      );
      this.editGizmo.removeEventListener(
        'objectChange',
        this.onGizmoObjectChange,
      );
      this.editGizmo.detach();
      this.ctx?.scene.remove(this.editGizmo);
      this.editGizmo.dispose();
      this.editGizmo = null;
    }
    if (this.editGroup) {
      this.ctx?.scene.remove(this.editGroup);
      this.editGroup = null;
    }
    this.shapeAnchor = null;
    this.originalShape = null;
    this.gizmoDragging = false;
  }

  private syncAnchorToShape(): void {
    if (!this.shapeAnchor) return;
    const pending = useRoiStore.getState().pendingShape;
    if (!pending) return;
    const center = getShapeCenter(pending);
    const centerZ = getShapeCenterZ(pending);
    // 3D shapes store absolute Z in PCO local space; 2D shapes use DEM
    const z = centerZ !== 0 ? centerZ : this.getDrawZ(center.x, center.y);
    this.shapeAnchor.position.set(center.x, center.y, z);
    this.shapeAnchor.rotation.set(0, 0, 0);
  }

  private readonly onGizmoDragChanged = (event: { value: boolean }): void => {
    this.gizmoDragging = event.value;
    if (this.ctx) this.ctx.controls.enabled = !event.value;

    if (event.value) {
      // Drag started — snapshot the original shape and anchor
      this.originalShape = useRoiStore.getState().pendingShape;
      if (this.shapeAnchor) {
        this.originalAnchorPos.copy(this.shapeAnchor.position);
        this.originalAnchorRotZ = this.shapeAnchor.rotation.z;
      }
    } else {
      // Drag ended — re-sync anchor to updated shape center
      this.originalShape = null;
      this.syncAnchorToShape();
    }
  };

  private readonly onGizmoObjectChange = (): void => {
    if (!this.originalShape || !this.shapeAnchor) return;
    const store = useRoiStore.getState();
    const subMode = store.editSubMode;
    const dx = this.shapeAnchor.position.x - this.originalAnchorPos.x;
    const dy = this.shapeAnchor.position.y - this.originalAnchorPos.y;
    const dz = this.shapeAnchor.position.z - this.originalAnchorPos.z;

    if (subMode === 'points') {
      // Move only the selected control points
      const updated = moveSelectedPoints(
        this.originalShape,
        store.selectedPoints,
        dx,
        dy,
      );
      store.setPendingShape(updated);
    } else if (subMode === 'translate') {
      store.setPendingShape(translateShape(this.originalShape, dx, dy, dz));
    } else if (subMode === 'rotate') {
      const deltaRot =
        this.shapeAnchor.rotation.z - this.originalAnchorRotZ;
      const center = getShapeCenter(this.originalShape);
      store.setPendingShape(
        rotateShapeZ(this.originalShape, deltaRot, center.x, center.y),
      );
    }
  };

  private onEditSubModeChanged(subMode: RoiEditSubMode): void {
    if (!this.editGizmo) return;
    if (subMode === 'translate') {
      this.editGizmo.size = 1;
      this.editGizmo.visible = true;
      this.editGizmo.enabled = true;
      this.editGizmo.setMode('translate');
      this.syncAnchorToShape();
    } else if (subMode === 'rotate') {
      this.editGizmo.size = 1;
      this.editGizmo.visible = true;
      this.editGizmo.enabled = true;
      this.editGizmo.setMode('rotate');
      this.syncAnchorToShape();
    } else {
      // 'points' — mini gizmo at selection, or hidden if no selection
      this.editGizmo.setMode('translate');
      this.editGizmo.size = 0.4;
      const { pendingShape, selectedPoints } = useRoiStore.getState();
      if (pendingShape) {
        this.syncPointsGizmo(pendingShape, selectedPoints);
      }
    }
  }

  /**
   * In points mode: show a small translate gizmo at the centroid of
   * selected control points, or hide it if nothing is selected.
   */
  private syncPointsGizmo(
    shape: RoiShape,
    selectedIndices: number[],
  ): void {
    if (!this.editGizmo || !this.shapeAnchor) return;
    const subMode = useRoiStore.getState().editSubMode;
    if (subMode !== 'points') return;

    if (selectedIndices.length === 0) {
      this.editGizmo.visible = false;
      this.editGizmo.enabled = false;
      return;
    }

    // Compute centroid of selected points
    const points = getControlPoints(shape);
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let count = 0;
    let hasExplicitZ = false;
    for (const idx of selectedIndices) {
      if (idx < points.length) {
        cx += points[idx].x;
        cy += points[idx].y;
        if (points[idx].z !== undefined) {
          cz += points[idx].z!;
          hasExplicitZ = true;
        }
        count++;
      }
    }
    if (count === 0) return;
    cx /= count;
    cy /= count;
    cz /= count;

    this.shapeAnchor.position.set(cx, cy, hasExplicitZ ? cz : this.getDrawZ(cx, cy));
    this.shapeAnchor.rotation.set(0, 0, 0);
    this.editGizmo.visible = true;
    this.editGizmo.enabled = true;
  }

  // ---- Edit Point Listeners ----

  private startEditListeners(): void {
    if (this.editListening || !this.ctx) return;
    this.editListening = true;
    this.ctx.domElement.addEventListener('pointerdown', this.onEditPointerDown);
    this.ctx.domElement.addEventListener('pointermove', this.onEditPointerMove);
    this.ctx.domElement.addEventListener('pointerup', this.onEditPointerUp);
  }

  private stopEditListeners(): void {
    if (!this.editListening || !this.ctx) return;
    this.editListening = false;
    this.ctx.domElement.removeEventListener(
      'pointerdown',
      this.onEditPointerDown,
    );
    this.ctx.domElement.removeEventListener(
      'pointermove',
      this.onEditPointerMove,
    );
    this.ctx.domElement.removeEventListener('pointerup', this.onEditPointerUp);
  }

  private readonly onEditPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const store = useRoiStore.getState();
    if (store.editSubMode !== 'points') return;
    if (this.gizmoDragging) return;
    const pending = store.pendingShape;
    if (!pending) return;

    const hitIdx = this.hitTestHandle(e, pending);
    if (hitIdx !== null) {
      // Clicked on a handle
      if (e.ctrlKey || e.metaKey) {
        store.toggleSelectedPoint(hitIdx);
      } else if (!store.selectedPoints.includes(hitIdx)) {
        store.setSelectedPoints([hitIdx]);
      }
      // Start point drag
      this.pointDragOriginShape = pending;
      this.pointDragScreenStart = { x: e.clientX, y: e.clientY };
    } else {
      // Empty space → start box select
      if (!e.ctrlKey && !e.metaKey) {
        store.clearSelectedPoints();
      }
      this.boxSelecting = true;
      this.boxSelectScreenStart = { x: e.clientX, y: e.clientY };
      this.showBoxSelectOverlay(e.clientX, e.clientY, e.clientX, e.clientY);
    }
  };

  private readonly onEditPointerMove = (e: PointerEvent): void => {
    const store = useRoiStore.getState();
    if (store.editSubMode !== 'points') return;

    if (this.pointDragOriginShape && this.pointDragScreenStart) {
      // Dragging selected points
      const dx = e.clientX - this.pointDragScreenStart.x;
      const dy = e.clientY - this.pointDragScreenStart.y;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return; // deadzone

      const origHit = this.raycastAtScreen(
        this.pointDragScreenStart.x,
        this.pointDragScreenStart.y,
      );
      const curHit = this.raycastAtScreen(e.clientX, e.clientY);
      if (!origHit || !curHit) return;

      const localDx = curHit.x - origHit.x;
      const localDy = curHit.y - origHit.y;
      const updated = moveSelectedPoints(
        this.pointDragOriginShape,
        store.selectedPoints,
        localDx,
        localDy,
      );
      store.setPendingShape(updated);
    } else if (this.boxSelecting && this.boxSelectScreenStart) {
      this.showBoxSelectOverlay(
        this.boxSelectScreenStart.x,
        this.boxSelectScreenStart.y,
        e.clientX,
        e.clientY,
      );
    }
  };

  private readonly onEditPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const store = useRoiStore.getState();

    if (this.pointDragOriginShape) {
      this.pointDragOriginShape = null;
      this.pointDragScreenStart = null;
    }

    if (this.boxSelecting && this.boxSelectScreenStart) {
      const pending = store.pendingShape;
      if (pending) {
        const selected = this.getPointsInScreenRect(
          pending,
          this.boxSelectScreenStart.x,
          this.boxSelectScreenStart.y,
          e.clientX,
          e.clientY,
        );
        if (e.ctrlKey || e.metaKey) {
          const current = new Set(store.selectedPoints);
          for (const idx of selected) current.add(idx);
          store.setSelectedPoints([...current]);
        } else {
          store.setSelectedPoints(selected);
        }
      }
      this.boxSelecting = false;
      this.boxSelectScreenStart = null;
      this.hideBoxSelectOverlay();
    }
  };

  /** Screen-space hit test: find handle closest to pointer within threshold. */
  private hitTestHandle(e: PointerEvent, shape: RoiShape): number | null {
    const points = getControlPoints(shape);
    const threshold = 15;
    let closest: number | null = null;
    let closestDist = threshold;

    for (let i = 0; i < points.length; i++) {
      const screen = this.localToScreen(points[i].x, points[i].y);
      if (!screen) continue;
      const dist = Math.sqrt(
        (e.clientX - screen.x) ** 2 + (e.clientY - screen.y) ** 2,
      );
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    }
    return closest;
  }

  /** Find control point indices within a screen-space rectangle. */
  private getPointsInScreenRect(
    shape: RoiShape,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): number[] {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    const points = getControlPoints(shape);
    const result: number[] = [];

    for (let i = 0; i < points.length; i++) {
      const screen = this.localToScreen(points[i].x, points[i].y);
      if (!screen) continue;
      if (
        screen.x >= minX &&
        screen.x <= maxX &&
        screen.y >= minY &&
        screen.y <= maxY
      ) {
        result.push(i);
      }
    }
    return result;
  }

  // ---- Box select overlay (DOM) ----

  private showBoxSelectOverlay(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): void {
    if (!this.boxSelectEl) {
      this.boxSelectEl = document.createElement('div');
      this.boxSelectEl.style.position = 'fixed';
      this.boxSelectEl.style.border = '1px dashed rgba(34, 170, 255, 0.8)';
      this.boxSelectEl.style.backgroundColor = 'rgba(34, 170, 255, 0.1)';
      this.boxSelectEl.style.pointerEvents = 'none';
      this.boxSelectEl.style.zIndex = '1000';
      document.body.appendChild(this.boxSelectEl);
    }
    this.boxSelectEl.style.display = 'block';
    this.boxSelectEl.style.left = `${Math.min(x1, x2)}px`;
    this.boxSelectEl.style.top = `${Math.min(y1, y2)}px`;
    this.boxSelectEl.style.width = `${Math.abs(x2 - x1)}px`;
    this.boxSelectEl.style.height = `${Math.abs(y2 - y1)}px`;
  }

  private hideBoxSelectOverlay(): void {
    if (this.boxSelectEl) {
      this.boxSelectEl.style.display = 'none';
    }
  }

  private removeBoxSelectOverlay(): void {
    if (this.boxSelectEl) {
      this.boxSelectEl.remove();
      this.boxSelectEl = null;
    }
  }

  // ---- Raycasting ----

  /**
   * Get the draw-plane Z for a given (x,y) in local space.
   * Uses DEM elevation when available, otherwise falls back to bbox midpoint.
   */
  private getDrawZ(x: number, y: number): number {
    const dem = this.ctx?.getDem();
    if (dem) {
      const z = dem.getElevation(x, y);
      if (z !== null) return z;
    }
    return this.localBBox
      ? (this.localBBox.min.z + this.localBBox.max.z) / 2
      : 0;
  }

  private raycastDrawPlane(e: PointerEvent): Vector3 | null {
    return this.raycastAtScreen(e.clientX, e.clientY);
  }

  private raycastAtScreen(clientX: number, clientY: number): Vector3 | null {
    if (!this.ctx || !this.localBBox) return null;

    const camera = this.ctx.getActiveCamera();
    const rect = this.ctx.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );

    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, camera);

    const tg = this.ctx.getEditor().getTransformGroup();
    tg.updateMatrixWorld(true);
    const worldMat = tg.matrixWorld;
    const inverseMat = worldMat.clone().invert();

    // Transform ray into local space
    const localOrigin = raycaster.ray.origin.clone().applyMatrix4(inverseMat);
    const localDir = raycaster.ray.direction
      .clone()
      .transformDirection(inverseMat)
      .normalize();

    // First pass: intersect flat plane at DEM mean or bbox midpoint
    // to get an approximate (x,y), then refine Z from the DEM.
    const zGuess = this.getDrawZ(0, 0);
    if (Math.abs(localDir.z) < 1e-8) return null;
    const t = (zGuess - localOrigin.z) / localDir.z;
    if (t < 0) return null;
    const hit = localOrigin.clone().addScaledVector(localDir, t);

    // Refine: look up actual DEM elevation at the hit (x,y),
    // then re-intersect at that Z for a more accurate position.
    const demZ = this.getDrawZ(hit.x, hit.y);
    if (Math.abs(demZ - zGuess) > 0.01) {
      const t2 = (demZ - localOrigin.z) / localDir.z;
      if (t2 > 0) {
        hit.copy(localOrigin).addScaledVector(localDir, t2);
        hit.z = demZ;
      }
    } else {
      hit.z = demZ;
    }

    return hit;
  }

  private localToScreen(lx: number, ly: number): { x: number; y: number } | null {
    if (!this.ctx || !this.localBBox) return null;
    const tg = this.ctx.getEditor().getTransformGroup();
    const z = this.getDrawZ(lx, ly);
    const worldPos = new Vector3(lx, ly, z).applyMatrix4(tg.matrixWorld);
    const camera = this.ctx.getActiveCamera();
    const ndc = worldPos.project(camera);
    const rect = this.ctx.domElement.getBoundingClientRect();
    return {
      x: ((ndc.x + 1) / 2) * rect.width + rect.left,
      y: ((-ndc.y + 1) / 2) * rect.height + rect.top,
    };
  }

  // ---- Visuals ----

  private rebuildVisuals(): void {
    this.clearVisuals();
    if (!this.visualsGroup || !this.localBBox) return;

    const { shapes, pendingShape, phase, selectedPoints } =
      useRoiStore.getState();
    const getZ = (x: number, y: number) => this.getDrawZ(x, y);

    for (const shape of shapes) {
      const vis = buildShapeVisual(shape, getZ, false);
      this.visualsGroup.add(vis);
    }

    if (pendingShape) {
      const isEditPhase = phase === 'editing';
      const vis = buildShapeVisual(pendingShape, getZ, true, isEditPhase);
      this.previewGroup = vis;
      this.visualsGroup.add(vis);

      // Show small edit handles at each control point during editing
      if (isEditPhase) {
        const points = getControlPoints(pendingShape);
        const handles = buildEditHandles(points, getZ, selectedPoints);
        this.visualsGroup.add(handles);

        // Position mini gizmo at selection centroid (points mode)
        this.syncPointsGizmo(pendingShape, selectedPoints);
      }
    }
  }

  private clearVisuals(): void {
    if (!this.visualsGroup) return;
    while (this.visualsGroup.children.length > 0) {
      const child = this.visualsGroup.children[0];
      this.visualsGroup.remove(child);
      if (child instanceof Group) disposeGroup(child);
    }
    this.previewGroup = null;
  }

  // ---- Clip regions ----

  /** Apply clip regions from stored shapes and exit ROI mode */
  private applyClipRegions(): void {
    this.applyClipRegionsOnly();
    this.stopDrawing();
    if (this.rotationDisabled && this.ctx) {
      this.ctx.controls.enableRotate = true;
      this.rotationDisabled = false;
    }

    const store = useRoiStore.getState();
    store.setClipEnabled(true);
    store.setClipVisible(true);

    if (this.visualsGroup) this.visualsGroup.visible = true;
    // Exit the ROI mode — shapes and clip persist in the background
    useViewerModeStore.getState().exitMode();
  }

  /** Set clip boxes/cylinders on point cloud materials (no mode change) */
  private applyClipRegionsOnly(): void {
    if (!this.ctx || !this.localBBox) return;
    const { shapes } = useRoiStore.getState();
    if (shapes.length === 0) return;

    const tg = this.ctx.getEditor().getTransformGroup();
    tg.updateMatrixWorld(true);
    const { boxes, cylinders, polygons } = shapesToClipRegions(
      shapes,
      this.localBBox,
      tg.matrixWorld,
    );

    for (const pco of this.ctx.getPointClouds()) {
      pco.material.clipMode = ClipMode.CLIP_OUTSIDE;
      if (boxes.length > 0) {
        pco.material.useClipBox = true;
        pco.material.setClipBoxes(boxes);
      }
      if (cylinders.length > 0 && typeof pco.material.setClipCylinders === 'function') {
        pco.material.useClipCylinder = true;
        pco.material.setClipCylinders(cylinders);
      }
      if (polygons.length > 0 && typeof pco.material.setClipPolygons === 'function') {
        pco.material.useClipPolygon = true;
        pco.material.setClipPolygons(polygons);
      }
    }
  }

  private clearClipRegions(): void {
    if (!this.ctx) return;
    for (const pco of this.ctx.getPointClouds()) {
      pco.material.clipMode = ClipMode.DISABLED;
      pco.material.useClipBox = false;
      pco.material.setClipBoxes([]);
      if (typeof pco.material.setClipCylinders === 'function') {
        pco.material.useClipCylinder = false;
        pco.material.setClipCylinders([]);
      }
      if (typeof pco.material.setClipPolygons === 'function') {
        pco.material.useClipPolygon = false;
        pco.material.setClipPolygons([]);
      }
    }
  }
}
