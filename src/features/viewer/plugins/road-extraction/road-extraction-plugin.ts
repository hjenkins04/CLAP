import {
  DoubleSide,
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
import {
  upsamplePolyline,
  chaikinSmooth,
  offsetPolyline,
  deriveCenterline,
  projectLineToFrames,
} from './services/centerline-utils';

/** Pre-extracted clip inverse matrix elements for fast per-point testing. */
interface ClipInverse { e: Float64Array }

// ── Visual constants ──────────────────────────────────────────────────────────

const COLOR_CENTRELINE      = 0xffcc00;
const COLOR_LEFT            = 0x00ff88;
const COLOR_RIGHT           = 0xff6600;
const COLOR_HANDLE_LEFT     = 0x00ff88;
const COLOR_HANDLE_RIGHT    = 0xff6600;
const COLOR_HANDLE_HOVER    = 0xffffff;
const COLOR_MIDPOINT        = 0xaaaaff;
const COLOR_SHAPING_FILL    = 0x0099cc;
const HANDLE_RADIUS         = 0.15;       // metres
const MIDPOINT_RADIUS       = 0.10;       // metres
const RENDER_ORDER          = 950;
const BATCH_SIZE            = 40;         // sections per async tick
const MIDPOINT_SCREEN_PX    = 20;         // hover detection threshold (pixels)

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

  // ── Shaping phase ─────────────────────────────────────────────────────────
  private shapingGroup:             Group | null = null;
  private shapingPolygonMesh:       Mesh  | null = null;
  private shapingCentrelineLine:    Line  | null = null;
  private shapingLeftLine:          Line  | null = null;
  private shapingRightLine:         Line  | null = null;
  private shapingHandleGroup:       Group | null = null;
  private shapingMidpointIndicator: Mesh  | null = null;
  /** Local mutable copies used for smooth direct-update during drag. */
  private shapingLeftLocal:  Vec3[] = [];
  private shapingRightLocal: Vec3[] = [];
  private shapingListening        = false;
  private shapingDragHandle:      Mesh | null = null;
  private shapingDragHandleMat:   MeshBasicMaterial | null = null;
  private shapingHoveredMidpoint: { side: 'left' | 'right'; afterIndex: number; worldPos: Vec3 } | null = null;

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
    this.stopShapingListeners();
    this.stopEditListeners();
    this.clearPreviewLines();
    this.clearShapingVisuals();
    this.clearEditHandles();
    this.drawingPoints = [];
    const store = useRoadExtractionStore.getState();
    store.clearPending();
    store.clearCenterline();
    store.clearShaping();
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
        this.stopShapingListeners();
        this.clearShapingVisuals();
        this.stopEditListeners();
        this.clearPreviewLines();
        this.clearEditHandles();
        this.drawingPoints = [];
        useRoadExtractionStore.getState().clearShaping();
        this.startDrawingListeners();
        break;

      case 'shaping':
        this.stopDrawingListeners();
        this.stopEditListeners();
        this.clearEditHandles();
        this.enterShaping();
        break;

      case 'extracting':
        this.stopDrawingListeners();
        this.stopShapingListeners();
        this.clearShapingVisuals();
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

  /** Confirm the drawn centreline → enter shaping phase. */
  confirmCenterline(): void {
    const store = useRoadExtractionStore.getState();
    if (this.drawingPoints.length < 2) return;
    store.setCenterlinePoints([...this.drawingPoints]);
    store.setPhase('shaping');
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

  /** Confirm the shaping polygon and trigger extraction. */
  confirmShaping(): void {
    const store = useRoadExtractionStore.getState();
    const { shapingLeft, shapingRight } = store;
    if (shapingLeft.length < 2 || shapingRight.length < 2) return;

    // Re-derive centreline as midpoints of left/right edge lines
    const newCentreline = deriveCenterline(shapingLeft, shapingRight);
    store.setCenterlinePoints(newCentreline);
    this.drawingPoints = [...newCentreline];
    // shapingLeft/Right stay in store as extraction hints
    store.setPhase('extracting');
  }

  /** Go back to shaping from reviewing to re-adjust the road polygon. */
  backToShaping(): void {
    useRoadExtractionStore.getState().setPhase('shaping');
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

    if (isDbl && this.drawingPoints.length >= 2) {
      // Double-click: the first click already added the point; just confirm.
      // Do NOT pop — the user expects double-click to mean "add final point + finish",
      // which is standard drawing-tool convention.
      this.confirmCenterline();
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

  // ── Shaping phase ─────────────────────────────────────────────────────────

  private enterShaping(): void {
    const store = useRoadExtractionStore.getState();
    const { centerlinePoints, params } = store;
    if (centerlinePoints.length < 2) return;

    // Resolve params defensively — persisted state from an older session may
    // be missing new fields if the persist merge hasn't kicked in yet.
    const clSpacing   = params.centerlineUpsampleSpacing > 0 ? params.centerlineUpsampleSpacing : 0.25;
    const denseSpacing = params.upsampleSpacing > 0 ? params.upsampleSpacing : 0.5;
    const passes      = Number.isFinite(params.smoothingPasses) ? Math.round(params.smoothingPasses) : 3;
    const width       = params.roadWidth > 0 ? params.roadWidth : 8.0;

    // 1. Upsample raw drawn line at fine spacing → smooth → re-sample at output spacing
    const upsampled = upsamplePolyline(centerlinePoints, clSpacing);
    const smoothed  = chaikinSmooth(upsampled, passes);
    const dense     = upsamplePolyline(smoothed, denseSpacing);

    if (dense.length < 2) return;

    // 2. Offset left and right by roadWidth / 2
    const half  = width / 2;
    const left  = offsetPolyline(dense,  half);
    const right = offsetPolyline(dense, -half);

    store.setShapingLines(left, right);
    this.rebuildShapingVisuals(left, right, dense);
    this.startShapingListeners();
  }

  private rebuildShapingVisuals(left: Vec3[], right: Vec3[], centre?: Vec3[]): void {
    this.clearShapingVisuals();
    if (left.length < 2 || right.length < 2 || !this.rootGroup) return;

    this.shapingGroup = new Group();
    this.shapingGroup.name = 'road-shaping';
    this.rootGroup.add(this.shapingGroup);

    // Filled polygon
    this.shapingPolygonMesh = buildRibbonMesh(left, right);
    if (this.shapingPolygonMesh) {
      this.shapingPolygonMesh.renderOrder = RENDER_ORDER - 5;
      this.shapingGroup.add(this.shapingPolygonMesh);
    }

    // Reference centreline
    const cl = centre ?? useRoadExtractionStore.getState().centerlinePoints;
    if (cl.length >= 2) {
      this.shapingCentrelineLine = buildLine(cl, COLOR_CENTRELINE, true);
      this.shapingCentrelineLine.renderOrder = RENDER_ORDER;
      this.shapingGroup.add(this.shapingCentrelineLine);
    }

    // Edge lines
    this.shapingLeftLine = buildLine(left, COLOR_LEFT, false);
    this.shapingLeftLine.renderOrder = RENDER_ORDER + 1;
    this.shapingGroup.add(this.shapingLeftLine);

    this.shapingRightLine = buildLine(right, COLOR_RIGHT, false);
    this.shapingRightLine.renderOrder = RENDER_ORDER + 1;
    this.shapingGroup.add(this.shapingRightLine);

    // Vertex handles
    this.shapingHandleGroup = new Group();
    this.shapingHandleGroup.name = 'shaping-handles';
    this.shapingGroup.add(this.shapingHandleGroup);

    const hGeom = new SphereGeometry(HANDLE_RADIUS, 8, 6);
    left.forEach((p, i) => {
      const m = new Mesh(hGeom, new MeshBasicMaterial({ color: COLOR_HANDLE_LEFT, depthTest: false }));
      m.position.set(p.x, p.y, p.z);
      m.renderOrder = RENDER_ORDER + 10;
      m.userData = { side: 'left', index: i };
      this.shapingHandleGroup!.add(m);
    });
    right.forEach((p, i) => {
      const m = new Mesh(hGeom, new MeshBasicMaterial({ color: COLOR_HANDLE_RIGHT, depthTest: false }));
      m.position.set(p.x, p.y, p.z);
      m.renderOrder = RENDER_ORDER + 10;
      m.userData = { side: 'right', index: i };
      this.shapingHandleGroup!.add(m);
    });

    // Single reusable midpoint-hover indicator
    const mpGeom = new SphereGeometry(MIDPOINT_RADIUS, 8, 6);
    this.shapingMidpointIndicator = new Mesh(
      mpGeom,
      new MeshBasicMaterial({ color: COLOR_MIDPOINT, depthTest: false, transparent: true, opacity: 0.85 }),
    );
    this.shapingMidpointIndicator.visible = false;
    this.shapingMidpointIndicator.renderOrder = RENDER_ORDER + 15;
    this.shapingGroup.add(this.shapingMidpointIndicator);

    // Keep local copies for direct-update during drag
    this.shapingLeftLocal  = [...left];
    this.shapingRightLocal = [...right];
  }

  private clearShapingVisuals(): void {
    this.stopShapingListeners();
    if (this.shapingGroup && this.rootGroup) {
      disposeGroup(this.shapingGroup);
      this.rootGroup.remove(this.shapingGroup);
    }
    this.shapingGroup             = null;
    this.shapingPolygonMesh       = null;
    this.shapingCentrelineLine    = null;
    this.shapingLeftLine          = null;
    this.shapingRightLine         = null;
    this.shapingHandleGroup       = null;
    this.shapingMidpointIndicator = null;
    this.shapingDragHandle        = null;
    this.shapingDragHandleMat     = null;
    this.shapingHoveredMidpoint   = null;
  }

  // ── Shaping listeners ──────────────────────────────────────────────────────

  private startShapingListeners(): void {
    if (this.shapingListening || !this.ctx) return;
    this.shapingListening = true;
    this.ctx.domElement.addEventListener('pointerdown', this.onShapingPointerDown);
    this.ctx.domElement.addEventListener('pointermove', this.onShapingPointerMove);
    this.ctx.domElement.addEventListener('pointerup',   this.onShapingPointerUp);
    this.ctx.domElement.style.cursor = 'default';
  }

  private stopShapingListeners(): void {
    if (!this.shapingListening || !this.ctx) return;
    this.shapingListening = false;
    this.ctx.domElement.removeEventListener('pointerdown', this.onShapingPointerDown);
    this.ctx.domElement.removeEventListener('pointermove', this.onShapingPointerMove);
    this.ctx.domElement.removeEventListener('pointerup',   this.onShapingPointerUp);
    this.ctx.domElement.style.cursor = '';
    this.shapingDragHandle = null;
    if (this.ctx?.controls) this.ctx.controls.enabled = true;
  }

  private readonly onShapingPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.ctx || !this.shapingHandleGroup) return;

    // Check vertex handle hit
    const handle = this.raycastShapingHandles(e.clientX, e.clientY);
    if (handle) {
      this.shapingDragHandle    = handle;
      this.shapingDragHandleMat = handle.material as MeshBasicMaterial;
      this.shapingDragHandleMat.color.setHex(COLOR_HANDLE_HOVER);
      if (this.ctx.controls) this.ctx.controls.enabled = false;
      return;
    }

    // Check midpoint hover → insert vertex
    if (this.shapingHoveredMidpoint) {
      const { side, afterIndex, worldPos } = this.shapingHoveredMidpoint;
      useRoadExtractionStore.getState().insertShapingVertex(side, afterIndex, worldPos);
      const store = useRoadExtractionStore.getState();
      this.rebuildShapingVisuals(store.shapingLeft, store.shapingRight);
      this.startShapingListeners();
    }
  };

  private readonly onShapingPointerMove = (e: PointerEvent): void => {
    if (!this.ctx) return;

    if (this.shapingDragHandle) {
      // Drag vertex along its horizontal plane
      const handleY = this.shapingDragHandle.position.y;
      const ndc = clientToNdc(e.clientX, e.clientY, this.ctx.domElement);
      const camera = this.ctx.getActiveCamera();
      const worldPos = raycastHorizontalPlane(ndc, camera, handleY);
      if (!worldPos) return;

      const { side, index } = this.shapingDragHandle.userData as { side: 'left' | 'right'; index: number };
      const pos: Vec3 = { x: worldPos.x, y: handleY, z: worldPos.z };

      // Update local copy and handle mesh position
      if (side === 'left')  this.shapingLeftLocal[index]  = pos;
      else                  this.shapingRightLocal[index] = pos;
      this.shapingDragHandle.position.set(pos.x, pos.y, pos.z);

      // Update line geometry in place (fast — no mesh rebuild)
      this.updateShapingLineGeometry(side === 'left' ? this.shapingLeftLine : this.shapingRightLine,
                                     side === 'left' ? this.shapingLeftLocal : this.shapingRightLocal);
      // Rebuild polygon (small, fast)
      this.rebuildShapingPolygonInPlace();
      return;
    }

    // Midpoint hover detection
    this.updateShapingMidpointHover(e.clientX, e.clientY);
  };

  private readonly onShapingPointerUp = (_e: PointerEvent): void => {
    if (!this.shapingDragHandle) return;

    const { side, index } = this.shapingDragHandle.userData as { side: 'left' | 'right'; index: number };
    const pos = this.shapingDragHandle.position;

    // Restore handle colour
    if (this.shapingDragHandleMat) {
      this.shapingDragHandleMat.color.setHex(
        side === 'left' ? COLOR_HANDLE_LEFT : COLOR_HANDLE_RIGHT,
      );
    }

    // Commit final position to store
    useRoadExtractionStore.getState().updateShapingVertex(
      side, index, { x: pos.x, y: pos.y, z: pos.z },
    );

    this.shapingDragHandle    = null;
    this.shapingDragHandleMat = null;
    if (this.ctx?.controls) this.ctx.controls.enabled = true;
  };

  private raycastShapingHandles(clientX: number, clientY: number): Mesh | null {
    if (!this.ctx || !this.shapingHandleGroup) return null;
    const camera = this.ctx.getActiveCamera();
    const rect   = this.ctx.domElement.getBoundingClientRect();
    const ndc    = new Vector2(
      ((clientX - rect.left) / rect.width)  *  2 - 1,
      ((clientY - rect.top)  / rect.height) * -2 + 1,
    );
    const rc = new Raycaster();
    rc.setFromCamera(ndc, camera);
    const hits = rc.intersectObjects(this.shapingHandleGroup.children, false);
    return hits.length > 0 ? (hits[0].object as Mesh) : null;
  }

  private updateShapingMidpointHover(clientX: number, clientY: number): void {
    if (!this.ctx || !this.shapingMidpointIndicator) return;

    const camera = this.ctx.getActiveCamera();
    camera.updateMatrixWorld(true);
    const rect = this.ctx.domElement.getBoundingClientRect();

    // View-projection matrix for screen-space projection
    const vpMat = new Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    const m = vpMat.elements;

    const toScreen = (wx: number, wy: number, wz: number): { sx: number; sy: number } | null => {
      const w = m[3] * wx + m[7] * wy + m[11] * wz + m[15];
      if (w <= 0) return null;
      return {
        sx: (((m[0] * wx + m[4] * wy + m[8]  * wz + m[12]) / w) + 1) / 2 * rect.width  + rect.left,
        sy: ((-(m[1] * wx + m[5] * wy + m[9] * wz + m[13]) / w) + 1) / 2 * rect.height + rect.top,
      };
    };

    let best: { side: 'left' | 'right'; afterIndex: number; worldPos: Vec3; dist: number } | null = null;

    const check = (pts: Vec3[], side: 'left' | 'right') => {
      for (let i = 0; i < pts.length - 1; i++) {
        const mp: Vec3 = {
          x: (pts[i].x + pts[i + 1].x) / 2,
          y: (pts[i].y + pts[i + 1].y) / 2,
          z: (pts[i].z + pts[i + 1].z) / 2,
        };
        const sc = toScreen(mp.x, mp.y, mp.z);
        if (!sc) continue;
        const dx = sc.sx - clientX, dy = sc.sy - clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MIDPOINT_SCREEN_PX && (!best || dist < best.dist)) {
          best = { side, afterIndex: i, worldPos: mp, dist };
        }
      }
    };

    check(this.shapingLeftLocal,  'left');
    check(this.shapingRightLocal, 'right');

    if (best) {
      this.shapingHoveredMidpoint = best;
      this.shapingMidpointIndicator.position.set(best.worldPos.x, best.worldPos.y, best.worldPos.z);
      this.shapingMidpointIndicator.visible = true;
      (this.shapingMidpointIndicator.material as MeshBasicMaterial).color.setHex(
        best.side === 'left' ? COLOR_LEFT : COLOR_RIGHT,
      );
      if (this.ctx) this.ctx.domElement.style.cursor = 'copy';
    } else {
      this.shapingHoveredMidpoint = null;
      this.shapingMidpointIndicator.visible = false;
      if (this.ctx && !this.shapingDragHandle) this.ctx.domElement.style.cursor = 'default';
    }
  }

  /** Update a single edge line's position buffer in place. */
  private updateShapingLineGeometry(line: Line | null, pts: Vec3[]): void {
    if (!line || pts.length < 2) return;
    const posAttr = line.geometry.getAttribute('position') as BufferAttribute;
    if (posAttr.count !== pts.length) {
      // Point count mismatch (shouldn't happen during drag, only after insert)
      return;
    }
    for (let i = 0; i < pts.length; i++) {
      posAttr.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
    }
    posAttr.needsUpdate = true;
  }

  /** Dispose the current polygon mesh and rebuild it from the local copies. */
  private rebuildShapingPolygonInPlace(): void {
    if (!this.shapingGroup) return;
    if (this.shapingPolygonMesh) {
      disposeObject(this.shapingPolygonMesh);
      this.shapingGroup.remove(this.shapingPolygonMesh);
      this.shapingPolygonMesh = null;
    }
    const mesh = buildRibbonMesh(this.shapingLeftLocal, this.shapingRightLocal);
    if (mesh) {
      mesh.renderOrder = RENDER_ORDER - 5;
      this.shapingGroup.add(mesh);
      this.shapingPolygonMesh = mesh;
    }
  }

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

    // 2a. Compute per-frame edge hints from the shaping lines (if available)
    const { shapingLeft, shapingRight } = store;
    const hintLeft  = shapingLeft.length  >= 2 ? projectLineToFrames(shapingLeft,  frames) : null;
    const hintRight = shapingRight.length >= 2 ? projectLineToFrames(shapingRight, frames) : null;

    store.setProgress({ done: 0, total: frames.length });

    // 3. Process sections in async batches
    const rawResults: SectionResult[] = [];

    for (let i = 0; i < frames.length; i += BATCH_SIZE) {
      if (cancelled) return;

      const end = Math.min(i + BATCH_SIZE, frames.length);
      for (let j = i; j < end; j++) {
        rawResults.push(
          analyzeSection(grid, frames[j], j, params, store.prior,
            hintLeft?.[j], hintRight?.[j]),
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

  /** Build the spatial grid in a yielding fashion (one PCO node per tick).
   *
   * Respects the current viewport filters exactly as the renderer does:
   *   - Active ROI / virtual-tile clip boxes and cylinders
   *   - Classification visibility and active state (from annotate store)
   *   - Point-cloud visibility flag
   */
  private async buildGridAsync(isCancelled: () => boolean): Promise<PointGridIndex> {
    const grid = new PointGridIndex(0.5);
    if (!this.ctx) return grid;

    const { classVisibility, classActive } = useAnnotateStore.getState();

    const pcos = this.ctx.getPointClouds();
    for (const pco of pcos) {
      if (!pco.visible) continue;

      // --- Extract active clip regions from material ---
      const mat = pco.material;
      let clipBoxes: ClipInverse[] | null = null;
      let clipCylinders: ClipInverse[] | null = null;

      if (mat.clipMode !== ClipMode.DISABLED) {
        clipBoxes = mat.clipBoxes.map((cb: { inverse: Matrix4 }) => ({
          e: new Float64Array(cb.inverse.elements),
        }));
        if (mat.clipCylinders?.length) {
          clipCylinders = (mat.clipCylinders as Array<{ inverse: Matrix4 }>).map((cc) => ({
            e: new Float64Array(cc.inverse.elements),
          }));
        }
        // Only keep if at least one region is defined
        if (clipBoxes.length === 0) clipBoxes = null;
        if (clipCylinders?.length === 0) clipCylinders = null;
      }

      const hasClip = clipBoxes !== null || clipCylinders !== null;

      const iRange = pco.material.intensityRange as [number, number] ?? [0, 65535];
      const iMin = iRange[0];
      const iMax = iRange[1];
      const iRangeSpan = iMax - iMin || 1;

      for (const node of pco.visibleNodes) {
        if (isCancelled()) return grid;

        const sceneNode = node.sceneNode;
        if (!sceneNode) continue;
        const geom = sceneNode.geometry;
        if (!geom) continue;

        const posAttr = geom.getAttribute('position');
        if (!posAttr) continue;

        sceneNode.updateMatrixWorld(true);
        const ne = sceneNode.matrixWorld.elements;

        const positions   = posAttr.array as Float32Array;
        const count       = posAttr.count;
        const intAttr     = geom.getAttribute('intensity');
        const intensities = intAttr ? (intAttr.array as Float32Array) : null;
        const classAttr   = geom.getAttribute('classification');

        const needsClassFilter = classAttr !== null && classAttr !== undefined;

        for (let i = 0; i < count; i++) {
          // --- Classification filter ---
          if (needsClassFilter) {
            const classVal = String(Math.round(classAttr.getX(i)));
            if (!(classVisibility[classVal] ?? true)) continue;
            if (!(classActive[classVal] ?? true)) continue;
          }

          const lx = positions[i * 3];
          const ly = positions[i * 3 + 1];
          const lz = positions[i * 3 + 2];

          // Transform to world space
          const wx = ne[0] * lx + ne[4] * ly + ne[8]  * lz + ne[12];
          const wy = ne[1] * lx + ne[5] * ly + ne[9]  * lz + ne[13];
          const wz = ne[2] * lx + ne[6] * ly + ne[10] * lz + ne[14];

          // --- Clip region filter (ROI, virtual tiles, etc.) ---
          if (hasClip) {
            let inside = false;

            if (clipBoxes) {
              for (const { e } of clipBoxes) {
                const clx = e[0] * wx + e[4] * wy + e[8]  * wz + e[12];
                const cly = e[1] * wx + e[5] * wy + e[9]  * wz + e[13];
                const clz = e[2] * wx + e[6] * wy + e[10] * wz + e[14];
                if (clx >= -0.5 && clx <= 0.5 && cly >= -0.5 && cly <= 0.5 && clz >= -0.5 && clz <= 0.5) {
                  inside = true;
                  break;
                }
              }
            }

            if (!inside && clipCylinders) {
              for (const { e } of clipCylinders) {
                const clx = e[0] * wx + e[4] * wy + e[8]  * wz + e[12];
                const cly = e[1] * wx + e[5] * wy + e[9]  * wz + e[13];
                const clz = e[2] * wx + e[6] * wy + e[10] * wz + e[14];
                if (clx * clx + cly * cly <= 0.25 && clz >= -0.5 && clz <= 0.5) {
                  inside = true;
                  break;
                }
              }
            }

            if (!inside) continue;
          }

          // Normalise intensity to [0, 255]
          const rawI  = intensities ? intensities[i] : 128;
          const normI = ((rawI - iMin) / iRangeSpan) * 255;

          grid.insert(wx, wy, wz, normI);
        }

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

/**
 * Build a semi-transparent ribbon mesh between two edge polylines.
 * Both lines are resampled to the same count for clean triangulation.
 */
/** Return true when all three coordinates of a Vec3 are finite numbers. */
function isFiniteVec3(p: Vec3): boolean {
  return isFinite(p.x) && isFinite(p.y) && isFinite(p.z);
}

function buildRibbonMesh(left: Vec3[], right: Vec3[]): Mesh | null {
  const cleanL = left.filter(isFiniteVec3);
  const cleanR = right.filter(isFiniteVec3);
  if (cleanL.length < 2 || cleanR.length < 2) return null;
  // Use cleaned copies for the rest of the function
  left  = cleanL;
  right = cleanR;

  const M = Math.max(left.length, right.length, 60);
  // Inline resample (avoid circular import — centerline-utils used at top)
  const resample = (pts: Vec3[], count: number): Vec3[] => {
    if (pts.length < 2) return [...pts];
    const arcs: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x, dz = pts[i].z - pts[i - 1].z;
      arcs.push(arcs[i - 1] + Math.sqrt(dx * dx + dz * dz));
    }
    const total = arcs[arcs.length - 1];
    const out: Vec3[] = [];
    for (let j = 0; j < count; j++) {
      const s = (j / (count - 1)) * total;
      let lo = 0, hi = arcs.length - 2;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (arcs[mid] <= s) lo = mid; else hi = mid - 1; }
      const span = arcs[lo + 1] - arcs[lo];
      const t = span > 1e-10 ? (s - arcs[lo]) / span : 0;
      out.push({
        x: pts[lo].x + t * (pts[lo + 1].x - pts[lo].x),
        y: pts[lo].y + t * (pts[lo + 1].y - pts[lo].y),
        z: pts[lo].z + t * (pts[lo + 1].z - pts[lo].z),
      });
    }
    return out;
  };

  const l = resample(left,  M);
  const r = resample(right, M);

  const positions = new Float32Array(M * 2 * 3);
  for (let i = 0; i < M; i++) {
    positions[(i * 2)     * 3 + 0] = l[i].x; positions[(i * 2)     * 3 + 1] = l[i].y; positions[(i * 2)     * 3 + 2] = l[i].z;
    positions[(i * 2 + 1) * 3 + 0] = r[i].x; positions[(i * 2 + 1) * 3 + 1] = r[i].y; positions[(i * 2 + 1) * 3 + 2] = r[i].z;
  }

  const indices: number[] = [];
  for (let i = 0; i < M - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    indices.push(a, b, c,  b, d, c);
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setIndex(indices);

  const mat = new MeshBasicMaterial({
    color:       COLOR_SHAPING_FILL,
    transparent: true,
    opacity:     0.18,
    side:        DoubleSide,
    depthWrite:  false,
  });

  return new Mesh(geom, mat);
}

function disposeObject(obj: Mesh | Line): void {
  obj.geometry.dispose();
  const mat = obj.material;
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
  else mat.dispose();
}

function buildLine(pts: Vec3[], color: number, dashed: boolean): Line {
  const safe = pts.filter(isFiniteVec3);
  const usePts = safe.length >= 2 ? safe : pts;
  const positions = new Float32Array(usePts.length * 3);
  usePts.forEach((p, i) => {
    positions[i * 3]     = isFinite(p.x) ? p.x : 0;
    positions[i * 3 + 1] = isFinite(p.y) ? p.y : 0;
    positions[i * 3 + 2] = isFinite(p.z) ? p.z : 0;
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
