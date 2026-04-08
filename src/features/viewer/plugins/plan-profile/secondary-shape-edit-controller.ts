/**
 * Manages 2D polygon vertex editing in the secondary (plan/profile) viewport.
 *
 * Responsibilities:
 *  - Track pierce point positions (where polygon edges cross the slab) for click detection
 *    (The visual dots are rendered by slab-scene-filter; this controller only handles input.)
 *  - Detect clicks on pierce points → trigger "Add as vertex" callback
 *  - Render blue vertex markers (layer 2) for existing polygon vertices inside the slab
 *  - Click/drag-select blue vertex markers → sync selection with ShapeEditorEngine
 *  - Show a slab-aligned TransformControls gizmo (layer 2) when vertices are selected
 *  - Gizmo drag → move selected vertices via editEngine.updateShape()
 */

import {
  BufferGeometry,
  Float32BufferAttribute,
  Matrix4,
  Object3D,
  Points,
  PointsMaterial,
  Vector2,
  Vector3,
} from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { DragSelectController } from '../../modules/drag-select';
import type { DragSelectMode, SelectionFrustum } from '../../modules/drag-select';
import { isWorldPointInFrustum } from '../../modules/drag-select';
import type { SecondaryViewport } from '../../modules/plan-profile/secondary-viewport';
import { slabToClipBox } from '../../modules/plan-profile';
import type { PlaneSlab } from '../../modules/plan-profile';
import type { ShapeEditorEngine } from '../../modules/shape-editor';
import type { EditorShape, ElementRef, SelectionState } from '../../modules/shape-editor';
import type { ViewerPluginContext } from '../../types';

const PIERCE_CLICK_PX  = 14;  // screen-space pixel radius for pierce-point click
const VERTEX_CLICK_PX  = 12;  // screen-space pixel radius for vertex click
const SECONDARY_LAYER  =  2;  // Three.js layer for 2D-only objects (gizmo, markers)

type Vec3 = { x: number; y: number; z: number };

/** One pierce point: where a polygon edge intersects the slab cross-section. */
interface PiercePoint {
  worldPos: Vector3;
  edgeIndex: number;
}

/** One blue vertex marker: existing polygon vertex inside the slab. */
interface VertexMarker {
  worldPos: Vector3;
  vertexIndex: number;
}

// ── 3-D Liang–Barsky clip (duplicated from slab-scene-filter for encapsulation) ─

function clipSegmentToUnitBox(a: Vector3, b: Vector3): [number, number] | null {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  let tNear = 0, tFar = 1;
  const checks: [number, number][] = [
    [-dx, a.x + 0.5], [dx, 0.5 - a.x],
    [-dy, a.y + 0.5], [dy, 0.5 - a.y],
    [-dz, a.z + 0.5], [dz, 0.5 - a.z],
  ];
  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-10) { if (q < 0) return null; }
    else if (p < 0) { tNear = Math.max(tNear, q / p); }
    else { tFar = Math.min(tFar, q / p); }
    if (tNear > tFar) return null;
  }
  return [tNear, tFar];
}

export class SecondaryShapeEditController {
  private readonly ctx: ViewerPluginContext;
  private readonly secondaryVp: SecondaryViewport;
  private readonly getSlab: () => PlaneSlab | null;
  private readonly getEditEngine: () => ShapeEditorEngine | null;
  private readonly getAnnotationId: () => string | null;
  private readonly getVertices: () => Vec3[] | null;
  private readonly onPiercePointsSelected: (
    annotationId: string,
    piercePoints: Array<{ edgeIndex: number; worldPos: Vector3 }>,
    screenPos: { x: number; y: number },
  ) => void;

  // Pierce point positions (computed each frame; visuals rendered by slab-scene-filter)
  private piercePoints: PiercePoint[] = [];
  private selectedPierceIndices: Set<number> = new Set();
  private lastPointerUpClient = new Vector2();

  // Blue vertex markers (layer 2, managed here)
  private vertexMarkers: VertexMarker[] = [];
  private markerPoints: Points | null = null;   // unselected vertices (blue)
  private selMarkerPoints: Points | null = null; // selected vertices (cyan)

