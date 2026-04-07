import { BufferGeometry, Float32BufferAttribute, Group, Points, PointsMaterial, Raycaster, Vector2, Vector3 } from 'three';
import type { ShapeEditorInternalContext, ObbShape, BoxDrawPhase } from '../shape-editor-types';
import { clientToNdc, raycastHorizontalPlane, metersPerPixel } from '../utils/raycast-utils';
import { buildObbWireframe } from '../visuals/shape-visual-builder';
import { SHAPE_COLOR_PREVIEW } from '../visuals/visual-constants';
import { clearGroup } from '../utils/dispose-utils';

/**
 * Handles three-click box drawing:
 *   1. `hover`    — move to preview nearest PCO point; click to set anchor
 *   2. `footprint`— move to extend XZ footprint on locked plane; click to confirm
 *   3. `extrude`  — move vertically to set height; click to commit
 */
export class BoxDrawController {
  private ctx: ShapeEditorInternalContext;
  private phase: BoxDrawPhase = 'hover';
  private previewGroup: Group | null = null;
  private hoverMarker: Points | null = null;

  // Footprint state
  private anchorWorld: Vector3 | null = null;
  private groundY = 0;
  private mouseDownClient = new Vector2();
  /** True while the pointer is held down (drag mode). False after first click releases. */
  private pointerHeld = false;

  // Current pending shape values
  private centerX = 0;
  private centerY = 0;
  private centerZ = 0;
  private halfX = 0.01;
  private halfY = 0.1;
  private halfZ = 0.01;

  // Extrusion state
  private extrudeScreenY = 0;

  constructor(ctx: ShapeEditorInternalContext) {
    this.ctx = ctx;
  }

