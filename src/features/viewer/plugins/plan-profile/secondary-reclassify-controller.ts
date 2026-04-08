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

/** Pre-extracted inverse matrix elements for fast inline point-in-box test */
interface ClipInverse {
  e: Float64Array;
}

export class SecondaryReclassifyController {
  private readonly secondaryVp: SecondaryViewport;
  private readonly ctx: ViewerPluginContext;
  private readonly getSlab: () => PlaneSlab | null;

  private dragSelect: DragSelectController;

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

  activate(): void {
    this.dragSelect.activate();
  }

  deactivate(): void {
    this.dragSelect.deactivate();
    this.clearSelection();
  }

  update(): void {
    if (!this.selectionFrustum) return;
    this.evaluateNewNodes();
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
