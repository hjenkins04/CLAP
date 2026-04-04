import {
  Group,
  Mesh,
  Vector2,
  Vector3,
  Raycaster,
  Matrix4,
  PerspectiveCamera,
  LineSegments,
} from 'three';
import type { PointCloudOctree } from 'potree-core';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { useStaticObstacleStore } from './static-obstacle-store';
import { useViewerModeStore } from '@/app/stores';
import type { Annotate3DPhase, NormalFace } from './static-obstacle-types';
import {
  buildBoxGroup,
  buildFacePickMeshes,
  buildAnnotationGroup,
  disposeGroup,
  attachArrow,
} from './static-obstacle-visuals';
import { StaticObstaclePanel } from './static-obstacle-panel';

export class StaticObstaclePlugin implements ViewerPlugin {
  readonly id = 'static-obstacle';
  readonly name = 'Static Obstacles';
  readonly order = 8;
  readonly SidebarPanel = StaticObstaclePanel;
  readonly sidebarTitle = 'Static Obstacles';
  readonly sidebarDefaultOpen = false;

  private ctx: ViewerPluginContext | null = null;
  private rootGroup: Group | null = null;

  // Committed annotation visuals
  private annotationGroups = new Map<string, Group>();

  // Pending draw state
  private drawStart: Vector3 | null = null; // scene world space
  private drawGroundY = 0;
  private extrudeStartScreenY = 0;
  private pendingCenterX = 0;
  private pendingCenterY = 0;
  private pendingCenterZ = 0;
  private pendingHalfX = 0;
  private pendingHalfY = 0.1;
  private pendingHalfZ = 0;

  // Three.js groups for pending interaction
  private pendingGroup: Group | null = null;
  private facePickGroup: Group | null = null;

  private listening = false;
  private fallbackElevY = 0;

  private unsubMode: (() => void) | null = null;
  private unsubStore: (() => void) | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;

    this.rootGroup = new Group();
    this.rootGroup.name = 'static-obstacles';
    ctx.worldRoot.add(this.rootGroup);

    this.rebuildAnnotations();

    this.unsubMode = useViewerModeStore.subscribe((state, prev) => {
      const was = prev.mode === 'static-obstacle';
      const is = state.mode === 'static-obstacle';
      if (is && !was) this.enterMode();
      else if (!is && was) this.exitMode();
    });

