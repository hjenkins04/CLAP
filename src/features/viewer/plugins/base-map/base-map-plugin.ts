import {
  Group,
  Mesh,
  BufferGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
  CanvasTexture,
  DoubleSide,
  Box3,
  Vector3,
  Matrix4,
  PlaneGeometry,
} from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { Texture } from 'three';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { useBaseMapStore } from './base-map-store';
import { useWorldFrameStore } from '../world-frame';
import {
  geoToMeters,
  localToGeo,
  lngLatToTile,
  tileToLngLat,
  computeWorldFrameTransform,
  type WorldFrameTransform,
  type GeoPoint,
  type CrsInfo,
} from '../world-frame/geo-utils';
import { BaseMapPanel } from './base-map-panel';
import { useGridStore } from '../grid/grid-store';

// ── Persisted geo-reference data ─────────────────────────────────────

export interface GeoRefData {
  anchor1: { geo: GeoPoint; pc: { x: number; y: number; z: number } };
  anchor2: { geo: GeoPoint; pc: { x: number; y: number; z: number } } | null;
  rotationOffset: number;
  translationOffset: { x: number; z: number };
  baseMap: {
    opacity: number;
    zoomLevel: number;
    flipX: boolean;
    flipZ: boolean;
    zOffset?: number;
  };
  grid?: {
    visible: boolean;
    size: number;
    cellSize: number;
  };
}

const GEOREF_FILENAME = 'georef.json';

const TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const DEFAULT_Z_OFFSET = -1;
const TERRAIN_SEGMENTS = 32; // subdivisions per tile for DEM draping

// ──────────────────────────────────────────────────────────────────────
// Y-up convention (Three.js standard, enforced by editor GlobalTransform).
// Ground plane = XZ.  Y = elevation.
// LocalPoint: x = Three.js X, z = Three.js Z.
// ──────────────────────────────────────────────────────────────────────

export class BaseMapPlugin implements ViewerPlugin {
  readonly id = 'base-map';
  readonly name = 'Base Map';
  readonly order = 5;
  readonly SidebarPanel = BaseMapPanel;
  readonly sidebarTitle = 'Base Satellite Map';
  readonly sidebarDefaultOpen = false;

  private ctx: ViewerPluginContext | null = null;
  private tileGroup: Group | null = null;
  private zOffsetProxy: Mesh | null = null;
  private tileMeshes = new Map<string, Mesh>();
  private tileTextures = new Map<string, Texture>();
  private loadingTiles = new Set<string>();
  private tileGeneration = 0;
  private tileElevation = 0;
  private pcBounds: Box3 | null = null;
  private gizmo: TransformControls | null = null;

  private unsubWorldFrame: (() => void) | null = null;
  private unsubBaseMap: (() => void) | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────────

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;

    this.tileGroup = new Group();
    this.tileGroup.name = 'base-map-tiles';
    ctx.scene.add(this.tileGroup);

    this.unsubWorldFrame = useWorldFrameStore.subscribe((state, prev) => {
      if (state.transform !== prev.transform || state.phase !== prev.phase) {
        this.updateTiles();
      }
      if (state.zOffset !== prev.zOffset) { this.clearTiles(); this.updateTiles(); }
      if (state.flipX !== prev.flipX || state.flipZ !== prev.flipZ) this.applyFlip();
      if (state.editingZOffset !== prev.editingZOffset) {
        if (state.editingZOffset) this.showZOffsetProxy();
        else this.hideZOffsetProxy();
      }
      if (state.pendingZOffset !== prev.pendingZOffset && state.editingZOffset) {
        this.updateZOffsetProxy(state.pendingZOffset);
      }
    });

    this.unsubBaseMap = useBaseMapStore.subscribe((state, prev) => {
      if (state.visible !== prev.visible) this.applyVisibility();
      if (state.opacity !== prev.opacity) this.applyOpacity();
      if (state.zoomLevel !== prev.zoomLevel) { this.clearTiles(); this.updateTiles(); }
      if (state.editing !== prev.editing) {
        if (state.editing) this.startEditing(); else this.stopEditing();
      }
      if (state.gizmoMode !== prev.gizmoMode && state.editing) this.applyGizmoMode(state.gizmoMode);
    });

    useBaseMapStore.getState()._setOnSave(async () => {
      useBaseMapStore.getState().setSaving(true);
      try { await this.saveGeoRef(); }
      finally { useBaseMapStore.getState().setSaving(false); }
    });

