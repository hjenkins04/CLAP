import { BufferGeometry, Float32BufferAttribute, Group, Points, PointsMaterial, Raycaster, Vector2, Vector3 } from 'three';
import type { ShapeEditorInternalContext, ObbShape } from '../shape-editor-types';
import { clientToNdc, raycastHorizontalPlane } from '../utils/raycast-utils';
import { buildObbWireframe } from '../visuals/shape-visual-builder';
import { SHAPE_COLOR_PREVIEW } from '../visuals/visual-constants';
import { clearGroup } from '../utils/dispose-utils';

/** Half-extent used for the Y (elevation) axis — large enough to cover any point cloud. */
const FLAT_BOX_HALF_Y = 5_000;

/**
 * Handles flat-box drawing: a single footprint-drag phase that produces an
 * OBB with an enormous Y half-extent, effectively clipping all elevations
 * within the XZ footprint.
 *
 * Compared to BoxDrawController there is no extrude phase — the shape is
 * committed immediately on pointer-up after the drag.
 */
export class FlatBoxDrawController {
  private ctx: ShapeEditorInternalContext;
  private previewGroup: Group | null = null;
  private hoverMarker: Points | null = null;

  private anchorWorld: Vector3 | null = null;
  private groundY = 0;
  private mouseDownClient = new Vector2();
  private dragging = false;

  private centerX = 0;
  private centerZ = 0;
  private halfX = 0.01;
  private halfZ = 0.01;

  constructor(ctx: ShapeEditorInternalContext) {
    this.ctx = ctx;
  }

  activate(): void {
    this.previewGroup = new Group();
    this.previewGroup.renderOrder = 900;
    this.ctx.scene.add(this.previewGroup);

    const hoverGeo = new BufferGeometry();
    hoverGeo.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
    const hoverMat = new PointsMaterial({ color: 0x00e5ff, size: 8, sizeAttenuation: false, depthTest: false, transparent: true, opacity: 0.9 });
    this.hoverMarker = new Points(hoverGeo, hoverMat);
    this.hoverMarker.renderOrder = 999;
    this.hoverMarker.visible = false;
    this.ctx.scene.add(this.hoverMarker);

    this.ctx.domElement.style.cursor = 'crosshair';
    this.ctx.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.ctx.domElement.addEventListener('pointermove', this.onPointerMove);
    this.ctx.domElement.addEventListener('pointerup', this.onPointerUp);
    this.ctx.domElement.addEventListener('keydown', this.onKeyDown);
  }

  deactivate(): void {
    this.ctx.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.ctx.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.ctx.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.ctx.domElement.removeEventListener('keydown', this.onKeyDown);
    this.ctx.domElement.style.cursor = '';
    if (this.previewGroup) {
      clearGroup(this.previewGroup);
      this.ctx.scene.remove(this.previewGroup);
      this.previewGroup = null;
    }
    if (this.hoverMarker) {
      this.hoverMarker.geometry.dispose();
      (this.hoverMarker.material as PointsMaterial).dispose();
      this.ctx.scene.remove(this.hoverMarker);
      this.hoverMarker = null;
    }
    this.anchorWorld = null;
    this.dragging = false;
  }

