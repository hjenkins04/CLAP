import { Box3, Vector3, Matrix4 } from 'three';
import type { PointCloudOctree } from 'potree-core';
import { ClipMode } from 'potree-core';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { useRoiStore, type RoiPhase, type RoiDrawTool, type RoiEditSubMode } from './roi-store';
import { useViewerModeStore } from '@/app/stores';
import { editorShapesToClipRegions } from './roi-clip-adapter';
import { RoiPanel } from './roi-panel';
import { setRoiPluginRef } from './roi-plugin-ref';
import {
  ShapeEditorEngine,
  type EditorShape,
  type SelectSubMode,
  type TransformMode,
} from '../../modules/shape-editor';

export class RoiSelectionPlugin implements ViewerPlugin {
  readonly id = 'roi-selection';
  readonly name = 'ROI Selection';
  readonly order = 90;
  readonly SidebarPanel = RoiPanel;
  readonly sidebarTitle = 'ROI';
  readonly sidebarDefaultOpen = false;

  private ctx: ViewerPluginContext | null = null;
  private engine: ShapeEditorEngine | null = null;
  private localBBox: Box3 | null = null;
  private fallbackY = 0;

  private unsubMode: (() => void) | null = null;
  private unsubStore: (() => void) | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;
    setRoiPluginRef(this);

    this.engine = new ShapeEditorEngine(ctx, {
      vertexHandleRadius: 0.09,
      edgeHandleRadius:   0.07,
      faceHandleRadius:   0.08,
      snapToGrid: false,
      showEdgeMidHandles: true,
      showFaceExtrudeHandles: true,
      escapeHandled: true,
      deleteHandled: true,
    });

    // ── Engine event handlers ────────────────────────────────────────────────

    this.engine.on('shape-created', (shape: EditorShape) => {
      const store = useRoiStore.getState();
      store.addShapeId(shape.id);
      // Transition back to editing phase — this fires onPhaseChanged('editing')
      // which puts the engine into select mode.
      store.enterEditing();
      // Select the newly created shape so the user can edit it immediately.
      this.engine!.selectShape(shape.id);
    });

    this.engine.on('shape-updated', () => {
      if (useRoiStore.getState().clipEnabled) {
        this.applyClipRegionsFromEngine();
      }
    });

    this.engine.on('shape-deleted', ({ id }) => {
      useRoiStore.getState().removeShapeId(id);
    });

    this.engine.on('selection-changed', (sel) => {
      useRoiStore.getState().setSelectionInfo({
        shapes: sel.shapes.size,
        elements: sel.elements.length,
      });
    });

    this.engine.on('draw-cancelled', () => {
      const store = useRoiStore.getState();
      if (store.phase === 'drawing') {
        store.enterEditing();
      }
    });

    // ── Mode store subscription ──────────────────────────────────────────────

    this.unsubMode = useViewerModeStore.subscribe((state, prev) => {
      const was = prev.mode === 'roi-selection';
      const is = state.mode === 'roi-selection';
      if (is && !was) this.enterMode();
      else if (!is && was) this.exitMode();
    });

    // ── ROI store subscription ───────────────────────────────────────────────

