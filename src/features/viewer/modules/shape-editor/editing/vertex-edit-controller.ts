import { Vector2, Vector3, Mesh } from 'three';
import type { ShapeEditorInternalContext, HandleUserData, EditorShape, PolygonShape, PolylineShape, Vec3 } from '../shape-editor-types';
import { clientToNdc, raycastHorizontalPlane, raycastObjects, metersPerPixel } from '../utils/raycast-utils';
import { getHandleData } from '../visuals/handle-visual-builder';
import {
  obbCorners,
  obbMoveCorner,
  polygonMoveVertex,
  polylineMoveVertex,
  polygonInsertVertex,
  polylineInsertVertex,
  polygonEdges,
  polylineEdges,
} from '../utils/geometry-utils';
import { fromThreeVec3 } from '../utils/geometry-utils';

/**
 * Handles drag-based vertex editing.
 * Active when the editor is in `select` mode with sub-mode `vertex`.
 * Dragging a vertex handle moves the corresponding shape vertex.
 */
export class VertexEditController {
  private ctx: ShapeEditorInternalContext;
  private dragging = false;
  private activeHandle: HandleUserData | null = null;
  private originalShape: EditorShape | null = null;
  private mouseDownClient = new Vector2();
  private groundY = 0;
  private listening = false;

  /** Handle meshes to pick from (set by engine). */
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

  // ── Event handlers ─────────────────────────────────────────────────────────

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const ndc = clientToNdc(e.clientX, e.clientY, this.ctx.domElement);
    const camera = this.ctx.getCamera();

    // ── Vertex drag ────────────────────────────────────────────────────────────
    const vertexMeshes = this.handleMeshes.filter((m) => getHandleData(m.userData)?.kind === 'vertex');
    const hit = raycastObjects(ndc, camera, vertexMeshes);
    if (hit) {
      const data = getHandleData(hit.object.userData);
      if (!data) return;

      const shape = this.ctx.shapes.get(data.shapeId);
      if (!shape) return;

      const sel = this.ctx.getSelection();
      const isSelected = sel.elements.some(
        (el) => el.shapeId === data.shapeId && el.elementType === 'vertex' && el.index === data.index,
      );
      if (!isSelected) return;

      this.activeHandle = data;
      this.originalShape = JSON.parse(JSON.stringify(shape));
      this.mouseDownClient.set(e.clientX, e.clientY);
      this.groundY = this.getVertexY(shape, data.index);
      this.dragging = true;
      this.ctx.orbitControls.enabled = false;
      this.ctx.domElement.style.cursor = 'move';
      e.stopPropagation();
      return;
    }

    // ── Edge-mid click → insert vertex ─────────────────────────────────────────
    const edgeMidMeshes = this.handleMeshes.filter((m) => getHandleData(m.userData)?.kind === 'edge-mid');
    const edgeHit = raycastObjects(ndc, camera, edgeMidMeshes);
    if (edgeHit) {
      const data = getHandleData(edgeHit.object.userData);
      if (data) this.insertVertex(data, e);
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging || !this.activeHandle || !this.originalShape) return;

    const camera = this.ctx.getCamera();
    const ndc = clientToNdc(e.clientX, e.clientY, this.ctx.domElement);
    const hit = raycastHorizontalPlane(ndc, camera, this.groundY);
    if (!hit) return;

    // Apply snap — vertex snap takes priority over grid snap.
    // Exclude the shape being dragged so it doesn't snap to its own vertices.
    const snapResult = this.ctx.snap.snap(
      { x: hit.x, y: hit.y, z: hit.z },
      this.ctx.shapes,
      this.activeHandle ? [this.activeHandle.shapeId] : [],
    );
    hit.x = snapResult.snapped.x;
    hit.z = snapResult.snapped.z;
    hit.y = snapResult.didSnap ? snapResult.snapped.y : this.ctx.getElevation(hit.x, hit.z);

    const sel = this.ctx.getSelection();
    const selectedIndices = sel.elements
      .filter((el) => el.shapeId === this.activeHandle!.shapeId && el.elementType === 'vertex')
      .map((el) => el.index);

    // Move all selected vertices by the same delta
    const origPos = this.getVertexPos(this.originalShape, this.activeHandle.index);
    if (!origPos) return;

