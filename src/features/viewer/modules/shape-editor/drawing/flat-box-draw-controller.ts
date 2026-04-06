import { Group, Vector2, Vector3 } from 'three';
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

  // ── Event handlers ──────────────────────────────────────────────────────────

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const hit = this.groundHit(e.clientX, e.clientY);
    if (!hit) return;
    this.anchorWorld = hit.clone();
    this.groundY = hit.y;
    this.mouseDownClient.set(e.clientX, e.clientY);
    this.dragging = true;
    this.ctx.orbitControls.enabled = false;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging || !this.anchorWorld) return;
    const hit = this.groundHit(e.clientX, e.clientY);
    if (!hit) return;
    this.updateFootprintFromHit(hit);
    this.rebuildPreview();
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
    const y = this.anchorWorld ? this.groundY : this.ctx.getElevation(0, 0);
    let hit = raycastHorizontalPlane(ndc, camera, y);
    if (!hit) return null;
    const demY = this.ctx.getElevation(hit.x, hit.z);
    if (Math.abs(demY - y) > 0.05) {
      hit = raycastHorizontalPlane(ndc, camera, demY) ?? hit;
      hit.y = demY;
    } else {
      hit.y = y;
    }
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
    wireframe.children.forEach((c) => this.previewGroup!.add(c));
    wireframe.children.length = 0;
    this.previewGroup.add(wireframe);
  }

  private commit(): void {
    const shape: ObbShape = {
      ...this.buildShape(`se-flat-box-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
    };
    this.ctx.finishDraw(shape);
  }
}
