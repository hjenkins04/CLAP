import {
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  PointsMaterial,
  Matrix4,
  Vector4,
} from 'three';
import { ClipMode } from 'potree-core';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { useViewerModeStore } from '@/app/stores';
import { usePointSelectStore } from './point-select-store';

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
  e: Float64Array; // 16 elements of the inverse matrix
}

export class PointSelectPlugin implements ViewerPlugin {
  readonly id = 'point-select';
  readonly name = 'Point Selection';
  readonly order = 60;

  private ctx: ViewerPluginContext | null = null;
  private unsubMode: (() => void) | null = null;

  // Selection rectangle state
  private dragStart: { x: number; y: number } | null = null;
  private dragSubtract = false; // Alt held at drag start = subtract mode
  private boxEl: HTMLDivElement | null = null;

  // Persistent selection frustum — re-evaluated each frame
  private selectionFrustum: SelectionFrustum | null = null;
  private processedNodes = new Set<string>();
  private selectedPositions: number[] = [];

  // Highlight overlay
  private highlightPoints: Points | null = null;

  // Bound listeners
  private onPointerDown = this._onPointerDown.bind(this);
  private onPointerMove = this._onPointerMove.bind(this);
  private onPointerUp = this._onPointerUp.bind(this);

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;

    this.unsubMode = useViewerModeStore.subscribe((state, prev) => {
      const was = prev.mode === 'point-select';
      const is = state.mode === 'point-select';
      if (is && !was) this.activate();
      else if (!is && was) this.deactivate();
    });

    if (useViewerModeStore.getState().mode === 'point-select') {
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
    usePointSelectStore.getState().setPhase('selecting');
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
    usePointSelectStore.getState().reset();
  }

  clearSelection(): void {
    this.selectionFrustum = null;
    this.processedNodes.clear();
    this.selectedPositions = [];
    this.clearHighlight();
    usePointSelectStore.getState().setSelectedCount(0);
    usePointSelectStore.getState().setPhase('selecting');
  }

  // --- Pointer events ---

  private _onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (e.ctrlKey && e.shiftKey) return; // Ctrl+Shift+LMB is orbit

