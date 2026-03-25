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
import { usePoiStore } from './poi-store';
import { useViewerModeStore } from '@/app/stores';

export class PoiPlugin implements ViewerPlugin {
  readonly id = 'poi';
  readonly name = 'POI';
  readonly order = 75;

  private ctx: ViewerPluginContext | null = null;

  // Confirmed marker
  private marker: Mesh | null = null;
  private geometry: SphereGeometry | null = null;
  private material: MeshBasicMaterial | null = null;

  // Preview marker (hover)
  private previewMarker: Mesh | null = null;
  private previewGeometry: SphereGeometry | null = null;
  private previewMaterial: MeshBasicMaterial | null = null;

  // Gizmo for confirming phase
  private gizmo: TransformControls | null = null;

  private unsubPoi: (() => void) | null = null;
  private unsubMode: (() => void) | null = null;
  private unsubPhase: (() => void) | null = null;
  private listening = false;
  private mouseDownPos = new Vector2();
  private markerBaseRadius = 0.15;

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;

    // Shared geometry
    const sphereGeo = new SphereGeometry(1, 16, 16);

    // Confirmed marker
    this.geometry = sphereGeo;
    this.material = new MeshBasicMaterial({
      color: 0xff3333,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });
    this.marker = new Mesh(this.geometry, this.material);
    this.marker.renderOrder = 999;
    this.marker.visible = false;
    ctx.scene.add(this.marker);

    // Preview marker (semi-transparent, follows cursor)
    this.previewGeometry = sphereGeo;
    this.previewMaterial = new MeshBasicMaterial({
      color: 0xff3333,
      depthTest: false,
      transparent: true,
      opacity: 0.45,
    });
    this.previewMarker = new Mesh(this.previewGeometry, this.previewMaterial);
    this.previewMarker.renderOrder = 998;
    this.previewMarker.visible = false;
    ctx.scene.add(this.previewMarker);

    // Subscribe to POI store — position changes
    this.unsubPoi = usePoiStore.subscribe((state, prev) => {
      if (state.position !== prev.position) {
        this.onPoiChanged(state.position);
      }
      if (state.previewPosition !== prev.previewPosition) {
        this.onPreviewChanged(state.previewPosition);
      }
      if (state.markerVisible !== prev.markerVisible) {
        if (this.marker) this.marker.visible = state.markerVisible && !!state.position;
      }
    });

    // Subscribe to mode store — enter/exit POI mode
    this.unsubMode = useViewerModeStore.subscribe((state, prev) => {
      const wasPoi = prev.mode === 'poi';
      const isPoi = state.mode === 'poi';
      if (isPoi && !wasPoi) {
        this.enterPoiMode();
      } else if (!isPoi && wasPoi) {
        this.exitPoiMode();
      }
    });

    // Subscribe to phase changes
    this.unsubPhase = usePoiStore.subscribe((state, prev) => {
      if (state.phase !== prev.phase) {
        this.onPhaseChanged(state.phase, prev.phase);
      }
    });

    // Apply initial state
    const { position } = usePoiStore.getState();
    if (position) this.onPoiChanged(position);

