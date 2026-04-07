import { Object3D, Vector3, Vector2, Quaternion, Euler, Group } from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import type { ShapeEditorInternalContext, EditorShape, TransformMode, ShapeId } from '../shape-editor-types';
import type { SnapAxis, AxisSnapGuide } from '../snapping/snap-engine';
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

  /** Guide lines shown during axis-constrained vertex snap. */
  private guideGroup: Group | null = null;

  /** Cursor position in DOM-element-local pixels, updated every pointermove. */
  private cursorPx = new Vector2(-9999, -9999);

  private readonly onPointerMove = (e: PointerEvent): void => {
    const rect = this.ctx.domElement.getBoundingClientRect();
    this.cursorPx.set(e.clientX - rect.left, e.clientY - rect.top);
  };

  constructor(ctx: ShapeEditorInternalContext) {
    this.ctx = ctx;
    this.ctx.domElement.addEventListener('pointermove', this.onPointerMove);
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
          // Drag ended — clear snap guides and emit updated events
          this.clearGuideLines();
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
    this.clearGuideLines();
    if (this.gizmo) {
      this.gizmo.detach();
      this.gizmo.visible = false;
    }
    this.ctx.orbitControls.enabled = true;
  }

  dispose(): void {
    this.ctx.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.deactivate();
    if (this.guideGroup) {
      this.ctx.scene.remove(this.guideGroup);
      this.guideGroup = null;
    }
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

  /**
   * Determine which axes the gizmo is currently constraining movement to.
   * Reads `gizmo.axis` first; falls back to inferring from `rawDelta` when the
   * axis string is absent or represents screen-space drag ('E', 'XYZE', etc.).
   */
  private getConstrainedAxes(rawDelta: Vector3): ReadonlySet<SnapAxis> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axisStr: string = (this.gizmo as any)?.axis ?? '';
    const axes = new Set<SnapAxis>();

    // 'E' = screen-space (trackball) drag — no meaningful axis constraint.
    // Only trust axisStr when it contains one or more of X/Y/Z.
    const hasX = axisStr.includes('X');
    const hasY = axisStr.includes('Y');
    const hasZ = axisStr.includes('Z');

    if (hasX || hasY || hasZ) {
      if (hasX) axes.add('x');
      if (hasY) axes.add('y');
      if (hasZ) axes.add('z');
    } else {
      // Fallback: infer from actual delta — axes with meaningful movement are constrained.
      const eps = 1e-4;
      if (Math.abs(rawDelta.x) > eps) axes.add('x');
      if (Math.abs(rawDelta.y) > eps) axes.add('y');
      if (Math.abs(rawDelta.z) > eps) axes.add('z');
    }

    return axes;
  }

  private applyGizmoTransform(): void {
    if (!this.anchor) return;
    const sel = this.ctx.getSelection();
    const hasElements = sel.elements.length > 0;
    const hasShapes = sel.shapes.size > 0;

    if (this.mode === 'translate') {
      const rawDelta = this.anchor.position.clone().sub(this.anchorStartPos);

      // Axis-constrained vertex snap (screen-space proximity)
      const axes = this.getConstrainedAxes(rawDelta);
      const snapResult = this.findAxisSnap(
        {
          x: this.anchorStartPos.x + rawDelta.x,
          y: this.anchorStartPos.y + rawDelta.y,
          z: this.anchorStartPos.z + rawDelta.z,
        },
        axes,
      );
      this.updateGuideLines(snapResult.guides);
      const delta = new Vector3(
        snapResult.snapped.x - this.anchorStartPos.x,
        snapResult.snapped.y - this.anchorStartPos.y,
        snapResult.snapped.z - this.anchorStartPos.z,
      );

      // Move the gizmo anchor to the snapped position so it stays with the shape.
      if (snapResult.guides.length > 0 && this.anchor) {
        this.anchor.position.set(
          this.anchorStartPos.x + delta.x,
          this.anchorStartPos.y + delta.y,
          this.anchorStartPos.z + delta.z,
        );
      }

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

  // ── Screen-space axis snap ─────────────────────────────────────────────────

  /** Screen-pixel proximity threshold for axis-snap to fire. */
  private static readonly SNAP_PX = 90;

  private static readonly GUIDE_COLOR = 0xff3333;

  /**
   * Screen-space axis snap.
   * For each constrained axis, finds the extra vertex that is within
   * SNAP_PX pixels of the proposed position and snaps to its world
   * coordinate on that axis.
   */
  private findAxisSnap(proposedPos: { x: number; y: number; z: number }, axes: ReadonlySet<SnapAxis>): { snapped: { x: number; y: number; z: number }; guides: AxisSnapGuide[] } {
    const extraVerts = this.ctx.snap.getExtraVertices();
    if (extraVerts.length === 0 || axes.size === 0 || this.ctx.config.snapToVertexRadius <= 0) {
      return { snapped: { ...proposedPos }, guides: [] };
    }

    const camera = this.ctx.getCamera();
    const rect = this.ctx.domElement.getBoundingClientRect();

    const projectToScreen = (p: { x: number; y: number; z: number }) => {
      const v = new Vector3(p.x, p.y, p.z).project(camera);
      return new Vector2((v.x * 0.5 + 0.5) * rect.width, (-v.y * 0.5 + 0.5) * rect.height);
    };

    // Use the actual cursor position — NOT the projected vertex position.
    // When dragging on a constrained axis (e.g. X), the vertex moves along X
    // while the cursor can be anywhere; proximity must be measured from the cursor.
    const cursor = this.cursorPx;
    const result = { ...proposedPos };
    const guides: AxisSnapGuide[] = [];

    // Find the single closest extra vertex to the cursor (shared across all axes).
    // Skip any vertex that sits at the drag-start position — that's the vertex being moved.
    const SELF_EPS = 0.001;
    let bestPx = TransformController.SNAP_PX;
    let bestVert: { x: number; y: number; z: number } | null = null;

    for (const v of extraVerts) {
      const dx = v.x - this.anchorStartPos.x;
      const dy = v.y - this.anchorStartPos.y;
      const dz = v.z - this.anchorStartPos.z;
      if (dx * dx + dy * dy + dz * dz < SELF_EPS * SELF_EPS) continue;
      const vScreen = projectToScreen(v);
      const px = cursor.distanceTo(vScreen);
      if (px < bestPx) { bestPx = px; bestVert = v; }
    }

    if (bestVert) {
      for (const axis of axes) {
        result[axis] = bestVert[axis];
        guides.push({ target: { ...bestVert }, dragged: { ...result }, axis });
      }
      // Update dragged field in all guides to reflect fully-snapped position
      for (const g of guides) g.dragged = { ...result };
    }

    return { snapped: result, guides };
  }

  // ── Guide lines ────────────────────────────────────────────────────────────

  private updateGuideLines(guides: AxisSnapGuide[]): void {
    this.clearGuideLines();
    if (guides.length === 0) return;

    if (!this.guideGroup) {
      this.guideGroup = new Group();
      this.guideGroup.name = 'snap-guides';
      this.ctx.scene.add(this.guideGroup);
    }

    const rendererSize = this.ctx.renderer.getSize(new Vector2());

    for (const guide of guides) {
      const color = TransformController.GUIDE_COLOR;

      // Line goes from the dragged vertex → the snap reference target
      const geo = new LineGeometry();
      geo.setPositions([
        guide.dragged.x, guide.dragged.y, guide.dragged.z,
        guide.target.x,  guide.target.y,  guide.target.z,
      ]);

      const mat = new LineMaterial({
        color,
        linewidth: 2.5,   // pixels — works with Line2 unlike LineBasicMaterial
        depthTest: false,
        resolution: rendererSize,
      });

      const line = new Line2(geo, mat);
      line.renderOrder = 970;
      line.computeLineDistances();
      this.guideGroup.add(line);
    }
  }

  private clearGuideLines(): void {
    if (!this.guideGroup) return;
    for (const child of [...this.guideGroup.children]) {
      if (child instanceof Line2) {
        (child.geometry as LineGeometry).dispose();
        (child.material as LineMaterial).dispose();
      }
    }
    this.guideGroup.clear();
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
