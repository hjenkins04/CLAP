import { Group, Vector2, Vector3, PerspectiveCamera } from 'three';
import type { ShapeEditorInternalContext, ObbShape, BoxDrawPhase } from '../shape-editor-types';
import { clientToNdc, raycastHorizontalPlane, metersPerPixel } from '../utils/raycast-utils';
import { buildObbWireframe } from '../visuals/shape-visual-builder';
import { SHAPE_COLOR_PREVIEW } from '../visuals/visual-constants';
import { clearGroup } from '../utils/dispose-utils';

/**
 * Handles the two-phase box drawing interaction:
 *   1. `footprint` — mouse-down to anchor, drag to set XZ extents
 *   2. `extrude`   — mouse-move vertically to set Y (height), click to confirm
 */
export class BoxDrawController {
  private ctx: ShapeEditorInternalContext;
  private phase: BoxDrawPhase = 'footprint';
  private previewGroup: Group | null = null;

  // Footprint state
  private anchorWorld: Vector3 | null = null;
  private groundY = 0;
  private mouseDownClient = new Vector2();
  private dragging = false;

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
    this.phase = 'footprint';
    this.previewGroup = new Group();
    this.previewGroup.renderOrder = 900;
    this.ctx.scene.add(this.previewGroup);
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
    this.anchorWorld = null;
    this.dragging = false;
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (this.phase === 'footprint') {
      const hit = this.groundHit(e.clientX, e.clientY);
      if (!hit) return;
      this.anchorWorld = hit.clone();
      this.groundY = hit.y;
      this.mouseDownClient.set(e.clientX, e.clientY);
      this.dragging = true;
      this.ctx.orbitControls.enabled = false;
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.phase === 'footprint' && this.dragging && this.anchorWorld) {
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
    this.ctx.orbitControls.enabled = true;

    if (this.phase === 'footprint') {
      if (!this.dragging || !this.anchorWorld) return;
      const hit = this.groundHit(e.clientX, e.clientY);
      if (hit) this.updateFootprintFromHit(hit);

      if (this.halfX < this.ctx.config.minHalfExtent && this.halfZ < this.ctx.config.minHalfExtent) {
        // Too small — treat as a click, abort
        this.dragging = false;
        this.anchorWorld = null;
        return;
      }

      this.dragging = false;
      this.phase = 'extrude';
      this.extrudeScreenY = e.clientY;
      this.ctx.domElement.style.cursor = 'ns-resize';
    } else if (this.phase === 'extrude') {
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
    const y = this.anchorWorld ? this.groundY : this.ctx.getElevation(0, 0);

    let hit = raycastHorizontalPlane(ndc, camera, y);
    if (!hit) return null;

    // Refine with DEM at the hit position
    const demY = this.ctx.getElevation(hit.x, hit.z);
    if (Math.abs(demY - y) > 0.05) {
      hit = raycastHorizontalPlane(ndc, camera, demY) ?? hit;
      hit.y = demY;
    } else {
      hit.y = y;
    }

    // Apply snapping
    const snapped = this.ctx.snap.snapXZ(hit.x, hit.z);
    hit.x = snapped.x;
    hit.z = snapped.z;
    return hit;
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