    this.dragStart = { x: e.clientX, y: e.clientY };
    this.dragSubtract = e.altKey;
    usePointSelectStore.getState().setDragging(true);
  }

  private _onPointerMove(e: PointerEvent): void {
    if (!this.dragStart) return;

    const dx = Math.abs(e.clientX - this.dragStart.x);
    const dy = Math.abs(e.clientY - this.dragStart.y);
    if (dx < 3 && dy < 3) return;

    this.updateBoxOverlay(this.dragStart.x, this.dragStart.y, e.clientX, e.clientY, this.dragSubtract);
  }

  private _onPointerUp(e: PointerEvent): void {
    if (e.button !== 0 || !this.dragStart) return;

    const start = this.dragStart;
    this.dragStart = null;
    usePointSelectStore.getState().setDragging(false);
    this.removeBoxOverlay();

    const dx = Math.abs(e.clientX - start.x);
    const dy = Math.abs(e.clientY - start.y);
    if (dx < 5 && dy < 5) {
      // Click (not drag) — clear existing selection
      if (this.selectionFrustum) this.clearSelection();
      return;
    }

    // Compute screen-space rectangle
    const rect = this.ctx!.domElement.getBoundingClientRect();
    const x0 = Math.min(start.x, e.clientX) - rect.left;
    const y0 = Math.min(start.y, e.clientY) - rect.top;
    const x1 = Math.max(start.x, e.clientX) - rect.left;
    const y1 = Math.max(start.y, e.clientY) - rect.top;
    const viewW = rect.width;
    const viewH = rect.height;

    // Convert screen rect to NDC
    const ndcX0 = (x0 / viewW) * 2 - 1;
    const ndcY0 = -(y0 / viewH) * 2 + 1;
    const ndcX1 = (x1 / viewW) * 2 - 1;
    const ndcY1 = -(y1 / viewH) * 2 + 1;

    // Capture the VP matrix at selection time
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

    if (this.dragSubtract && this.selectedPositions.length > 0) {
      // Subtract: remove points that fall inside the new rect
      this.subtractFromSelection(frustum);
    } else {
      // Normal select: replace selection
      this.selectionFrustum = frustum;
      this.processedNodes.clear();
      this.selectedPositions = [];
      this.evaluateNewNodes();
    }
  }

  // --- Clip region helpers ---

  /**
   * Extract clip region inverse matrices from the first PCO's material.
   * Returns null if clipping is disabled (no active ROI/virtual-tiles).
   */
  private getActiveClipRegions(): {
    boxes: ClipInverse[];
    cylinders: ClipInverse[];
  } | null {
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

  /**
   * Test if a world-space point passes the clip filter.
   * For CLIP_OUTSIDE: point must be inside at least one clip region.
   */
  private isPointInsideClip(
    wx: number, wy: number, wz: number,
    clipBoxes: ClipInverse[],
    clipCylinders: ClipInverse[],
  ): boolean {
    // Test clip boxes (unit cube [-0.5, 0.5]³ after inverse transform)
    for (const { e } of clipBoxes) {
      const lx = e[0] * wx + e[4] * wy + e[8] * wz + e[12];
      const ly = e[1] * wx + e[5] * wy + e[9] * wz + e[13];
      const lz = e[2] * wx + e[6] * wy + e[10] * wz + e[14];
      if (lx >= -0.5 && lx <= 0.5 &&
          ly >= -0.5 && ly <= 0.5 &&
          lz >= -0.5 && lz <= 0.5) {
        return true;
      }
    }

    // Test clip cylinders (unit cylinder: radius 0.5 in XY, height [-0.5, 0.5] in Z)
    for (const { e } of clipCylinders) {
      const lx = e[0] * wx + e[4] * wy + e[8] * wz + e[12];
      const ly = e[1] * wx + e[5] * wy + e[9] * wz + e[13];
      const lz = e[2] * wx + e[6] * wy + e[10] * wz + e[14];
      if (lx * lx + ly * ly <= 0.25 &&
          lz >= -0.5 && lz <= 0.5) {
        return true;
      }
    }

    return false;
  }

  // --- Subtract mode ---

  /**
   * Remove already-selected world-space points that project into the given
   * screen-space frustum. Does not change the persistent selectionFrustum
   * (so new nodes still accumulate via the original selection).
   */
  private subtractFromSelection(frustum: SelectionFrustum): void {
    const { ndcMinX, ndcMaxX, ndcMinY, ndcMaxY, vpMatrix } = frustum;
    const m = vpMatrix.elements;

    const kept: number[] = [];
    const len = this.selectedPositions.length;

    for (let i = 0; i < len; i += 3) {
      const wx = this.selectedPositions[i];
      const wy = this.selectedPositions[i + 1];
      const wz = this.selectedPositions[i + 2];

      // Project world position to NDC using the subtract VP matrix
      const cw = m[3] * wx + m[7] * wy + m[11] * wz + m[15];
      if (cw > 0) {
        const ndcX = (m[0] * wx + m[4] * wy + m[8] * wz + m[12]) / cw;
        const ndcY = (m[1] * wx + m[5] * wy + m[9] * wz + m[13]) / cw;

        if (ndcX >= ndcMinX && ndcX <= ndcMaxX &&
            ndcY >= ndcMinY && ndcY <= ndcMaxY) {
          continue; // Inside subtract rect — remove
        }
      }

      kept.push(wx, wy, wz);
    }

    this.selectedPositions = kept;
    this.rebuildHighlight();
    const pointCount = kept.length / 3;
    usePointSelectStore.getState().setSelectedCount(pointCount);
    usePointSelectStore.getState().setPhase(pointCount > 0 ? 'selected' : 'selecting');
  }

  // --- Selection logic (runs each frame while frustum is active) ---

  private evaluateNewNodes(): void {
    if (!this.ctx || !this.selectionFrustum) return;

    const { ndcMinX, ndcMaxX, ndcMinY, ndcMaxY, vpMatrix } = this.selectionFrustum;
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

        for (let i = 0; i < count; i++) {
          const idx = i * 3;
          const px = arr[idx];
          const py = arr[idx + 1];
          const pz = arr[idx + 2];

          const cw = m[3] * px + m[7] * py + m[11] * pz + m[15];
          if (cw <= 0) continue;

          const ndcX = (m[0] * px + m[4] * py + m[8] * pz + m[12]) / cw;
          const ndcY = (m[1] * px + m[5] * py + m[9] * pz + m[13]) / cw;

          if (ndcX >= ndcMinX && ndcX <= ndcMaxX &&
              ndcY >= ndcMinY && ndcY <= ndcMaxY) {
            // Compute world-space position
            const wx = ne[0] * px + ne[4] * py + ne[8] * pz + ne[12];
            const wy = ne[1] * px + ne[5] * py + ne[9] * pz + ne[13];
            const wz = ne[2] * px + ne[6] * py + ne[10] * pz + ne[14];

            // Check clip regions if active
            if (clipRegions &&
                !this.isPointInsideClip(wx, wy, wz, clipRegions.boxes, clipRegions.cylinders)) {
              continue;
            }

            this.selectedPositions.push(wx, wy, wz);
          }
        }
      }
    }

    if (added) {
      this.rebuildHighlight();
      const pointCount = this.selectedPositions.length / 3;
      usePointSelectStore.getState().setSelectedCount(pointCount);
      usePointSelectStore.getState().setPhase(pointCount > 0 ? 'selected' : 'selecting');
    }
  }

  // --- Highlight rendering ---

  private rebuildHighlight(): void {
    this.clearHighlight();
    if (!this.ctx || this.selectedPositions.length === 0) return;

    const geom = new BufferGeometry();
    geom.setAttribute(
      'position',
      new Float32BufferAttribute(new Float32Array(this.selectedPositions), 3),
    );

    const mat = new PointsMaterial({
      color: 0xffaa00,
      size: 3,
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.85,
    });

    this.highlightPoints = new Points(geom, mat);
    this.highlightPoints.renderOrder = 900;
    this.ctx.worldRoot.add(this.highlightPoints);
  }

  private clearHighlight(): void {
    if (this.highlightPoints && this.ctx) {
      this.ctx.worldRoot.remove(this.highlightPoints);
      this.highlightPoints.geometry.dispose();
      (this.highlightPoints.material as PointsMaterial).dispose();
      this.highlightPoints = null;
    }
  }

  // --- Box overlay ---

  private updateBoxOverlay(x0: number, y0: number, x1: number, y1: number, subtract = false): void {
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
      this.boxEl.style.border = '1px solid rgba(255, 170, 0, 0.8)';
      this.boxEl.style.backgroundColor = 'rgba(255, 170, 0, 0.1)';
    }

    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);

    this.boxEl.style.left = `${left}px`;
    this.boxEl.style.top = `${top}px`;
    this.boxEl.style.width = `${w}px`;
    this.boxEl.style.height = `${h}px`;
  }

  private removeBoxOverlay(): void {
    if (this.boxEl) {
      this.boxEl.remove();
      this.boxEl = null;
    }
  }
}
