import {
  BufferGeometry,
  Float32BufferAttribute,
  Matrix4,
  Points,
  PointsMaterial,
  Vector3,
} from 'three';
import { DragSelectController } from '../../modules/drag-select';
import type { DragSelectMode, SelectionFrustum } from '../../modules/drag-select';
import type { SecondaryViewport } from '../../modules/plan-profile/secondary-viewport';
import { slabToClipBox } from '../../modules/plan-profile';
import type { PlaneSlab } from '../../modules/plan-profile';
import type { ViewerPluginContext } from '../../types';
import { makePointId } from '../../services/point-cloud-editor/point-id';
import type { PointId } from '../../services/point-cloud-editor/types';
import { useAnnotateStore } from '../annotate/annotate-store';
import { useReclassifyStore } from '../reclassify/reclassify-store';

// ── Point-in-polygon (ray casting) ───────────────────────────────────────────

function isPointInPolygon2D(px: number, py: number, poly: [number, number][]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ── 2D Polygon draw overlay ───────────────────────────────────────────────────

/**
 * Lightweight polygon drawing for the secondary (2D profile) viewport.
 * Renders a canvas overlay for vertex preview and fires onComplete when
 * the polygon is closed (double-click, first-vertex click, or Enter).
 */
class SecondaryPolygonDraw {
  private readonly canvas: HTMLCanvasElement;
  private readonly onComplete: (ndcPolygon: [number, number][]) => void;
  private readonly onCancel: () => void;
  private readonly targetEl: HTMLCanvasElement;

  /** Vertices in canvas-local pixel coords [x, y] */
  private vertices: [number, number][] = [];
  private cursor: [number, number] | null = null;

  private readonly CLOSE_PX = 14;
  private readonly keyFn: (e: KeyboardEvent) => void;

  constructor(
    targetEl: HTMLCanvasElement,
    onComplete: (ndcPolygon: [number, number][]) => void,
    onCancel: () => void,
  ) {
    this.targetEl = targetEl;
    this.onComplete = onComplete;
    this.onCancel = onCancel;

    // Create overlay canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:50;';
    this.canvas.width  = targetEl.clientWidth;
    this.canvas.height = targetEl.clientHeight;

    const parent = targetEl.parentElement ?? document.body;
    parent.style.position = 'relative';
    parent.appendChild(this.canvas);

    this.keyFn = this.onKeyDown.bind(this);
    targetEl.addEventListener('pointerdown', this.onPointerDown);
    targetEl.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('keydown', this.keyFn);
    targetEl.style.cursor = 'crosshair';
  }

  dispose(): void {
    this.targetEl.removeEventListener('pointerdown', this.onPointerDown);
    this.targetEl.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('keydown', this.keyFn);
    this.canvas.remove();
    this.targetEl.style.cursor = '';
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const rect = this.targetEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check close-on-first-vertex
    if (this.vertices.length >= 3) {
      const [fx, fy] = this.vertices[0];
      const dx = x - fx, dy = y - fy;
      if (dx * dx + dy * dy <= this.CLOSE_PX * this.CLOSE_PX) {
        this.close();
        return;
      }
    }

    // Double-click closes
    // (handled implicitly via close-on-first-vertex for repeated clicks)

    this.vertices.push([x, y]);
    this.redraw();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const rect = this.targetEl.getBoundingClientRect();
    this.cursor = [e.clientX - rect.left, e.clientY - rect.top];
    this.redraw();
  };

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && this.vertices.length >= 3) {
      this.close();
    } else if (e.key === 'Escape') {
      this.dispose();
      this.onCancel();
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && this.vertices.length > 0) {
      this.vertices.pop();
      this.redraw();
    }
  }

  private close(): void {
    if (this.vertices.length < 3) return;
    const w = this.targetEl.clientWidth;
    const h = this.targetEl.clientHeight;
    const ndcPoly: [number, number][] = this.vertices.map(([px, py]) => [
      (px / w) * 2 - 1,
      -((py / h) * 2 - 1),
    ]);
    this.dispose();
    this.onComplete(ndcPoly);
  }

  private redraw(): void {
    const w = this.canvas.width  = this.targetEl.clientWidth;
    const h = this.canvas.height = this.targetEl.clientHeight;
    const ctx2d = this.canvas.getContext('2d');
    if (!ctx2d) return;
    ctx2d.clearRect(0, 0, w, h);
    if (this.vertices.length === 0) return;

    // Draw polygon outline
    ctx2d.beginPath();
    ctx2d.moveTo(this.vertices[0][0], this.vertices[0][1]);
    for (let i = 1; i < this.vertices.length; i++) {
      ctx2d.lineTo(this.vertices[i][0], this.vertices[i][1]);
    }
    if (this.cursor) ctx2d.lineTo(this.cursor[0], this.cursor[1]);
    ctx2d.strokeStyle = 'rgba(253, 224, 71, 0.9)';  // yellow
    ctx2d.lineWidth = 1.5;
    ctx2d.setLineDash([4, 3]);
    ctx2d.stroke();

    // Draw vertex dots
    ctx2d.setLineDash([]);
    for (let i = 0; i < this.vertices.length; i++) {
      const [vx, vy] = this.vertices[i];
      const isFirst = i === 0;
      ctx2d.beginPath();
      ctx2d.arc(vx, vy, isFirst ? 5 : 3, 0, Math.PI * 2);
      ctx2d.fillStyle = isFirst ? 'rgba(0, 229, 255, 0.9)' : 'rgba(253, 224, 71, 0.9)';
      ctx2d.fill();
      // Close indicator ring on first vertex when ≥ 3 vertices
      if (isFirst && this.vertices.length >= 3) {
        ctx2d.beginPath();
        ctx2d.arc(vx, vy, this.CLOSE_PX, 0, Math.PI * 2);
        ctx2d.strokeStyle = 'rgba(0, 229, 255, 0.4)';
        ctx2d.lineWidth = 1;
        ctx2d.stroke();
      }
    }
  }
}

