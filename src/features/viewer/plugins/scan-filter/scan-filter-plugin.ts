import {
  BufferGeometry,
  Float32BufferAttribute,
  OrthographicCamera,
  Points,
  PointsMaterial,
  Vector2,
  Vector3,
} from 'three';
import type { PointCloudOctree } from 'potree-core';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { electronFetch } from '../../services/electron-fetch';
import { useScanFilterStore } from './scan-filter-store';
import { useViewerModeStore } from '@/app/stores';
import type { TrajectoryData } from './scan-filter-types';

// Height of the scanning sensor above ground (metres)
const SENSOR_HEIGHT = 2.0;

interface DemData {
  xMin: number; yMin: number; xMax: number; yMax: number;
  cellSize: number; cols: number; rows: number;
  elevation: number[][];
}

// Color constants
const COLOR_UNSELECTED = [0.4, 0.7, 1.0] as const;   // blue-white
const COLOR_SELECTED   = [1.0, 0.6, 0.0] as const;   // orange
const COLOR_HOVER      = [1.0, 1.0, 0.0] as const;   // yellow

export class ScanFilterPlugin implements ViewerPlugin {
  readonly id = 'scan-filter';
  readonly name = 'Scan Filter';
  readonly order = 93;

  private ctx: ViewerPluginContext | null = null;
  private trajPoints: Points | null = null;
  private trajGeo: BufferGeometry | null = null;
  private trajData: TrajectoryData | null = null;
  private hoveredScanId: number | null = null;
  private demData: DemData | null = null;

  // LOD: 4 pre-built meshes (one per detail level). Only the active one is visible.
  // Toggling .visible is guaranteed to work; setDrawRange proved unreliable.
  private lodMeshes: (Points | null)[] = [null, null, null, null];
  private lodGeos:   (BufferGeometry | null)[] = [null, null, null, null];
  private permutation: Int32Array | null = null;   // permutation[perm_i] = orig_i
  private lodCounts: [number, number, number, number] = [0, 0, 0, 0];
  private currentLodLevel = 3;
  private lodCheckTick = 0;
  private scanDiag = 500; // bounding-box diagonal; updated on point cloud load
  private static readonly LOD_STRIDES = [64, 16, 4, 1] as const;
  // LOD thresholds as fractions of scan diagonal applied to the zoom proxy.
  // For ortho: proxy = visible world height. For persp: proxy = orbit radius.
  // e.g. for diag=2391: [1434, 478, 120]
  private static readonly LOD_FRACS   = [0.6, 0.2, 0.05] as const;
  // Dot sizes per LOD level — bigger dots when fewer points are shown.
  private static readonly LOD_SIZES   = [14, 11, 8, 6] as const;

  private unsubMode: (() => void) | null = null;
  private unsubStore: (() => void) | null = null;

  private listening = false;
  private mouseDownPos = new Vector2();
  private isDragSelecting = false;
  private isPointerDown = false;
  private dragStartClient = new Vector2();
  private dragIsDeselect = false;
  private selRectEl: HTMLDivElement | null = null;

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;

    this.unsubMode = useViewerModeStore.subscribe((state, prev) => {
      const was = prev.mode === 'scan-filter';
      const is  = state.mode === 'scan-filter';
      if (is && !was) this.enterMode();
      else if (!is && was) this.exitMode();
    });

