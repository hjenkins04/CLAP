import {
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  PointsMaterial,
  Raycaster,
  Vector2,
  Vector3,
  Matrix4,
  Ray,
} from 'three';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { usePointInfoStore } from './point-info-store';
import { useViewerModeStore } from '@/app/stores';
import type { PointInfo } from './point-info-types';
import {
  useClassificationLegendStore,
  isClassVisible,
} from '../../services/classification-legend';
import { useAnnotateStore } from '../annotate/annotate-store';

export class PointInfoPlugin implements ViewerPlugin {
  readonly id = 'point-info';
  readonly name = 'Point Info';
  readonly order = 76;

  private ctx: ViewerPluginContext | null = null;

  // Confirmed pick marker — yellow dot, slightly larger than a normal point
  private marker: Points | null = null;
  // Hover preview marker — same colour, slightly smaller
  private previewMarker: Points | null = null;

  private unsubMode: (() => void) | null = null;
  private unsubStore: (() => void) | null = null;

  private listening = false;
  private mouseDownPos = new Vector2();
  private lastMoveTime = 0;

  // Pick acceptance radius in world units — updated whenever we have a good
  // measurement of the scene scale (first point cloud load).
  private pickRadius = 1.0;

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;

    this.marker = this.makeMarker(10, 1.0);
    this.marker.visible = false;
    ctx.worldRoot.add(this.marker);

    this.previewMarker = this.makeMarker(7, 0.55);
    this.previewMarker.visible = false;
    ctx.worldRoot.add(this.previewMarker);

    this.unsubMode = useViewerModeStore.subscribe((state, prev) => {
      const was = prev.mode === 'point-info';
      const is  = state.mode === 'point-info';
      if (is && !was) this.enterMode();
      else if (!is && was) this.exitMode();
    });

    this.unsubStore = usePointInfoStore.subscribe((state, prev) => {
      if (state.pickedPoint !== prev.pickedPoint) {
        this.syncMarker(state.pickedPoint);
      }
      if (state.previewPoint !== prev.previewPoint) {
        this.syncPreviewMarker(state.previewPoint);
      }
    });

