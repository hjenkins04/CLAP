import { Group, Vector3 } from 'three';
import type { ShapeEditorInternalContext, PolylineShape, Vec3 } from '../shape-editor-types';
import { clientToNdc, raycastHorizontalPlane } from '../utils/raycast-utils';
import { buildPolylineWireframe } from '../visuals/shape-visual-builder';
import { SHAPE_COLOR_PREVIEW } from '../visuals/visual-constants';
import { clearGroup } from '../utils/dispose-utils';

/**
 * Polyline drawing: click to place points, double-click or Enter to confirm.
 * Backspace removes the last point. Escape cancels.
 */
export class PolylineDrawController {
  private ctx: ShapeEditorInternalContext;
  private points: Vec3[] = [];
  private previewGroup: Group | null = null;
  private groundY = 0;
  private lastClickTime = 0;
  private lastMouseClient = { x: 0, y: 0 };

  constructor(ctx: ShapeEditorInternalContext) {
    this.ctx = ctx;
  }

  activate(): void {
    this.points = [];
    this.groundY = this.ctx.getElevation(0, 0);
    this.previewGroup = new Group();
    this.previewGroup.renderOrder = 900;
    this.ctx.scene.add(this.previewGroup);
    this.ctx.domElement.style.cursor = 'crosshair';
    this.ctx.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.ctx.domElement.addEventListener('pointermove', this.onPointerMove);
    this.ctx.domElement.addEventListener('keydown', this.onKeyDown);
  }

  deactivate(): void {
    this.ctx.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.ctx.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.ctx.domElement.removeEventListener('keydown', this.onKeyDown);
    this.ctx.domElement.style.cursor = '';
    if (this.previewGroup) {
      clearGroup(this.previewGroup);
      this.ctx.scene.remove(this.previewGroup);
      this.previewGroup = null;
    }
    this.points = [];
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const hit = this.groundHit(e.clientX, e.clientY);
    if (!hit) return;

    const now = performance.now();
    const isDblClick = now - this.lastClickTime < 350;
    this.lastClickTime = now;

    if (isDblClick && this.points.length >= 1) {
      this.points.pop(); // remove last (double-click first-click duplicate)
      this.commit();
      return;
    }

    this.points.push({ x: hit.x, y: hit.y, z: hit.z });
    this.groundY = hit.y;
    this.rebuildPreview(null);

    const max = this.ctx.config.maxPolylinePoints;
    if (max > 0 && this.points.length >= max) {
      this.commit();
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    this.lastMouseClient = { x: e.clientX, y: e.clientY };
    if (this.points.length === 0) return;
    const hit = this.groundHit(e.clientX, e.clientY);
    this.rebuildPreview(hit);
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      this.ctx.cancelDraw();
    } else if (e.key === 'Enter') {
      if (this.points.length >= 2) this.commit();
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      if (this.points.length > 0) {
        this.points.pop();
        const hit = this.groundHit(this.lastMouseClient.x, this.lastMouseClient.y);
        this.rebuildPreview(hit);
      }
    }
  };

  // ── Private helpers ─────────────────────────────────────────────────────────

  private groundHit(clientX: number, clientY: number): Vector3 | null {
    const camera = this.ctx.getCamera();
    const ndc = clientToNdc(clientX, clientY, this.ctx.domElement);
    let hit = raycastHorizontalPlane(ndc, camera, this.groundY);
    if (!hit) return null;
    const demY = this.ctx.getElevation(hit.x, hit.z);
    if (Math.abs(demY - this.groundY) > 0.05) {
      hit = raycastHorizontalPlane(ndc, camera, demY) ?? hit;
    }
    hit.y = demY;
    const s = this.ctx.snap.snapXZ(hit.x, hit.z);
    hit.x = s.x; hit.z = s.z;
    return hit;
  }

  private rebuildPreview(cursor: Vector3 | null): void {
    if (!this.previewGroup) return;
    clearGroup(this.previewGroup);
    const pts = cursor
      ? [...this.points, { x: cursor.x, y: cursor.y, z: cursor.z }]
      : [...this.points];
    if (pts.length < 2) return;
    const shape: PolylineShape = {
      type: 'polyline',
      id: '__preview__',
      points: pts,
      closed: false,
      metadata: {},
    };
    this.previewGroup.add(buildPolylineWireframe(shape, SHAPE_COLOR_PREVIEW));
  }

  private commit(): void {
    if (this.points.length < 2) {
      this.ctx.cancelDraw();
      return;
    }
    const shape: PolylineShape = {
      type: 'polyline',
      id: `se-line-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      points: [...this.points],
      closed: false,
      metadata: {},
    };
    this.ctx.finishDraw(shape);
  }
}
