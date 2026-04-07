import { Mesh, Vector2, Vector3 } from 'three';
import type {
  ShapeEditorInternalContext,
  SelectionState,
  ShapeId,
  HandleUserData,
  ElementRef,
  SubElementType,
  SelectSubMode,
} from '../shape-editor-types';
import { clientToNdc, raycastObjects } from '../utils/raycast-utils';
import { getHandleData } from '../visuals/handle-visual-builder';
import { DragSelectController, isWorldPointInFrustum } from '../../drag-select';
import type { SelectionFrustum, DragSelectMode } from '../../drag-select';

/**
 * Manages click-based shape and sub-element selection, plus drag-box selection.
 *
 * Shape mode:  click shape body → select whole shape.
 * Vertex/Edge/Face mode: click handle → select element; drag → box-select elements.
 * Ctrl+click / Ctrl+drag adds to selection, Alt+drag subtracts.
 */
export class SelectionController {
  private ctx: ShapeEditorInternalContext;
  private subMode: SelectSubMode = 'shape';
  private listening = false;
  private mouseDownPos = new Vector2();
  private isPointerDown = false;
  private isDragSelecting = false;

  private dragSelect: DragSelectController;

  handleMeshes: Mesh[] = [];
  shapeMeshes: Mesh[] = [];
  hoveredHandle: HandleUserData | null = null;

  constructor(ctx: ShapeEditorInternalContext) {
    this.ctx = ctx;
    this.dragSelect = new DragSelectController({
      domElement: ctx.domElement,
      getCamera: () => ctx.getCamera(),
      onSelect: (frustum, mode) => this.applyDragSelect(frustum, mode),
      // onClickEmpty is intentionally absent — click-to-clear is handled in onPointerUp
    });
  }

  activate(subMode: SelectSubMode = 'shape'): void {
    this.subMode = subMode;
    if (!this.listening) {
      this.listening = true;
      this.ctx.domElement.addEventListener('pointerdown', this.onPointerDownCapture, { capture: true });
      this.ctx.domElement.addEventListener('pointerdown', this.onPointerDown);
      this.ctx.domElement.addEventListener('pointerup', this.onPointerUp);
      this.ctx.domElement.addEventListener('pointermove', this.onPointerMove);
      this.ctx.domElement.addEventListener('keydown', this.onKeyDown);
    }
  }

  deactivate(): void {
    if (!this.listening) return;
    this.listening = false;
    this.ctx.domElement.removeEventListener('pointerdown', this.onPointerDownCapture, { capture: true });
    this.ctx.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.ctx.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.ctx.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.ctx.domElement.removeEventListener('keydown', this.onKeyDown);
    this.isDragSelecting = false;
    this.isPointerDown = false;
    this.hoveredHandle = null;
  }

  setSubMode(mode: SelectSubMode): void {
    this.subMode = mode;
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  /** Capture-phase: always fires even when TransformControls stopPropagation blocks bubble. */
  private readonly onPointerDownCapture = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.mouseDownPos.set(e.clientX, e.clientY);
  };

  /** Bubble-phase: blocked by TransformControls when gizmo is clicked — intentional. */
  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.isPointerDown = true;
    this.isDragSelecting = false;
    this.dragSelect.handlePointerDown(e);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    // Drag-select: only in vertex/edge/face sub-modes
    if (this.isPointerDown && this.subMode !== 'shape' && this.ctx.getMode() === 'select') {
      this.dragSelect.handlePointerMove(e);

      if (this.dragSelect.isDragging && !this.isDragSelecting) {
        // Drag just started — abort if orbit/gizmo already has control
        if (!this.ctx.orbitControls.enabled) {
          this.isPointerDown = false;
          return;
        }
        this.isDragSelecting = true;
        this.ctx.orbitControls.enabled = false;
      }

      if (this.isDragSelecting) return; // skip hover while drag-selecting
    }

    if (this.isDragSelecting) return;

