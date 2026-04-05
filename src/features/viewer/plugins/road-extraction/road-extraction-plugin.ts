import {
  Group,
  Line,
  Mesh,
  SphereGeometry,
  BufferGeometry,
  BufferAttribute,
  LineBasicMaterial,
  MeshBasicMaterial,
  Vector2,
  Vector3,
  Raycaster,
  Matrix4,
} from 'three';
import type { PointCloudOctree } from 'potree-core';
import { ClipMode } from 'potree-core';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { useViewerModeStore } from '@/app/stores';
import { useRoadExtractionStore } from './road-extraction-store';
import type { RoadExtractionPhase } from './road-extraction-store';
import type { Vec3, SectionResult } from './road-extraction-types';
import { RoadExtractionPanel } from './road-extraction-panel';
import { clientToNdc, raycastHorizontalPlane } from '../../modules/shape-editor/utils/raycast-utils';
import { PointGridIndex } from './services/point-grid-index';
import { sampleCenterline } from './services/centerline-sampler';
import { analyzeSection, buildBoundaryFromResults } from './services/cross-section-analyzer';
import { useAnnotateStore } from '../annotate/annotate-store';

/** Pre-extracted clip inverse matrix elements for fast per-point testing. */
interface ClipInverse { e: Float64Array }

// ── Visual constants ──────────────────────────────────────────────────────────

const COLOR_CENTRELINE    = 0xffcc00;
const COLOR_LEFT          = 0x00ff88;
const COLOR_RIGHT         = 0xff6600;
const COLOR_HANDLE_LEFT   = 0x00ff88;
const COLOR_HANDLE_RIGHT  = 0xff6600;
const COLOR_HANDLE_HOVER  = 0xffffff;
const HANDLE_RADIUS       = 0.15;       // metres
const RENDER_ORDER        = 950;
const BATCH_SIZE          = 40;         // sections per async tick

// ── Plugin ────────────────────────────────────────────────────────────────────

export class RoadExtractionPlugin implements ViewerPlugin {
  readonly id             = 'road-extraction';
  readonly name           = 'Road Extraction';
  readonly order          = 9;
  readonly SidebarPanel   = RoadExtractionPanel;
  readonly sidebarTitle   = 'Road Extraction';
  readonly sidebarDefaultOpen = false;

  private ctx: ViewerPluginContext | null = null;
  private rootGroup: Group | null = null;
  private fallbackElevY = 0;

  // ── Store subscriptions ───────────────────────────────────────────────────
  private unsubMode:  (() => void) | null = null;
  private unsubStore: (() => void) | null = null;

  // ── Centreline drawing ────────────────────────────────────────────────────
  private drawingPoints: Vec3[] = [];
  private drawingGroundY = 0;
  private drawingListening = false;
  private drawLastClickTime = 0;
  private drawLastMouse = { x: 0, y: 0 };

  // ── Three.js visuals ──────────────────────────────────────────────────────
  private centrelinePreviewLine: Line | null    = null;
  private leftBoundaryLine:      Line | null    = null;
  private rightBoundaryLine:     Line | null    = null;
  private committedGroups = new Map<string, Group>();
  private editHandleGroup: Group | null         = null;

  // ── Extraction runtime ────────────────────────────────────────────────────
  private gridIndex:     PointGridIndex | null  = null;
  private cancelExtract: (() => void) | null    = null;

  // ── Edit-handle interaction ───────────────────────────────────────────────
  private editListening    = false;
  private hoveredHandle:   Mesh | null = null;
  private dragHandle:      Mesh | null = null;
  private dragHandleMat:   MeshBasicMaterial | null = null;
  private dragStartMouse   = new Vector2();

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;
    this.rootGroup = new Group();
    this.rootGroup.name = 'road-extraction';
    ctx.scene.add(this.rootGroup);

    this.rebuildCommitted();

    this.unsubMode = useViewerModeStore.subscribe((state, prev) => {
      const was = prev.mode === 'road-extraction';
      const is  = state.mode === 'road-extraction';
      if (is && !was) this.enterMode();
      else if (!is && was) this.exitMode();
    });