/** Pre-extracted inverse matrix elements for fast inline point-in-box test */
interface ClipInverse {
  e: Float64Array;
}

export class SecondaryReclassifyController {
  private readonly secondaryVp: SecondaryViewport;
  private readonly ctx: ViewerPluginContext;
  private readonly getSlab: () => PlaneSlab | null;

  private dragSelect: DragSelectController;
  private polygonDraw: SecondaryPolygonDraw | null = null;
  private unsubTool: (() => void) | null = null;

  private selectionFrustum: SelectionFrustum | null = null;
  private processedNodes = new Set<string>();

  private selectedPositions: number[] = [];
  private selectedPointIds: PointId[] = [];
  private selectedPointKeys = new Set<string>();

  private highlightPoints: Points | null = null;

  // Track whether we currently own the reclassify store's apply function, and
  // what the previous apply function was so we can restore it on clear.
  private isOwningStore = false;
  private prevApplyFn: ((classId: number) => void) | null = null;
  private readonly boundApplyFn: (classId: number) => void;

  constructor(
    secondaryVp: SecondaryViewport,
    ctx: ViewerPluginContext,
    getSlab: () => PlaneSlab | null,
  ) {
    this.secondaryVp = secondaryVp;
    this.ctx = ctx;
    this.getSlab = getSlab;
    this.boundApplyFn = this.applyClassification.bind(this);

    this.dragSelect = new DragSelectController({
      domElement: secondaryVp.renderer.domElement,
      getCamera: () => secondaryVp.camera,
      onSelect: (frustum, mode) => this.handleDragSelect(frustum, mode),
      onClickEmpty: () => { if (this.selectionFrustum) this.clearSelection(); },
    });
  }