  // TransformControls gizmo (layer 2, secondary camera)
  private gizmo: TransformControls | null = null;
  private anchor: Object3D | null = null;
  private anchorStartPos = new Vector3();
  private originalShape: EditorShape | null = null;
  private isGizmoDragging = false;
  private unsubSelection: (() => void) | null = null;

  // Drag-select for vertices
  private dragSelect: DragSelectController;
  private isDragSelecting = false;
  private isPointerDown = false;
  private pointerDownClient = new Vector2();

  constructor(
    ctx: ViewerPluginContext,
    secondaryVp: SecondaryViewport,
    getSlab: () => PlaneSlab | null,
    getEditEngine: () => ShapeEditorEngine | null,
    getAnnotationId: () => string | null,
    getVertices: () => Vec3[] | null,
    onPiercePointsSelected: (
      annotationId: string,
      piercePoints: Array<{ edgeIndex: number; worldPos: Vector3 }>,
      screenPos: { x: number; y: number },
    ) => void,
  ) {
    this.ctx = ctx;
    this.secondaryVp = secondaryVp;
    this.getSlab = getSlab;
    this.getEditEngine = getEditEngine;
    this.getAnnotationId = getAnnotationId;
    this.getVertices = getVertices;
    this.onPiercePointsSelected = onPiercePointsSelected;

    this.dragSelect = new DragSelectController({
      domElement: secondaryVp.renderer.domElement,
      getCamera: () => secondaryVp.camera,
      onSelect: (frustum, mode) => this.applyDragSelect(frustum, mode),
      onClickEmpty: () => {
        this.getEditEngine()?.clearSelection();
        this.clearPierceSelection();
      },
    });
  }

  activate(): void {
    // Enable layer 2 on the secondary camera so layer-2 objects are visible in 2D.
    this.secondaryVp.camera.layers.enable(SECONDARY_LAYER);

    // Create anchor and gizmo.
    this.buildGizmo();

    // Subscribe to editEngine selection changes to update marker visuals.
    const engine = this.getEditEngine();
    if (engine) {
      const onSel = (_sel: SelectionState) => this.rebuildMarkers();
      engine.on('selection-changed', onSel);
      this.unsubSelection = () => engine.off('selection-changed', onSel);
    }

    const el = this.secondaryVp.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup',   this.onPointerUp);
  }

  deactivate(): void {
    this.secondaryVp.camera.layers.disable(SECONDARY_LAYER);

    this.destroyGizmo();
    this.clearMarkers();

    this.unsubSelection?.();
    this.unsubSelection = null;

    const el = this.secondaryVp.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup',   this.onPointerUp);
    this.dragSelect.deactivate();
    this.secondaryVp.controls.enabled = true;
    this.piercePoints = [];
    this.selectedPierceIndices.clear();
  }

  /** Called each frame after driveSecondaryLod(). Recomputes pierce/vertex positions. */
  update(): void {
    this.recomputePiercePoints();
    this.recomputeVertexMarkers();
    this.rebuildMarkers();
    this.updateGizmoPosition();
  }

  dispose(): void {
    this.deactivate();
  }

  // ── Gizmo lifecycle ──────────────────────────────────────────────────────────

