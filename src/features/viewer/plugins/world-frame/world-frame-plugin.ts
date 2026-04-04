import {
  SphereGeometry,
  MeshBasicMaterial,
  Mesh,
  Raycaster,
  Vector2,
  Vector3,
  Box3,
  Matrix4,
  Ray,
} from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { useWorldFrameStore, type WorldFramePhase } from './world-frame-store';
import { useViewerModeStore } from '@/app/stores';
import { WorldFramePanel } from './world-frame-panel';
import type { ViewCubePlugin } from '../view-cube/view-cube-plugin';

export class WorldFramePlugin implements ViewerPlugin {
  readonly id = 'world-frame';
  readonly name = 'World Frame';
  readonly order = 80;
  readonly SidebarPanel = WorldFramePanel;
  readonly sidebarTitle = 'World Frame';
  readonly sidebarDefaultOpen = false;

  private ctx: ViewerPluginContext | null = null;

  // Anchor markers
  private marker1: Mesh | null = null;
  private marker2: Mesh | null = null;
  private previewMarker: Mesh | null = null;
  private markerBaseRadius = 0.15;

  // Anchor gizmo (edit anchor point in 3D)
  private anchorGizmo: TransformControls | null = null;
  private anchorOrigPc: { x: number; y: number; z: number } | null = null;

  // Subscriptions
  private unsubMode: (() => void) | null = null;
  private unsubPhase: (() => void) | null = null;
  private unsubAnchorEdit: (() => void) | null = null;

  // PC pick state
  private listening = false;
  private mouseDownPos = new Vector2();
  private lastMoveTime = 0;

  // ── Lifecycle ──────────────────────────────────────────────────────

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;

    const sphereGeo = new SphereGeometry(1, 16, 16);