  // Temporarily suppress controls while the pointer is held during a drag-select
  // so the rubber-band rect doesn't compete with camera pan. Released on pointerup.
  private readonly onPointerDown = (e: PointerEvent): void => {
    // Only suppress controls for left-click — right-click pans the 2D camera.
    if (e.button !== 0) return;
    this.secondaryVp.controls.enabled = false;
  };
  private readonly onPointerUp = (): void => {
    this.secondaryVp.controls.enabled = true;
  };

  activate(): void {
    // Controls stay enabled; they are only suppressed while a drag is in progress.
    this.secondaryVp.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);

    // Subscribe to tool changes
    this.unsubTool = useReclassifyStore.subscribe((s, prev) => {
      if (s.activeTool !== prev.activeTool) {
        this.handleToolChange(s.activeTool);
      }
    });

    this.handleToolChange(useReclassifyStore.getState().activeTool);
  }

  deactivate(): void {
    this.secondaryVp.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.secondaryVp.controls.enabled = true;
    this.unsubTool?.();
    this.unsubTool = null;
    this.stopPolygonDraw();
    this.dragSelect.deactivate();
    this.clearSelection();
  }

  update(): void {
    if (!this.selectionFrustum) return;
    this.evaluateNewNodes();
  }

  private handleToolChange(tool: 'drag-select' | 'polygon'): void {
    if (tool === 'polygon') {
      this.dragSelect.deactivate();
      this.startPolygonDraw();
    } else {
      this.stopPolygonDraw();
      this.dragSelect.activate();
    }
  }

  private startPolygonDraw(): void {
    if (this.polygonDraw) return;
    this.polygonDraw = new SecondaryPolygonDraw(
      this.secondaryVp.renderer.domElement,
      (ndcPolygon) => {
        // Polygon is drawn — expose Confirm button in the 2D panel
        useReclassifyStore.getState().setPolygonConfirm(
          true,
          '2d',
          () => this.confirmPolygonSelection(ndcPolygon),
        );
      },
      () => {
        useReclassifyStore.getState().clearPolygonConfirm();
        useReclassifyStore.getState().setActiveTool('drag-select');
      },
    );
  }

  private stopPolygonDraw(): void {
    this.polygonDraw?.dispose();
    this.polygonDraw = null;
    useReclassifyStore.getState().clearPolygonConfirm();
  }

  private confirmPolygonSelection(ndcPolygon: [number, number][]): void {
    useReclassifyStore.getState().clearPolygonConfirm();
    this.evaluateNodesPolygon(ndcPolygon);
  }

  applyClassification(classId: number): void {
    if (this.selectedPointIds.length === 0) return;
    this.ctx.getEditor().setClassification(this.selectedPointIds, classId);
    this.clearSelection();
  }

  clearSelection(): void {
    this.selectionFrustum = null;
    this.processedNodes.clear();
    this.selectedPositions = [];
    this.selectedPointIds = [];
    this.selectedPointKeys.clear();
    this.clearHighlight();
    // Release ownership of the reclassify store and restore the previous apply fn.
    if (this.isOwningStore) {
      this.isOwningStore = false;
      const store = useReclassifyStore.getState();
      store.setApplyFn(this.prevApplyFn);
      store.setSelectedCount(0);
      store.setGizmoScreenPos(null);
      store.setPhase('selecting');
      this.prevApplyFn = null;
    }
  }

  dispose(): void {
    this.deactivate();
    this.dragSelect.deactivate();
    this.clearHighlight();
  }

  // ── Drag-select handler ───────────────────────────────────────────────────────

  private handleDragSelect(frustum: SelectionFrustum, mode: DragSelectMode): void {
    if (mode === 'subtract') {
      if (this.selectedPointIds.length > 0) this.subtractFromSelection(frustum);
      return;
    }

    // Take ownership of the reclassify store on first drag, saving whatever
    // apply fn was there before (the primary 3D reclassify plugin's fn).
    if (!this.isOwningStore) {
      this.prevApplyFn = useReclassifyStore.getState()._applyReclassification;
      this.isOwningStore = true;
      useReclassifyStore.getState().setApplyFn(this.boundApplyFn);
    }

    if (mode === 'replace') {
      this.selectedPositions = [];
      this.selectedPointIds = [];
      this.selectedPointKeys.clear();
    }

    this.selectionFrustum = frustum;
    this.processedNodes.clear();
    // Do NOT call evaluateNewNodes() here — visibleNodes at this point has already
    // been restored to the primary camera's nodes by renderSecondary(). Evaluation
    // is deferred to the next update() call, which runs after driveSecondaryLod()
    // has populated visibleNodes with the correct slab-area nodes.
  }

  // ── Slab clip test ────────────────────────────────────────────────────────────

  private buildSlabClipInverse(): ClipInverse | null {
    const slab = this.getSlab();
    if (!slab) return null;
    const clipBox = slabToClipBox(slab);
    return { e: new Float64Array(clipBox.inverse.elements) };
  }

  private isPointInSlab(wx: number, wy: number, wz: number, clip: ClipInverse): boolean {
    const { e } = clip;
    const lx = e[0]*wx + e[4]*wy + e[8]*wz  + e[12];
    const ly = e[1]*wx + e[5]*wy + e[9]*wz  + e[13];
    const lz = e[2]*wx + e[6]*wy + e[10]*wz + e[14];
    return lx >= -0.5 && lx <= 0.5 && ly >= -0.5 && ly <= 0.5 && lz >= -0.5 && lz <= 0.5;
  }

  // ── Subtract mode ─────────────────────────────────────────────────────────────

  private subtractFromSelection(frustum: SelectionFrustum): void {
    const { ndcMinX, ndcMaxX, ndcMinY, ndcMaxY, vpMatrix } = frustum;
    const m = vpMatrix.elements;

    const keptPositions: number[] = [];
    const keptIds: PointId[] = [];
    const keptKeys = new Set<string>();

    for (let i = 0; i < this.selectedPointIds.length; i++) {
      const wx = this.selectedPositions[i * 3];
      const wy = this.selectedPositions[i * 3 + 1];
      const wz = this.selectedPositions[i * 3 + 2];

      const cw = m[3]*wx + m[7]*wy + m[11]*wz + m[15];
      if (cw > 0) {
        const ndcX = (m[0]*wx + m[4]*wy + m[8]*wz  + m[12]) / cw;
        const ndcY = (m[1]*wx + m[5]*wy + m[9]*wz  + m[13]) / cw;
        if (ndcX >= ndcMinX && ndcX <= ndcMaxX && ndcY >= ndcMinY && ndcY <= ndcMaxY) continue;
      }

      keptPositions.push(wx, wy, wz);
      keptIds.push(this.selectedPointIds[i]);
      keptKeys.add(this.selectedPointIds[i]);
    }

    this.selectedPositions = keptPositions;
    this.selectedPointIds = keptIds;
    this.selectedPointKeys = keptKeys;
    this.rebuildHighlight();
    this.updateStore();
  }

  // ── Selection evaluation ──────────────────────────────────────────────────────

  /** Select points whose NDC position (secondary camera) lies inside the drawn polygon. */
  private evaluateNodesPolygon(ndcPolygon: [number, number][]): void {
    if (ndcPolygon.length < 3) return;

    const { classVisibility, classActive } = useAnnotateStore.getState();
    const pointClouds = this.ctx.getPointClouds();
    const slabClip = this.buildSlabClipInverse();
    const vpMatrix = this.secondaryVp.camera.projectionMatrix.clone()
      .multiply(this.secondaryVp.camera.matrixWorldInverse);
    const mvp = new Matrix4();

    // Take ownership of the store
    if (!this.isOwningStore) {
      this.prevApplyFn = useReclassifyStore.getState()._applyReclassification;
      this.isOwningStore = true;
      useReclassifyStore.getState().setApplyFn(this.boundApplyFn);
    }

    // Fresh selection
    this.selectedPositions = [];
    this.selectedPointIds = [];
    this.selectedPointKeys.clear();

    for (const pco of pointClouds) {
      pco.updateMatrixWorld(true);

      for (const node of pco.visibleNodes) {
        const nodeKey = node.geometryNode?.name;
        if (!nodeKey) continue;

        const sceneNode = node.sceneNode;
        if (!sceneNode) continue;
        const geom = sceneNode.geometry;
        if (!geom) continue;
        const posAttr = geom.getAttribute('position');
        if (!posAttr) continue;

        const nodeWorld = sceneNode.matrixWorld;
        const ne = nodeWorld.elements;
        mvp.multiplyMatrices(vpMatrix, nodeWorld);
        const m = mvp.elements;

        const arr = posAttr.array as Float32Array;
        const count = posAttr.count;
        const classAttr = geom.getAttribute('classification');

        for (let i = 0; i < count; i++) {
          const idx = i * 3;
          const px = arr[idx], py = arr[idx + 1], pz = arr[idx + 2];

          // Project to secondary camera NDC
          const cw = m[3]*px + m[7]*py + m[11]*pz + m[15];
          if (cw <= 0) continue;
          const ndcX = (m[0]*px + m[4]*py + m[8]*pz  + m[12]) / cw;
          const ndcY = (m[1]*px + m[5]*py + m[9]*pz  + m[13]) / cw;

          // NDC polygon test
          if (!isPointInPolygon2D(ndcX, ndcY, ndcPolygon)) continue;

          // Classification filter
          if (classAttr) {
            const classVal = Math.round(classAttr.getX(i));
            if (!(classVisibility[String(classVal)] ?? true)) continue;
            if (!(classActive[String(classVal)] ?? true)) continue;
          }

          // World-space position
          const wx = ne[0]*px + ne[4]*py + ne[8]*pz  + ne[12];
          const wy = ne[1]*px + ne[5]*py + ne[9]*pz  + ne[13];
          const wz = ne[2]*px + ne[6]*py + ne[10]*pz + ne[14];

          // Slab clip test
          if (slabClip && !this.isPointInSlab(wx, wy, wz, slabClip)) continue;

          const pid = makePointId(nodeKey, i);
          if (this.selectedPointKeys.has(pid)) continue;
          this.selectedPointKeys.add(pid);
          this.selectedPositions.push(wx, wy, wz);
          this.selectedPointIds.push(pid);
        }
      }
    }

    this.rebuildHighlight();
    this.updateStore();
  }

  private evaluateNewNodes(): void {
    if (!this.selectionFrustum) return;

    const { ndcMinX, ndcMaxX, ndcMinY, ndcMaxY, vpMatrix } = this.selectionFrustum;
    const { classVisibility, classActive } = useAnnotateStore.getState();
    const pointClouds = this.ctx.getPointClouds();
    const slabClip = this.buildSlabClipInverse();
    const mvp = new Matrix4();
    let added = false;

    for (const pco of pointClouds) {
      pco.updateMatrixWorld(true);

      for (const node of pco.visibleNodes) {
        const nodeKey = node.geometryNode?.name;
        if (!nodeKey || this.processedNodes.has(nodeKey)) continue;

        const sceneNode = node.sceneNode;
        if (!sceneNode) continue;
        const geom = sceneNode.geometry;
        if (!geom) continue;
        const posAttr = geom.getAttribute('position');
        if (!posAttr) continue;

        this.processedNodes.add(nodeKey);
        added = true;

        const nodeWorld = sceneNode.matrixWorld;
        const ne = nodeWorld.elements;
        mvp.multiplyMatrices(vpMatrix, nodeWorld);
        const m = mvp.elements;

        const arr = posAttr.array as Float32Array;
        const count = posAttr.count;
        const classAttr = geom.getAttribute('classification');

        for (let i = 0; i < count; i++) {
          const idx = i * 3;
          const px = arr[idx], py = arr[idx + 1], pz = arr[idx + 2];

          // Frustum test (secondary camera VP)
          const cw = m[3]*px + m[7]*py + m[11]*pz + m[15];
          if (cw <= 0) continue;
          const ndcX = (m[0]*px + m[4]*py + m[8]*pz  + m[12]) / cw;
          const ndcY = (m[1]*px + m[5]*py + m[9]*pz  + m[13]) / cw;
          if (ndcX < ndcMinX || ndcX > ndcMaxX || ndcY < ndcMinY || ndcY > ndcMaxY) continue;

          // Classification visibility + active filter
          if (classAttr) {
            const classVal = Math.round(classAttr.getX(i));
            if (!(classVisibility[String(classVal)] ?? true)) continue;
            if (!(classActive[String(classVal)] ?? true)) continue;
          }

          // World-space position
          const wx = ne[0]*px + ne[4]*py + ne[8]*pz  + ne[12];
          const wy = ne[1]*px + ne[5]*py + ne[9]*pz  + ne[13];
          const wz = ne[2]*px + ne[6]*py + ne[10]*pz + ne[14];

          // Slab clip test — only points inside the slab volume are eligible
          if (slabClip && !this.isPointInSlab(wx, wy, wz, slabClip)) continue;

          const pid = makePointId(nodeKey, i);
          if (this.selectedPointKeys.has(pid)) continue;

          this.selectedPointKeys.add(pid);
          this.selectedPositions.push(wx, wy, wz);
          this.selectedPointIds.push(pid);
        }
      }
    }

    if (added) {
      this.rebuildHighlight();
      this.updateStore();
    }
  }

  // ── Store sync ────────────────────────────────────────────────────────────────

  private updateStore(): void {
    const n = this.selectedPointIds.length;
    const store = useReclassifyStore.getState();
    store.setSelectedCount(n);
    store.setPhase(n > 0 ? 'selected' : 'selecting');
    if (n > 0) {
      this.computeGizmoPos();
    } else {
      store.setGizmoScreenPos(null);
    }
  }

  private computeGizmoPos(): void {
    if (this.selectedPositions.length === 0) return;

    let sx = 0, sy = 0, sz = 0;
    const ptCount = this.selectedPositions.length / 3;
    for (let i = 0; i < this.selectedPositions.length; i += 3) {
      sx += this.selectedPositions[i];
      sy += this.selectedPositions[i + 1];
      sz += this.selectedPositions[i + 2];
    }

    const centroid = new Vector3(sx / ptCount, sy / ptCount, sz / ptCount);
    const camera = this.secondaryVp.camera;
    camera.updateMatrixWorld(true);
    centroid.project(camera);

    const canvas = this.secondaryVp.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const rawX = ((centroid.x + 1) / 2) * rect.width  + rect.left;
    const rawY = ((-centroid.y + 1) / 2) * rect.height + rect.top;

    const GIZMO_W = 224, GIZMO_H = 340, MARGIN = 12;
    const x = Math.max(rect.left + MARGIN, Math.min(rawX + 16, rect.right  - GIZMO_W - MARGIN));
    const y = Math.max(rect.top  + MARGIN, Math.min(rawY - 24, rect.bottom - GIZMO_H - MARGIN));

    useReclassifyStore.getState().setGizmoScreenPos({ x, y });
  }

  // ── Highlight rendering ───────────────────────────────────────────────────────

  private rebuildHighlight(): void {
    this.clearHighlight();
    if (this.selectedPositions.length === 0) return;

    const geom = new BufferGeometry();
    geom.setAttribute(
      'position',
      new Float32BufferAttribute(new Float32Array(this.selectedPositions), 3),
    );

    const mat = new PointsMaterial({
      color: 0xfde047,
      size: 4,
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.92,
    });

    this.highlightPoints = new Points(geom, mat);
    this.highlightPoints.renderOrder = 900;
    this.ctx.worldRoot.add(this.highlightPoints);
  }

  private clearHighlight(): void {
    if (this.highlightPoints) {
      this.ctx.worldRoot.remove(this.highlightPoints);
      this.highlightPoints.geometry.dispose();
      (this.highlightPoints.material as PointsMaterial).dispose();
      this.highlightPoints = null;
    }
  }
}