  // ── Event handlers ──────────────────────────────────────────────────────────

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const hit = this.groundHit(e.clientX, e.clientY);
    if (!hit) return;
    if (this.hoverMarker) this.hoverMarker.visible = false;
    this.anchorWorld = hit.clone();
    this.groundY = hit.y;
    this.mouseDownClient.set(e.clientX, e.clientY);
    this.dragging = true;
    this.ctx.orbitControls.enabled = false;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.dragging && this.anchorWorld) {
      const hit = this.groundHit(e.clientX, e.clientY);
      if (!hit) return;
      this.updateFootprintFromHit(hit);
      this.rebuildPreview();
    } else if (!this.anchorWorld) {
      this.updateHoverIndicator(e.clientX, e.clientY);
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.ctx.orbitControls.enabled = true;
    if (!this.dragging || !this.anchorWorld) return;

    const hit = this.groundHit(e.clientX, e.clientY);
    if (hit) this.updateFootprintFromHit(hit);

    if (this.halfX < this.ctx.config.minHalfExtent && this.halfZ < this.ctx.config.minHalfExtent) {
      this.dragging = false;
      this.anchorWorld = null;
      return;
    }

    this.dragging = false;
    this.commit();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.ctx.cancelDraw();
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private groundHit(clientX: number, clientY: number): Vector3 | null {
    const camera = this.ctx.getCamera();
    const ndc = clientToNdc(clientX, clientY, this.ctx.domElement);

    if (!this.anchorWorld) {
      // PCO surface: ray vs loaded point cloud geometry (also used by point cloud snap mode)
      if (this.ctx.snap.isSurfaceModeActive() || this.ctx.snap.isPointCloudPickActive()) {
        const sp = this.pickSurfacePoint(clientX, clientY);
        if (sp) {
          this.groundY = sp.y;
          const snapped = this.ctx.snap.snapXZ(sp.x, sp.z);
          return new Vector3(snapped.x, sp.y, snapped.z);
        }
      }

      // DEM
      if (this.ctx.snap.isDemModeActive()) {
        const y0 = this.ctx.getElevation(0, 0);
        let hit = raycastHorizontalPlane(ndc, camera, y0);
        if (!hit) return null;
        const demY = this.ctx.getElevation(hit.x, hit.z);
        if (Math.abs(demY - y0) > 0.05) {
          hit = raycastHorizontalPlane(ndc, camera, demY) ?? hit;
        }
        hit.y = demY;
        this.groundY = demY;
        const snapped = this.ctx.snap.snapXZ(hit.x, hit.z);
        hit.x = snapped.x; hit.z = snapped.z;
        return hit;
      }

      // Flat fallback — use DEM at the actual cursor XZ position
      const y0 = this.ctx.getElevation(0, 0);
      const hit = raycastHorizontalPlane(ndc, camera, y0);
      if (!hit) return null;
      const groundY = this.ctx.getElevation(hit.x, hit.z);
      this.groundY = groundY;
      hit.y = groundY;
      const snapped = this.ctx.snap.snapXZ(hit.x, hit.z);
      hit.x = snapped.x; hit.z = snapped.z;
      return hit;
    }

    // Dragging — stay on locked plane
    const hit = raycastHorizontalPlane(ndc, camera, this.groundY);
    if (!hit) return null;
    hit.y = this.groundY;
    const snapped = this.ctx.snap.snapXZ(hit.x, hit.z);
    hit.x = snapped.x; hit.z = snapped.z;
    return hit;
  }

  private updateHoverIndicator(clientX: number, clientY: number): void {
    if (!this.hoverMarker || !this.ctx.snap.isPointCloudPickActive()) {
      if (this.hoverMarker) this.hoverMarker.visible = false;
      return;
    }
    const sp = this.pickSurfacePoint(clientX, clientY);
    if (sp) {
      this.hoverMarker.position.copy(sp);
      this.hoverMarker.visible = true;
    } else {
      this.hoverMarker.visible = false;
    }
  }

  /** Cast a ray into visible PCO geometry and return the nearest hit point. */
  private pickSurfacePoint(clientX: number, clientY: number): Vector3 | null {
    const camera = this.ctx.getCamera();
    const rect = this.ctx.domElement.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width)  * 2 - 1;
    const ndcY = -((clientY - rect.top)  / rect.height) * 2 + 1;
    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2(ndcX, ndcY), camera);
    return this.ctx.snap.pickSurfacePoint(raycaster.ray);
  }

  private updateFootprintFromHit(hit: Vector3): void {
    const a = this.anchorWorld!;
    const dx = Math.abs(hit.x - a.x);
    const dz = Math.abs(hit.z - a.z);
    this.centerX = (a.x + hit.x) / 2;
    this.centerZ = (a.z + hit.z) / 2;
    this.halfX = Math.max(this.ctx.config.minHalfExtent, dx / 2);
    this.halfZ = Math.max(this.ctx.config.minHalfExtent, dz / 2);
  }

  private buildShape(id = '__preview__'): ObbShape {
    return {
      type: 'obb',
      id,
      center: { x: this.centerX, y: this.groundY, z: this.centerZ },
      halfExtents: { x: this.halfX, y: FLAT_BOX_HALF_Y, z: this.halfZ },
      rotationY: 0,
      metadata: { flatBox: true },
    };
  }

  private rebuildPreview(): void {
    if (!this.previewGroup) return;
    clearGroup(this.previewGroup);
    // Preview shows a flat slab visual at ground level so the footprint is clear.
    const previewShape: ObbShape = {
      ...this.buildShape(),
      halfExtents: { x: this.halfX, y: 0.2, z: this.halfZ },
    };
    const wireframe = buildObbWireframe(previewShape, SHAPE_COLOR_PREVIEW);
    [...wireframe.children].forEach((c) => this.previewGroup!.add(c));
    this.previewGroup.add(wireframe);
  }

  private commit(): void {
    const shape: ObbShape = {
      ...this.buildShape(`se-flat-box-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
    };
    this.ctx.finishDraw(shape);
  }
}