    // Anchor 1 marker (green)
    this.marker1 = new Mesh(
      sphereGeo,
      new MeshBasicMaterial({ color: 0x22c55e, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this.marker1.renderOrder = 999;
    this.marker1.visible = false;
    ctx.worldRoot.add(this.marker1);

    // Anchor 2 marker (blue)
    this.marker2 = new Mesh(
      sphereGeo,
      new MeshBasicMaterial({ color: 0x3b82f6, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this.marker2.renderOrder = 999;
    this.marker2.visible = false;
    ctx.worldRoot.add(this.marker2);

    // Preview marker (semi-transparent yellow)
    this.previewMarker = new Mesh(
      sphereGeo,
      new MeshBasicMaterial({ color: 0xfbbf24, depthTest: false, transparent: true, opacity: 0.45 }),
    );
    this.previewMarker.renderOrder = 998;
    this.previewMarker.visible = false;
    ctx.worldRoot.add(this.previewMarker);

    // Subscribe to anchor-editing flag
    this.unsubAnchorEdit = useWorldFrameStore.subscribe((state, prev) => {
      if (state.editingAnchor !== prev.editingAnchor) {
        if (state.editingAnchor) this.startAnchorEditing();
        else this.stopAnchorEditing();
      }
    });

    // Subscribe to viewer mode
    this.unsubMode = useViewerModeStore.subscribe((state, prev) => {
      const was = prev.mode === 'world-frame';
      const is = state.mode === 'world-frame';
      if (is && !was) this.onEnterMode();
      else if (!is && was) this.onExitMode();
    });

    // Subscribe to phase changes
    this.unsubPhase = useWorldFrameStore.subscribe((state, prev) => {
      if (state.phase !== prev.phase) {
        this.onPhaseChanged(state.phase, prev.phase);
      }
      if (state.previewPcPoint !== prev.previewPcPoint) {
        this.onPreviewChanged(state.previewPcPoint);
      }
      if (state.markersVisible !== prev.markersVisible) {
        this.applyMarkerVisibility(state.markersVisible);
      }
    });

    // Restore markers if world frame was previously confirmed
    const { phase, anchor1, anchor2 } = useWorldFrameStore.getState();
    if (phase === 'confirmed') {
      // Recompute transform from persisted state
      useWorldFrameStore.getState().recomputeTransform();
    }
    if (anchor1 && this.marker1) {
      this.marker1.position.set(anchor1.pc.x, anchor1.pc.y, anchor1.pc.z);
      this.marker1.visible = true;
    }
    if (anchor2 && this.marker2) {
      this.marker2.position.set(anchor2.pc.x, anchor2.pc.y, anchor2.pc.z);
      this.marker2.visible = true;
    }

    // If mode is already active on init
    if (useViewerModeStore.getState().mode === 'world-frame') {
      this.onEnterMode();
    }
  }

  onPointCloudLoaded(): void {
    if (!this.ctx) return;
    const pcos = this.ctx.getPointClouds();
    if (pcos.length === 0) return;

    const box = new Box3();
    for (const pco of pcos) {
      const b = pco.pcoGeometry.boundingBox;
      box.expandByPoint(b.min.clone().add(pco.position));
      box.expandByPoint(b.max.clone().add(pco.position));
    }
    const size = box.getSize(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    this.markerBaseRadius = maxDim * 0.0008;
    this.marker1?.scale.setScalar(this.markerBaseRadius);
    this.marker2?.scale.setScalar(this.markerBaseRadius);
    this.previewMarker?.scale.setScalar(this.markerBaseRadius);
  }

  dispose(): void {
    this.stopListening();
    this.stopAnchorEditing();
    this.unsubMode?.();
    this.unsubPhase?.();
    this.unsubAnchorEdit?.();
    this.unsubMode = null;
    this.unsubPhase = null;
    this.unsubAnchorEdit = null;

    if (this.ctx) {
      if (this.marker1) this.ctx.worldRoot.remove(this.marker1);
      if (this.marker2) this.ctx.worldRoot.remove(this.marker2);
      if (this.previewMarker) this.ctx.worldRoot.remove(this.previewMarker);
    }
    [this.marker1, this.marker2, this.previewMarker].forEach((m) => {
      if (m) (m.material as MeshBasicMaterial).dispose();
    });
    // Shared geometry — dispose once
    this.marker1?.geometry.dispose();
    this.marker1 = null;
    this.marker2 = null;
    this.previewMarker = null;
    this.ctx = null;
  }

  // ── Mode enter/exit ────────────────────────────────────────────────

  private onEnterMode(): void {
    const store = useWorldFrameStore.getState();
    if (store.phase === 'idle' || store.phase === 'confirmed') {
      store.setPhase('map-pick-first');
    }
  }

  private onExitMode(): void {
    const store = useWorldFrameStore.getState();
    if (store.phase !== 'confirmed') {
      store.resetWorldFrame();
    }
    this.stopListening();
    if (this.previewMarker) this.previewMarker.visible = false;
  }

  // ── Phase transitions ──────────────────────────────────────────────

  private onPhaseChanged(phase: WorldFramePhase, _prev: WorldFramePhase): void {
    const viewCube = this.ctx?.host.getPlugin<ViewCubePlugin>('view-cube');
    switch (phase) {
      case 'pc-pick-first':
      case 'pc-pick-second': {
        // Snap camera to top-down for point picking
        viewCube?.snapToTopDown();
        this.startListening();
        break;
      }
      case 'preview':
        this.stopListening();
        // Restore standard Y-up so the user can orbit while reviewing the alignment
        viewCube?.restoreYUp();
        // Compute initial transform for preview
        useWorldFrameStore.getState().recomputeTransform();
        break;
      case 'confirmed':
        this.stopListening();
        viewCube?.restoreYUp();
        break;
      case 'idle':
        this.stopListening();
        viewCube?.restoreYUp();
        if (this.previewMarker) this.previewMarker.visible = false;
        this.marker1!.visible = false;
        this.marker2!.visible = false;
        break;
    }
  }

  private applyMarkerVisibility(visible: boolean): void {
    const { anchor1, anchor2 } = useWorldFrameStore.getState();
    if (this.marker1) this.marker1.visible = visible && !!anchor1;
    if (this.marker2) this.marker2.visible = visible && !!anchor2;
  }

  private onPreviewChanged(pt: { x: number; y: number; z: number } | null): void {
    if (!this.previewMarker) return;
    if (pt) {
      this.previewMarker.position.set(pt.x, pt.y, pt.z);
      this.previewMarker.visible = true;
    } else {
      this.previewMarker.visible = false;
    }
  }

  // ── Public API (called from overlay/panel) ─────────────────────────

  confirmPreview(): void {
    useWorldFrameStore.getState().confirmWorldFrame();
    useViewerModeStore.getState().exitMode();
  }

  cancelWorkflow(): void {
    useWorldFrameStore.getState().resetWorldFrame();
    if (this.marker1) this.marker1.visible = false;
    if (this.marker2) this.marker2.visible = false;
    useViewerModeStore.getState().exitMode();
  }

  redefine(): void {
    if (this.marker1) this.marker1.visible = false;
    if (this.marker2) this.marker2.visible = false;
    useWorldFrameStore.getState().resetWorldFrame();
    useViewerModeStore.getState().enterWorldFrameMode();
  }

  // ── PC Point Picking (mirrors POI pattern) ─────────────────────────

  private startListening(): void {
    if (this.listening || !this.ctx) return;
    this.listening = true;
    this.ctx.domElement.style.cursor = 'crosshair';
    this.ctx.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.ctx.domElement.addEventListener('pointerup', this.onPointerUp);
    this.ctx.domElement.addEventListener('pointermove', this.onPointerMove);
  }

  private stopListening(): void {
    if (!this.listening || !this.ctx) return;
    this.listening = false;
    this.ctx.domElement.style.cursor = '';
    this.ctx.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.ctx.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.ctx.domElement.removeEventListener('pointermove', this.onPointerMove);
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.mouseDownPos.set(e.clientX, e.clientY);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const dx = e.clientX - this.mouseDownPos.x;
    const dy = e.clientY - this.mouseDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) return;
    this.pickPoint(e);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const now = performance.now();
    if (now - this.lastMoveTime < 33) return;
    this.lastMoveTime = now;

    if (!this.ctx) return;
    const camera = this.ctx.getActiveCamera();
    const rect = this.ctx.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hit = this.findClosestPoint(raycaster.ray);
    useWorldFrameStore.getState().setPreviewPcPoint(
      hit ? { x: hit.x, y: hit.y, z: hit.z } : null,
    );
  };

  private pickPoint(e: PointerEvent): void {
    if (!this.ctx) return;
    const camera = this.ctx.getActiveCamera();
    const rect = this.ctx.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hit = this.findClosestPoint(raycaster.ray);
    if (!hit) return;

    const store = useWorldFrameStore.getState();
    store.setPreviewPcPoint(null);

    if (store.phase === 'pc-pick-first') {
      store.setAnchor1Pc({ x: hit.x, y: hit.y, z: hit.z });
      if (this.marker1) {
        this.marker1.position.copy(hit);
        this.marker1.visible = true;
      }
      // If two geo points were picked, need second PC point
      if (store.geoPoint2) {
        store.setPhase('pc-pick-second');
      } else {
        store.setPhase('preview');
      }
    } else if (store.phase === 'pc-pick-second') {
      store.setAnchor2Pc({ x: hit.x, y: hit.y, z: hit.z });
      if (this.marker2) {
        this.marker2.position.copy(hit);
        this.marker2.visible = true;
      }
      store.setPhase('preview');
    }
  }

  // ── Anchor Point Gizmo ────────────────────────────────────────────

  private startAnchorEditing(): void {
    if (!this.ctx || !this.marker1 || this.anchorGizmo) return;
    const wf = useWorldFrameStore.getState();
    if (!wf.anchor1) return;

    // Snapshot for cancel
    this.anchorOrigPc = { ...wf.anchor1.pc };

    this.anchorGizmo = new TransformControls(this.ctx.getActiveCamera(), this.ctx.domElement);
    this.anchorGizmo.setSpace('world');
    this.anchorGizmo.setMode('translate');
    // Y-up convention: only allow XZ movement
    this.anchorGizmo.showX = true;
    this.anchorGizmo.showY = false;
    this.anchorGizmo.showZ = true;
    this.anchorGizmo.attach(this.marker1);
    this.ctx.worldRoot.add(this.anchorGizmo);
    this.anchorGizmo.addEventListener('dragging-changed', this.onAnchorDragChanged);
    this.anchorGizmo.addEventListener('objectChange', this.onAnchorObjectChange);

    // Register cancel callback now so the panel can call it
    useWorldFrameStore.getState()._setOnCancelAnchor(() => {
      if (!this.anchorOrigPc || !this.marker1) return;
      this.marker1.position.set(this.anchorOrigPc.x, this.anchorOrigPc.y, this.anchorOrigPc.z);
      useWorldFrameStore.getState().setAnchor1PcLive(this.anchorOrigPc);
    });
  }

  private stopAnchorEditing(): void {
    if (!this.anchorGizmo) return;
    this.anchorGizmo.removeEventListener('dragging-changed', this.onAnchorDragChanged);
    this.anchorGizmo.removeEventListener('objectChange', this.onAnchorObjectChange);
    this.anchorGizmo.detach();
    if (this.ctx) this.ctx.worldRoot.remove(this.anchorGizmo);
    this.anchorGizmo.dispose();
    this.anchorGizmo = null;
    if (this.ctx) this.ctx.controls.enabled = true;
    this.anchorOrigPc = null;
    useWorldFrameStore.getState()._setOnCancelAnchor(null);
  }

  private readonly onAnchorDragChanged = (event: { value: boolean }): void => {
    if (this.ctx) this.ctx.controls.enabled = !event.value;
  };

  private readonly onAnchorObjectChange = (): void => {
    if (!this.marker1 || !this.anchorOrigPc) return;
    // Lock Y to original anchor elevation (only XZ shown anyway, but just in case)
    this.marker1.position.y = this.anchorOrigPc.y;
    useWorldFrameStore.getState().setAnchor1PcLive({
      x: this.marker1.position.x,
      y: this.marker1.position.y,
      z: this.marker1.position.z,
    });
  };

  private findClosestPoint(ray: Ray): Vector3 | null {
    if (!this.ctx) return null;
    const pcos = this.ctx.getPointClouds();
    let bestDist = Infinity;
    let bestPoint: Vector3 | null = null;
    const tmp = new Vector3();
    const invMatrix = new Matrix4();

    for (const pco of pcos) {
      pco.updateMatrixWorld(true);
      for (const node of pco.visibleNodes) {
        const geom = node.sceneNode?.geometry;
        if (!geom) continue;
        const posAttr = geom.getAttribute('position');
        if (!posAttr) continue;

        const worldMatrix = node.sceneNode.matrixWorld;
        invMatrix.copy(worldMatrix).invert();
        const localRay = ray.clone().applyMatrix4(invMatrix);

        const count = posAttr.count;
        const step = count > 10000 ? Math.floor(count / 5000) : 1;

        for (let i = 0; i < count; i += step) {
          tmp.fromBufferAttribute(posAttr, i);
          const dist = localRay.distanceToPoint(tmp);
          if (dist < bestDist) {
            bestDist = dist;
            bestPoint = tmp.clone().applyMatrix4(worldMatrix);
          }
        }
      }
    }

    if (bestPoint && bestDist < this.markerBaseRadius * 20) {
      return bestPoint;
    }
    return null;
  }
}