    // Hover highlight
    const ndc = clientToNdc(e.clientX, e.clientY, this.ctx.domElement);
    const camera = this.ctx.getCamera();
    const pickMeshes = this.subMode === 'shape'
      ? this.shapeMeshes
      : this.handleMeshes.filter((m) => {
          const d = getHandleData(m.userData);
          if (!d) return false;
          if (this.subMode === 'vertex') return d.kind === 'vertex';
          if (this.subMode === 'edge')   return d.kind === 'edge-mid';
          if (this.subMode === 'face')   return d.kind === 'face-extrude';
          return false;
        });

    const hit = raycastObjects(ndc, camera, pickMeshes);
    const newHovered = hit ? getHandleData(hit.object.userData) : null;
    if (JSON.stringify(newHovered) !== JSON.stringify(this.hoveredHandle)) {
      this.hoveredHandle = newHovered;
      if (this.subMode === 'vertex' || this.subMode === 'shape') {
        this.ctx.rebuildVisuals();
      } else {
        this.ctx.rebuildHandles();
      }
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.isPointerDown = false;

    if (this.isDragSelecting) {
      this.isDragSelecting = false;
      this.ctx.orbitControls.enabled = true;
      this.dragSelect.handlePointerUp(e); // → fires onSelect → applyDragSelect
      return;
    }

    // Pass through to dragSelect so it can detect click-empty if needed
    this.dragSelect.handlePointerUp(e);

    if (e.button !== 0) return;
    const dx = e.clientX - this.mouseDownPos.x;
    const dy = e.clientY - this.mouseDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 6) return;

    const ndc = clientToNdc(e.clientX, e.clientY, this.ctx.domElement);
    const camera = this.ctx.getCamera();
    const additive = e.ctrlKey || e.metaKey;

