import { Vector2, Vector3, Mesh } from 'three';
import type { ShapeEditorInternalContext, HandleUserData, EditorShape, Vec3 } from '../shape-editor-types';
import { clientToNdc, raycastHorizontalPlane } from '../utils/raycast-utils';
import { raycastObjects } from '../utils/raycast-utils';
import { getHandleData } from '../visuals/handle-visual-builder';
import {
  obbCorners,
  OBB_EDGES,
  obbMoveEdgeMid,
  polygonMoveEdgeMid,
  polylineMoveEdgeMid,
  polygonEdges,
  polylineEdges,
} from '../utils/geometry-utils';
import { fromThreeVec3 } from '../utils/geometry-utils';

/**
 * Handles drag-based edge editing (moving edge midpoint handles).
 * Active when the editor is in `select` mode with sub-mode `edge`.
 */
export class EdgeEditController {
  private ctx: ShapeEditorInternalContext;
  private dragging = false;
  private activeHandle: HandleUserData | null = null;
  private originalShape: EditorShape | null = null;
  private groundY = 0;
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

    const edgeMeshes = this.handleMeshes.filter((m) => getHandleData(m.userData)?.kind === 'edge-mid');
    const hit = raycastObjects(ndc, camera, edgeMeshes);
    if (!hit) return;

    const data = getHandleData(hit.object.userData);
    if (!data) return;

    const shape = this.ctx.shapes.get(data.shapeId);
    if (!shape) return;

    const sel = this.ctx.getSelection();
    const isSelected = sel.elements.some(
      (el) => el.shapeId === data.shapeId && el.elementType === 'edge' && el.index === data.index,
    );
    if (!isSelected) return;

    this.activeHandle = data;
    this.originalShape = JSON.parse(JSON.stringify(shape));
    this.groundY = this.getEdgeMidY(shape, data.index);
    this.dragging = true;
    this.ctx.orbitControls.enabled = false;
    this.ctx.domElement.style.cursor = 'move';
    e.stopPropagation();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging || !this.activeHandle || !this.originalShape) return;

    const ndc = clientToNdc(e.clientX, e.clientY, this.ctx.domElement);
    const camera = this.ctx.getCamera();
    let hit = raycastHorizontalPlane(ndc, camera, this.groundY);
    if (!hit) return;

    hit.y = this.ctx.getElevation(hit.x, hit.z);
    const s = this.ctx.snap.snapXZ(hit.x, hit.z);
    hit.x = s.x; hit.z = s.z;

    const newMid: Vec3 = { x: hit.x, y: hit.y, z: hit.z };

    let shape: EditorShape = JSON.parse(JSON.stringify(this.originalShape));
    switch (shape.type) {
      case 'obb':     shape = obbMoveEdgeMid(shape, this.activeHandle.index, newMid); break;
      case 'polygon': shape = polygonMoveEdgeMid(shape, this.activeHandle.index, newMid); break;
      case 'polyline': shape = polylineMoveEdgeMid(shape, this.activeHandle.index, newMid); break;
    }

    this.ctx.shapes.set(shape.id, shape);
    this.ctx.rebuildVisuals(shape.id);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.dragging) return;
    this.finishDrag();
  };

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

  private getEdgeMidY(shape: EditorShape, edgeIdx: number): number {
    switch (shape.type) {
      case 'obb': {
        const [ai, bi] = OBB_EDGES[edgeIdx];
        const corners = obbCorners(shape);
        return (corners[ai].y + corners[bi].y) / 2;
      }
      case 'polygon': {
        const edges = polygonEdges(shape);
        const [a, b] = edges[edgeIdx];
        return (shape.basePoints[a].y + shape.basePoints[b].y) / 2;
      }
      case 'polyline': {
        const edges = polylineEdges(shape);
        const [a, b] = edges[edgeIdx];
        return (shape.points[a].y + shape.points[b].y) / 2;
      }
    }
  }
}