    this.unsubStore = useScanFilterStore.subscribe((state, prev) => {
      if (state.trajectoryVisible !== prev.trajectoryVisible) {
        for (let lod = 0; lod < 4; lod++) {
          if (this.lodMeshes[lod])
            this.lodMeshes[lod]!.visible = state.trajectoryVisible && lod === this.currentLodLevel;
        }
      }
      if (state.selectedScanIds !== prev.selectedScanIds) {
        this.rebuildColors();
        if (state.filterEnabled) this.applyFilter();
      }
      if (state.effectiveScanIdMin !== prev.effectiveScanIdMin ||
          state.effectiveScanIdMax !== prev.effectiveScanIdMax ||
          state.filterMode !== prev.filterMode ||
          state.excludeRangeMin !== prev.excludeRangeMin ||
          state.excludeRangeMax !== prev.excludeRangeMax) {
        if (state.filterEnabled) this.applyFilter();
      }
      if (state.filterEnabled !== prev.filterEnabled) {
        if (state.filterEnabled) this.applyFilter();
        else this.clearFilter();
      }
    });
  }

  onPointCloudLoaded(pco: PointCloudOctree): void {
    // Compute scan diagonal so LOD thresholds scale with scene size.
    const b = pco.pcoGeometry.boundingBox;
    this.scanDiag = b.getSize(new Vector3()).length();

    const baseUrl = this.ctx?.getBaseUrl();
    if (!baseUrl) return;
    this.loadTrajectory(`${baseUrl}trajectory.json`);
    // If filter was already applied (e.g. after reload), reapply
    const store = useScanFilterStore.getState();
    if (store.filterEnabled) this.applyFilter();
  }

  onPointCloudsUnloaded(): void {
    useScanFilterStore.getState().setTrajectoryData(null);
    this.destroyTrajectoryMesh();
    this.trajData = null;
    this.demData = null;
    this.clearFilter();
  }

  dispose(): void {
    this.exitMode();
    this.unsubMode?.();
    this.unsubMode = null;
    this.unsubStore?.();
    this.unsubStore = null;
    this.destroyTrajectoryMesh();
    this.ctx = null;
  }

  // ── Mode entry / exit ───────────────────────────────────────────────────────

  private enterMode(): void {
    const store = useScanFilterStore.getState();
    // Show trajectory when entering mode
    store.setTrajectoryVisible(true);
    if (this.trajPoints) this.trajPoints.visible = true;
    store.setPhase('configuring');
    this.startListening();
  }

  private exitMode(): void {
    this.stopListening();
    const store = useScanFilterStore.getState();
    if (store.filterEnabled) {
      store.setPhase('applied');
    } else if (store.selectedScanIds.length > 0) {
      // Had a selection but didn't apply — discard
      store.resetToIdle();
      if (this.trajPoints) this.trajPoints.visible = false;
    } else {
      store.setPhase('idle');
      if (this.trajPoints) this.trajPoints.visible = false;
    }
  }

  // ── Public API (called from UI) ─────────────────────────────────────────────

  applyFilter(): void {
    const { effectiveScanIdMin, effectiveScanIdMax, excludeRangeMin, excludeRangeMax, filterMode } = useScanFilterStore.getState();
    if (!this.ctx) return;
    const exclude = filterMode === 'exclude';
    const min = exclude ? excludeRangeMin : effectiveScanIdMin;
    const max = exclude ? excludeRangeMax : effectiveScanIdMax;
    for (const pco of this.ctx.getPointClouds()) {
      (pco.material as any).setScanFilter(min, max, exclude);
    }
  }

  clearFilter(): void {
    if (!this.ctx) return;
    for (const pco of this.ctx.getPointClouds()) {
      (pco.material as any).clearScanFilter?.();
    }
  }

  enableFilter(): void {
    const store = useScanFilterStore.getState();
    if (store.selectedScanIds.length === 0) return;
    store.setFilterEnabled(true);
    store.setPhase('applied');
    useViewerModeStore.getState().exitMode();
  }

  disableFilter(): void {
    useScanFilterStore.getState().setFilterEnabled(false);
    this.clearFilter();
  }

  clearAll(): void {
    this.clearFilter();
    useScanFilterStore.getState().resetToIdle();
    if (this.trajPoints) this.trajPoints.visible = false;
  }

  redefine(): void {
    this.clearFilter();
    useScanFilterStore.getState().setFilterEnabled(false);
    useViewerModeStore.getState().enterScanFilterMode();
  }

  // ── Trajectory loading ──────────────────────────────────────────────────────

  private async loadTrajectory(url: string): Promise<void> {
    try {
      const baseUrl = url.replace(/trajectory\.json$/, '');
      const [trajResp, demResp] = await Promise.all([
        electronFetch(url),
        electronFetch(`${baseUrl}dem.json`).catch(() => null),
      ]);
      if (!trajResp.ok) return; // no trajectory.json — silently skip
      const data: TrajectoryData = await trajResp.json();
      let dem: DemData | null = null;
      if (demResp?.ok) {
        dem = await demResp.json() as DemData;
        console.info('[ScanFilter] DEM loaded, elevation range:',
          dem.xMin.toFixed(0), dem.yMin.toFixed(0), '→',
          dem.xMax.toFixed(0), dem.yMax.toFixed(0));
      } else {
        console.warn('[ScanFilter] DEM not loaded (ok=', demResp?.ok, ')');
      }
      this.trajData = data;
      this.demData = dem;
      useScanFilterStore.getState().setTrajectoryData(data);
      this.buildTrajectoryMesh(data, dem);
    } catch (err) {
      console.warn('[ScanFilter] trajectory load error:', err);
    }
  }

  // ── LOD update ──────────────────────────────────────────────────────────────

  onUpdate(_delta: number): void {
    if (!this.ctx || !this.lodMeshes[3]) return;
    if (++this.lodCheckTick < 15) return; // ~4 Hz at 60 fps
    this.lodCheckTick = 0;

    // Compute a zoom proxy that works for both camera types:
    // - OrthographicCamera: visible world height = frustum / camera.zoom (smaller = more zoomed in)
    // - PerspectiveCamera:  orbit radius from controls (smaller = more zoomed in)
    const cam = this.ctx.getActiveCamera();
    let zoomProxy: number;
    if (cam instanceof OrthographicCamera) {
      zoomProxy = (cam.top - cam.bottom) / Math.max(0.001, cam.zoom);
    } else {
      zoomProxy = this.ctx.controls.getDistance();
    }

    if (!useScanFilterStore.getState().trajectoryVisible) return;

    const newLevel = this.distToLodLevel(zoomProxy);

    if (newLevel === this.currentLodLevel) return;
    this.currentLodLevel = newLevel;

    for (let lod = 0; lod < 4; lod++) {
      if (this.lodMeshes[lod]) this.lodMeshes[lod]!.visible = lod === newLevel;
    }
    this.trajPoints = this.lodMeshes[newLevel];
    this.trajGeo    = this.lodGeos[newLevel];
  }

  private distToLodLevel(orbitRadius: number): number {
    for (let lvl = 0; lvl < ScanFilterPlugin.LOD_FRACS.length; lvl++) {
      if (orbitRadius > this.scanDiag * ScanFilterPlugin.LOD_FRACS[lvl]) return lvl;
    }
    return 3;
  }

  /** Look up the DEM ground elevation (Three.js Y) at a given X/Z position. */
  private lookupGroundY(x: number, z: number, dem: DemData): number | null {
    const col = Math.round((x - dem.xMin) / dem.cellSize);
    const row = Math.round((z - dem.yMin) / dem.cellSize);
    if (col < 0 || col >= dem.cols || row < 0 || row >= dem.rows) return null;
    return dem.elevation[row][col];
  }

  private buildTrajectoryMesh(data: TrajectoryData, dem: DemData | null): void {
    if (!this.ctx) return;
    this.destroyTrajectoryMesh();

    const n = data.points.length;

    // ── Build permutation: perm[pi] = original index ──────────────────────────
    const perm = new Int32Array(n);
    const used = new Uint8Array(n);
    let pos = 0;
    const lodCounts: [number, number, number, number] = [0, 0, 0, 0];
    for (let lod = 0; lod < 4; lod++) {
      const stride = ScanFilterPlugin.LOD_STRIDES[lod];
      for (let i = 0; i < n; i += stride) {
        if (!used[i]) { perm[pos++] = i; used[i] = 1; }
      }
      lodCounts[lod] = pos;
    }
    this.permutation = perm;
    this.lodCounts   = lodCounts;

    // ── DEM fallback elevation ────────────────────────────────────────────────
    let demFallbackY: number | null = null;
    if (dem) {
      let sum = 0, cnt = 0;
      for (let r = 0; r < dem.rows; r += 50)
        for (let c = 0; c < dem.cols; c += 50)
          { sum += dem.elevation[r][c]; cnt++; }
      demFallbackY = cnt > 0 ? sum / cnt + SENSOR_HEIGHT : null;
    }

    // ── Compute all n positions in permuted order ─────────────────────────────
    const allPositions = new Float32Array(n * 3);
    for (let pi = 0; pi < n; pi++) {
      const p = data.points[perm[pi]];
      let y = demFallbackY ?? p.y;
      if (dem) {
        const gy = this.lookupGroundY(p.x, p.z, dem);
        if (gy !== null) y = gy + SENSOR_HEIGHT;
      }
      allPositions[pi * 3]     = p.x;
      allPositions[pi * 3 + 1] = y;
      allPositions[pi * 3 + 2] = p.z;
    }

    // ── Build one Points mesh per LOD level ───────────────────────────────────
    // Each mesh has exactly lodCounts[lod] vertices — the first slice of the
    // permuted array. Toggling .visible is how LOD works; no setDrawRange needed.
    const tg  = this.ctx.getEditor().getTransformGroup();
    const vis = useScanFilterStore.getState().trajectoryVisible;

    for (let lod = 0; lod < 4; lod++) {
      const count = lodCounts[lod];
      const lodPos = new Float32Array(count * 3);
      lodPos.set(allPositions.subarray(0, count * 3));

      const lodCol = new Float32Array(count * 3);
      for (let pi = 0; pi < count; pi++) {
        lodCol[pi * 3]     = COLOR_UNSELECTED[0];
        lodCol[pi * 3 + 1] = COLOR_UNSELECTED[1];
        lodCol[pi * 3 + 2] = COLOR_UNSELECTED[2];
      }

      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(lodPos, 3));
      geo.setAttribute('color',    new Float32BufferAttribute(lodCol, 3));

      const mat = new PointsMaterial({
        size: ScanFilterPlugin.LOD_SIZES[lod],
        vertexColors: true,
        sizeAttenuation: false,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      });

      const mesh = new Points(geo, mat);
      mesh.renderOrder = 1000;
      mesh.visible = vis && lod === 3; // start at full detail, hidden until user enables
      tg.add(mesh);

      this.lodGeos[lod]   = geo;
      this.lodMeshes[lod] = mesh;
    }

    // Convenience refs used by picking and color update code.
    this.trajGeo    = this.lodGeos[3];
    this.trajPoints = this.lodMeshes[3];

    this.currentLodLevel = 3;
    this.lodCheckTick = 14; // fire LOD check on next onUpdate
  }

  private destroyTrajectoryMesh(): void {
    if (!this.ctx) return;
    const tg = this.ctx.getEditor().getTransformGroup();
    for (let lod = 0; lod < 4; lod++) {
      if (this.lodMeshes[lod]) {
        tg.remove(this.lodMeshes[lod]!);
        (this.lodMeshes[lod]!.material as PointsMaterial).dispose();
        this.lodGeos[lod]?.dispose();
        this.lodMeshes[lod] = null;
        this.lodGeos[lod]   = null;
      }
    }
    this.trajPoints = null;
    this.trajGeo    = null;
    this.permutation = null;
    this.lodCounts   = [0, 0, 0, 0];
    this.currentLodLevel = 3;
  }

  // ── Color management ────────────────────────────────────────────────────────

  private rebuildColors(): void {
    if (!this.trajData || !this.permutation) return;
    const selected = new Set(useScanFilterStore.getState().selectedScanIds);
    const perm = this.permutation;
    const n = this.trajData.points.length;

    // Update all 4 LOD geometries. Each LOD[lod] has lodCounts[lod] vertices
    // which correspond to perm[0..lodCounts[lod]-1].
    for (let lod = 0; lod < 4; lod++) {
      const geo = this.lodGeos[lod];
      if (!geo) continue;
      const colorAttr = geo.getAttribute('color');
      if (!colorAttr) continue;
      const arr = colorAttr.array as Float32Array;
      const count = Math.min(this.lodCounts[lod], n);
      for (let pi = 0; pi < count; pi++) {
        const sid = this.trajData.points[perm[pi]].scanId;
        const [r, g, b] = sid === this.hoveredScanId
          ? COLOR_HOVER
          : selected.has(sid)
            ? COLOR_SELECTED
            : COLOR_UNSELECTED;
        arr[pi * 3]     = r;
        arr[pi * 3 + 1] = g;
        arr[pi * 3 + 2] = b;
      }
      colorAttr.needsUpdate = true;
    }
  }

  // ── Selection event listeners ───────────────────────────────────────────────

  private startListening(): void {
    if (this.listening || !this.ctx) return;
    this.listening = true;
    this.ctx.domElement.style.cursor = 'crosshair';
    this.ctx.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.ctx.domElement.addEventListener('pointerup',   this.onPointerUp);
    this.ctx.domElement.addEventListener('pointermove', this.onPointerMove);
  }

  private stopListening(): void {
    if (!this.listening || !this.ctx) return;
    this.listening = false;
    this.ctx.domElement.style.cursor = '';
    this.ctx.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.ctx.domElement.removeEventListener('pointerup',   this.onPointerUp);
    this.ctx.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.removeSelRect();
    this.isDragSelecting = false;
    this.isPointerDown = false;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.isPointerDown = true;
    this.isDragSelecting = false;
    this.dragIsDeselect = e.altKey;
    this.dragStartClient.set(e.clientX, e.clientY);
    this.mouseDownPos.set(e.clientX, e.clientY);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.isPointerDown) {
      const dx = e.clientX - this.dragStartClient.x;
      const dy = e.clientY - this.dragStartClient.y;
      if (!this.isDragSelecting && Math.sqrt(dx * dx + dy * dy) > 8) {
        this.isDragSelecting = true;
        if (this.ctx) this.ctx.controls.enabled = false;
        this.showSelRect(this.dragStartClient.x, this.dragStartClient.y, e.clientX, e.clientY, this.dragIsDeselect);
      } else if (this.isDragSelecting) {
        this.updateSelRect(this.dragStartClient.x, this.dragStartClient.y, e.clientX, e.clientY);
        return;
      }
    }
    if (!this.isDragSelecting) this.updateHover(e);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.isPointerDown = false;
    if (this.isDragSelecting) {
      this.isDragSelecting = false;
      if (this.ctx) this.ctx.controls.enabled = true;
      this.finishDragSelect(e);
      this.removeSelRect();
      return;
    }
    if (e.button !== 0) return;
    const dx = e.clientX - this.mouseDownPos.x;
    const dy = e.clientY - this.mouseDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 6) return;
    this.handleClick(e);
  };

  // ── Hit testing ─────────────────────────────────────────────────────────────

  private pickScanId(clientX: number, clientY: number, thresholdPx = 12): number | null {
    if (!this.ctx || !this.trajData || !this.trajPoints || !this.trajGeo || !this.permutation) return null;
    const camera = this.ctx.getActiveCamera();
    const rect = this.ctx.domElement.getBoundingClientRect();
    let best: number | null = null;
    let bestDist = Infinity;
    const posAttr = this.trajGeo.getAttribute('position');
    const visibleCount = this.lodCounts[this.currentLodLevel];
    const perm = this.permutation;

    for (let pi = 0; pi < visibleCount; pi++) {
      const w = this.trajPoints.localToWorld(
        new Vector3(posAttr.getX(pi), posAttr.getY(pi), posAttr.getZ(pi))
      );
      w.project(camera);
      const sx = ((w.x + 1) / 2) * rect.width + rect.left;
      const sy = ((-w.y + 1) / 2) * rect.height + rect.top;
      const d = Math.sqrt((sx - clientX) ** 2 + (sy - clientY) ** 2);
      if (d < thresholdPx && d < bestDist) {
        bestDist = d;
        best = this.trajData.points[perm[pi]].scanId;
      }
    }
    return best;
  }

  private handleClick(e: PointerEvent): void {
    const sid = this.pickScanId(e.clientX, e.clientY);
    if (sid === null) {
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        useScanFilterStore.getState().setSelectedScanIds([]);
      }
      return;
    }
    if (e.altKey) {
      // Alt+click: remove this scan from selection
      const prev = useScanFilterStore.getState().selectedScanIds;
      useScanFilterStore.getState().setSelectedScanIds(prev.filter((x) => x !== sid));
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: add to selection (toggle)
      useScanFilterStore.getState().toggleScanId(sid);
    } else {
      useScanFilterStore.getState().setSelectedScanIds([sid]);
    }
  }

  private updateHover(e: PointerEvent): void {
    const sid = this.pickScanId(e.clientX, e.clientY, 14);
    if (sid !== this.hoveredScanId) {
      this.hoveredScanId = sid;
      this.rebuildColors();
    }
  }

  private finishDragSelect(e: PointerEvent): void {
    if (!this.ctx || !this.trajData || !this.trajPoints || !this.trajGeo || !this.permutation) return;
    const x1 = Math.min(this.dragStartClient.x, e.clientX);
    const y1 = Math.min(this.dragStartClient.y, e.clientY);
    const x2 = Math.max(this.dragStartClient.x, e.clientX);
    const y2 = Math.max(this.dragStartClient.y, e.clientY);

    const camera = this.ctx.getActiveCamera();
    const rect = this.ctx.domElement.getBoundingClientRect();
    const selected: number[] = [];
    const posAttr = this.trajGeo.getAttribute('position');
    const visibleCount = this.lodCounts[this.currentLodLevel];
    const perm = this.permutation;

    for (let pi = 0; pi < visibleCount; pi++) {
      const w = this.trajPoints.localToWorld(
        new Vector3(posAttr.getX(pi), posAttr.getY(pi), posAttr.getZ(pi))
      );
      w.project(camera);
      if (w.z > 1) continue; // behind camera
      const sx = ((w.x + 1) / 2) * rect.width + rect.left;
      const sy = ((-w.y + 1) / 2) * rect.height + rect.top;
      if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) {
        selected.push(this.trajData.points[perm[pi]].scanId);
      }
    }

    if (selected.length > 0) {
      const prev = useScanFilterStore.getState().selectedScanIds;
      if (this.dragIsDeselect) {
        // Alt+drag: remove box-selected scans from current selection
        const removeSet = new Set(selected);
        useScanFilterStore.getState().setSelectedScanIds(prev.filter((id) => !removeSet.has(id)));
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl+drag: add box-selected scans to current selection
        useScanFilterStore.getState().setSelectedScanIds([...new Set([...prev, ...selected])]);
      } else {
        // Plain drag: replace selection
        useScanFilterStore.getState().setSelectedScanIds(selected);
      }
    }
  }

  // ── Drag-select rect ────────────────────────────────────────────────────────

  private showSelRect(x1: number, y1: number, x2: number, y2: number, deselect = false): void {
    if (!this.selRectEl) {
      const div = document.createElement('div');
      document.body.appendChild(div);
      this.selRectEl = div;
    }
    const [border, bg] = deselect
      ? ['rgba(239,68,68,0.9)', 'rgba(239,68,68,0.1)']   // red for deselect
      : ['rgba(255,180,0,0.9)', 'rgba(255,180,0,0.1)'];   // amber for select
    this.selRectEl.style.cssText =
      `position:fixed;pointer-events:none;border:1px solid ${border};` +
      `background:${bg};z-index:9999;box-sizing:border-box;`;
    this.updateSelRect(x1, y1, x2, y2);
  }

  private updateSelRect(x1: number, y1: number, x2: number, y2: number): void {
    if (!this.selRectEl) return;
    const minX = Math.min(x1, x2), minY = Math.min(y1, y2);
    const maxX = Math.max(x1, x2), maxY = Math.max(y1, y2);
    Object.assign(this.selRectEl.style, {
      left: `${minX}px`, top: `${minY}px`,
      width: `${maxX - minX}px`, height: `${maxY - minY}px`,
    });
  }

  private removeSelRect(): void {
    if (this.selRectEl) {
      document.body.removeChild(this.selRectEl);
      this.selRectEl = null;
    }
  }
}
