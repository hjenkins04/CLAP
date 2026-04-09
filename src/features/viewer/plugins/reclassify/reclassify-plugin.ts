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
import { DragSelectController } from '../../modules/drag-select';
import type { SelectionFrustum, DragSelectMode } from '../../modules/drag-select';
import { ShapeEditorEngine } from '../../modules/shape-editor';
import type { PolygonShape, Vec3 } from '../../modules/shape-editor';

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
  private unsubTool: (() => void) | null = null;

  // Drag-select
  private dragSelect: DragSelectController | null = null;

  // Polygon draw
  private polygonEngine: ShapeEditorEngine | null = null;
  private polygonConfirmFn: ((e: KeyboardEvent) => void) | null = null;

  // Persistent selection frustum
  private selectionFrustum: SelectionFrustum | null = null;
  private processedNodes = new Set<string>();

  // Parallel arrays: selectedPositions[i*3..i*3+2] ↔ selectedPointIds[i]
  // selectedPointKeys tracks added points for deduplication in add-mode
  private selectedPositions: number[] = [];
  private selectedPointIds: PointId[] = [];
  private selectedPointKeys = new Set<string>();

  // Gizmo position is fixed once computed per selection
  private gizmoFixed = false;

  // Highlight overlay
  private highlightPoints: Points | null = null;

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;

    this.dragSelect = new DragSelectController({
      domElement: ctx.domElement,
      getCamera: () => ctx.getActiveCamera(),
      onSelect: (frustum, mode) => this.handleDragSelect(frustum, mode),
      onClickEmpty: () => { if (this.selectionFrustum) this.clearSelection(); },
    });

    this.unsubMode = useViewerModeStore.subscribe((state, prev) => {
      const was = prev.mode === 'reclassify';
      const is  = state.mode === 'reclassify';
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
    this.dragSelect = null;
    this.ctx = null;
  }

  // ── Activation ─────────────────────────────────────────────────────────────

  private activate(): void {
    if (!this.ctx) return;
    useReclassifyStore.getState().setPhase('selecting');
    useReclassifyStore.getState().setApplyFn(this.applyReclassification.bind(this));

    // Subscribe to active-tool changes
    this.unsubTool = useReclassifyStore.subscribe((s, prev) => {
      if (s.activeTool !== prev.activeTool) {
        this.handleToolChange(s.activeTool);
      }
    });

    // Activate the current tool
    this.handleToolChange(useReclassifyStore.getState().activeTool);
  }

  private deactivate(): void {
    if (!this.ctx) return;
    this.unsubTool?.();
    this.unsubTool = null;
    this.stopPolygonDraw();
    this.dragSelect?.deactivate();
    this.ctx.domElement.style.cursor = '';
    this.clearSelection();
    useReclassifyStore.getState().setApplyFn(null);
    useReclassifyStore.getState().reset();
  }

  private handleToolChange(tool: 'drag-select' | 'polygon'): void {
    if (tool === 'polygon') {
      this.dragSelect?.deactivate();
      this.clearSelection();
      this.startPolygonDraw();
    } else {
      this.stopPolygonDraw();
      this.dragSelect?.activate();
      if (this.ctx) this.ctx.domElement.style.cursor = 'crosshair';
    }
  }

  // ── Polygon draw ───────────────────────────────────────────────────────────

  private startPolygonDraw(): void {
    if (!this.ctx || this.polygonEngine) return;

    const ctx = this.ctx;
    const engine = new ShapeEditorEngine(ctx, {
      escapeHandled: false, // reclassify-overlay handles Escape
      deleteHandled: false,
      showEdgeMidHandles: false,
      showFaceExtrudeHandles: false,
    });

    engine.setElevationFn((worldX: number, worldZ: number): number => {
      const dem = ctx.getDem();
      if (dem) {
        const tg = ctx.getEditor().getTransformGroup();
        tg.updateMatrixWorld(true);
        const local = new Vector3(worldX, 0, worldZ)
          .applyMatrix4(new Matrix4().copy(tg.matrixWorld).invert());
        const elev = dem.getElevationClamped(local.x, local.z);
        if (elev !== null) return elev as number;
      }
      return 0;
    });

    engine.on('shape-created', (shape) => {
      if (shape.type !== 'polygon') return;
      // Switch to vertex-edit mode so user can refine before confirming
      engine.startSelect('vertex');
      engine.selectShape(shape.id);
      // Install Enter listener to confirm selection
      this.installPolygonConfirm(shape as PolygonShape);
    });

    engine.on('draw-cancelled', () => {
      this.stopPolygonDraw(false);
      useReclassifyStore.getState().setActiveTool('drag-select');
    });

    this.polygonEngine = engine;
    engine.startDrawPolygon();
  }

  private stopPolygonDraw(restoreCursor = true): void {
    if (this.polygonConfirmFn) {
      this.ctx?.domElement.removeEventListener('keydown', this.polygonConfirmFn);
      this.polygonConfirmFn = null;
    }
    this.polygonEngine?.dispose();
    this.polygonEngine = null;
    if (restoreCursor && this.ctx) this.ctx.domElement.style.cursor = '';
  }

  private installPolygonConfirm(shape: PolygonShape): void {
    if (this.polygonConfirmFn) {
      this.ctx?.domElement.removeEventListener('keydown', this.polygonConfirmFn);
    }
    const fn = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') {
        e.stopPropagation();
        this.confirmPolygonSelection(shape);
      } else if (e.key === 'Escape') {
        this.stopPolygonDraw(false);
        useReclassifyStore.getState().setActiveTool('drag-select');
      }
    };
    this.polygonConfirmFn = fn;
    this.ctx?.domElement.addEventListener('keydown', fn);
  }

  private confirmPolygonSelection(shape: PolygonShape): void {
    this.stopPolygonDraw();
    this.evaluateNodesPolygon(shape.basePoints);
    useReclassifyStore.getState().setActiveTool('drag-select');
  }

  /** Select all point cloud points whose XZ position lies inside the polygon footprint. */
  private evaluateNodesPolygon(basePoints: Vec3[]): void {
    if (!this.ctx || basePoints.length < 3) return;

    const xzPoly: [number, number][] = basePoints.map((p) => [p.x, p.z]);
    const { classVisibility, classActive } = useAnnotateStore.getState();
    const pointClouds = this.ctx.getPointClouds();
    const clipRegions = this.getActiveClipRegions();

    // Reset existing selection
    this.selectedPositions = [];
    this.selectedPointIds = [];
    this.selectedPointKeys.clear();
    this.gizmoFixed = false;

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
        const arr = posAttr.array as Float32Array;
        const count = posAttr.count;
        const classAttr = geom.getAttribute('classification');

        for (let i = 0; i < count; i++) {
          const idx = i * 3;
          const px = arr[idx], py = arr[idx + 1], pz = arr[idx + 2];

          // World-space position
          const wx = ne[0]*px + ne[4]*py + ne[8]*pz  + ne[12];
          const wy = ne[1]*px + ne[5]*py + ne[9]*pz  + ne[13];
          const wz = ne[2]*px + ne[6]*py + ne[10]*pz + ne[14];

          // XZ polygon test (vertical prism selection)
          if (!isPointInPolygon2D(wx, wz, xzPoly)) continue;

          // Classification visibility + active filter
          if (classAttr) {
            const classVal = Math.round(classAttr.getX(i));
            if (!(classVisibility[String(classVal)] ?? true)) continue;
            if (!(classActive[String(classVal)] ?? true)) continue;
          }

          // Clip region test
          if (clipRegions && !this.isPointInsideClip(wx, wy, wz, clipRegions.boxes, clipRegions.cylinders)) continue;

          const key = `${nodeKey}:${i}`;
          if (this.selectedPointKeys.has(key)) continue;
          this.selectedPointKeys.add(key);
          this.selectedPositions.push(wx, wy, wz);
          this.selectedPointIds.push(makePointId(nodeKey, i));
        }
      }
    }

    this.rebuildHighlight();
    const pointCount = this.selectedPointIds.length;
    useReclassifyStore.getState().setSelectedCount(pointCount);
    useReclassifyStore.getState().setPhase(pointCount > 0 ? 'selected' : 'selecting');
  }

  clearSelection(): void {
    this.selectionFrustum = null;
    this.processedNodes.clear();
    this.selectedPositions = [];
    this.selectedPointIds = [];
    this.selectedPointKeys.clear();
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

  // ── Drag-select handler ─────────────────────────────────────────────────────

  private handleDragSelect(frustum: SelectionFrustum, mode: DragSelectMode): void {
    if (mode === 'subtract') {
      if (this.selectedPointIds.length > 0) this.subtractFromSelection(frustum);
      return;
    }

    if (mode === 'replace') {
      // Fresh selection — clear everything first
      this.selectedPositions = [];
      this.selectedPointIds = [];
      this.selectedPointKeys.clear();
      this.gizmoFixed = false;
    }
    // Both 'replace' and 'add': set a new frustum to evaluate
    this.selectionFrustum = frustum;
    this.processedNodes.clear(); // re-evaluate all nodes against new frustum
    this.evaluateNewNodes();
  }

  // ── Clip region helpers ─────────────────────────────────────────────────────

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
    wx: number, wy: number, wz: number,
    clipBoxes: ClipInverse[],
    clipCylinders: ClipInverse[],
  ): boolean {
    for (const { e } of clipBoxes) {
      const lx = e[0]*wx + e[4]*wy + e[8]*wz  + e[12];
      const ly = e[1]*wx + e[5]*wy + e[9]*wz  + e[13];
      const lz = e[2]*wx + e[6]*wy + e[10]*wz + e[14];
      if (lx >= -0.5 && lx <= 0.5 && ly >= -0.5 && ly <= 0.5 && lz >= -0.5 && lz <= 0.5) return true;
    }
    for (const { e } of clipCylinders) {
      const lx = e[0]*wx + e[4]*wy + e[8]*wz  + e[12];
      const ly = e[1]*wx + e[5]*wy + e[9]*wz  + e[13];
      const lz = e[2]*wx + e[6]*wy + e[10]*wz + e[14];
      if (lx * lx + ly * ly <= 0.25 && lz >= -0.5 && lz <= 0.5) return true;
    }
    return false;
  }

  // ── Subtract mode ───────────────────────────────────────────────────────────

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
      // Rebuild key set from the kept IDs — use index as a stable reference
      keptKeys.add(this.pointKeyAt(i));
    }

    this.selectedPositions = keptPositions;
    this.selectedPointIds = keptIds;
    this.selectedPointKeys = keptKeys;
    this.rebuildHighlight();

    const pointCount = keptIds.length;
    useReclassifyStore.getState().setSelectedCount(pointCount);
    useReclassifyStore.getState().setPhase(pointCount > 0 ? 'selected' : 'selecting');
  }

  // ── Selection logic ─────────────────────────────────────────────────────────

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
          const px = arr[idx], py = arr[idx + 1], pz = arr[idx + 2];

          // Frustum test
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

          // Clip region test
          if (clipRegions && !this.isPointInsideClip(wx, wy, wz, clipRegions.boxes, clipRegions.cylinders)) continue;

          // Deduplication for add-mode
          const key = `${nodeKey}:${i}`;
          if (this.selectedPointKeys.has(key)) continue;

          this.selectedPointKeys.add(key);
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

  /** String key for the point at index `i` in the selected arrays (for subtract dedup). */
  private pointKeyAt(i: number): string {
    // Reconstruct from the stored ID — fall back to positional string if needed
    const id = this.selectedPointIds[i];
    return id ? String(id) : `pos:${i}`;
  }

  // ── Highlight rendering ─────────────────────────────────────────────────────

  private rebuildHighlight(): void {
    this.clearHighlight();
    if (!this.ctx || this.selectedPositions.length === 0) {
      useReclassifyStore.getState().setGizmoScreenPos(null);
      return;
    }

    const geom = new BufferGeometry();
    geom.setAttribute('position', new Float32BufferAttribute(new Float32Array(this.selectedPositions), 3));

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

    const rect = this.ctx.domElement.getBoundingClientRect();
    const rawX = ((centroid.x + 1) / 2) * rect.width  + rect.left;
    const rawY = ((-centroid.y + 1) / 2) * rect.height + rect.top;

    const GIZMO_W = 224, GIZMO_H = 340, MARGIN = 12;
    const x = Math.max(rect.left + MARGIN, Math.min(rawX + 16, rect.right  - GIZMO_W - MARGIN));
    const y = Math.max(rect.top  + MARGIN, Math.min(rawY - 24, rect.bottom - GIZMO_H - MARGIN));

    useReclassifyStore.getState().setGizmoScreenPos({ x, y });
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Ray-casting point-in-polygon test in 2D.
 * px/py are the test coordinates; polygon is an array of [x, y] vertices.
 */
function isPointInPolygon2D(px: number, py: number, polygon: [number, number][]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}