    if (this.subMode === 'shape') {
      const hit = raycastObjects(ndc, camera, this.shapeMeshes);
      if (hit) {
        const shapeId = hit.object.userData.shapeId as ShapeId | undefined;
        if (shapeId) { this.selectShape(shapeId, additive); return; }
      }
      if (!additive) this.clearSelection();
    } else {
      const pickMeshes = this.handleMeshes.filter((m) => {
        const d = getHandleData(m.userData);
        if (!d) return false;
        if (this.subMode === 'vertex') return d.kind === 'vertex';
        if (this.subMode === 'edge')   return d.kind === 'edge-mid';
        if (this.subMode === 'face')   return d.kind === 'face-extrude';
        return false;
      });
      const hit = raycastObjects(ndc, camera, pickMeshes);
      if (hit) {
        const data = getHandleData(hit.object.userData);
        if (data) {
          const elementType: SubElementType =
            data.kind === 'vertex'   ? 'vertex' :
            data.kind === 'edge-mid' ? 'edge'   : 'face';
          this.selectElement(
            { shapeId: data.shapeId, elementType, index: data.index, faceAxis: data.faceAxis },
            additive,
          );
          return;
        }
      }
      if (!additive) this.clearSelection();
    }
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.ctx.config.deleteHandled) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const sel = this.ctx.getSelection();
      if (sel.shapes.size > 0) {
        for (const id of sel.shapes) {
          this.ctx.shapes.delete(id);
          this.ctx.emit('shape-deleted', { id });
          this.ctx.rebuildVisuals();
        }
        this.clearSelection();
      }
    }
    if (this.ctx.config.escapeHandled && e.key === 'Escape') {
      this.clearSelection();
    }
  };

  // ── Drag-select application ─────────────────────────────────────────────────

  private applyDragSelect(frustum: SelectionFrustum, mode: DragSelectMode): void {
    if (this.subMode === 'shape') {
      this.boxSelectShapes(frustum, mode);
    } else {
      this.boxSelectElements(frustum, mode);
    }
  }

  private boxSelectShapes(frustum: SelectionFrustum, mode: DragSelectMode): void {
    const found = new Set<ShapeId>();
    for (const mesh of this.shapeMeshes) {
      const shapeId = mesh.userData.shapeId as ShapeId | undefined;
      if (!shapeId) continue;
      const pos = mesh.getWorldPosition(new Vector3());
      if (isWorldPointInFrustum(pos.x, pos.y, pos.z, frustum)) found.add(shapeId);
    }

    const prev = this.ctx.getSelection();
    if (mode === 'replace') {
      if (found.size > 0) this.ctx.setSelection({ shapes: found, elements: [] });
    } else if (mode === 'add') {
      const merged = new Set([...prev.shapes, ...found]);
      this.ctx.setSelection({ shapes: merged, elements: [] });
    } else { // subtract
      const remaining = new Set([...prev.shapes].filter((id) => !found.has(id)));
      this.ctx.setSelection({ shapes: remaining, elements: [] });
    }
  }

  private boxSelectElements(frustum: SelectionFrustum, mode: DragSelectMode): void {
    const found: ElementRef[] = [];

    for (const mesh of this.handleMeshes) {
      const data = getHandleData(mesh.userData);
      if (!data) continue;
      if (this.subMode === 'vertex' && data.kind !== 'vertex')     continue;
      if (this.subMode === 'edge'   && data.kind !== 'edge-mid')   continue;
      if (this.subMode === 'face'   && data.kind !== 'face-extrude') continue;

      const pos = mesh.getWorldPosition(new Vector3());
      if (!isWorldPointInFrustum(pos.x, pos.y, pos.z, frustum)) continue;

      const elementType: SubElementType =
        data.kind === 'vertex'   ? 'vertex' :
        data.kind === 'edge-mid' ? 'edge'   : 'face';
      found.push({ shapeId: data.shapeId, elementType, index: data.index, faceAxis: data.faceAxis });
    }

    const elementKey = (e: ElementRef) => `${e.shapeId}:${e.elementType}:${e.index}`;
    const prev = this.ctx.getSelection().elements;

    if (mode === 'replace') {
      if (found.length > 0) this.ctx.setSelection({ shapes: new Set(), elements: found });
    } else if (mode === 'add') {
      const map = new Map(prev.map((e) => [elementKey(e), e]));
      for (const el of found) map.set(elementKey(el), el);
      this.ctx.setSelection({ shapes: new Set(), elements: [...map.values()] });
    } else { // subtract
      const removeKeys = new Set(found.map(elementKey));
      const remaining = prev.filter((e) => !removeKeys.has(elementKey(e)));
      this.ctx.setSelection({ shapes: new Set(), elements: remaining });
    }
  }

  // ── Selection manipulation ──────────────────────────────────────────────────

  selectShape(id: ShapeId, additive: boolean): void {
    const prev = this.ctx.getSelection();
    let shapes: Set<ShapeId>;
    if (additive) {
      shapes = new Set(prev.shapes);
      if (shapes.has(id)) shapes.delete(id); else shapes.add(id);
    } else {
      shapes = new Set([id]);
    }
    this.ctx.setSelection({ shapes, elements: [] });
  }

  selectElement(ref: ElementRef, additive: boolean): void {
    const prev = this.ctx.getSelection();
    let elements: ElementRef[];
    if (additive) {
      const idx = prev.elements.findIndex(
        (e) => e.shapeId === ref.shapeId && e.elementType === ref.elementType && e.index === ref.index,
      );
      elements = idx >= 0
        ? prev.elements.filter((_, i) => i !== idx)
        : [...prev.elements, ref];
    } else {
      elements = [ref];
    }
    this.ctx.setSelection({ shapes: new Set(), elements });
  }

  clearSelection(): void {
    const prev = this.ctx.getSelection();
    if (prev.shapes.size === 0 && prev.elements.length === 0) return;
    this.ctx.setSelection({ shapes: new Set(), elements: [] });
  }
}
