import { Group, Mesh, Vector2, Vector3, Raycaster, Matrix4 } from 'three';
import type { PointCloudOctree } from 'potree-core';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { useStaticObstacleStore } from './static-obstacle-store';
import type { ObstacleEditSubMode } from './static-obstacle-store';
import { useViewerModeStore } from '@/app/stores';
import type { Annotate3DPhase, NormalFace } from './static-obstacle-types';
import {
  buildAnnotationGroup,
  buildFacePickMeshes,
  setFacePickHover,
  disposeGroup,
} from './static-obstacle-visuals';
import { StaticObstaclePanel } from './static-obstacle-panel';
import {
  ShapeEditorEngine,
  type ObbShape,
  type SelectSubMode,
  type TransformMode,
} from '../../modules/shape-editor';

export class StaticObstaclePlugin implements ViewerPlugin {
  readonly id = 'static-obstacle';
  readonly name = 'Static Obstacles';
  readonly order = 8;
  readonly SidebarPanel = StaticObstaclePanel;
  readonly sidebarTitle = 'Static Obstacles';
  readonly sidebarDefaultOpen = false;

  private ctx: ViewerPluginContext | null = null;
  private rootGroup: Group | null = null;
  private engine: ShapeEditorEngine | null = null;

  // Committed annotation visuals
  private annotationGroups = new Map<string, Group>();

  // Face picking state
  private facePickGroup: Group | null = null;
  private faceListening = false;
  private hoveredFaceMesh: Mesh | null = null;

  private fallbackElevY = 0;

  private unsubMode: (() => void) | null = null;
  private unsubStore: (() => void) | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;

    this.rootGroup = new Group();
    this.rootGroup.name = 'static-obstacles';
    ctx.scene.add(this.rootGroup);

    // Shape-editor engine for drawing + editing the pending OBB
    this.engine = new ShapeEditorEngine(ctx, {
      vertexHandleRadius: 0.03,
      edgeHandleRadius:   0.025,
      faceHandleRadius:   0.03,
      snapToGrid: false,
      showEdgeMidHandles: true,
      showFaceExtrudeHandles: true,
      escapeHandled: false, // plugin handles escape itself
      deleteHandled: false,
    });

    this.engine.setElevationFn((worldX: number, worldZ: number) =>
      this.getGroundElevScene(worldX, worldZ),
    );

    this.engine.on('shape-created', (shape) => {
      if (shape.type !== 'obb') return;
      const store = useStaticObstacleStore.getState();
      store.setPendingShapeId(shape.id);
      store.setPhase('editing');
      this.engine!.startSelect('shape');
      this.engine!.selectShape(shape.id);
    });

    this.rebuildAnnotations();

    this.unsubMode = useViewerModeStore.subscribe((state, prev) => {
      const was = prev.mode === 'static-obstacle';
      const is = state.mode === 'static-obstacle';
      if (is && !was) this.enterMode();
      else if (!is && was) this.exitMode();
    });