  private buildGizmo(): void {
    this.anchor = new Object3D();
    this.anchor.layers.set(SECONDARY_LAYER);

    // Apply slab-aligned rotation so gizmo X = tangent, Y = up.
    const slab = this.getSlab();
    if (slab) {
      const m = new Matrix4().makeBasis(slab.tangent, new Vector3(0, 1, 0), slab.viewDir);
      this.anchor.quaternion.setFromRotationMatrix(m);
    }

    this.ctx.scene.add(this.anchor);

    this.gizmo = new TransformControls(
      this.secondaryVp.camera,
      this.secondaryVp.renderer.domElement,
    );
    this.gizmo.userData.secondaryViewport = true; // skip in slab-scene-filter
    this.gizmo.setMode('translate');
    this.gizmo.space = 'local';
    this.gizmo.showX = true;
    this.gizmo.showY = true;
    this.gizmo.showZ = false; // depth axis locked — no movement along viewDir
    this.gizmo.size = 0.7;
    // Traverse all children (visual arrows, planes) and set them to layer 2.
    this.gizmo.traverse((child) => { child.layers.set(SECONDARY_LAYER); });
    // TC's internal raycaster uses layer 0 by default — point it at layer 2
    // so it can detect its own handles which are now on layer 2 only.
    this.gizmo.getRaycaster().layers.set(SECONDARY_LAYER);

    // Wire gizmo events.
    this.gizmo.addEventListener('dragging-changed', (event) => {
      const dragging = (event as unknown as { value: boolean }).value;
      this.secondaryVp.controls.enabled = !dragging; // suppress pan/zoom during gizmo drag
      if (dragging) {
        this.anchorStartPos.copy(this.anchor!.position);
        const engine = this.getEditEngine();
        const annId = this.getAnnotationId();
        if (engine && annId) {
          const shape = engine.getShape(annId);
          this.originalShape = shape ? JSON.parse(JSON.stringify(shape)) : null;
        }
        this.isGizmoDragging = true;
      } else {
        // Drag ended — finalize for history.
        if (this.isGizmoDragging) {
          const engine = this.getEditEngine();
          const annId = this.getAnnotationId();
          if (engine && annId) {
            const shape = engine.getShape(annId);
            if (shape) engine.updateShape(shape);
          }
        }
        this.isGizmoDragging = false;
        this.originalShape = null;
        this.secondaryVp.controls.enabled = true;
      }
    });

    this.gizmo.addEventListener('change', () => {
      if (!this.isGizmoDragging || !this.originalShape || this.originalShape.type !== 'polyline') return;

      const delta = this.anchor!.position.clone().sub(this.anchorStartPos);
      const engine = this.getEditEngine();
      if (!engine) return;

      const sel = engine.getSelection();
      const shape = JSON.parse(JSON.stringify(this.originalShape)) as typeof this.originalShape;
      if (!shape || shape.type !== 'polyline') return;

      for (const el of sel.elements) {
        if (el.elementType !== 'vertex') continue;
        const v = shape.points[el.index];
        if (!v) continue;
        shape.points[el.index] = {
          x: v.x + delta.x,
          y: v.y + delta.y,
          z: v.z + delta.z,
        };
      }

      engine.updateShape(shape);
    });

    this.ctx.scene.add(this.gizmo as unknown as Object3D);
  }

  private destroyGizmo(): void {
    if (this.gizmo) {
      this.gizmo.detach();
      this.ctx.scene.remove(this.gizmo as unknown as Object3D);
      this.gizmo.dispose();
      this.gizmo = null;
    }
    if (this.anchor) {
      this.ctx.scene.remove(this.anchor);
      this.anchor = null;
    }
    this.isGizmoDragging = false;
    this.originalShape = null;
    this.secondaryVp.controls.enabled = true;
  }

  /** Position the gizmo anchor at the centroid of selected vertices. */
  private updateGizmoPosition(): void {
    if (!this.gizmo || !this.anchor) return;
    if (this.isGizmoDragging) return; // don't snap back while dragging

    const engine = this.getEditEngine();
    const vertices = this.getVertices();
    if (!engine || !vertices) {
      this.gizmo.detach();
      return;
    }

    const sel = engine.getSelection();
    const selectedVertices = sel.elements.filter((el) => el.elementType === 'vertex');
    if (selectedVertices.length === 0) {
      this.gizmo.detach();
      return;
    }

    // Centroid of selected vertices.
    const centroid = new Vector3();
    let count = 0;
    for (const el of selectedVertices) {
      const v = vertices[el.index];
      if (!v) continue;
      centroid.x += v.x;
      centroid.y += v.y;
      centroid.z += v.z;
      count++;
    }
    if (count === 0) { this.gizmo.detach(); return; }
    centroid.divideScalar(count);

    this.anchor.position.copy(centroid);
    this.gizmo.attach(this.anchor);
  }

  // ── Pierce point computation ────────────────────────────────────────────────

