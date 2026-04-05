import { Object3D, Vector3, Quaternion, Euler } from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { ShapeEditorInternalContext, EditorShape, TransformMode, ShapeId } from '../shape-editor-types';
import {
  shapeCentroid,
  translateShape,
  fromThreeVec3,
  elementsCentroid,
  getAffectedVertexIndices,
  applyVertexDelta,
} from '../utils/geometry-utils';

/**
 * Wraps Three.js TransformControls for translating, rotating, and scaling
 * selected shapes OR selected sub-elements (vertices / edges / faces).
 *
 * Shape mode (sel.shapes.size > 0):
 *   Anchor at selection centroid → translate/rotate/scale whole shapes.
 *
 * Element mode (sel.elements.length > 0):
 *   Anchor at element centroid → translate only; moves the affected vertices.
 */
export class TransformController {
  private ctx: ShapeEditorInternalContext;
  private gizmo: TransformControls | null = null;
  private anchor: Object3D | null = null;
  private active = false;
  private mode: TransformMode = 'translate';

  // State captured at drag-start
  private originalShapes = new Map<string, EditorShape>();
  private anchorStartPos = new Vector3();
  private anchorStartQuat = new Quaternion();

  constructor(ctx: ShapeEditorInternalContext) {
    this.ctx = ctx;
  }

  activate(mode: TransformMode = 'translate'): void {
    this.mode = mode;
    if (!this.gizmo) {
      const camera = this.ctx.getCamera();
      this.gizmo = new TransformControls(camera, this.ctx.domElement);
      this.gizmo.renderOrder = 940;
      this.ctx.scene.add(this.gizmo);

      this.anchor = new Object3D();
      this.ctx.scene.add(this.anchor);

      this.gizmo.attach(this.anchor);

      this.gizmo.addEventListener('dragging-changed', (event) => {
        const dragging = (event as unknown as { value: boolean }).value;
        if (dragging) {
          this.originalShapes.clear();
          const sel = this.ctx.getSelection();
          // Snapshot shapes for shape-mode transforms
          for (const id of sel.shapes) {
            const shape = this.ctx.shapes.get(id);
            if (shape) this.originalShapes.set(id, JSON.parse(JSON.stringify(shape)));
          }
          // Snapshot shapes for element-mode transforms
          for (const el of sel.elements) {
            if (!this.originalShapes.has(el.shapeId)) {
              const shape = this.ctx.shapes.get(el.shapeId);
              if (shape) this.originalShapes.set(el.shapeId, JSON.parse(JSON.stringify(shape)));
            }
          }
          if (this.anchor) this.anchorStartPos.copy(this.anchor.position);
          if (this.anchor) this.anchorStartQuat.copy(this.anchor.quaternion);
        } else {
          // Drag ended — emit updated events
          const sel = this.ctx.getSelection();
          const updated = new Set<ShapeId>([...sel.shapes]);
          for (const el of sel.elements) updated.add(el.shapeId);
          for (const id of updated) {
            const shape = this.ctx.shapes.get(id);
            if (shape) this.ctx.emit('shape-updated', shape);
          }
        }
      });

      this.gizmo.addEventListener('change', () => {
        if (!this.gizmo?.dragging || !this.anchor) return;
        this.applyGizmoTransform();
      });
    }

    // Always re-attach anchor — deactivate() calls detach(), so every activate()
    // must re-attach even if the gizmo was previously created.
    if (this.anchor) this.gizmo.attach(this.anchor);

    this.gizmo.setMode(this.mode);
    this.active = true;
    this.gizmo.visible = true;
  }

  deactivate(): void {
    this.active = false;
    if (this.gizmo) {
      this.gizmo.detach();
      this.gizmo.visible = false;
    }
    this.ctx.orbitControls.enabled = true;
  }

  dispose(): void {
    this.deactivate();
    if (this.gizmo) {
      this.ctx.scene.remove(this.gizmo);
      this.gizmo.dispose();
      this.gizmo = null;
    }
    if (this.anchor) {
      this.ctx.scene.remove(this.anchor);
      this.anchor = null;
    }
  }

  setMode(mode: TransformMode): void {
    this.mode = mode;
    this.gizmo?.setMode(mode);
  }