    this.unsubStore = useStaticObstacleStore.subscribe((state, prev) => {
      if (state.phase !== prev.phase) {
        this.onPhaseChanged(state.phase, prev.phase);
      }
      if (state.editSubMode !== prev.editSubMode) {
        this.applyEditSubMode(state.editSubMode);
      }
      if (state.annotations !== prev.annotations || state.layers !== prev.layers) {
        this.rebuildAnnotations();
      }
    });
  }

  onUpdate(delta: number): void {
    this.engine?.onUpdate(delta);
  }

  onPointCloudLoaded(_pco: PointCloudOctree): void {
    this.computeFallbackElevY();
    this.updateElevationFn();
  }

  dispose(): void {
    this.stopFaceListening();
    this.clearFacePickGroup();
    this.unsubMode?.();
    this.unsubMode = null;
    this.unsubStore?.();
    this.unsubStore = null;
    this.engine?.dispose();
    this.engine = null;
    this.clearAllAnnotationGroups();
    if (this.ctx && this.rootGroup) {
      this.ctx.scene.remove(this.rootGroup);
    }
    this.rootGroup = null;
    this.ctx = null;
  }

  // ── Mode lifecycle ─────────────────────────────────────────────────────────

  private enterMode(): void {
    this.computeFallbackElevY();
    this.updateElevationFn();
    const store = useStaticObstacleStore.getState();
    this.engine?.clearShapes();
    store.setPendingShapeId(null);
    store.setPendingBox(null);
    if (store.layers.length === 0 || !store.activeLayerId) {
      store.setPhase('idle');
      return;
    }
    store.setPhase('drawing');
    this.engine?.startDrawBox();
  }

  private exitMode(): void {
    this.stopFaceListening();
    this.clearFacePickGroup();
    this.engine?.setModeIdle();
    this.engine?.clearShapes();
    const store = useStaticObstacleStore.getState();
    store.setPendingShapeId(null);
    store.setPendingBox(null);
    store.setPhase('idle');
  }

  // ── Phase transitions ──────────────────────────────────────────────────────

  private onPhaseChanged(phase: Annotate3DPhase, _prev: Annotate3DPhase): void {
    switch (phase) {
      case 'drawing':
        this.stopFaceListening();
        this.clearFacePickGroup();
        this.engine?.clearShapes();
        this.engine?.startDrawBox();
        break;

      case 'editing':
        // engine already switched to select mode in shape-created handler
        break;

      case 'picking-face': {
        this.engine?.setModeIdle();
        this.setupFacePicking();
        this.startFaceListening();
        break;
      }

      case 'classifying':
        this.stopFaceListening();
        this.clearFacePickGroup();
        break;

      case 'idle':
        this.stopFaceListening();
        this.clearFacePickGroup();
        break;
    }
  }

  // ── Public API (called by overlay) ────────────────────────────────────────

  /** Confirm the edited OBB shape and enter face-picking phase. */
  confirmShape(): void {
    const store = useStaticObstacleStore.getState();
    const shapeId = store.pendingShapeId;
    if (!shapeId || !this.engine) return;
    const shape = this.engine.getShape(shapeId);
    if (!shape || shape.type !== 'obb') return;
    const obb = shape as ObbShape;
    store.setPendingBox({
      center: { ...obb.center },
      halfExtents: { ...obb.halfExtents },
      rotationY: obb.rotationY,
      frontFace: null,
    });
    store.setPhase('picking-face');
  }

  /** Discard the current pending shape and restart drawing. */
  discardPendingShape(): void {
    const store = useStaticObstacleStore.getState();
    this.engine?.clearShapes();
    store.setPendingShapeId(null);
    store.setPendingBox(null);
    store.setPhase('drawing');
    this.engine?.startDrawBox();
  }

  /** Update the edit sub-mode on the engine. */
  setEditSubMode(mode: ObstacleEditSubMode): void {
    useStaticObstacleStore.getState().setEditSubMode(mode);
  }

  private applyEditSubMode(mode: ObstacleEditSubMode): void {
    if (!this.engine) return;
    const shapeId = useStaticObstacleStore.getState().pendingShapeId;
    if (!shapeId) return;
    if (mode === 'translate' || mode === 'rotate' || mode === 'scale') {
      this.engine.startTransform(mode as TransformMode);
      // Re-select the pending shape in case it was deselected during vertex/edge/face editing
      if (this.engine.getSelection().shapes.size === 0) {
        this.engine.selectShape(shapeId);
      }
    } else {
      this.engine.setSubMode(mode as SelectSubMode);
    }
  }

  // ── Face picking ───────────────────────────────────────────────────────────

  private setupFacePicking(): void {
    this.clearFacePickGroup();
    if (!this.rootGroup) return;
    const store = useStaticObstacleStore.getState();
    const box = store.pendingBox;
    if (!box) return;

    const meshes = buildFacePickMeshes(box.halfExtents);
    this.facePickGroup = new Group();
    this.facePickGroup.position.set(box.center.x, box.center.y, box.center.z);
    this.facePickGroup.rotation.y = box.rotationY;
    for (const m of meshes) this.facePickGroup.add(m);
    this.rootGroup.add(this.facePickGroup);
  }

  private startFaceListening(): void {
    if (this.faceListening || !this.ctx) return;
    this.faceListening = true;
    this.ctx.domElement.addEventListener('pointerdown', this.onFacePointerDown);
    this.ctx.domElement.addEventListener('pointermove', this.onFacePointerMove);
    this.ctx.domElement.style.cursor = 'pointer';
  }

  private stopFaceListening(): void {
    if (!this.faceListening || !this.ctx) return;
    this.faceListening = false;
    this.ctx.domElement.removeEventListener('pointerdown', this.onFacePointerDown);
    this.ctx.domElement.removeEventListener('pointermove', this.onFacePointerMove);
    this.ctx.domElement.style.cursor = '';
    // Clear any lingering hover highlight
    setFacePickHover(this.hoveredFaceMesh, false);
    this.hoveredFaceMesh = null;
  }

  private readonly onFacePointerMove = (e: PointerEvent): void => {
    if (!this.ctx || !this.facePickGroup) return;
    const camera = this.ctx.getActiveCamera();
    const rect = this.ctx.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(this.facePickGroup.children, false);
    const hit = hits.length > 0 ? (hits[0].object as Mesh) : null;

    if (hit !== this.hoveredFaceMesh) {
      setFacePickHover(this.hoveredFaceMesh, false);
      setFacePickHover(hit, true);
      this.hoveredFaceMesh = hit;
    }
  };

  private readonly onFacePointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.ctx || !this.facePickGroup) return;
    const camera = this.ctx.getActiveCamera();
    const rect = this.ctx.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(this.facePickGroup.children, false);
    if (hits.length === 0) return;

    const face = hits[0].object.userData.face as NormalFace;
    const store = useStaticObstacleStore.getState();
    store.setPendingFace(face);
    store.setPhase('classifying');
  };

  private clearFacePickGroup(): void {
    if (this.facePickGroup && this.rootGroup) {
      this.facePickGroup.children.forEach((child) => {
        if (child instanceof Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      this.rootGroup.remove(this.facePickGroup);
      this.facePickGroup = null;
    }
  }

  // ── Ground elevation ───────────────────────────────────────────────────────

  private getGroundElevScene(sceneX: number, sceneZ: number): number {
    if (!this.ctx) return this.fallbackElevY;
    const dem = this.ctx.getDem();
    if (dem) {
      const tg = this.ctx.getEditor().getTransformGroup();
      tg.updateMatrixWorld(true);
      const invTg = new Matrix4().copy(tg.matrixWorld).invert();
      const local = new Vector3(sceneX, 0, sceneZ).applyMatrix4(invTg);
      const elev = dem.getElevationClamped(local.x, local.z);
      if (elev !== null) return elev as number;
    }
    return this.fallbackElevY;
  }

  private computeFallbackElevY(): void {
    if (!this.ctx) return;
    const pcos = this.ctx.getPointClouds();
    if (pcos.length === 0) return;
    const tg = this.ctx.getEditor().getTransformGroup();
    tg.updateMatrixWorld(true);
    const wm = tg.matrixWorld;
    let totalY = 0;
    let count = 0;
    for (const pco of pcos) {
      const b = pco.pcoGeometry.boundingBox;
      const minWorld = b.min.clone().applyMatrix4(wm);
      const maxWorld = b.max.clone().applyMatrix4(wm);
      totalY += (minWorld.y + maxWorld.y) / 2;
      count++;
    }
    if (count > 0) this.fallbackElevY = totalY / count;
  }

  private updateElevationFn(): void {
    this.engine?.setElevationFn((worldX: number, worldZ: number) =>
      this.getGroundElevScene(worldX, worldZ),
    );
  }

  // ── Annotation visuals ─────────────────────────────────────────────────────

  private rebuildAnnotations(): void {
    this.clearAllAnnotationGroups();
    if (!this.rootGroup) return;
    const { annotations, layers } = useStaticObstacleStore.getState();
    const layerMap = new Map(layers.map((l) => [l.id, l]));
    for (const ann of annotations) {
      const layer = layerMap.get(ann.layerId);
      if (!layer) continue;
      const group = buildAnnotationGroup(ann, layer.color);
      group.rotation.y = ann.rotationY;
      group.visible = ann.visible && layer.visible;
      group.userData.annotationId = ann.id;
      this.rootGroup.add(group);
      this.annotationGroups.set(ann.id, group);
    }
  }

  private clearAllAnnotationGroups(): void {
    if (!this.rootGroup) return;
    for (const group of this.annotationGroups.values()) {
      disposeGroup(group);
      this.rootGroup.remove(group);
    }
    this.annotationGroups.clear();
  }
}