    const { pickedPoint } = usePointInfoStore.getState();
    if (pickedPoint) this.syncMarker(pickedPoint);
  }

  onPointCloudLoaded(): void {
    if (!this.ctx) return;
    const pcos = this.ctx.getPointClouds();
    if (pcos.length === 0) return;
    // Pick radius = 0.5% of the diagonal of the bounding box — gives a reasonable
    // world-space cursor for the "closest point" search.
    const b = pcos[0].pcoGeometry.boundingBox;
    const diag = b.getSize(new Vector3()).length();
    this.pickRadius = diag * 0.005;
  }

  dispose(): void {
    this.exitMode();
    this.unsubMode?.();
    this.unsubMode = null;
    this.unsubStore?.();
    this.unsubStore = null;

    if (this.ctx) {
      if (this.marker) this.ctx.worldRoot.remove(this.marker);
      if (this.previewMarker) this.ctx.worldRoot.remove(this.previewMarker);
    }
    (this.marker?.material as PointsMaterial | undefined)?.dispose();
    this.marker?.geometry.dispose();
    (this.previewMarker?.material as PointsMaterial | undefined)?.dispose();
    this.previewMarker?.geometry.dispose();
    this.marker = null;
    this.previewMarker = null;
    this.ctx = null;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private makeMarker(pixelSize: number, opacity: number): Points {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
    const mat = new PointsMaterial({
      color: 0xfde047,        // yellow-300
      size: pixelSize,
      sizeAttenuation: false, // screen-space pixels, zoom-invariant
      depthTest: false,
      transparent: true,
      opacity,
    });
    const pts = new Points(geo, mat);
    pts.renderOrder = 999;
    return pts;
  }

  // ── Mode lifecycle ───────────────────────────────────────────────────────────

  private enterMode(): void {
    usePointInfoStore.getState().setPhase('picking');
    this.startListening();
  }

  private exitMode(): void {
    usePointInfoStore.getState().setPhase('idle');
    usePointInfoStore.getState().setPreviewPoint(null);
    this.stopListening();
    if (this.previewMarker) this.previewMarker.visible = false;
  }

  // ── Marker sync ──────────────────────────────────────────────────────────────

  private syncMarker(info: PointInfo | null): void {
    if (!this.marker || !this.ctx) return;
    if (!info) { this.marker.visible = false; return; }
    this.ctx.worldRoot.updateWorldMatrix(true, false);
    const local = this.ctx.worldRoot.worldToLocal(
      new Vector3(info.worldPos.x, info.worldPos.y, info.worldPos.z),
    );
    this.marker.position.copy(local);
    this.marker.visible = true;
  }

  private syncPreviewMarker(info: PointInfo | null): void {
    if (!this.previewMarker || !this.ctx) return;
    if (!info) { this.previewMarker.visible = false; return; }
    this.ctx.worldRoot.updateWorldMatrix(true, false);
    const local = this.ctx.worldRoot.worldToLocal(
      new Vector3(info.worldPos.x, info.worldPos.y, info.worldPos.z),
    );
    this.previewMarker.position.copy(local);
    this.previewMarker.visible = true;
  }

  // ── Event listeners ──────────────────────────────────────────────────────────

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
    if (now - this.lastMoveTime < 33) return; // ~30 fps
    this.lastMoveTime = now;
    if (!this.ctx) return;
    const ray = this.makeRay(e.clientX, e.clientY);
    if (!ray) return;
    usePointInfoStore.getState().setPreviewPoint(this.findClosestPointWithInfo(ray));
  };

  private pickPoint(e: PointerEvent): void {
    if (!this.ctx) return;
    const ray = this.makeRay(e.clientX, e.clientY);
    if (!ray) return;
    const info = this.findClosestPointWithInfo(ray);
    if (!info) return;
    usePointInfoStore.getState().setPickedPoint(info);
    usePointInfoStore.getState().setPreviewPoint(null);
  }

  // ── Ray picking ──────────────────────────────────────────────────────────────

  private makeRay(clientX: number, clientY: number): Ray | null {
    if (!this.ctx) return null;
    const camera = this.ctx.getActiveCamera();
    const rect = this.ctx.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const rc = new Raycaster();
    rc.setFromCamera(ndc, camera);
    return rc.ray;
  }

  private findClosestPointWithInfo(ray: Ray): PointInfo | null {
    if (!this.ctx) return null;

    const pcos = this.ctx.getPointClouds();
    let bestDist = Infinity;
    let bestInfo: PointInfo | null = null;

    const tmp = new Vector3();
    const worldMatrix = new Matrix4();
    const invMatrix = new Matrix4();

    // Snapshot the legend + user visibility once per pick so the hot inner
    // loop only reads local variables.
    const legend = useClassificationLegendStore.getState().legend;
    const visibility = useAnnotateStore.getState().classVisibility;

    for (const pco of pcos) {
      pco.updateMatrix();

      for (const node of pco.visibleNodes) {
        const geom = node.sceneNode?.geometry;
        if (!geom) continue;
        const posAttr = geom.getAttribute('position');
        if (!posAttr) continue;

        worldMatrix.multiplyMatrices(pco.matrixWorld, node.sceneNode.matrix);
        invMatrix.copy(worldMatrix).invert();
        const localRay = ray.clone().applyMatrix4(invMatrix);

        const count = posAttr.count;
        const step = count > 10000 ? Math.floor(count / 5000) : 1;

        const scanIdAttr = geom.getAttribute('scan_id');
        const classAttr  = geom.getAttribute('classification');
        const intAttr    = geom.getAttribute('intensity');
        const gpsAttr    = geom.getAttribute('gps-time');

        for (let i = 0; i < count; i += step) {
          // Skip points whose class is hidden in the legend panel — Potree
          // only fades them via material alpha, so without this check picking
          // would "find" points that the user can't actually see.
          if (classAttr) {
            const cls = Math.round(classAttr.getX(i));
            if (!isClassVisible(cls, legend, visibility)) continue;
          }

          tmp.fromBufferAttribute(posAttr, i);
          const d = localRay.distanceToPoint(tmp);
          if (d < bestDist) {
            bestDist = d;
            const world = tmp.clone().applyMatrix4(worldMatrix);
            bestInfo = {
              worldPos: { x: world.x, y: world.y, z: world.z },
              scanId:         scanIdAttr ? Math.round(scanIdAttr.getX(i)) : null,
              classification: classAttr  ? Math.round(classAttr.getX(i))  : null,
              intensity:      intAttr    ? Math.round(intAttr.getX(i))    : null,
              gpsTime:        gpsAttr    ? gpsAttr.getX(i)                : null,
            };
          }
        }
      }
    }

    return bestInfo && bestDist < this.pickRadius ? bestInfo : null;
  }
}