  private recomputePiercePoints(): void {
    this.piercePoints = [];
    const slab = this.getSlab();
    const vertices = this.getVertices();
    if (!slab || !vertices || vertices.length < 2) return;

    const clipBox = slabToClipBox(slab);
    const inv = clipBox.inverse;
    const n = vertices.length;
    const wA = new Vector3(), wB = new Vector3();
    const lA = new Vector3(), lB = new Vector3();

    // Build set of vertex indices that are inside the slab volume —
    // suppress pierce points for edges touching an inside vertex.
    const insideVertices = new Set<number>();
    for (let i = 0; i < n; i++) {
      const l = new Vector3(vertices[i].x, vertices[i].y, vertices[i].z).applyMatrix4(inv);
      if (l.x >= -0.5 && l.x <= 0.5 && l.y >= -0.5 && l.y <= 0.5 && l.z >= -0.5 && l.z <= 0.5) {
        insideVertices.add(i);
      }
    }

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      // Suppress orange dot if either endpoint is already an inside vertex.
      if (insideVertices.has(i) || insideVertices.has(j)) continue;

      wA.set(vertices[i].x, vertices[i].y, vertices[i].z);
      wB.set(vertices[j].x, vertices[j].y, vertices[j].z);
      lA.copy(wA).applyMatrix4(inv);
      lB.copy(wB).applyMatrix4(inv);

      const clip = clipSegmentToUnitBox(lA, lB);
      if (!clip) continue;

      const [t0, t1] = clip;
      const mid = wA.clone().lerp(wB, (t0 + t1) / 2);
      this.piercePoints.push({ worldPos: mid, edgeIndex: i });
    }
  }

  // ── Vertex marker computation ────────────────────────────────────────────────

  private recomputeVertexMarkers(): void {
    this.vertexMarkers = [];
    const slab = this.getSlab();
    const vertices = this.getVertices();
    if (!slab || !vertices) return;

    const clipBox = slabToClipBox(slab);
    const inv = clipBox.inverse;

    for (let i = 0; i < vertices.length; i++) {
      const l = new Vector3(vertices[i].x, vertices[i].y, vertices[i].z).applyMatrix4(inv);
      if (l.x >= -0.5 && l.x <= 0.5 && l.y >= -0.5 && l.y <= 0.5 && l.z >= -0.5 && l.z <= 0.5) {
        this.vertexMarkers.push({
          worldPos: new Vector3(vertices[i].x, vertices[i].y, vertices[i].z),
          vertexIndex: i,
        });
      }
    }
  }

  /** Rebuild the layer-2 blue/cyan Points objects from current vertex marker state. */
  private rebuildMarkers(): void {
    this.clearMarkers();
    if (this.vertexMarkers.length === 0) return;

    const engine = this.getEditEngine();
    const sel = engine?.getSelection();
    const selectedIndices = new Set(
      sel?.elements.filter((e) => e.elementType === 'vertex').map((e) => e.index) ?? [],
    );

    const unselPos: number[] = [];
    const selPos: number[] = [];

    for (const vm of this.vertexMarkers) {
      if (selectedIndices.has(vm.vertexIndex)) {
        selPos.push(vm.worldPos.x, vm.worldPos.y, vm.worldPos.z);
      } else {
        unselPos.push(vm.worldPos.x, vm.worldPos.y, vm.worldPos.z);
      }
    }

    if (unselPos.length > 0) {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(unselPos), 3));
      const mat = new PointsMaterial({
        color: 0x3b82f6, // blue
        size: 5,
        sizeAttenuation: false,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      });
      this.markerPoints = new Points(geo, mat);
      this.markerPoints.renderOrder = 950;
      this.markerPoints.layers.set(SECONDARY_LAYER);
      this.ctx.scene.add(this.markerPoints);
    }

    if (selPos.length > 0) {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(selPos), 3));
      const mat = new PointsMaterial({
        color: 0xfde047, // yellow for selected
        size: 7,
        sizeAttenuation: false,
        depthTest: false,
        transparent: true,
        opacity: 1.0,
      });
      this.selMarkerPoints = new Points(geo, mat);
      this.selMarkerPoints.renderOrder = 951;
      this.selMarkerPoints.layers.set(SECONDARY_LAYER);
      this.ctx.scene.add(this.selMarkerPoints);
    }
  }

  private clearMarkers(): void {
    if (this.markerPoints) {
      this.ctx.scene.remove(this.markerPoints);
      this.markerPoints.geometry.dispose();
      (this.markerPoints.material as PointsMaterial).dispose();
      this.markerPoints = null;
    }
    if (this.selMarkerPoints) {
      this.ctx.scene.remove(this.selMarkerPoints);
      this.selMarkerPoints.geometry.dispose();
      (this.selMarkerPoints.material as PointsMaterial).dispose();
      this.selMarkerPoints = null;
    }
  }

  // ── Pointer handlers ────────────────────────────────────────────────────────

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;

    // If the pointer is over a gizmo handle (axis is highlighted), let TC take it.
    // gizmo.axis is non-null when TC detected a hovered handle in the last pointermove.
    if (this.gizmo?.axis !== null) return;

    // Also bail if TC is already mid-drag.
    if (this.isGizmoDragging) return;

    this.isPointerDown = true;
    this.pointerDownClient.set(e.clientX, e.clientY);

    // 1. Check existing blue vertex markers (click to select).
    const vertexHit = this.findNearestVertexMarker(e.clientX, e.clientY);
    if (vertexHit !== null) {
      const vm = this.vertexMarkers[vertexHit];
      const engine = this.getEditEngine();
      const annId = this.getAnnotationId();
      if (engine && annId) {
        const additive = e.ctrlKey || e.metaKey;
        const sel = engine.getSelection();
        const alreadySelected = sel.elements.some(
          (el) => el.elementType === 'vertex' && el.index === vm.vertexIndex,
        );
        if (additive) {
          if (alreadySelected) {
            // Ctrl-click on selected → deselect it.
            engine.setSelection({
              shapes: new Set(),
              elements: sel.elements.filter(
                (el) => !(el.elementType === 'vertex' && el.index === vm.vertexIndex),
              ),
            });
          } else {
            engine.setSelection({
              shapes: new Set(),
              elements: [
                ...sel.elements,
                { shapeId: annId, elementType: 'vertex' as const, index: vm.vertexIndex },
              ],
            });
          }
        } else {
          engine.setSelection({
            shapes: new Set(),
            elements: [{ shapeId: annId, elementType: 'vertex' as const, index: vm.vertexIndex }],
          });
        }
      }
      this.clearPierceSelection();
      this.isPointerDown = false;
      return;
    }

    // 2. Check pierce points (click to add vertex).
    const pierceHit = this.findNearestPiercePoint(e.clientX, e.clientY);
    if (pierceHit !== null) {
      this.clearPierceSelection(); // reset before new selection
      this.setPierceSelection([pierceHit], e.clientX, e.clientY);
      this.isPointerDown = false;
      return;
    }

    // 3. Nothing hit — arm drag-select.
    this.dragSelect.handlePointerDown(e);
    this.isDragSelecting = false;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.isPointerDown) return;

    const dx = e.clientX - this.pointerDownClient.x;
    const dy = e.clientY - this.pointerDownClient.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Drag-select
    if (dist > 5) {
      if (!this.isDragSelecting) {
        this.isDragSelecting = true;
      }
      this.dragSelect.handlePointerMove(e);
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.lastPointerUpClient.set(e.clientX, e.clientY);

    if (this.isDragSelecting) {
      this.isDragSelecting = false;
      this.dragSelect.handlePointerUp(e);
    } else {
      this.dragSelect.handlePointerUp(e);
    }

    this.isPointerDown = false;
  };

  // ── Drag-select vertices / pierce points ───────────────────────────────────

  private applyDragSelect(frustum: SelectionFrustum, mode: DragSelectMode): void {
    const engine = this.getEditEngine();
    const annId = this.getAnnotationId();
    if (!engine || !annId) return;

    // Find vertex markers in frustum
    const foundVertices: ElementRef[] = [];
    for (const vm of this.vertexMarkers) {
      if (isWorldPointInFrustum(vm.worldPos.x, vm.worldPos.y, vm.worldPos.z, frustum)) {
        foundVertices.push({ shapeId: annId, elementType: 'vertex', index: vm.vertexIndex });
      }
    }

    // Find pierce points in frustum (only for replace-mode drag; add/subtract are vertex ops)
    const foundPierceIndices: number[] = [];
    if (mode === 'replace') {
      for (let i = 0; i < this.piercePoints.length; i++) {
        const pp = this.piercePoints[i];
        if (isWorldPointInFrustum(pp.worldPos.x, pp.worldPos.y, pp.worldPos.z, frustum)) {
          foundPierceIndices.push(i);
        }
      }
    }

    if (foundVertices.length > 0) {
      // Vertices found — select them, clear any pierce selection
      this.applyVertexSelection(foundVertices, mode, annId, engine);
      this.clearPierceSelection();
    } else if (foundPierceIndices.length > 0 && mode === 'replace') {
      // Only pierce points found — select them for "add vertex" popup
      engine.clearSelection();
      this.setPierceSelection(foundPierceIndices, this.lastPointerUpClient.x, this.lastPointerUpClient.y);
    } else {
      this.clearPierceSelection();
    }
  }

  private applyVertexSelection(
    found: ElementRef[],
    mode: DragSelectMode,
    annId: string,
    engine: ShapeEditorEngine,
  ): void {
    const prev = engine.getSelection().elements;
    const elementKey = (e: ElementRef) => `${e.shapeId}:${e.elementType}:${e.index}`;
    let elements: ElementRef[];
    if (mode === 'replace') {
      elements = found;
    } else if (mode === 'add') {
      const map = new Map(prev.map((e) => [elementKey(e), e]));
      for (const el of found) map.set(elementKey(el), el);
      elements = [...map.values()];
    } else {
      const removeKeys = new Set(found.map(elementKey));
      elements = prev.filter((e) => !removeKeys.has(elementKey(e)));
    }
    engine.setSelection({ shapes: new Set(), elements });
  }

  private setPierceSelection(indices: number[], screenX: number, screenY: number): void {
    this.selectedPierceIndices = new Set(indices);
    const annId = this.getAnnotationId();
    if (!annId || indices.length === 0) return;
    const piercePoints = indices.map((i) => ({
      edgeIndex: this.piercePoints[i].edgeIndex,
      worldPos: this.piercePoints[i].worldPos.clone(),
    }));
    this.onPiercePointsSelected(annId, piercePoints, { x: screenX, y: screenY });
  }

  private clearPierceSelection(): void {
    if (this.selectedPierceIndices.size > 0) {
      this.selectedPierceIndices.clear();
      this.onPiercePointsSelected('', [], { x: 0, y: 0 }); // empty = clear popup
    }
  }

  // ── Pierce point click detection ────────────────────────────────────────────

  private findNearestPiercePoint(clientX: number, clientY: number): number | null {
    if (this.piercePoints.length === 0) return null;
    return this.findNearestScreenPoint(
      this.piercePoints.map((pp) => pp.worldPos),
      clientX, clientY, PIERCE_CLICK_PX,
    );
  }

  private findNearestVertexMarker(clientX: number, clientY: number): number | null {
    if (this.vertexMarkers.length === 0) return null;
    return this.findNearestScreenPoint(
      this.vertexMarkers.map((vm) => vm.worldPos),
      clientX, clientY, VERTEX_CLICK_PX,
    );
  }

  private findNearestScreenPoint(
    worldPositions: Vector3[],
    clientX: number,
    clientY: number,
    threshold: number,
  ): number | null {
    const camera = this.secondaryVp.camera;
    const rect = this.secondaryVp.renderer.domElement.getBoundingClientRect();

    let best: number | null = null;
    let bestDist = threshold;

    for (let i = 0; i < worldPositions.length; i++) {
      const wp = worldPositions[i].clone().project(camera);
      const sx = ((wp.x + 1) / 2) * rect.width  + rect.left;
      const sy = ((-wp.y + 1) / 2) * rect.height + rect.top;
      const d = Math.sqrt((sx - clientX) ** 2 + (sy - clientY) ** 2);
      if (d < bestDist) { bestDist = d; best = i; }
    }

    return best;
  }
}
