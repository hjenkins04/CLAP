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

/**
 * Manages click-based shape and sub-element selection, plus drag-box selection.
 *
 * Shape mode:  click shape body → select whole shape.
 * Vertex/Edge/Face mode: click handle → select element; drag → box-select elements.
 * Ctrl+click toggles individual items.
 */
export class SelectionController {
  private ctx: ShapeEditorInternalContext;
  private subMode: SelectSubMode = 'shape';
  private listening = false;
  private mouseDownPos = new Vector2();
  private isPointerDown = false;
  private isDragSelecting = false;
  private selRectEl: HTMLDivElement | null = null;

  handleMeshes: Mesh[] = [];
  shapeMeshes: Mesh[] = [];
  hoveredHandle: HandleUserData | null = null;

  constructor(ctx: ShapeEditorInternalContext) {
    this.ctx = ctx;
  }

  activate(subMode: SelectSubMode = 'shape'): void {
    this.subMode = subMode;
    if (!this.listening) {
      this.listening = true;
      // Capture-phase: update mouseDownPos BEFORE TransformControls stopPropagation
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
    this.removeSelRect();
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
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    // Drag-select: only in select mode and only when pointer is down (not from gizmo)
    if (this.isPointerDown && this.subMode !== 'shape' && this.ctx.getMode() === 'select') {
      const dx = e.clientX - this.mouseDownPos.x;
      const dy = e.clientY - this.mouseDownPos.y;
      if (!this.isDragSelecting && Math.sqrt(dx * dx + dy * dy) > 8) {
        // Don't start drag-select if orbit is already disabled (gizmo hover/drag or vertex drag)
        if (!this.ctx.orbitControls.enabled) {
          this.isPointerDown = false;
          return;
        }
        this.isDragSelecting = true;
        this.ctx.orbitControls.enabled = false;
        this.showSelRect(this.mouseDownPos.x, this.mouseDownPos.y, e.clientX, e.clientY);
      } else if (this.isDragSelecting) {
        this.updateSelRect(this.mouseDownPos.x, this.mouseDownPos.y, e.clientX, e.clientY);
        return; // don't do hover while drag-selecting
      }
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
        // Full visual rebuild: vertex sphere colors need re-building the handle geometry.
        this.ctx.rebuildVisuals();
      } else if (this.subMode === 'edge' || this.subMode === 'face') {
        // Cheap rebuild: only update highlight overlays (no sphere geometry changes).
        this.ctx.rebuildHandles();
      }
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.isPointerDown = false;

    if (this.isDragSelecting) {
      this.isDragSelecting = false;
      this.ctx.orbitControls.enabled = true;
      this.finishDragSelect(e);
      this.removeSelRect();
      return;
    }

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
            data.kind === 'vertex' ? 'vertex' :
            data.kind === 'edge-mid' ? 'edge' : 'face';
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

  // ── Selection manipulation ─────────────────────────────────────────────────

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

  boxSelectShapes(screenRect: DOMRect): void {
    const camera = this.ctx.getCamera();
    const domRect = this.ctx.domElement.getBoundingClientRect();
    const selected = new Set<ShapeId>();
    for (const [id] of this.ctx.shapes) {
      for (const mesh of this.shapeMeshes) {
        if (mesh.userData.shapeId !== id) continue;
        const pos = mesh.getWorldPosition(new Vector3());
        const ndc = pos.project(camera);
        const sx = ((ndc.x + 1) / 2) * domRect.width + domRect.left;
        const sy = ((-ndc.y + 1) / 2) * domRect.height + domRect.top;
        if (sx >= screenRect.left && sx <= screenRect.right && sy >= screenRect.top && sy <= screenRect.bottom) {
          selected.add(id);
        }
      }
    }
    if (selected.size > 0) this.ctx.setSelection({ shapes: selected, elements: [] });
  }

  // ── Drag-select helpers ─────────────────────────────────────────────────────

  private showSelRect(x1: number, y1: number, x2: number, y2: number): void {
    if (!this.selRectEl) {
      const div = document.createElement('div');
      div.style.cssText =
        'position:fixed;pointer-events:none;border:1px solid rgba(68,136,255,0.9);' +
        'background:rgba(68,136,255,0.12);z-index:9999;box-sizing:border-box;';
      document.body.appendChild(div);
      this.selRectEl = div;
    }
    this.updateSelRect(x1, y1, x2, y2);
  }

  private updateSelRect(x1: number, y1: number, x2: number, y2: number): void {
    if (!this.selRectEl) return;
    const minX = Math.min(x1, x2), minY = Math.min(y1, y2);
    const maxX = Math.max(x1, x2), maxY = Math.max(y1, y2);
    Object.assign(this.selRectEl.style, {
      left: `${minX}px`, top: `${minY}px`,
      width: `${maxX - minX}px`, height: `${maxY - minY}px`,
    });
  }

  private removeSelRect(): void {
    if (this.selRectEl) {
      document.body.removeChild(this.selRectEl);
      this.selRectEl = null;
    }
  }

  private finishDragSelect(e: PointerEvent): void {
    const x1 = Math.min(this.mouseDownPos.x, e.clientX);
    const y1 = Math.min(this.mouseDownPos.y, e.clientY);
    const x2 = Math.max(this.mouseDownPos.x, e.clientX);
    const y2 = Math.max(this.mouseDownPos.y, e.clientY);
    this.boxSelectElements(new DOMRect(x1, y1, x2 - x1, y2 - y1));
  }

  private boxSelectElements(screenRect: DOMRect): void {
    const camera = this.ctx.getCamera();
    const domRect = this.ctx.domElement.getBoundingClientRect();
    const selected: ElementRef[] = [];

    for (const mesh of this.handleMeshes) {
      const data = getHandleData(mesh.userData);
      if (!data) continue;
      if (this.subMode === 'vertex' && data.kind !== 'vertex') continue;
      if (this.subMode === 'edge'   && data.kind !== 'edge-mid') continue;
      if (this.subMode === 'face'   && data.kind !== 'face-extrude') continue;

      const worldPos = mesh.getWorldPosition(new Vector3());
      const projected = worldPos.clone().project(camera);
      if (projected.z > 1) continue; // behind camera

      const sx = ((projected.x + 1) / 2) * domRect.width + domRect.left;
      const sy = ((-projected.y + 1) / 2) * domRect.height + domRect.top;

      if (sx >= screenRect.left && sx <= screenRect.right &&
          sy >= screenRect.top  && sy <= screenRect.bottom) {
        const elementType: SubElementType =
          data.kind === 'vertex' ? 'vertex' :
          data.kind === 'edge-mid' ? 'edge' : 'face';
        selected.push({ shapeId: data.shapeId, elementType, index: data.index, faceAxis: data.faceAxis });
      }
    }

    if (selected.length > 0) {
      this.ctx.setSelection({ shapes: new Set(), elements: selected });
    }
  }
}
