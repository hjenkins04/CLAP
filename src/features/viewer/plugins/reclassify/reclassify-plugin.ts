import {
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  PointsMaterial,
  Matrix4,
  Vector3,
} from 'three';
import { ClipMode } from 'potree-core';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { useViewerModeStore } from '@/app/stores';
import { useAnnotateStore } from '../annotate/annotate-store';
import { useReclassifyStore } from './reclassify-store';
import { makePointId } from '../../services/point-cloud-editor/point-id';
import type { PointId } from '../../services/point-cloud-editor/types';

/** Stored selection frustum (NDC bounds + VP matrix at capture time) */
interface SelectionFrustum {
  ndcMinX: number;
  ndcMaxX: number;
  ndcMinY: number;
  ndcMaxY: number;
  vpMatrix: Matrix4;
}

/** Pre-extracted clip inverse matrix elements for fast inline testing */
interface ClipInverse {
  e: Float64Array;
}

export class ReclassifyPlugin implements ViewerPlugin {
  readonly id = 'reclassify';
  readonly name = 'Reclassify';
  readonly order = 55;

  private ctx: ViewerPluginContext | null = null;
  private unsubMode: (() => void) | null = null;

  // Selection rectangle state
  private dragStart: { x: number; y: number } | null = null;
  private dragSubtract = false;
  private boxEl: HTMLDivElement | null = null;

  // Persistent selection frustum
  private selectionFrustum: SelectionFrustum | null = null;
  private processedNodes = new Set<string>();

  // Parallel arrays: selectedPositions[i*3..i*3+2] ↔ selectedPointIds[i]
  private selectedPositions: number[] = [];
  private selectedPointIds: PointId[] = [];

  // Gizmo position is fixed once computed per selection
  private gizmoFixed = false;

  // Highlight overlay
  private highlightPoints: Points | null = null;

  // Bound listeners
  private onPointerDown = this._onPointerDown.bind(this);
  private onPointerMove = this._onPointerMove.bind(this);
  private onPointerUp = this._onPointerUp.bind(this);

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;

    this.unsubMode = useViewerModeStore.subscribe((state, prev) => {
      const was = prev.mode === 'reclassify';
      const is = state.mode === 'reclassify';
      if (is && !was) this.activate();
      else if (!is && was) this.deactivate();
    });