  /** Called every frame — updates camera and proactively blocks OrbitControls on hover/drag. */
  onUpdate(): void {
    if (!this.gizmo) return;
    this.gizmo.camera = this.ctx.getCamera();

    if (!this.active) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isBlocking = this.gizmo.dragging || (this.gizmo as any).axis !== null;
    if (isBlocking !== !this.ctx.orbitControls.enabled) {
      this.ctx.orbitControls.enabled = !isBlocking;
    }
  }

  /** Reposition anchor at selection centroid (whole-shape mode). */
  updateAnchorToSelection(): void {
    if (!this.anchor) return;
    const sel = this.ctx.getSelection();
    if (sel.shapes.size === 0) {
      if (this.gizmo) this.gizmo.visible = false;
      return;
    }
    let x = 0, y = 0, z = 0, count = 0;
    for (const id of sel.shapes) {
      const shape = this.ctx.shapes.get(id);
      if (!shape) continue;
      const c = shapeCentroid(shape);
      x += c.x; y += c.y; z += c.z; count++;
    }
    if (count === 0) return;
    this.anchor.position.set(x / count, y / count, z / count);
    this.anchor.quaternion.identity();
    this.anchorStartPos.copy(this.anchor.position);
    if (this.gizmo && this.active) this.gizmo.visible = true;
  }

  /** Reposition anchor at centroid of selected elements (element mode). */
  updateAnchorToElements(): void {
    if (!this.anchor) return;
    const sel = this.ctx.getSelection();
    if (sel.elements.length === 0) {
      if (this.gizmo) this.gizmo.visible = false;
      return;
    }
    const c = elementsCentroid(sel.elements, this.ctx.shapes);
    this.anchor.position.set(c.x, c.y, c.z);
    this.anchor.quaternion.identity();
    this.anchorStartPos.copy(this.anchor.position);
    if (this.gizmo && this.active) this.gizmo.visible = true;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private applyGizmoTransform(): void {
    if (!this.anchor) return;
    const sel = this.ctx.getSelection();
    const hasElements = sel.elements.length > 0;
    const hasShapes = sel.shapes.size > 0;

    if (this.mode === 'translate') {
      const delta = this.anchor.position.clone().sub(this.anchorStartPos);

      if (hasElements) {
        this.applyElementTranslate(delta.x, delta.y, delta.z);
      } else if (hasShapes) {
        for (const id of sel.shapes) {
          const orig = this.originalShapes.get(id);
          if (!orig) continue;
          this.ctx.shapes.set(id, translateShape(orig, delta.x, delta.y, delta.z));
        }
        this.ctx.rebuildVisuals();
      }
    } else if (this.mode === 'rotate' && hasShapes && !hasElements) {
      const qDelta = this.anchor.quaternion.clone();
      const euler = new Euler().setFromQuaternion(qDelta, 'YXZ');
      const dy = euler.y;
      for (const id of sel.shapes) {
        const orig = this.originalShapes.get(id);
        if (!orig) continue;
        if (orig.type === 'obb') {
          this.ctx.shapes.set(id, { ...orig, rotationY: orig.rotationY + dy });
        }
      }
      this.ctx.rebuildVisuals();
    }
  }

  private applyElementTranslate(dx: number, dy: number, dz: number): void {
    const sel = this.ctx.getSelection();

    // Collect affected vertex indices per shape
    const shapeVertices = new Map<ShapeId, Set<number>>();
    for (const el of sel.elements) {
      const shape = this.ctx.shapes.get(el.shapeId);
      if (!shape) continue;
      if (!shapeVertices.has(el.shapeId)) shapeVertices.set(el.shapeId, new Set());
      for (const v of getAffectedVertexIndices(shape, el)) {
        shapeVertices.get(el.shapeId)!.add(v);
      }
    }

    // Apply delta
    for (const [shapeId, vertexIndices] of shapeVertices) {
      const orig = this.originalShapes.get(shapeId);
      if (!orig) continue;
      this.ctx.shapes.set(shapeId, applyVertexDelta(orig, vertexIndices, dx, dy, dz));
    }
    this.ctx.rebuildVisuals();
  }
}