    this.unsubStore = useRoiStore.subscribe((state, prev) => {
      if (state.phase !== prev.phase) {
        this.onPhaseChanged(state.phase, prev.phase);
      }
      if (state.editSubMode !== prev.editSubMode) {
        this.applyEditSubMode(state.editSubMode);
      }
    });
  }

  onUpdate(delta: number): void {
    this.engine?.onUpdate(delta);
  }

  onPointCloudLoaded(_pco: PointCloudOctree): void {
    this.computeLocalBBox();
    this.updateElevationFn();
  }

  dispose(): void {
    setRoiPluginRef(null);
    this.unsubMode?.();
    this.unsubMode = null;
    this.unsubStore?.();
    this.unsubStore = null;
    this.engine?.dispose();
    this.engine = null;
    this.ctx = null;
  }

  // ── Mode entry / exit ──────────────────────────────────────────────────────

  /**
   * Called when viewer mode changes TO 'roi-selection'.
   * Always brings the engine and store to a clean, known editing state.
   */
  private enterMode(): void {
    this.computeLocalBBox();
    this.updateElevationFn();

    // Bring engine to a neutral state before the store transition fires.
    this.engine?.setModeIdle();

    const store = useRoiStore.getState();

    // If we're re-entering after a clear/redefine, start fresh.
    // editRoi() pre-sets phase='editing' to skip this clear and keep existing shapes.
    if (store.phase !== 'editing') {
      store.clearShapes();
      this.engine?.clearShapes();
    }

    store.enterEditing();

    // Always activate select mode here — onPhaseChanged won't fire when phase was
    // already 'editing' (e.g. coming from editRoi()), so we do it unconditionally.
    this.engine?.startSelect('shape');
  }

  /**
   * Called when viewer mode changes AWAY from 'roi-selection'.
   * Always cleans up the engine regardless of clip state.
   */
  private exitMode(): void {
    // ALWAYS deactivate engine — this hides the gizmo and all edit handles.
    this.engine?.setModeIdle();

    const store = useRoiStore.getState();

    if (store.clipEnabled) {
      // Clip was applied — keep shapes but mark as applied and reset edit state.
      store.setPhase('applied');
    } else {
      // Exited without applying — full cleanup.
      this.clearClipRegions();
      this.engine?.clearShapes();
      store.resetToIdle();
    }
  }

  // ── Phase change handler ───────────────────────────────────────────────────

  /**
   * Drives the engine when the ROI phase changes.
   * This is the single authoritative place that maps phase → engine state.
   */
  private onPhaseChanged(phase: RoiPhase, _prev: RoiPhase): void {
    switch (phase) {
      case 'editing':
        // Enter select mode with 'shape' sub-mode (editSubMode was reset by enterEditing).
        this.engine?.startSelect('shape');
        break;

      case 'drawing':
        // Draw tool is activated via startDrawingTool() — engine handles it there.
        // Nothing extra needed here.
        break;

      case 'applied':
        // Clear any vertex/edge/face selection, then go idle (removes gizmo + handles).
        this.engine?.clearSelection();
        this.engine?.setModeIdle();
        break;

      case 'idle':
        this.engine?.setModeIdle();
        break;
    }
  }

  // ── Public API (called by UI / hotkeys) ───────────────────────────────────

  startDrawingTool(tool: RoiDrawTool): void {
    if (!this.engine) return;
    const store = useRoiStore.getState();
    if (store.phase !== 'editing') return; // guard: only draw when in editing phase
    store.setActiveTool(tool);
    store.setPhase('drawing');
    switch (tool) {
      case 'box':      this.engine.startDrawBox();      break;
      case 'polygon':  this.engine.startDrawPolygon();  break;
      case 'polyline': this.engine.startDrawPolyline(); break;
    }
  }

  cancelDraw(): void {
    this.engine?.cancelDraw();
    // draw-cancelled event will call store.enterEditing()
  }

  removeLastShape(): void {
    const { shapeIds } = useRoiStore.getState();
    if (shapeIds.length === 0) return;
    const lastId = shapeIds[shapeIds.length - 1];
    this.engine?.removeShape(lastId);
    // Store updates via 'shape-deleted' event
  }

  applySelection(): void {
    if (!this.engine) return;
    const store = useRoiStore.getState();
    if (store.shapeCount === 0) return;
    this.applyClipRegionsFromEngine();
    store.setClipEnabled(true);
    // Setting phase to 'applied' triggers onPhaseChanged → engine.setModeIdle()
    store.setPhase('applied');
    // Exit viewer mode — exitMode() in this plugin is also called but is safe
    // (engine is already idle from onPhaseChanged, exitMode is idempotent).
    useViewerModeStore.getState().exitMode();
  }

  cancelSelection(): void {
    this.clearClipRegions();
    this.engine?.clearShapes();
    useRoiStore.getState().resetToIdle();
    useViewerModeStore.getState().exitMode();
  }

  enableClip(): void {
    const store = useRoiStore.getState();
    if (store.shapeCount === 0 || !this.engine) return;
    this.applyClipRegionsFromEngine();
    store.setClipEnabled(true);
    store.setPhase('applied');
  }

  disableClip(): void {
    this.clearClipRegions();
    useRoiStore.getState().setClipEnabled(false);
  }

  toggleClipVisible(): void {
    const store = useRoiStore.getState();
    store.setClipVisible(!store.clipVisible);
  }

  redefine(): void {
    this.clearClipRegions();
    useRoiStore.getState().setClipEnabled(false);
    useViewerModeStore.getState().enterRoiSelectionMode();
  }

  /**
   * Re-enter editing mode while keeping existing shapes intact.
   * Unlike redefine(), this does NOT clear the shapes — the user can adjust
   * vertices, move, and resize the existing ROI without redrawing from scratch.
   */
  editRoi(): void {
    // Pre-set phase to 'editing' so enterMode() skips the shape-clear guard.
    useRoiStore.getState().setPhase('editing');
    useViewerModeStore.getState().enterRoiSelectionMode();
  }

  clearRoi(): void {
    this.clearClipRegions();
    this.engine?.clearShapes();
    useRoiStore.getState().resetToIdle();
  }

  setEditSubMode(mode: RoiEditSubMode): void {
    const store = useRoiStore.getState();
    // Only allow edit sub-mode changes during the editing phase.
    if (store.phase !== 'editing') return;
    store.setEditSubMode(mode);
    // applyEditSubMode fires via store subscription
  }

  // ── Edit sub-mode sync ─────────────────────────────────────────────────────

  private applyEditSubMode(mode: RoiEditSubMode): void {
    if (!this.engine) return;
    // Guard: only apply if actually in editing phase and engine is in select mode.
    const store = useRoiStore.getState();
    if (store.phase !== 'editing') return;

    if (mode === 'translate' || mode === 'rotate' || mode === 'scale') {
      this.engine.startTransform(mode as TransformMode);
    } else {
      // 'shape' | 'vertex' | 'edge' | 'face'
      this.engine.setSubMode(mode as SelectSubMode);
    }
  }

  // ── Clip region management ─────────────────────────────────────────────────

  private applyClipRegionsFromEngine(): void {
    if (!this.ctx || !this.engine) return;
    const shapes = this.engine.getShapes();
    const { boxes, cylinders, polygons } = editorShapesToClipRegions(shapes);
    const hasRegions = boxes.length + cylinders.length + polygons.length > 0;

    for (const pco of this.ctx.getPointClouds()) {
      if (!hasRegions) {
        pco.material.clipMode = ClipMode.DISABLED;
        pco.material.useClipBox = false;
        pco.material.setClipBoxes([]);
        pco.material.setClipPolygons([]);
      } else {
        pco.material.clipMode = ClipMode.CLIP_OUTSIDE;
        pco.material.useClipBox = boxes.length > 0;
        pco.material.setClipBoxes(boxes.length > 0 ? boxes : []);
        // Potree supports one polygon at a time; pass first (if any).
        pco.material.setClipPolygons(polygons.length > 0 ? [polygons[0]] : []);
      }
    }
  }

  private clearClipRegions(): void {
    if (!this.ctx) return;
    for (const pco of this.ctx.getPointClouds()) {
      pco.material.clipMode = ClipMode.DISABLED;
      pco.material.useClipBox = false;
      pco.material.setClipBoxes([]);
      pco.material.setClipPolygons([]);
    }
    useRoiStore.getState().setClipEnabled(false);
  }

  // ── Elevation / bounding box ───────────────────────────────────────────────

  private computeLocalBBox(): void {
    if (!this.ctx) return;
    const pcos = this.ctx.getPointClouds();
    if (pcos.length === 0) return;
    const box = new Box3();
    const tg = this.ctx.getEditor().getTransformGroup();
    tg.updateMatrixWorld(true);
    for (const pco of pcos) {
      const b = pco.pcoGeometry.boundingBox;
      const minW = b.min.clone().add(pco.position).applyMatrix4(tg.matrixWorld);
      const maxW = b.max.clone().add(pco.position).applyMatrix4(tg.matrixWorld);
      box.expandByPoint(minW);
      box.expandByPoint(maxW);
    }
    this.localBBox = box;
    this.fallbackY = (box.min.y + box.max.y) / 2;
  }

  private updateElevationFn(): void {
    if (!this.engine || !this.ctx) return;
    const ctx = this.ctx;
    const getFallbackY = () => this.fallbackY;

    this.engine.setElevationFn((worldX: number, worldZ: number): number => {
      const dem = ctx.getDem();
      if (dem) {
        const tg = ctx.getEditor().getTransformGroup();
        tg.updateMatrixWorld(true);
        const local = new Vector3(worldX, 0, worldZ)
          .applyMatrix4(new Matrix4().copy(tg.matrixWorld).invert());
        const elev = dem.getElevationClamped(local.x, local.z);
        if (elev !== null) return elev as number;
      }
      return getFallbackY();
    });
  }
}
