import { Vector2, Vector3, Mesh, PerspectiveCamera } from 'three';
import type { ShapeEditorInternalContext, HandleUserData, EditorShape, ObbShape, PolygonShape } from '../shape-editor-types';
import { clientToNdc, raycastVerticalPlane, metersPerPixel } from '../utils/raycast-utils';
import { raycastObjects } from '../utils/raycast-utils';
import { getHandleData } from '../visuals/handle-visual-builder';
import { obbMoveFace, OBB_FACE_AXES, type ObbFaceAxis } from '../utils/geometry-utils';

/**
 * Handles drag-based face extrusion.
 *
 * For OBB shapes: dragging a face-extrude handle moves that face outward/inward
 * along its normal, changing both the center and halfExtents of the OBB.
 *
 * For polygon shapes: dragging the top-face handle (index 0, +y) changes the
 * extrusion height.
 *
 * Active when the editor is in `select` mode with sub-mode `face`.
 */
export class FaceEditController {
  private ctx: ShapeEditorInternalContext;
  private dragging = false;
  private activeHandle: HandleUserData | null = null;
  private originalShape: EditorShape | null = null;
  private faceNormal = new Vector3(0, 1, 0);
  private faceStartWorld = new Vector3();
  private extrudeScreenY = 0;
  private listening = false;

  handleMeshes: Mesh[] = [];

  constructor(ctx: ShapeEditorInternalContext) {
    this.ctx = ctx;
  }

  activate(): void {
    if (!this.listening) {
      this.listening = true;
      this.ctx.domElement.addEventListener('pointerdown', this.onPointerDown);
      this.ctx.domElement.addEventListener('pointermove', this.onPointerMove);
      this.ctx.domElement.addEventListener('pointerup', this.onPointerUp);
    }
  }

  deactivate(): void {
    if (!this.listening) return;
    this.listening = false;
    this.ctx.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.ctx.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.ctx.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.finishDrag();
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const ndc = clientToNdc(e.clientX, e.clientY, this.ctx.domElement);
    const camera = this.ctx.getCamera();

    const faceMeshes = this.handleMeshes.filter((m) => getHandleData(m.userData)?.kind === 'face-extrude');
    const hit = raycastObjects(ndc, camera, faceMeshes);
    if (!hit) return;

    const data = getHandleData(hit.object.userData);
    if (!data) return;

    const shape = this.ctx.shapes.get(data.shapeId);
    if (!shape) return;

    const sel = this.ctx.getSelection();
    const isSelected = sel.elements.some(
      (el) => el.shapeId === data.shapeId && el.elementType === 'face' && el.index === data.index,
    );
    if (!isSelected) return;

    this.activeHandle = data;
    this.originalShape = JSON.parse(JSON.stringify(shape));
    this.faceStartWorld.copy(hit.object.getWorldPosition(new Vector3()));
    this.extrudeScreenY = e.clientY;
    this.faceNormal = this.getFaceNormal(data.faceAxis);
    this.dragging = true;
    this.ctx.orbitControls.enabled = false;
    this.ctx.domElement.style.cursor = 'ns-resize';
    e.stopPropagation();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging || !this.activeHandle || !this.originalShape) return;

    const camera = this.ctx.getCamera();
    const shapeId = this.activeHandle.shapeId;

    // Use a vertical plane through the face center, oriented to face the camera
    // on the axis perpendicular to the face normal (for best pointer feel).
    const ndc = clientToNdc(e.clientX, e.clientY, this.ctx.domElement);

    // Find the perpendicular to faceNormal that faces the camera (for vertical plane)
    const camDir = camera.position.clone().sub(this.faceStartWorld).normalize();
    const perpNormal = new Vector3().crossVectors(this.faceNormal, camDir).normalize();
    if (perpNormal.lengthSq() < 0.01) {
      // Face normal almost parallel to view — fall back to screen-space delta
      const dPx = this.extrudeScreenY - e.clientY;
      this.applyScreenSpaceExtrusion(dPx, shapeId);
      return;
    }

    const hitPoint = raycastVerticalPlane(ndc, camera, perpNormal, this.faceStartWorld);
    if (!hitPoint) return;

    const delta = hitPoint.clone().sub(this.faceStartWorld).dot(this.faceNormal);
    this.applyFaceDelta(delta, shapeId);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.dragging) return;
    this.finishDrag();
  };

  // ── Private helpers ─────────────────────────────────────────────────────────

  private applyFaceDelta(delta: number, shapeId: string): void {
    const orig = this.originalShape!;
    let updated: EditorShape;

    if (orig.type === 'obb' && this.activeHandle?.faceAxis) {
      updated = obbMoveFace(orig, this.activeHandle.faceAxis as ObbFaceAxis, delta);
    } else if (orig.type === 'polygon') {
      const newHeight = Math.max(this.ctx.config.minExtrudeHeight, orig.height + delta);
      updated = { ...orig, height: newHeight };
    } else {
      return;
    }

    this.ctx.shapes.set(shapeId, updated);
    this.ctx.rebuildVisuals(shapeId);
  }

  private applyScreenSpaceExtrusion(dPx: number, shapeId: string): void {
    const camera = this.ctx.getCamera();
    const dist = camera.position.distanceTo(this.faceStartWorld);
    const mpp = metersPerPixel(camera, dist, this.ctx.domElement.clientHeight);
    const delta = dPx * mpp;
    this.applyFaceDelta(delta, shapeId);
  }

  private getFaceNormal(faceAxis?: string): Vector3 {
    switch (faceAxis) {
      case '+x': return new Vector3(1, 0, 0);
      case '-x': return new Vector3(-1, 0, 0);
      case '+y': return new Vector3(0, 1, 0);
      case '-y': return new Vector3(0, -1, 0);
      case '+z': return new Vector3(0, 0, 1);
      case '-z': return new Vector3(0, 0, -1);
      default:   return new Vector3(0, 1, 0);
    }
  }

  private finishDrag(): void {
    if (this.dragging && this.activeHandle) {
      const shape = this.ctx.shapes.get(this.activeHandle.shapeId);
      if (shape) this.ctx.emit('shape-updated', shape);
    }
    this.dragging = false;
    this.activeHandle = null;
    this.originalShape = null;
    this.ctx.orbitControls.enabled = true;
    this.ctx.domElement.style.cursor = '';
  }
}