    const dx = hit.x - origPos.x;
    const dy = hit.y - origPos.y;
    const dz = hit.z - origPos.z;

    let shape = JSON.parse(JSON.stringify(this.originalShape)) as EditorShape;
    for (const idx of selectedIndices) {
      const vp = this.getVertexPos(this.originalShape, idx);
      if (!vp) continue;
      const newPos: Vec3 = { x: vp.x + dx, y: vp.y + dy, z: vp.z + dz };
      shape = this.applyVertexMove(shape, idx, newPos);
    }

    this.ctx.shapes.set(shape.id, shape);
    this.ctx.rebuildVisuals(shape.id);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.dragging) return;
    this.finishDrag();
  };

  // ── Insert vertex ───────────────────────────────────────────────────────────

  private insertVertex(data: HandleUserData, e: PointerEvent): void {
    const shape = this.ctx.shapes.get(data.shapeId);
    if (!shape || (shape.type !== 'polygon' && shape.type !== 'polyline')) return;

    // Compute midpoint of the clicked edge
    let mid: Vec3;
    let updated: EditorShape;
    const newIdx = data.index + 1;

    if (shape.type === 'polygon') {
      const edges = polygonEdges(shape);
      const edge = edges[data.index];
      if (!edge) return;
      const pa = shape.basePoints[edge[0]], pb = shape.basePoints[edge[1]];
      mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2, z: (pa.z + pb.z) / 2 };
      updated = polygonInsertVertex(shape as PolygonShape, data.index, mid);
    } else {
      const edges = polylineEdges(shape as PolylineShape);
      const edge = edges[data.index];
      if (!edge) return;
      const pa = (shape as PolylineShape).points[edge[0]], pb = (shape as PolylineShape).points[edge[1]];
      mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2, z: (pa.z + pb.z) / 2 };
      updated = polylineInsertVertex(shape as PolylineShape, data.index, mid);
    }

    this.ctx.shapes.set(updated.id, updated);
    this.ctx.emit('shape-updated', updated);

    // Select the new vertex and begin dragging it
    this.ctx.setSelection({ shapes: new Set(), elements: [
      { shapeId: updated.id, elementType: 'vertex', index: newIdx },
    ]});
    this.ctx.rebuildVisuals(updated.id);

    this.activeHandle = { _seHandle: true, kind: 'vertex', shapeId: updated.id, index: newIdx };
    this.originalShape = JSON.parse(JSON.stringify(updated));
    this.mouseDownClient.set(e.clientX, e.clientY);
    this.groundY = mid.y;
    this.dragging = true;
    this.ctx.orbitControls.enabled = false;
    this.ctx.domElement.style.cursor = 'move';
    e.stopPropagation();
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

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

  private getVertexPos(shape: EditorShape, index: number): Vec3 | null {
    switch (shape.type) {
      case 'obb': {
        const corners = obbCorners(shape);
        const c = corners[index];
        return c ? fromThreeVec3(c) : null;
      }
      case 'polygon': {
        const n = shape.basePoints.length;
        if (index < n) return shape.basePoints[index];
        const ti = index - n;
        const p = shape.basePoints[ti];
        return p ? { x: p.x, y: p.y + shape.height, z: p.z } : null;
      }
      case 'polyline':
        return shape.points[index] ?? null;
    }
  }

  private getVertexY(shape: EditorShape, index: number): number {
    return this.getVertexPos(shape, index)?.y ?? this.ctx.getElevation(0, 0);
  }

  private applyVertexMove(shape: EditorShape, index: number, newPos: Vec3): EditorShape {
    switch (shape.type) {
      case 'obb':
        return obbMoveCorner(shape, index, newPos);
      case 'polygon': {
        const n = shape.basePoints.length;
        if (index < n) {
          return polygonMoveVertex(shape, index, { x: newPos.x, y: newPos.y, z: newPos.z });
        }
        // Top vertex — adjust height
        const ti = index - n;
        const base = shape.basePoints[ti];
        const newHeight = Math.max(
          this.ctx.config.minExtrudeHeight,
          newPos.y - base.y,
        );
        return { ...shape, height: newHeight };
      }
      case 'polyline':
        return polylineMoveVertex(shape, index, newPos);
    }
  }
}
