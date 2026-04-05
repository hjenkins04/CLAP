import { Group, Vector3 } from 'three';
import type { ShapeEditorInternalContext, PolygonShape, Vec3 } from '../shape-editor-types';
import { clientToNdc, raycastHorizontalPlane } from '../utils/raycast-utils';
import { buildPolygonWireframe } from '../visuals/shape-visual-builder';
import { SHAPE_COLOR_PREVIEW } from '../visuals/visual-constants';
import { clearGroup } from '../utils/dispose-utils';

/**
 * Polygon drawing: click to place vertices, double-click or Enter to close.
 * Backspace removes the last vertex. Escape cancels.
 */
export class PolygonDrawController {
  private ctx: ShapeEditorInternalContext;
  private vertices: Vec3[] = [];
  private previewGroup: Group | null = null;
  private groundY = 0;
  private lastClickTime = 0;
  private lastMouseClient = { x: 0, y: 0 };

  constructor(ctx: ShapeEditorInternalContext) {
    this.ctx = ctx;
  }

  activate(): void {
    this.vertices = [];
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
    this.vertices = [];
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;

    const hit = this.groundHit(e.clientX, e.clientY);
    if (!hit) return;

    const now = performance.now();
    const isDblClick = now - this.lastClickTime < 350;
    this.lastClickTime = now;

    if (isDblClick && this.vertices.length >= 2) {
      // Double-click: remove the last vertex added in the first click of this pair, then close
      this.vertices.pop();
      this.commit();
      return;
    }

    this.vertices.push({ x: hit.x, y: hit.y, z: hit.z });
    this.groundY = hit.y;
    this.rebuildPreview(null);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    this.lastMouseClient = { x: e.clientX, y: e.clientY };
    if (this.vertices.length === 0) return;
    const hit = this.groundHit(e.clientX, e.clientY);
    this.rebuildPreview(hit);
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      this.ctx.cancelDraw();
    } else if (e.key === 'Enter') {
      if (this.vertices.length >= 3) this.commit();
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      if (this.vertices.length > 0) {
        this.vertices.pop();
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
    if (this.vertices.length === 0) return;

    const pts = cursor
      ? [...this.vertices, { x: cursor.x, y: cursor.y, z: cursor.z }]
      : [...this.vertices];

    if (pts.length < 2) return;

    const shape: PolygonShape = {
      type: 'polygon',
      id: '__preview__',
      basePoints: pts,
      height: 0,
      metadata: {},
    };
    this.previewGroup.add(buildPolygonWireframe(shape, SHAPE_COLOR_PREVIEW));
  }

  private commit(): void {
    if (this.vertices.length < 3) {
      this.ctx.cancelDraw();
      return;
    }
    const shape: PolygonShape = {
      type: 'polygon',
      id: `se-poly-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      basePoints: [...this.vertices],
      height: 2.0, // default 2 m height; user can adjust via face-extrude handle
      metadata: {},
    };
    this.ctx.finishDraw(shape);
  }
}