    this.unsubStore = useRoadExtractionStore.subscribe((state, prev) => {
      if (state.phase !== prev.phase) {
        this.onPhaseChanged(state.phase, prev.phase);
      }
      if (state.boundaries !== prev.boundaries) {
        this.rebuildCommitted();
      }
      // Redraw preview lines when pending result changes (e.g. vertex edited)
      if (
        state.phase === 'reviewing' || state.phase === 'editing-boundary'
      ) {
        if (
          state.pendingLeft  !== prev.pendingLeft ||
          state.pendingRight !== prev.pendingRight
        ) {
          this.rebuildBoundaryLines(state.pendingLeft, state.pendingRight);
        }
      }
    });
  }

  onUpdate(_delta: number): void { /* no per-frame work needed */ }

  onPointCloudLoaded(_pco: PointCloudOctree): void {
    this.computeFallbackElevY();
  }

  dispose(): void {
    this.cancelExtract?.();
    this.stopDrawingListeners();
    this.stopEditListeners();
    this.unsubMode?.();
    this.unsubMode = null;
    this.unsubStore?.();
    this.unsubStore = null;
    this.clearVisuals();
    this.clearCommitted();
    if (this.ctx && this.rootGroup) {
      this.ctx.scene.remove(this.rootGroup);
    }
    this.rootGroup = null;
    this.ctx = null;
  }

  // ── Mode lifecycle ─────────────────────────────────────────────────────────

  private enterMode(): void {
    this.computeFallbackElevY();
    const store = useRoadExtractionStore.getState();
    // If we're in a terminal state, start fresh drawing
    if (store.phase === 'idle' || store.phase === 'committed') {
      store.setPhase('drawing');
      this.startDrawingListeners();
    }
  }

  private exitMode(): void {
    this.cancelExtract?.();
    this.stopDrawingListeners();
    this.stopEditListeners();
    this.clearPreviewLines();
    this.clearEditHandles();
    this.drawingPoints = [];
    const store = useRoadExtractionStore.getState();
    store.clearPending();
    store.clearCenterline();
    store.setProgress(null);
    store.setPhase('idle');
  }

  // ── Phase transitions ─────────────────────────────────────────────────────

  private onPhaseChanged(phase: RoadExtractionPhase, _prev: RoadExtractionPhase): void {
    switch (phase) {
      case 'idle':
        this.cancelExtract?.();
        this.stopDrawingListeners();
        this.stopEditListeners();
        this.clearPreviewLines();
        this.clearEditHandles();
        this.drawingPoints = [];
        break;

      case 'drawing':
        this.cancelExtract?.();
        this.stopEditListeners();
        this.clearPreviewLines();
        this.clearEditHandles();
        this.drawingPoints = [];
        this.startDrawingListeners();
        break;

      case 'extracting':
        this.stopDrawingListeners();
        this.stopEditListeners();
        this.clearPreviewLines();
        this.clearEditHandles();
        this.runExtraction();
        break;

      case 'reviewing':
        this.stopDrawingListeners();
        this.stopEditListeners();
        this.clearEditHandles();
        // Lines already built by runExtraction → no rebuild needed here
        break;

      case 'editing-boundary': {
        const store = useRoadExtractionStore.getState();
        this.buildEditHandles(store.pendingLeft, store.pendingRight);
        this.startEditListeners();
        break;
      }

      case 'committed':
        this.stopDrawingListeners();
        this.stopEditListeners();
        this.clearEditHandles();
        this.clearPreviewLines();
        break;
    }
  }

  // ── Public API (called by overlay / panel) ────────────────────────────────

  /** Confirm the drawn centreline and start extraction. */
  confirmCenterline(): void {
    const store = useRoadExtractionStore.getState();
    if (this.drawingPoints.length < 2) return;
    store.setCenterlinePoints([...this.drawingPoints]);
    store.setPhase('extracting');
  }

  /** Cancel during drawing — return to idle. */
  cancelDrawing(): void {
    useRoadExtractionStore.getState().setPhase('idle');
    useViewerModeStore.getState().exitMode();
  }

  /** Re-run extraction with current params (called when params change in reviewing). */
  rerunExtraction(): void {
    const store = useRoadExtractionStore.getState();
    if (store.centerlinePoints.length < 2) return;
    this.drawingPoints = [...store.centerlinePoints];
    store.setPhase('extracting');
  }

  /** Enter boundary-editing mode. */
  enterEditBoundary(): void {
    useRoadExtractionStore.getState().setPhase('editing-boundary');
  }

  /** Finish boundary editing, return to reviewing. */
  doneEditBoundary(): void {
    this.stopEditListeners();
    this.clearEditHandles();
    useRoadExtractionStore.getState().setPhase('reviewing');
  }

  /** Accept the current result and commit it. */
  acceptResult(): void {
    useRoadExtractionStore.getState().commitPending();
    // phase → 'committed' handled by store
  }

  /** From committed state: continue with a new chunk (keeps prior). */
  continueNewChunk(): void {
    this.drawingPoints = [];
    useRoadExtractionStore.getState().setPhase('drawing');
    this.startDrawingListeners();
  }

  /** Redraw centreline from scratch (discard current result). */
  redrawCenterline(): void {
    this.cancelExtract?.();
    useRoadExtractionStore.getState().clearPending();
    useRoadExtractionStore.getState().setPhase('drawing');
  }

  /** Exit to idle. */
  exitToIdle(): void {
    useViewerModeStore.getState().exitMode();
  }

  // ── Centreline drawing ─────────────────────────────────────────────────────

  private startDrawingListeners(): void {
    if (this.drawingListening || !this.ctx) return;
    this.drawingListening = true;
    this.ctx.domElement.addEventListener('pointerdown', this.onDrawPointerDown);
    this.ctx.domElement.addEventListener('pointermove', this.onDrawPointerMove);
    this.ctx.domElement.addEventListener('keydown',     this.onDrawKeyDown);
    this.ctx.domElement.style.cursor = 'crosshair';
  }

  private stopDrawingListeners(): void {
    if (!this.drawingListening || !this.ctx) return;
    this.drawingListening = false;
    this.ctx.domElement.removeEventListener('pointerdown', this.onDrawPointerDown);
    this.ctx.domElement.removeEventListener('pointermove', this.onDrawPointerMove);
    this.ctx.domElement.removeEventListener('keydown',     this.onDrawKeyDown);
    this.ctx.domElement.style.cursor = '';
  }

  private readonly onDrawPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.ctx) return;

    const hit = this.groundHit(e.clientX, e.clientY);
    if (!hit) return;

    const now = performance.now();
    const isDbl = now - this.drawLastClickTime < 350;
    this.drawLastClickTime = now;

    if (isDbl && this.drawingPoints.length >= 1) {
      // Double-click: remove the pending last point (duplicate of dbl-first-click)
      this.drawingPoints.pop();
      if (this.drawingPoints.length >= 2) this.confirmCenterline();
      return;
    }

    this.drawingPoints.push({ x: hit.x, y: hit.y, z: hit.z });
    this.drawingGroundY = hit.y;
    this.rebuildCentrelinePreview(null);
  };

  private readonly onDrawPointerMove = (e: PointerEvent): void => {
    this.drawLastMouse = { x: e.clientX, y: e.clientY };
    if (this.drawingPoints.length === 0) return;
    const hit = this.groundHit(e.clientX, e.clientY);
    this.rebuildCentrelinePreview(hit ? { x: hit.x, y: hit.y, z: hit.z } : null);
  };

  private readonly onDrawKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      this.cancelDrawing();
    } else if (e.key === 'Enter') {
      if (this.drawingPoints.length >= 2) this.confirmCenterline();
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      if (this.drawingPoints.length > 0) {
        this.drawingPoints.pop();
        const hit = this.groundHit(this.drawLastMouse.x, this.drawLastMouse.y);
        this.rebuildCentrelinePreview(hit ? { x: hit.x, y: hit.y, z: hit.z } : null);
      }
    }
  };

  // ── Extraction ─────────────────────────────────────────────────────────────

  private async runExtraction(): Promise<void> {
    const store = useRoadExtractionStore.getState();
    const { centerlinePoints, params, prior } = store;

    if (centerlinePoints.length < 2 || !this.ctx) {
      store.setPhase('drawing');
      return;
    }

    // Allow previous run to be cancelled
    let cancelled = false;
    this.cancelExtract?.();
    this.cancelExtract = () => { cancelled = true; };

    // 1. Build spatial grid index from visible point cloud nodes
    const grid = await this.buildGridAsync(() => cancelled);
    if (cancelled) return;

    this.gridIndex = grid;

    if (grid.count === 0) {
      store.setPhase('reviewing'); // will show "no points" state
      return;
    }

    // Update prior intensity stats from the centreline area
    const { params: p } = store;
    const clBbox = computePolylineBBox(centerlinePoints, p.maxHalfWidth);
    const iStats = grid.intensityStats(clBbox.minX, clBbox.maxX, clBbox.minZ, clBbox.maxZ);

    // Refine prior with intensity stats from this region
    if (store.prior) {
      store.setPrior({
        ...store.prior,
        intensityMean: iStats.mean,
        intensityStd:  iStats.std,
      });
    }

    // 2. Generate cross-section frames
    const frames = sampleCenterline(centerlinePoints, params.sectionSpacing);
    if (frames.length === 0) {
      store.setPhase('drawing');
      return;
    }

    store.setProgress({ done: 0, total: frames.length });

    // 3. Process sections in async batches
    const rawResults: SectionResult[] = [];

    for (let i = 0; i < frames.length; i += BATCH_SIZE) {
      if (cancelled) return;

      const end = Math.min(i + BATCH_SIZE, frames.length);
      for (let j = i; j < end; j++) {
        rawResults.push(
          analyzeSection(grid, frames[j], j, params, store.prior),
        );
      }

      store.setProgress({ done: end, total: frames.length });

      // Yield to the event loop so the UI can update
      await yieldToMain();
    }

    if (cancelled) return;

    // 4. Build smoothed boundary from raw results
    const {
      leftPoints,
      rightPoints,
      leftCurbFlags,
      rightCurbFlags,
    } = buildBoundaryFromResults(rawResults, frames, params.smoothingWindow);

    // 5. Update store and visuals
    store.setPendingResult(leftPoints, rightPoints, leftCurbFlags, rightCurbFlags);
    this.rebuildBoundaryLines(leftPoints, rightPoints);

    store.setProgress(null);
    store.setPhase('reviewing');
  }

  /** Build the spatial grid in a yielding fashion (one PCO node per tick). */
  private async buildGridAsync(isCancelled: () => boolean): Promise<PointGridIndex> {
    const grid = new PointGridIndex(0.5);
    if (!this.ctx) return grid;

    const pcos = this.ctx.getPointClouds();
    for (const pco of pcos) {
      const iRange = pco.material.intensityRange as [number, number] ?? [0, 65535];
      const iMin = iRange[0];
      const iMax = iRange[1];

      for (const node of pco.visibleNodes) {
        if (isCancelled()) return grid;

        const sceneNode = node.sceneNode;
        if (!sceneNode) continue;
        const geom = sceneNode.geometry;
        if (!geom) continue;

        const posAttr = geom.getAttribute('position');
        if (!posAttr) continue;

        const positions  = posAttr.array as Float32Array;
        const count      = posAttr.count;
        const intAttr    = geom.getAttribute('intensity');
        const intensities = intAttr ? (intAttr.array as Float32Array) : null;

        sceneNode.updateMatrixWorld(true);
        const me = sceneNode.matrixWorld.elements;

        grid.insertFromNode(positions, intensities, me, iMin, iMax, count);

        // Yield every node to keep UI responsive
        await yieldToMain();
      }
    }

    return grid;
  }

  // ── Edit handles ───────────────────────────────────────────────────────────

  private buildEditHandles(leftPts: Vec3[], rightPts: Vec3[]): void {
    this.clearEditHandles();
    if (!this.rootGroup) return;

    this.editHandleGroup = new Group();
    this.editHandleGroup.name = 'edit-handles';
    this.rootGroup.add(this.editHandleGroup);

    const geom       = new SphereGeometry(HANDLE_RADIUS, 8, 6);
    const leftMat    = new MeshBasicMaterial({ color: COLOR_HANDLE_LEFT,  depthTest: false });
    const rightMat   = new MeshBasicMaterial({ color: COLOR_HANDLE_RIGHT, depthTest: false });

    leftPts.forEach((p, i) => {
      const mesh = new Mesh(geom, leftMat.clone());
      mesh.position.set(p.x, p.y, p.z);
      mesh.renderOrder = RENDER_ORDER + 10;
      mesh.userData = { side: 'left',  index: i };
      this.editHandleGroup!.add(mesh);
    });

    rightPts.forEach((p, i) => {
      const mesh = new Mesh(geom, rightMat.clone());
      mesh.position.set(p.x, p.y, p.z);
      mesh.renderOrder = RENDER_ORDER + 10;
      mesh.userData = { side: 'right', index: i };
      this.editHandleGroup!.add(mesh);
    });
  }

  private clearEditHandles(): void {
    if (this.editHandleGroup && this.rootGroup) {
      disposeGroup(this.editHandleGroup);
      this.rootGroup.remove(this.editHandleGroup);
      this.editHandleGroup = null;
    }
    this.hoveredHandle = null;
    this.dragHandle    = null;
    this.dragHandleMat = null;
  }

  // ── Edit-handle pointer events ─────────────────────────────────────────────

  private startEditListeners(): void {
    if (this.editListening || !this.ctx) return;
    this.editListening = true;
    this.ctx.domElement.addEventListener('pointerdown', this.onEditPointerDown);
    this.ctx.domElement.addEventListener('pointermove', this.onEditPointerMove);
    this.ctx.domElement.addEventListener('pointerup',   this.onEditPointerUp);
    this.ctx.domElement.style.cursor = 'default';
  }

  private stopEditListeners(): void {
    if (!this.editListening || !this.ctx) return;
    this.editListening = false;
    this.ctx.domElement.removeEventListener('pointerdown', this.onEditPointerDown);
    this.ctx.domElement.removeEventListener('pointermove', this.onEditPointerMove);
    this.ctx.domElement.removeEventListener('pointerup',   this.onEditPointerUp);
    this.ctx.domElement.style.cursor = '';
    this.dragHandle = null;
  }

  private readonly onEditPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.ctx || !this.editHandleGroup) return;
    const hit = this.raycastHandles(e.clientX, e.clientY);
    if (!hit) return;

    this.dragHandle    = hit;
    this.dragHandleMat = hit.material as MeshBasicMaterial;
    this.dragHandleMat.color.setHex(COLOR_HANDLE_HOVER);
    this.dragStartMouse.set(e.clientX, e.clientY);

    // Disable orbit while dragging
    if (this.ctx.controls) this.ctx.controls.enabled = false;
  };

  private readonly onEditPointerMove = (e: PointerEvent): void => {
    if (!this.ctx || !this.editHandleGroup) return;

    if (this.dragHandle) {
      // Drag: move handle along the ground plane at the handle's current height
      const handleY = this.dragHandle.position.y;
      const ndc = clientToNdc(e.clientX, e.clientY, this.ctx.domElement);
      const camera = this.ctx.getActiveCamera();
      const worldPos = raycastHorizontalPlane(ndc, camera, handleY);
      if (!worldPos) return;

      const { side, index } = this.dragHandle.userData as { side: 'left' | 'right'; index: number };
      const newPos: Vec3 = { x: worldPos.x, y: handleY, z: worldPos.z };

      // Update mesh
      this.dragHandle.position.set(newPos.x, newPos.y, newPos.z);

      // Update store + line
      useRoadExtractionStore.getState().updatePendingVertex(side, index, newPos);
      const { pendingLeft, pendingRight } = useRoadExtractionStore.getState();
      this.rebuildBoundaryLines(pendingLeft, pendingRight);
      return;
    }

    // Hover highlight
    const hit = this.raycastHandles(e.clientX, e.clientY);
    if (this.hoveredHandle && this.hoveredHandle !== hit) {
      // Restore previous hover colour
      const { side } = this.hoveredHandle.userData as { side: 'left' | 'right' };
      (this.hoveredHandle.material as MeshBasicMaterial).color.setHex(
        side === 'left' ? COLOR_HANDLE_LEFT : COLOR_HANDLE_RIGHT,
      );
    }
    if (hit) {
      (hit.material as MeshBasicMaterial).color.setHex(COLOR_HANDLE_HOVER);
      this.ctx.domElement.style.cursor = 'grab';
    } else {
      this.ctx.domElement.style.cursor = 'default';
    }
    this.hoveredHandle = hit;
  };

  private readonly onEditPointerUp = (_e: PointerEvent): void => {
    if (this.dragHandle && this.dragHandleMat) {
      const { side } = this.dragHandle.userData as { side: 'left' | 'right' };
      this.dragHandleMat.color.setHex(
        side === 'left' ? COLOR_HANDLE_LEFT : COLOR_HANDLE_RIGHT,
      );
    }
    this.dragHandle    = null;
    this.dragHandleMat = null;
    if (this.ctx?.controls) this.ctx.controls.enabled = true;
  };

  private raycastHandles(clientX: number, clientY: number): Mesh | null {
    if (!this.ctx || !this.editHandleGroup) return null;
    const camera = this.ctx.getActiveCamera();
    const rect   = this.ctx.domElement.getBoundingClientRect();
    const ndc    = new Vector2(
      ((clientX - rect.left) / rect.width)  *  2 - 1,
      ((clientY - rect.top)  / rect.height) * -2 + 1,
    );
    const rc = new Raycaster();
    rc.setFromCamera(ndc, camera);
    const hits = rc.intersectObjects(this.editHandleGroup.children, false);
    return hits.length > 0 ? (hits[0].object as Mesh) : null;
  }

  // ── Three.js visuals ───────────────────────────────────────────────────────

  private rebuildCentrelinePreview(cursor: Vec3 | null): void {
    if (!this.rootGroup) return;
    if (this.centrelinePreviewLine) {
      disposeLineMesh(this.centrelinePreviewLine);
      this.rootGroup.remove(this.centrelinePreviewLine);
      this.centrelinePreviewLine = null;
    }

    const pts = cursor
      ? [...this.drawingPoints, cursor]
      : [...this.drawingPoints];

    if (pts.length < 2) return;

    this.centrelinePreviewLine = buildLine(pts, COLOR_CENTRELINE, true);
    this.centrelinePreviewLine.renderOrder = RENDER_ORDER;
    this.rootGroup.add(this.centrelinePreviewLine);
  }

  private rebuildBoundaryLines(leftPts: Vec3[], rightPts: Vec3[]): void {
    if (!this.rootGroup) return;

    if (this.leftBoundaryLine) {
      disposeLineMesh(this.leftBoundaryLine);
      this.rootGroup.remove(this.leftBoundaryLine);
      this.leftBoundaryLine = null;
    }
    if (this.rightBoundaryLine) {
      disposeLineMesh(this.rightBoundaryLine);
      this.rootGroup.remove(this.rightBoundaryLine);
      this.rightBoundaryLine = null;
    }

    if (leftPts.length >= 2) {
      this.leftBoundaryLine = buildLine(leftPts, COLOR_LEFT, false);
      this.leftBoundaryLine.renderOrder = RENDER_ORDER;
      this.rootGroup.add(this.leftBoundaryLine);
    }
    if (rightPts.length >= 2) {
      this.rightBoundaryLine = buildLine(rightPts, COLOR_RIGHT, false);
      this.rightBoundaryLine.renderOrder = RENDER_ORDER;
      this.rootGroup.add(this.rightBoundaryLine);
    }
  }

  private clearPreviewLines(): void {
    if (!this.rootGroup) return;
    if (this.centrelinePreviewLine) {
      disposeLineMesh(this.centrelinePreviewLine);
      this.rootGroup.remove(this.centrelinePreviewLine);
      this.centrelinePreviewLine = null;
    }
    if (this.leftBoundaryLine) {
      disposeLineMesh(this.leftBoundaryLine);
      this.rootGroup.remove(this.leftBoundaryLine);
      this.leftBoundaryLine = null;
    }
    if (this.rightBoundaryLine) {
      disposeLineMesh(this.rightBoundaryLine);
      this.rootGroup.remove(this.rightBoundaryLine);
      this.rightBoundaryLine = null;
    }
  }

  private rebuildCommitted(): void {
    this.clearCommitted();
    if (!this.rootGroup) return;
    const { boundaries } = useRoadExtractionStore.getState();

    for (const b of boundaries) {
      if (!b.visible) continue;
      const group = new Group();
      group.name = b.id;

      if (b.leftPoints.length >= 2) {
        const line = buildLine(b.leftPoints, COLOR_LEFT, false);
        line.renderOrder = RENDER_ORDER - 1;
        group.add(line);
      }
      if (b.rightPoints.length >= 2) {
        const line = buildLine(b.rightPoints, COLOR_RIGHT, false);
        line.renderOrder = RENDER_ORDER - 1;
        group.add(line);
      }

      this.committedGroups.set(b.id, group);
      this.rootGroup.add(group);
    }
  }

  private clearCommitted(): void {
    if (!this.rootGroup) return;
    for (const group of this.committedGroups.values()) {
      disposeGroup(group);
      this.rootGroup.remove(group);
    }
    this.committedGroups.clear();
  }

  private clearVisuals(): void {
    this.clearPreviewLines();
    this.clearEditHandles();
  }

  // ── Ground elevation ───────────────────────────────────────────────────────

  private groundHit(clientX: number, clientY: number): Vector3 | null {
    if (!this.ctx) return null;
    const camera = this.ctx.getActiveCamera();
    const ndc    = clientToNdc(clientX, clientY, this.ctx.domElement);
    let hit = raycastHorizontalPlane(ndc, camera, this.drawingGroundY);
    if (!hit) return null;

    const dem = this.ctx.getDem();
    if (dem) {
      const tg  = this.ctx.getEditor().getTransformGroup();
      tg.updateMatrixWorld(true);
      const inv = new Matrix4().copy(tg.matrixWorld).invert();
      const local = new Vector3(hit.x, 0, hit.z).applyMatrix4(inv);
      const elev  = dem.getElevationClamped(local.x, local.z);
      if (elev !== null) {
        hit = raycastHorizontalPlane(ndc, camera, elev as number) ?? hit;
        hit.y = elev as number;
      }
    }

    return hit;
  }

  private computeFallbackElevY(): void {
    if (!this.ctx) return;
    const pcos = this.ctx.getPointClouds();
    if (pcos.length === 0) return;
    const tg = this.ctx.getEditor().getTransformGroup();
    tg.updateMatrixWorld(true);
    const wm = tg.matrixWorld;
    let totalY = 0, count = 0;
    for (const pco of pcos) {
      const b      = pco.pcoGeometry.boundingBox;
      const minW   = b.min.clone().applyMatrix4(wm);
      const maxW   = b.max.clone().applyMatrix4(wm);
      totalY += (minW.y + maxW.y) / 2;
      count++;
    }
    if (count > 0) this.fallbackElevY = totalY / count;
    this.drawingGroundY = this.fallbackElevY;
  }
}

// ── Module-level helpers ──────────────────────────────────────────────────────

function buildLine(pts: Vec3[], color: number, dashed: boolean): Line {
  const positions = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => {
    positions[i * 3]     = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
  });
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  const mat = new LineBasicMaterial({
    color,
    linewidth:  2,
    depthTest:  false,
    opacity:    dashed ? 0.7 : 0.95,
    transparent: true,
  });
  return new Line(geom, mat);
}

function disposeLineMesh(line: Line): void {
  line.geometry.dispose();
  (line.material as LineBasicMaterial).dispose();
}

function disposeGroup(group: Group): void {
  group.traverse((obj) => {
    if (obj instanceof Mesh || obj instanceof Line) {
      obj.geometry.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
  });
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function computePolylineBBox(
  pts: Vec3[],
  padding: number,
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX: minX - padding, maxX: maxX + padding, minZ: minZ - padding, maxZ: maxZ + padding };
}