    useBaseMapStore.getState()._setUndoRedo(
      () => this.undoEdit(),
      () => this.redoEdit(),
    );

    const { transform, phase } = useWorldFrameStore.getState();
    if (transform && (phase === 'confirmed' || phase === 'preview')) {
      this.updateTiles();
    }
  }

  onPointCloudLoaded(): void {
    if (!this.ctx) return;

    // World-space bounding box (accounts for editor's saved GlobalTransform)
    const pcos = this.ctx.getPointClouds();
    const tg = this.ctx.getEditor().getTransformGroup();
    tg.updateMatrixWorld(true);

    const box = new Box3();
    for (const pco of pcos) {
      const b = pco.pcoGeometry.boundingBox;
      for (const sx of [b.min.x, b.max.x]) {
        for (const sy of [b.min.y, b.max.y]) {
          for (const sz of [b.min.z, b.max.z]) {
            const c = new Vector3(sx, sy, sz).add(pco.position);
            c.applyMatrix4(tg.matrixWorld);
            box.expandByPoint(c);
          }
        }
      }
    }
    this.pcBounds = box;

    // When DEM is available, tiles are draped per-vertex so group Y = 0.
    // Without DEM, use a flat elevation estimate.
    const dem = this.ctx.getDem();
    if (dem) {
      this.tileElevation = 0; // vertices carry their own elevation
    } else {
      const center = box.getCenter(new Vector3());
      const size = box.getSize(new Vector3());
      const minDim = Math.min(size.x, size.y, size.z);
      const zOff = useWorldFrameStore.getState().zOffset;
      this.tileElevation = center.y - minDim / 2 + zOff;
    }

    // Always try both: georef.json for full manual calibration,
    // crs.json for auto world-frame + base-map visibility.
    this.loadGeoRef()
      .then(() => this.loadCrs())
      .then(() => this.updateTiles());
  }

  dispose(): void {
    this.hideZOffsetProxy();
    this.stopEditing();
    this.clearTiles();
    this.unsubWorldFrame?.();
    this.unsubBaseMap?.();
    this.unsubWorldFrame = null;
    this.unsubBaseMap = null;
    if (this.ctx && this.tileGroup) this.ctx.scene.remove(this.tileGroup);
    this.tileGroup = null;
    this.ctx = null;
  }

  // ── Tile Management ────────────────────────────────────────────────

  private updateTiles(): void {
    const { transform, phase } = useWorldFrameStore.getState();
    if (!transform || (phase !== 'confirmed' && phase !== 'preview')) {
      this.applyVisibility();
      return;
    }
    if (!this.pcBounds || !this.tileGroup) return;

    // Y-up: ground plane is XZ
    if (!useBaseMapStore.getState().editing) {
      this.tileGroup.position.set(
        transform.translation.x,
        this.tileElevation,
        transform.translation.z,
      );
      this.tileGroup.rotation.set(0, 0, 0);
      this.tileGroup.rotation.y = transform.rotation;
    }

    const { zoomLevel } = useBaseMapStore.getState();

    // PC bounds on ground plane (XZ)
    const corners = [
      { x: this.pcBounds.min.x, z: this.pcBounds.min.z },
      { x: this.pcBounds.min.x, z: this.pcBounds.max.z },
      { x: this.pcBounds.max.x, z: this.pcBounds.min.z },
      { x: this.pcBounds.max.x, z: this.pcBounds.max.z },
    ];

    let minTileX = Infinity, maxTileX = -Infinity;
    let minTileY = Infinity, maxTileY = -Infinity;

    for (const corner of corners) {
      const geo = localToGeo(corner, transform);
      const tile = lngLatToTile(geo.lng, geo.lat, zoomLevel);
      minTileX = Math.min(minTileX, tile.x);
      maxTileX = Math.max(maxTileX, tile.x);
      minTileY = Math.min(minTileY, tile.y);
      maxTileY = Math.max(maxTileY, tile.y);
    }

    minTileX -= 1; minTileY -= 1;
    maxTileX += 1; maxTileY += 1;

    const neededKeys = new Set<string>();
    for (let tx = minTileX; tx <= maxTileX; tx++) {
      for (let ty = minTileY; ty <= maxTileY; ty++) {
        neededKeys.add(`${zoomLevel}/${tx}/${ty}`);
      }
    }

    for (const [key, mesh] of this.tileMeshes) {
      if (!neededKeys.has(key)) {
        this.tileGroup.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as MeshBasicMaterial).dispose();
        this.tileMeshes.delete(key);
        const tex = this.tileTextures.get(key);
        if (tex) { tex.dispose(); this.tileTextures.delete(key); }
      }
    }

    for (const key of neededKeys) {
      if (this.tileMeshes.has(key) || this.loadingTiles.has(key)) continue;
      const [z, x, y] = key.split('/').map(Number);
      this.loadTile(z, x, y, transform);
    }

    this.applyFlip();
    this.applyVisibility();
  }

  private loadTile(z: number, x: number, y: number, transform: WorldFrameTransform): void {
    const key = `${z}/${x}/${y}`;
    this.loadingTiles.add(key);
    const gen = this.tileGeneration;

    const url = TILE_URL.replace('{z}', String(z))
      .replace('{y}', String(y))
      .replace('{x}', String(x));

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.loadingTiles.delete(key);
      // Discard if tiles were cleared while this image was loading
      if (!this.tileGroup || gen !== this.tileGeneration) return;

      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const c = canvas.getContext('2d');
      if (!c) return;
      c.drawImage(img, 0, 0, 256, 256);

      const texture = new CanvasTexture(canvas);
      this.tileTextures.set(key, texture);

      const topLeft = tileToLngLat(x, y, z);
      const bottomRight = tileToLngLat(x + 1, y + 1, z);
      const tlMeters = geoToMeters(topLeft, transform.refGeo);
      const brMeters = geoToMeters(bottomRight, transform.refGeo);

      const west = tlMeters.x;
      const east = brMeters.x;
      const north = tlMeters.y;
      const south = brMeters.y;

      // Build a subdivided grid in XZ (Y-up), then drape Y onto DEM elevation.
      const seg = TERRAIN_SEGMENTS;
      const cols = seg + 1;
      const rows = seg + 1;
      const vertCount = cols * rows;
      const vertices = new Float32Array(vertCount * 3);
      const uvs = new Float32Array(vertCount * 2);

      for (let iy = 0; iy < rows; iy++) {
        const t = iy / seg; // 0 = south, 1 = north
        const vz = south + t * (north - south);
        for (let ix = 0; ix < cols; ix++) {
          const s = ix / seg; // 0 = west, 1 = east
          const vx = west + s * (east - west);
          const idx = iy * cols + ix;
          vertices[idx * 3] = vx;
          vertices[idx * 3 + 1] = 0; // Y = elevation, set below
          vertices[idx * 3 + 2] = vz;
          uvs[idx * 2] = s;
          uvs[idx * 2 + 1] = t;
        }
      }

      // Drape vertices onto DEM
      this.drapeVerticesOnDem(vertices, vertCount);

      // Triangle indices
      const indices: number[] = [];
      for (let iy = 0; iy < seg; iy++) {
        for (let ix = 0; ix < seg; ix++) {
          const a = iy * cols + ix;
          const b = a + 1;
          const c = a + cols;
          const d = c + 1;
          indices.push(a, b, d, a, d, c);
        }
      }

      const geo = new BufferGeometry();
      geo.setIndex(indices);
      geo.setAttribute('position', new Float32BufferAttribute(vertices, 3));
      geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
      geo.computeVertexNormals();

      const { opacity } = useBaseMapStore.getState();
      const mat = new MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity,
        side: DoubleSide,
        depthWrite: false,
      });
      const mesh = new Mesh(geo, mat);
      mesh.renderOrder = -1;
      this.tileGroup.add(mesh);
      this.tileMeshes.set(key, mesh);
    };
    img.onerror = () => { this.loadingTiles.delete(key); };
    img.src = url;
  }

  private clearTiles(): void {
    if (!this.tileGroup) return;
    // Bump generation so in-flight img.onload callbacks are discarded
    this.tileGeneration++;
    for (const [key, mesh] of this.tileMeshes) {
      this.tileGroup.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
      const tex = this.tileTextures.get(key);
      if (tex) tex.dispose();
    }
    this.tileMeshes.clear();
    this.tileTextures.clear();
    this.loadingTiles.clear();
  }

  private applyVisibility(): void {
    if (!this.tileGroup) return;
    const { visible } = useBaseMapStore.getState();
    const { transform, phase } = useWorldFrameStore.getState();
    this.tileGroup.visible = visible && !!transform && (phase === 'confirmed' || phase === 'preview');
  }

  private applyFlip(): void {
    if (!this.tileGroup) return;
    const { flipX, flipZ } = useWorldFrameStore.getState();
    this.tileGroup.scale.x = flipX ? -1 : 1;
    this.tileGroup.scale.z = flipZ ? -1 : 1;
  }

  private applyOpacity(): void {
    const { opacity } = useBaseMapStore.getState();
    for (const mesh of this.tileMeshes.values()) {
      (mesh.material as MeshBasicMaterial).opacity = opacity;
    }
  }

  // ── Z-Offset Proxy Plane ────────────────────────────────────────────

  private showZOffsetProxy(): void {
    if (!this.ctx || !this.pcBounds || !this.tileGroup) return;

    // Hide real tiles
    this.tileGroup.visible = false;

    // Create a flat semi-transparent plane covering the PC extent
    const size = this.pcBounds.getSize(new Vector3());
    const center = this.pcBounds.getCenter(new Vector3());
    const planeSize = Math.max(size.x, size.z) * 1.2;

    const geo = new PlaneGeometry(planeSize, planeSize);
    geo.rotateX(-Math.PI / 2); // lay flat in XZ
    const mat = new MeshBasicMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.25,
      side: DoubleSide,
      depthWrite: false,
    });
    this.zOffsetProxy = new Mesh(geo, mat);
    this.zOffsetProxy.position.set(center.x, 0, center.z);
    this.zOffsetProxy.renderOrder = -1;

    // Set initial Y from current pending offset — use DEM min as reference
    this.updateZOffsetProxy(useWorldFrameStore.getState().pendingZOffset);

    this.ctx.scene.add(this.zOffsetProxy);
  }

  private hideZOffsetProxy(): void {
    if (this.zOffsetProxy && this.ctx) {
      this.ctx.scene.remove(this.zOffsetProxy);
      this.zOffsetProxy.geometry.dispose();
      (this.zOffsetProxy.material as MeshBasicMaterial).dispose();
      this.zOffsetProxy = null;
    }
    // Rebuild real tiles with confirmed offset
    this.clearTiles();
    this.updateTiles();
  }

  private updateZOffsetProxy(zOffset: number): void {
    if (!this.zOffsetProxy || !this.ctx) return;

    // Compute the base DEM elevation in world space (same logic as onPointCloudLoaded)
    const dem = this.ctx.getDem();
    if (dem) {
      dem.mesh.updateMatrixWorld(true);
      const demBox = new Box3().setFromObject(dem.mesh);
      this.zOffsetProxy.position.y = demBox.min.y + zOffset;
    } else if (this.pcBounds) {
      const size = this.pcBounds.getSize(new Vector3());
      const center = this.pcBounds.getCenter(new Vector3());
      const minDim = Math.min(size.x, size.y, size.z);
      this.zOffsetProxy.position.y = center.y - minDim / 2 + zOffset;
    }
  }

  // ── DEM Draping ─────────────────────────────────────────────────────

  /**
   * Set each vertex's Y to the DEM elevation at that world-space XZ position.
   * Vertices are in tile-group local space; the DEM is in editor transform-group
   * local space. We convert between them via world space.
   */
  private drapeVerticesOnDem(vertices: Float32Array, vertexCount: number): void {
    const dem = this.ctx?.getDem();
    if (!dem || !this.tileGroup || !this.ctx) return;

    const tg = this.ctx.getEditor().getTransformGroup();
    tg.updateMatrixWorld(true);
    this.tileGroup.updateMatrixWorld(true);

    const invTg = new Matrix4().copy(tg.matrixWorld).invert();
    const invTile = new Matrix4().copy(this.tileGroup.matrixWorld).invert();
    const pos = new Vector3();

    for (let i = 0; i < vertexCount; i++) {
      // Tile-group local → world
      pos.set(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]);
      pos.applyMatrix4(this.tileGroup.matrixWorld);

      // World → DEM local (editor transform-group space)
      const demLocal = pos.clone().applyMatrix4(invTg);

      // Y-up convention: DEM uses (x=east, z=north) for lookup, elevation → Y.
      const elev = dem.getElevationClamped(demLocal.x, demLocal.z);
      const zOff = useWorldFrameStore.getState().zOffset;
      demLocal.y = elev + zOff;
      // DEM local → world → tile-group local
      demLocal.applyMatrix4(tg.matrixWorld);
      demLocal.applyMatrix4(invTile);
      vertices[i * 3 + 1] = demLocal.y;
    }
  }

  // ── Editing ────────────────────────────────────────────────────────

  private startEditing(): void {
    if (!this.ctx || !this.tileGroup || this.gizmo) return;

    // Push initial snapshot so the first move can be undone
    useBaseMapStore.getState().clearEditHistory();
    this.pushCurrentSnapshot();

    this.gizmo = new TransformControls(this.ctx.getActiveCamera(), this.ctx.domElement);
    this.gizmo.setSpace('local');
    this.gizmo.attach(this.tileGroup);
    this.applyGizmoMode(useBaseMapStore.getState().gizmoMode);
    this.ctx.scene.add(this.gizmo);
    this.gizmo.addEventListener('dragging-changed', this.onGizmoDragChanged);
    this.gizmo.addEventListener('objectChange', this.onGizmoObjectChange);
  }

  private stopEditing(): void {
    if (!this.gizmo) return;
    this.syncGizmoToStore();
    useBaseMapStore.getState().clearEditHistory();
    this.gizmo.removeEventListener('dragging-changed', this.onGizmoDragChanged);
    this.gizmo.removeEventListener('objectChange', this.onGizmoObjectChange);
    this.gizmo.detach();
    if (this.ctx) this.ctx.scene.remove(this.gizmo);
    this.gizmo.dispose();
    this.gizmo = null;
    if (this.ctx) this.ctx.controls.enabled = true;
  }

  private applyGizmoMode(mode: 'translate' | 'rotate'): void {
    if (!this.gizmo) return;
    this.gizmo.setMode(mode);
    // Y-up: translate on XZ, rotate around Y
    this.gizmo.showX = mode === 'translate';
    this.gizmo.showY = mode === 'rotate';
    this.gizmo.showZ = mode === 'translate';
  }

  private isDragging = false;

  private readonly onGizmoDragChanged = (event: { value: boolean }): void => {
    if (this.ctx) this.ctx.controls.enabled = !event.value;
    if (event.value) {
      // Drag started
      this.isDragging = true;
    } else if (this.isDragging) {
      // Drag ended — push the new position as a snapshot
      this.isDragging = false;
      this.pushCurrentSnapshot();
    }
  };

  private readonly onGizmoObjectChange = (): void => {
    // Lock Y to tile elevation
    if (this.tileGroup) this.tileGroup.position.y = this.tileElevation;
  };

  private pushCurrentSnapshot(): void {
    if (!this.tileGroup) return;
    useBaseMapStore.getState().pushEditSnapshot({
      posX: this.tileGroup.position.x,
      posZ: this.tileGroup.position.z,
      rotY: this.tileGroup.rotation.y,
    });
  }

  private applySnapshot(snap: { posX: number; posZ: number; rotY: number }): void {
    if (!this.tileGroup) return;
    this.tileGroup.position.x = snap.posX;
    this.tileGroup.position.z = snap.posZ;
    this.tileGroup.rotation.y = snap.rotY;
  }

  undoEdit(): void {
    const snap = useBaseMapStore.getState().undoEdit();
    if (snap) this.applySnapshot(snap);
  }

  redoEdit(): void {
    const snap = useBaseMapStore.getState().redoEdit();
    if (snap) this.applySnapshot(snap);
  }

  private syncGizmoToStore(): void {
    if (!this.tileGroup) return;
    const wf = useWorldFrameStore.getState();
    if (!wf.anchor1) return;

    const baseX = wf.anchor1.pc.x;
    const baseZ = wf.anchor1.pc.z;

    let baseRot = 0;
    if (wf.anchor2) {
      const t = computeWorldFrameTransform(
        { geo: wf.anchor1.geo, pc: { x: wf.anchor1.pc.x, z: wf.anchor1.pc.z } },
        { geo: wf.anchor2.geo, pc: { x: wf.anchor2.pc.x, z: wf.anchor2.pc.z } },
        0, { x: 0, z: 0 },
      );
      baseRot = t.rotation;
    }

    wf.setTranslationOffset(
      this.tileGroup.position.x - baseX,
      this.tileGroup.position.z - baseZ,
    );
    wf.setRotationOffset(this.tileGroup.rotation.y - baseRot);
  }

  // ── Geo-reference persistence ──────────────────────────────────────

  async saveGeoRef(): Promise<void> {
    const basePath = this.ctx?.getEditor().getBasePath();
    if (!basePath) return;
    const wf = useWorldFrameStore.getState();
    if (!wf.anchor1) return;
    const bm = useBaseMapStore.getState();

    const gr = useGridStore.getState();

    const data: GeoRefData = {
      anchor1: { geo: wf.anchor1.geo, pc: wf.anchor1.pc },
      anchor2: wf.anchor2 ? { geo: wf.anchor2.geo, pc: wf.anchor2.pc } : null,
      rotationOffset: wf.rotationOffset,
      translationOffset: wf.translationOffset,
      baseMap: { opacity: bm.opacity, zoomLevel: bm.zoomLevel, flipX: wf.flipX, flipZ: wf.flipZ, zOffset: wf.zOffset },
      grid: { visible: gr.visible, size: gr.size, cellSize: gr.cellSize },
    };

    const buf = new TextEncoder().encode(JSON.stringify(data, null, 2)).buffer;
    if (window.electron) {
      await window.electron.invoke('write-file', { path: `${basePath}${GEOREF_FILENAME}`, data: buf });
    }
    console.info('[CLAP] Saved georef to', `${basePath}${GEOREF_FILENAME}`);
  }

  async loadGeoRef(): Promise<void> {
    const basePath = this.ctx?.getEditor().getBasePath();
    if (!basePath) return;

    let buffer: ArrayBuffer | null = null;
    if (window.electron) {
      buffer = await window.electron.invoke<ArrayBuffer | null>('read-file', {
        path: `${basePath}${GEOREF_FILENAME}`,
      });
    } else {
      try {
        const resp = await fetch(`${basePath}${GEOREF_FILENAME}?t=${Date.now()}`);
        if (resp.ok) buffer = await resp.arrayBuffer();
      } catch { /* not found */ }
    }
    if (!buffer) return;

    try {
      const data: GeoRefData = JSON.parse(new TextDecoder().decode(buffer));
      const wf = useWorldFrameStore.getState();
      wf.setGeoPoint1(data.anchor1.geo);
      wf.setAnchor1Pc(data.anchor1.pc);
      if (data.anchor2) {
        wf.setGeoPoint2(data.anchor2.geo);
        wf.setAnchor2Pc(data.anchor2.pc);
      }
      wf.setRotationOffset(data.rotationOffset);
      wf.setTranslationOffset(data.translationOffset.x, data.translationOffset.z);
      wf.confirmWorldFrame();

      const bm = useBaseMapStore.getState();
      bm.setOpacity(data.baseMap.opacity);
      bm.setZoomLevel(data.baseMap.zoomLevel);
      // Restore flip/zOffset to world-frame store (shared by all overlays)
      if (data.baseMap.flipX) wf.toggleFlipX();
      if (data.baseMap.flipZ) wf.toggleFlipZ();
      if (data.baseMap.zOffset !== undefined) wf.setZOffset(data.baseMap.zOffset);

      // Restore grid settings
      if (data.grid) {
        const gr = useGridStore.getState();
        gr.setVisible(data.grid.visible);
        gr.setSize(data.grid.size);
        gr.setCellSize(data.grid.cellSize);
      }

      console.info('[CLAP] Loaded georef from', `${basePath}${GEOREF_FILENAME}`);
    } catch (err) {
      console.warn('[CLAP] Failed to parse georef.json:', err);
    }
  }

  /**
   * Read crs.json (written by preprocess.py) and auto-configure the world frame.
   * Only called when no georef.json was found for this point cloud.
   */
  async loadCrs(): Promise<void> {
    const basePath = this.ctx?.getEditor().getBasePath();
    if (!basePath) return;

    let buffer: ArrayBuffer | null = null;
    if (window.electron) {
      buffer = await window.electron.invoke<ArrayBuffer | null>('read-file', {
        path: `${basePath}crs.json`,
      });
    } else {
      try {
        const resp = await fetch(`${basePath}crs.json?t=${Date.now()}`);
        if (resp.ok) buffer = await resp.arrayBuffer();
      } catch { /* not found */ }
    }
    if (!buffer) return;

    try {
      const crs: CrsInfo = JSON.parse(new TextDecoder().decode(buffer));
      if (crs.type === 'utm' && crs.refLngLat) {
        const refGeo: GeoPoint = { lng: crs.refLngLat.lng, lat: crs.refLngLat.lat };
        // Only set world frame anchors if not already confirmed (e.g. from georef.json or localStorage)
        if (useWorldFrameStore.getState().phase !== 'confirmed') {
          useWorldFrameStore.getState().autoConfirmFromCrs(refGeo);
        }
        // Always enable the base map when a known CRS is present
        useBaseMapStore.getState().setVisible(true);
        console.info('[CLAP] CRS detected — base map enabled:', crs.epsg, refGeo);
      }
    } catch (err) {
      console.warn('[CLAP] Failed to parse crs.json:', err);
    }
  }
}