  /** Attach DOM listeners and show preview group. */
  activate(): void {
    this.phase = 'hover';
    this.previewGroup = new Group();
    this.previewGroup.renderOrder = 900;
    this.ctx.scene.add(this.previewGroup);

    // Hover indicator — pixel-size point marker, same approach as PointInfoPlugin
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
    this.ctx.orbitControls.enabled = true;
    this.anchorWorld = null;
    this.pointerHeld = false;
    this.phase = 'hover';
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.mouseDownClient.set(e.clientX, e.clientY);

    if (this.phase === 'hover') {
      // Immediately set anchor so drag mode works (pointer held down = footprint drag)
      const hit = this.groundHit(e.clientX, e.clientY);
      if (!hit) return;
      if (this.hoverMarker) this.hoverMarker.visible = false;
      this.anchorWorld = hit.clone();
      this.groundY = hit.y;
      this.pointerHeld = true;
      this.phase = 'footprint';
      this.ctx.orbitControls.enabled = false;
    }
    // In 'footprint' (free) or 'extrude': just record position for click-detection on up
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.phase === 'hover') {
      this.updateHoverIndicator(e.clientX, e.clientY);
    } else if (this.phase === 'footprint') {
      const hit = this.groundHit(e.clientX, e.clientY);
      if (!hit) return;
      this.updateFootprintFromHit(hit);
      this.rebuildPreview();
    } else if (this.phase === 'extrude') {
      this.updateExtrusion(e.clientY);
      this.rebuildPreview();
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const dx = e.clientX - this.mouseDownClient.x;
    const dy = e.clientY - this.mouseDownClient.y;
    const wasClick = dx * dx + dy * dy <= 25; // ≤5 px = click

    if (this.phase === 'footprint' && this.pointerHeld) {
      this.pointerHeld = false;
      if (wasClick) {
        // Click mode: anchor set, now free-move to size footprint; wait for second click
      } else {
        // Drag mode: footprint sized by drag — if big enough go straight to extrude
        if (this.halfX < this.ctx.config.minHalfExtent && this.halfZ < this.ctx.config.minHalfExtent) {
          // Too small — abandon and return to hover
          this.ctx.orbitControls.enabled = true;
          this.anchorWorld = null;
          this.phase = 'hover';
          return;
        }
        this.extrudeScreenY = e.clientY;
        this.phase = 'extrude';
        this.ctx.domElement.style.cursor = 'ns-resize';
      }
    } else if (this.phase === 'footprint' && !this.pointerHeld && wasClick) {
      // Second click (free-move mode): confirm XZ, enter height phase
      if (this.halfX < this.ctx.config.minHalfExtent && this.halfZ < this.ctx.config.minHalfExtent) return;
      this.extrudeScreenY = e.clientY;
      this.phase = 'extrude';
      this.ctx.domElement.style.cursor = 'ns-resize';
    } else if (this.phase === 'extrude' && wasClick) {
      this.updateExtrusion(e.clientY);
      this.commit();
    }
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      this.ctx.cancelDraw();
    } else if (e.key === 'Enter' && this.phase === 'extrude') {
      this.commit();
    }
  };

  // ── Private helpers ─────────────────────────────────────────────────────────

  private groundHit(clientX: number, clientY: number): Vector3 | null {
    const camera = this.ctx.getCamera();
    const ndc = clientToNdc(clientX, clientY, this.ctx.domElement);

    // ── Initial anchor placement — determine drawing plane Y ──────────────────
    if (!this.anchorWorld) {
      // 1. PCO surface: ray vs loaded point cloud geometry (also used by point cloud snap mode)
      if (this.ctx.snap.isSurfaceModeActive() || this.ctx.snap.isPointCloudPickActive()) {
        const sp = this.pickSurfacePoint(clientX, clientY);
        if (sp) {
          this.groundY = sp.y;
          const snapped = this.ctx.snap.snapXZ(sp.x, sp.z);
          return new Vector3(snapped.x, sp.y, snapped.z);
        }
      }

      // 2. DEM — raycast against terrain elevation
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

      // 3. Flat plane fallback — use DEM at the actual cursor XZ position
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

    // ── Dragging — keep the locked ground Y ───────────────────────────────────
    const hit = raycastHorizontalPlane(ndc, camera, this.groundY);
    if (!hit) return null;
    hit.y = this.groundY;
    const snapped = this.ctx.snap.snapXZ(hit.x, hit.z);
    hit.x = snapped.x; hit.z = snapped.z;
    return hit;
  }

  /** Update the hover marker during the pre-anchor hover phase. */
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
    this.centerY = this.groundY;
    this.centerZ = (a.z + hit.z) / 2;
    this.halfX = Math.max(this.ctx.config.minHalfExtent, dx / 2);
    this.halfZ = Math.max(this.ctx.config.minHalfExtent, dz / 2);
    this.halfY = this.ctx.config.minHalfExtent;
  }

  private updateExtrusion(screenY: number): void {
    const camera = this.ctx.getCamera();
    const dPx = this.extrudeScreenY - screenY; // positive = upward
    const center = new Vector3(this.centerX, this.centerY, this.centerZ);
    const dist = camera.position.distanceTo(center);
    const mpp = metersPerPixel(camera, dist, this.ctx.domElement.clientHeight);
    const newHalfY = Math.max(this.ctx.config.minExtrudeHeight, Math.abs(dPx) * mpp);
    const dir = dPx >= 0 ? 1 : -1;
    this.halfY = newHalfY;
    this.centerY = this.groundY + newHalfY * dir;
  }

  private rebuildPreview(): void {
    if (!this.previewGroup) return;
    clearGroup(this.previewGroup);
    const shape = this.buildShape();
    const wireframe = buildObbWireframe(shape, SHAPE_COLOR_PREVIEW);
    wireframe.children.forEach((c) => this.previewGroup!.add(c));
    wireframe.children.length = 0; // prevent double dispose
    this.previewGroup.add(wireframe);
  }

  private buildShape(): ObbShape {
    return {
      type: 'obb',
      id: '__preview__',
      center: { x: this.centerX, y: this.centerY, z: this.centerZ },
      halfExtents: { x: this.halfX, y: this.halfY, z: this.halfZ },
      rotationY: 0,
      metadata: {},
    };
  }

  private commit(): void {
    const shape: ObbShape = {
      ...this.buildShape(),
      id: `se-box-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    };
    this.ctx.finishDraw(shape);
  }
}