    this.unsubStore = useStaticObstacleStore.subscribe((state, prev) => {
      if (state.phase !== prev.phase) {
        this.onPhaseChanged(state.phase);
      }
      if (state.annotations !== prev.annotations || state.layers !== prev.layers) {
        this.rebuildAnnotations();
      }
    });
  }

  onPointCloudLoaded(_pco: PointCloudOctree): void {
    this.computeFallbackElevY();
  }

  dispose(): void {
    this.stopListening();
    this.clearPendingVisuals();
    this.unsubMode?.();
    this.unsubMode = null;
    this.unsubStore?.();
    this.unsubStore = null;
    this.clearAllAnnotationGroups();
    if (this.ctx && this.rootGroup) {
      this.ctx.worldRoot.remove(this.rootGroup);
    }
    this.rootGroup = null;
    this.ctx = null;
  }

  // ── Mode lifecycle ─────────────────────────────────────────────────────────

  private enterMode(): void {
    this.computeFallbackElevY();
    const store = useStaticObstacleStore.getState();
    if (store.layers.length === 0 || !store.activeLayerId) {
      store.setPhase('idle');
      // Trigger overlay to show "create a layer first" message by staying in mode
      return;
    }
    store.setPhase('drawing-base');
  }

  private exitMode(): void {
    this.stopListening();
    this.clearPendingVisuals();
    useStaticObstacleStore.getState().setPendingBox(null);
    useStaticObstacleStore.getState().setPhase('idle');
  }

  private onPhaseChanged(phase: Annotate3DPhase): void {
    switch (phase) {
      case 'drawing-base':
        this.clearPendingVisuals();
        this.drawStart = null;
        this.startListening();
        break;
      case 'extruding':
        // Listening continues; pointermove handles height
        break;
      case 'picking-face':
        this.stopListening();
        this.setupFacePicking();
        this.startListening();
        break;
      case 'classifying':
        this.stopListening();
        this.clearFacePickGroup();
        break;
      case 'idle':
        this.stopListening();
        this.clearPendingVisuals();
        this.drawStart = null;
        break;
    }
  }

  // ── Input listeners ────────────────────────────────────────────────────────

  private startListening(): void {
    if (this.listening || !this.ctx) return;
    this.listening = true;
    this.ctx.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.ctx.domElement.addEventListener('pointermove', this.onPointerMove);
    this.ctx.domElement.addEventListener('pointerup', this.onPointerUp);
    this.ctx.domElement.addEventListener('keydown', this.onKeyDown);
  }

  private stopListening(): void {
    if (!this.listening || !this.ctx) return;
    this.listening = false;
    this.ctx.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.ctx.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.ctx.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.ctx.domElement.removeEventListener('keydown', this.onKeyDown);
    this.ctx.domElement.style.cursor = '';
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const phase = useStaticObstacleStore.getState().phase;

    if (phase === 'drawing-base') {
      const hit = this.raycastGround(e.clientX, e.clientY);
      if (!hit) return;
      this.drawStart = hit.clone();
      this.drawGroundY = hit.y;
      if (this.ctx) {
        this.ctx.controls.enabled = false;
        this.ctx.domElement.style.cursor = 'crosshair';
      }
    } else if (phase === 'picking-face') {
      this.tryPickFace(e);
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const phase = useStaticObstacleStore.getState().phase;

    if (phase === 'drawing-base' && this.drawStart) {
      const hit = this.raycastGround(e.clientX, e.clientY);
      if (!hit) return;
      const dx = Math.abs(hit.x - this.drawStart.x);
      const dz = Math.abs(hit.z - this.drawStart.z);
      if (dx < 0.05 && dz < 0.05) return;
      this.pendingCenterX = (this.drawStart.x + hit.x) / 2;
      this.pendingCenterY = this.drawGroundY;
      this.pendingCenterZ = (this.drawStart.z + hit.z) / 2;
      this.pendingHalfX = dx / 2;
      this.pendingHalfY = 0.1;
      this.pendingHalfZ = dz / 2;
      this.updatePendingVisual(null);
    } else if (phase === 'extruding') {
      this.updateExtrusion(e.clientY);
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const phase = useStaticObstacleStore.getState().phase;
    if (this.ctx) this.ctx.controls.enabled = true;

    if (phase === 'drawing-base') {
      if (!this.drawStart) return;
      const hit = this.raycastGround(e.clientX, e.clientY);
      const dx = hit ? Math.abs(hit.x - this.drawStart.x) : 0;
      const dz = hit ? Math.abs(hit.z - this.drawStart.z) : 0;
      if (!hit || (dx < 0.05 && dz < 0.05)) {
        this.drawStart = null;
        this.clearPendingVisuals();
        if (this.ctx) this.ctx.domElement.style.cursor = 'crosshair';
        return;
      }

      this.pendingCenterX = (this.drawStart.x + hit.x) / 2;
      this.pendingCenterY = this.drawGroundY;
      this.pendingCenterZ = (this.drawStart.z + hit.z) / 2;
      this.pendingHalfX = dx / 2;
      this.pendingHalfY = 0.1;
      this.pendingHalfZ = dz / 2;
      this.drawStart = null;
      this.extrudeStartScreenY = e.clientY;

      this.updatePendingVisual(null);
      useStaticObstacleStore.getState().setPendingBox({
        center: { x: this.pendingCenterX, y: this.pendingCenterY, z: this.pendingCenterZ },
        halfExtents: { x: this.pendingHalfX, y: this.pendingHalfY, z: this.pendingHalfZ },
        frontFace: null,
      });
      useStaticObstacleStore.getState().setPhase('extruding');
      if (this.ctx) this.ctx.domElement.style.cursor = 'ns-resize';
    } else if (phase === 'extruding') {
      // Finalise height
      useStaticObstacleStore.getState().setPendingBox({
        center: { x: this.pendingCenterX, y: this.pendingCenterY, z: this.pendingCenterZ },
        halfExtents: { x: this.pendingHalfX, y: this.pendingHalfY, z: this.pendingHalfZ },
        frontFace: null,
      });
      useStaticObstacleStore.getState().setPhase('picking-face');
      if (this.ctx) this.ctx.domElement.style.cursor = 'pointer';
    }
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      const phase = useStaticObstacleStore.getState().phase;
      if (phase !== 'idle') {
        useStaticObstacleStore.getState().discardPending();
        this.clearPendingVisuals();
        this.drawStart = null;
      }
    }
  };

  // ── Extrusion ──────────────────────────────────────────────────────────────

  private updateExtrusion(currentScreenY: number): void {
    if (!this.ctx) return;
    const dPixels = this.extrudeStartScreenY - currentScreenY; // up = positive
    const metersPerPixel = this.computeMetersPerPixel();
    const newHalfY = Math.max(0.05, Math.abs(dPixels) * metersPerPixel);
    const direction = dPixels >= 0 ? 1 : -1;

    this.pendingHalfY = newHalfY;
    // Center shifts up from ground
    this.pendingCenterY = this.drawGroundY + newHalfY * direction;
    this.updatePendingVisual(null);
  }

  private computeMetersPerPixel(): number {
    if (!this.ctx) return 0.01;
    const camera = this.ctx.getActiveCamera();
    const center = new Vector3(this.pendingCenterX, this.pendingCenterY, this.pendingCenterZ);
    const dist = camera.position.distanceTo(center);
    if (camera instanceof PerspectiveCamera) {
      const fovRad = (camera.fov * Math.PI) / 180;
      return (2 * dist * Math.tan(fovRad / 2)) / this.ctx.domElement.clientHeight;
    }
    return 0.01;
  }

  // ── Face picking ───────────────────────────────────────────────────────────

  private setupFacePicking(): void {
    this.clearFacePickGroup();
    if (!this.rootGroup) return;

    const meshes = buildFacePickMeshes({
      x: this.pendingHalfX,
      y: this.pendingHalfY,
      z: this.pendingHalfZ,
    });

    this.facePickGroup = new Group();
    this.facePickGroup.position.set(
      this.pendingCenterX,
      this.pendingCenterY,
      this.pendingCenterZ,
    );
    for (const m of meshes) this.facePickGroup.add(m);
    this.rootGroup.add(this.facePickGroup);
  }

  private tryPickFace(e: PointerEvent): void {
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
    if (hits.length === 0) return;

    const face = hits[0].object.userData.face as NormalFace;
    useStaticObstacleStore.getState().setPendingFace(face);
    this.updatePendingVisual(face);
    useStaticObstacleStore.getState().setPhase('classifying');
    if (this.ctx) this.ctx.domElement.style.cursor = '';
  }

  // ── Ground raycasting ──────────────────────────────────────────────────────

  /** Cast ray and return intersection with ground plane in scene world space. */
  private raycastGround(clientX: number, clientY: number): Vector3 | null {
    if (!this.ctx) return null;
    const camera = this.ctx.getActiveCamera();
    const rect = this.ctx.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, camera);

    const dir = raycaster.ray.direction;
    const origin = raycaster.ray.origin;

    // Estimate ground Y from DEM or fallback
    const elevGuess = this.getGroundElevScene(0, 0);
    if (Math.abs(dir.y) < 1e-8) return null;
    const t = (elevGuess - origin.y) / dir.y;
    if (t < 0) return null;
    const hit = origin.clone().addScaledVector(dir, t);

    // Refine with DEM at hit point
    const demElev = this.getGroundElevScene(hit.x, hit.z);
    if (Math.abs(demElev - elevGuess) > 0.01) {
      const t2 = (demElev - origin.y) / dir.y;
      if (t2 > 0) {
        hit.copy(origin).addScaledVector(dir, t2);
        hit.y = demElev;
      }
    } else {
      hit.y = demElev;
    }
    return hit;
  }

  /**
   * Get ground elevation at a scene-space (x, z) position.
   * Converts to PCO local space for DEM query, falls back to cached value.
   */
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

  // ── Visuals ────────────────────────────────────────────────────────────────

  private updatePendingVisual(selectedFace: NormalFace | null): void {
    if (!this.rootGroup) return;
    if (this.pendingGroup) {
      disposeGroup(this.pendingGroup);
      this.rootGroup.remove(this.pendingGroup);
      this.pendingGroup = null;
    }

    const store = useStaticObstacleStore.getState();
    const layer = store.layers.find((l) => l.id === store.activeLayerId);
    const color = layer?.color ?? '#ffffff';

    this.pendingGroup = buildBoxGroup(
      { x: this.pendingCenterX, y: this.pendingCenterY, z: this.pendingCenterZ },
      { x: this.pendingHalfX, y: this.pendingHalfY, z: this.pendingHalfZ },
      color,
      selectedFace,
      0xffff00,
    );
    this.rootGroup.add(this.pendingGroup);
  }

  private setupFacePickHighlight(face: NormalFace): void {
    // Re-render pending with arrow preview
    this.updatePendingVisual(face);
  }

  private clearFacePickGroup(): void {
    if (this.facePickGroup && this.rootGroup) {
      // dispose invisible meshes
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

  private clearPendingVisuals(): void {
    if (this.pendingGroup && this.rootGroup) {
      disposeGroup(this.pendingGroup);
      this.rootGroup.remove(this.pendingGroup);
      this.pendingGroup = null;
    }
    this.clearFacePickGroup();
  }

  private rebuildAnnotations(): void {
    this.clearAllAnnotationGroups();
    if (!this.rootGroup) return;
    const { annotations, layers } = useStaticObstacleStore.getState();
    const layerMap = new Map(layers.map((l) => [l.id, l]));
    for (const ann of annotations) {
      const layer = layerMap.get(ann.layerId);
      if (!layer) continue;
      const group = buildAnnotationGroup(ann, layer.color);
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