    if (useViewerModeStore.getState().mode === 'reclassify') {
      this.activate();
    }
  }

  onUpdate(): void {
    if (!this.selectionFrustum || !this.ctx) return;
    this.evaluateNewNodes();
  }

  dispose(): void {
    this.deactivate();
    this.unsubMode?.();
    this.unsubMode = null;
    this.ctx = null;
  }

  // --- Activation ---

  private activate(): void {
    if (!this.ctx) return;
    const el = this.ctx.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    el.style.cursor = 'crosshair';
    useReclassifyStore.getState().setPhase('selecting');
    useReclassifyStore.getState().setApplyFn(this.applyReclassification.bind(this));
  }

  private deactivate(): void {
    if (!this.ctx) return;
    const el = this.ctx.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    el.style.cursor = '';
    this.removeBoxOverlay();
    this.clearSelection();
    useReclassifyStore.getState().setApplyFn(null);
    useReclassifyStore.getState().reset();
  }

  clearSelection(): void {
    this.selectionFrustum = null;
    this.processedNodes.clear();
    this.selectedPositions = [];
    this.selectedPointIds = [];
    this.gizmoFixed = false;
    this.clearHighlight();
    useReclassifyStore.getState().setSelectedCount(0);
    useReclassifyStore.getState().setGizmoScreenPos(null);
    useReclassifyStore.getState().setPhase('selecting');
  }

  private applyReclassification(classId: number): void {
    if (!this.ctx || this.selectedPointIds.length === 0) return;
    this.ctx.getEditor().setClassification(this.selectedPointIds, classId);
    this.clearSelection();
  }

  // --- Pointer events ---

  private _onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (e.ctrlKey && e.shiftKey) return;

    this.dragStart = { x: e.clientX, y: e.clientY };
    this.dragSubtract = e.altKey;
    useReclassifyStore.getState().setDragging(true);
  }

  private _onPointerMove(e: PointerEvent): void {
    if (!this.dragStart) return;

    const dx = Math.abs(e.clientX - this.dragStart.x);
    const dy = Math.abs(e.clientY - this.dragStart.y);
    if (dx < 3 && dy < 3) return;

    this.updateBoxOverlay(
      this.dragStart.x,
      this.dragStart.y,
      e.clientX,
      e.clientY,
      this.dragSubtract,
    );
  }

  private _onPointerUp(e: PointerEvent): void {
    if (e.button !== 0 || !this.dragStart) return;

    const start = this.dragStart;
    this.dragStart = null;
    useReclassifyStore.getState().setDragging(false);
    this.removeBoxOverlay();

    const dx = Math.abs(e.clientX - start.x);
    const dy = Math.abs(e.clientY - start.y);
    if (dx < 5 && dy < 5) {
      if (this.selectionFrustum) this.clearSelection();
      return;
    }

    const rect = this.ctx!.domElement.getBoundingClientRect();
    const x0 = Math.min(start.x, e.clientX) - rect.left;
    const y0 = Math.min(start.y, e.clientY) - rect.top;
    const x1 = Math.max(start.x, e.clientX) - rect.left;
    const y1 = Math.max(start.y, e.clientY) - rect.top;
    const viewW = rect.width;
    const viewH = rect.height;

    const ndcX0 = (x0 / viewW) * 2 - 1;
    const ndcY0 = -(y0 / viewH) * 2 + 1;
    const ndcX1 = (x1 / viewW) * 2 - 1;
    const ndcY1 = -(y1 / viewH) * 2 + 1;

    const camera = this.ctx!.getActiveCamera();
    camera.updateMatrixWorld(true);
    const vpMatrix = new Matrix4();
    vpMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

    const frustum: SelectionFrustum = {
      ndcMinX: Math.min(ndcX0, ndcX1),
      ndcMaxX: Math.max(ndcX0, ndcX1),
      ndcMinY: Math.min(ndcY0, ndcY1),
      ndcMaxY: Math.max(ndcY0, ndcY1),
      vpMatrix,
    };

    if (this.dragSubtract && this.selectedPointIds.length > 0) {
      this.subtractFromSelection(frustum);
    } else {
      this.selectionFrustum = frustum;
      this.processedNodes.clear();
      this.selectedPositions = [];
      this.selectedPointIds = [];
      this.gizmoFixed = false;
      this.evaluateNewNodes();
    }
  }

  // --- Clip region helpers (copied from PointSelectPlugin) ---

  private getActiveClipRegions(): { boxes: ClipInverse[]; cylinders: ClipInverse[] } | null {
    if (!this.ctx) return null;
    const pointClouds = this.ctx.getPointClouds();
    if (pointClouds.length === 0) return null;

    const mat = pointClouds[0].material;
    if (mat.clipMode === ClipMode.DISABLED) return null;

    const boxes: ClipInverse[] = [];
    for (const cb of mat.clipBoxes) {
      boxes.push({ e: new Float64Array(cb.inverse.elements) });
    }

    const cylinders: ClipInverse[] = [];
    if (mat.clipCylinders) {
      for (const cc of mat.clipCylinders) {
        cylinders.push({ e: new Float64Array(cc.inverse.elements) });
      }
    }

    if (boxes.length === 0 && cylinders.length === 0) return null;
    return { boxes, cylinders };
  }

  private isPointInsideClip(
    wx: number,
    wy: number,
    wz: number,
    clipBoxes: ClipInverse[],
    clipCylinders: ClipInverse[],
  ): boolean {
    for (const { e } of clipBoxes) {
      const lx = e[0] * wx + e[4] * wy + e[8] * wz + e[12];
      const ly = e[1] * wx + e[5] * wy + e[9] * wz + e[13];
      const lz = e[2] * wx + e[6] * wy + e[10] * wz + e[14];
      if (lx >= -0.5 && lx <= 0.5 && ly >= -0.5 && ly <= 0.5 && lz >= -0.5 && lz <= 0.5) {
        return true;
      }
    }
    for (const { e } of clipCylinders) {
      const lx = e[0] * wx + e[4] * wy + e[8] * wz + e[12];
      const ly = e[1] * wx + e[5] * wy + e[9] * wz + e[13];
      const lz = e[2] * wx + e[6] * wy + e[10] * wz + e[14];
      if (lx * lx + ly * ly <= 0.25 && lz >= -0.5 && lz <= 0.5) {
        return true;
      }
    }
    return false;
  }

  // --- Subtract mode ---

  private subtractFromSelection(frustum: SelectionFrustum): void {
    const { ndcMinX, ndcMaxX, ndcMinY, ndcMaxY, vpMatrix } = frustum;
    const m = vpMatrix.elements;

    const keptPositions: number[] = [];
    const keptIds: PointId[] = [];

    for (let i = 0; i < this.selectedPointIds.length; i++) {
      const wx = this.selectedPositions[i * 3];
      const wy = this.selectedPositions[i * 3 + 1];
      const wz = this.selectedPositions[i * 3 + 2];

      const cw = m[3] * wx + m[7] * wy + m[11] * wz + m[15];
      if (cw > 0) {
        const ndcX = (m[0] * wx + m[4] * wy + m[8] * wz + m[12]) / cw;
        const ndcY = (m[1] * wx + m[5] * wy + m[9] * wz + m[13]) / cw;
        if (ndcX >= ndcMinX && ndcX <= ndcMaxX && ndcY >= ndcMinY && ndcY <= ndcMaxY) {
          continue; // Inside subtract rect — remove
        }
      }

      keptPositions.push(wx, wy, wz);
      keptIds.push(this.selectedPointIds[i]);
    }

    this.selectedPositions = keptPositions;
    this.selectedPointIds = keptIds;
    this.rebuildHighlight();

    const pointCount = keptIds.length;
    useReclassifyStore.getState().setSelectedCount(pointCount);
    useReclassifyStore.getState().setPhase(pointCount > 0 ? 'selected' : 'selecting');
  }

  // --- Selection logic ---

  private evaluateNewNodes(): void {
    if (!this.ctx || !this.selectionFrustum) return;

    const { ndcMinX, ndcMaxX, ndcMinY, ndcMaxY, vpMatrix } = this.selectionFrustum;
    const { classVisibility, classActive } = useAnnotateStore.getState();
    const pointClouds = this.ctx.getPointClouds();
    const clipRegions = this.getActiveClipRegions();
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
          const px = arr[idx];
          const py = arr[idx + 1];
          const pz = arr[idx + 2];

          // Frustum test
          const cw = m[3] * px + m[7] * py + m[11] * pz + m[15];
          if (cw <= 0) continue;

          const ndcX = (m[0] * px + m[4] * py + m[8] * pz + m[12]) / cw;
          const ndcY = (m[1] * px + m[5] * py + m[9] * pz + m[13]) / cw;

          if (ndcX < ndcMinX || ndcX > ndcMaxX || ndcY < ndcMinY || ndcY > ndcMaxY) continue;

          // Classification visibility + active filter
          if (classAttr) {
            const classVal = Math.round(classAttr.getX(i));
            if (!(classVisibility[String(classVal)] ?? true)) continue;
            if (!(classActive[String(classVal)] ?? true)) continue;
          }

          // World-space position
          const wx = ne[0] * px + ne[4] * py + ne[8] * pz + ne[12];
          const wy = ne[1] * px + ne[5] * py + ne[9] * pz + ne[13];
          const wz = ne[2] * px + ne[6] * py + ne[10] * pz + ne[14];

          // Clip region test
          if (clipRegions && !this.isPointInsideClip(wx, wy, wz, clipRegions.boxes, clipRegions.cylinders)) {
            continue;
          }

          this.selectedPositions.push(wx, wy, wz);
          this.selectedPointIds.push(makePointId(nodeKey, i));
        }
      }
    }

    if (added) {
      this.rebuildHighlight();
      const pointCount = this.selectedPointIds.length;
      useReclassifyStore.getState().setSelectedCount(pointCount);
      useReclassifyStore.getState().setPhase(pointCount > 0 ? 'selected' : 'selecting');
    }
  }

  // --- Highlight rendering ---

  private rebuildHighlight(): void {
    this.clearHighlight();
    if (!this.ctx || this.selectedPositions.length === 0) {
      useReclassifyStore.getState().setGizmoScreenPos(null);
      return;
    }

    const geom = new BufferGeometry();
    geom.setAttribute(
      'position',
      new Float32BufferAttribute(new Float32Array(this.selectedPositions), 3),
    );

    const mat = new PointsMaterial({
      color: 0x00d4ff,
      size: 3,
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
    });

    this.highlightPoints = new Points(geom, mat);
    this.highlightPoints.renderOrder = 900;
    this.ctx.worldRoot.add(this.highlightPoints);

    // Compute gizmo position once per selection
    if (!this.gizmoFixed) {
      this.gizmoFixed = true;
      this.computeGizmoPos();
    }
  }

  private clearHighlight(): void {
    if (this.highlightPoints && this.ctx) {
      this.ctx.worldRoot.remove(this.highlightPoints);
      this.highlightPoints.geometry.dispose();
      (this.highlightPoints.material as PointsMaterial).dispose();
      this.highlightPoints = null;
    }
  }

  private computeGizmoPos(): void {
    if (!this.ctx || this.selectedPositions.length === 0) {
      useReclassifyStore.getState().setGizmoScreenPos(null);
      return;
    }

    // Compute centroid of selected world positions
    let sx = 0, sy = 0, sz = 0;
    const ptCount = this.selectedPositions.length / 3;
    for (let i = 0; i < this.selectedPositions.length; i += 3) {
      sx += this.selectedPositions[i];
      sy += this.selectedPositions[i + 1];
      sz += this.selectedPositions[i + 2];
    }

    const centroid = new Vector3(sx / ptCount, sy / ptCount, sz / ptCount);
    const camera = this.ctx.getActiveCamera();
    camera.updateMatrixWorld(true);
    centroid.project(camera);

    // NDC → fixed screen coords
    const rect = this.ctx.domElement.getBoundingClientRect();
    const rawX = ((centroid.x + 1) / 2) * rect.width + rect.left;
    const rawY = ((-centroid.y + 1) / 2) * rect.height + rect.top;

    // Offset slightly from centroid and clamp within viewport
    const GIZMO_W = 224;
    const GIZMO_H = 340;
    const MARGIN = 12;
    const x = Math.max(rect.left + MARGIN, Math.min(rawX + 16, rect.right - GIZMO_W - MARGIN));
    const y = Math.max(rect.top + MARGIN, Math.min(rawY - 24, rect.bottom - GIZMO_H - MARGIN));

    useReclassifyStore.getState().setGizmoScreenPos({ x, y });
  }

  // --- Box overlay ---

  private updateBoxOverlay(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    subtract = false,
  ): void {
    if (!this.ctx) return;

    if (!this.boxEl) {
      this.boxEl = document.createElement('div');
      this.boxEl.style.position = 'fixed';
      this.boxEl.style.pointerEvents = 'none';
      this.boxEl.style.zIndex = '100';
      document.body.appendChild(this.boxEl);
    }

    if (subtract) {
      this.boxEl.style.border = '1px solid rgba(255, 80, 80, 0.8)';
      this.boxEl.style.backgroundColor = 'rgba(255, 80, 80, 0.1)';
    } else {
      this.boxEl.style.border = '1px solid rgba(0, 212, 255, 0.8)';
      this.boxEl.style.backgroundColor = 'rgba(0, 212, 255, 0.08)';
    }

    this.boxEl.style.left = `${Math.min(x0, x1)}px`;
    this.boxEl.style.top = `${Math.min(y0, y1)}px`;
    this.boxEl.style.width = `${Math.abs(x1 - x0)}px`;
    this.boxEl.style.height = `${Math.abs(y1 - y0)}px`;
  }

  private removeBoxOverlay(): void {
    if (this.boxEl) {
      this.boxEl.remove();
      this.boxEl = null;
    }
  }
}