    if (useViewerModeStore.getState().mode === 'poi') {
      this.enterPoiMode();
    }
  }

  onPointCloudLoaded(): void {
    if (!this.ctx || !this.marker || !this.previewMarker) return;
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
    this.marker.scale.setScalar(this.markerBaseRadius);
    this.previewMarker.scale.setScalar(this.markerBaseRadius);
  }

  dispose(): void {
    this.exitPoiMode();
    this.disposeGizmo();
    this.unsubPoi?.();
    this.unsubPoi = null;
    this.unsubMode?.();
    this.unsubMode = null;
    this.unsubPhase?.();
    this.unsubPhase = null;

    if (this.ctx) {
      if (this.marker) this.ctx.scene.remove(this.marker);
      if (this.previewMarker) this.ctx.scene.remove(this.previewMarker);
    }
    this.geometry?.dispose();
    this.material?.dispose();
    // previewGeometry is shared reference, only dispose material
    this.previewMaterial?.dispose();
    this.marker = null;
    this.previewMarker = null;
    this.geometry = null;
    this.material = null;
    this.previewGeometry = null;
    this.previewMaterial = null;
    this.ctx = null;
  }

  // --- Phase management ---

  private enterPoiMode(): void {
    const store = usePoiStore.getState();
    store.setPhase('selecting');
    store.setPreviewPosition(null);
    this.startListening();
  }

  private exitPoiMode(): void {
    const store = usePoiStore.getState();
    // If we were confirming, cancel — revert position
    if (store.phase === 'confirming') {
      this.disposeGizmo();
    }
    store.setPhase('idle');
    store.setPreviewPosition(null);
    this.stopListening();
    if (this.previewMarker) this.previewMarker.visible = false;
  }

  private onPhaseChanged(phase: string, _prev: string): void {
    if (phase === 'confirming') {
      this.stopListening(); // stop pick listeners during confirm
      if (this.previewMarker) this.previewMarker.visible = false;
      this.createGizmo();
    } else if (phase === 'selecting') {
      this.disposeGizmo();
      this.startListening();
    } else if (phase === 'idle') {
      this.disposeGizmo();
      this.stopListening();
      if (this.previewMarker) this.previewMarker.visible = false;
    }
  }

  // --- Gizmo ---

  private createGizmo(): void {
    if (!this.ctx || !this.marker || this.gizmo) return;

    this.gizmo = new TransformControls(
      this.ctx.getActiveCamera(),
      this.ctx.domElement
    );
    this.gizmo.setMode('translate');
    this.gizmo.setSize(0.6);
    this.gizmo.attach(this.marker);
    this.ctx.scene.add(this.gizmo);

    // Disable orbit while dragging gizmo
    this.gizmo.addEventListener('dragging-changed', this.onGizmoDragChanged);
    this.gizmo.addEventListener('objectChange', this.onGizmoObjectChange);
  }

  private disposeGizmo(): void {
    if (!this.gizmo) return;
    this.gizmo.removeEventListener('dragging-changed', this.onGizmoDragChanged);
    this.gizmo.removeEventListener('objectChange', this.onGizmoObjectChange);
    this.gizmo.detach();
    if (this.ctx) this.ctx.scene.remove(this.gizmo);
    this.gizmo.dispose();
    this.gizmo = null;
    // Re-enable orbit
    if (this.ctx) this.ctx.controls.enabled = true;
  }

  private readonly onGizmoDragChanged = (event: { value: boolean }): void => {
    if (this.ctx) this.ctx.controls.enabled = !event.value;
  };

  private readonly onGizmoObjectChange = (): void => {
    // Sync marker position back to store preview (live feedback)
    if (!this.marker) return;
    const p = this.marker.position;
    usePoiStore.getState().setPreviewPosition({ x: p.x, y: p.y, z: p.z });
  };

  /** Called externally (from UI) to confirm gizmo position */
  confirmAdjustment(): void {
    if (!this.marker) return;
    const p = this.marker.position;
    const store = usePoiStore.getState();
    store.setPosition(p.x, p.y, p.z);
    store.setPhase('idle');
    store.setPreviewPosition(null);
    useViewerModeStore.getState().exitMode();
  }

  /** Called externally (from UI) to cancel gizmo adjustment */
  cancelAdjustment(): void {
    // Restore marker to committed position
    const store = usePoiStore.getState();
    if (store.position && this.marker) {
      this.marker.position.set(store.position.x, store.position.y, store.position.z);
    }
    store.setPhase('idle');
    store.setPreviewPosition(null);
    useViewerModeStore.getState().exitMode();
  }

  // --- Marker updates ---

  private onPoiChanged(position: { x: number; y: number; z: number } | null): void {
    if (!this.ctx || !this.marker) return;

    if (position) {
      this.marker.position.set(position.x, position.y, position.z);
      this.marker.visible = usePoiStore.getState().markerVisible;

      if (this.marker.scale.x < 0.01) {
        this.marker.scale.setScalar(1);
      }

      // Set as orbit target
      this.ctx.controls.target.set(position.x, position.y, position.z);
      this.ctx.controls.update();
    } else {
      this.marker.visible = false;
    }
  }

  private onPreviewChanged(pos: { x: number; y: number; z: number } | null): void {
    if (!this.previewMarker) return;
    if (pos) {
      this.previewMarker.position.set(pos.x, pos.y, pos.z);
      this.previewMarker.visible = true;
      if (this.previewMarker.scale.x < 0.01) {
        this.previewMarker.scale.setScalar(this.markerBaseRadius || 1);
      }
    } else {
      this.previewMarker.visible = false;
    }
  }

  // --- Event listeners ---

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

  private lastMoveTime = 0;
  private readonly onPointerMove = (e: PointerEvent): void => {
    // Throttle to ~30fps
    const now = performance.now();
    if (now - this.lastMoveTime < 33) return;
    this.lastMoveTime = now;

    if (!this.ctx) return;
    const camera = this.ctx.getActiveCamera();
    const rect = this.ctx.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, camera);

    const hit = this.findClosestPoint(raycaster.ray);
    usePoiStore.getState().setPreviewPosition(
      hit ? { x: hit.x, y: hit.y, z: hit.z } : null
    );
  };

  private pickPoint(e: PointerEvent): void {
    if (!this.ctx) return;

    const camera = this.ctx.getActiveCamera();
    const rect = this.ctx.domElement.getBoundingClientRect();

    const ndc = new Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, camera);

    const hit = this.findClosestPoint(raycaster.ray);
    if (!hit) return;

    // Place marker and enter confirming phase
    const store = usePoiStore.getState();
    store.setPosition(hit.x, hit.y, hit.z);
    store.setPreviewPosition(null);
    store.setPhase('confirming');
  }

  /**
   * Iterate visible nodes, transform positions to world space,
   * and find the point closest to the ray (by perpendicular distance).
   */
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
