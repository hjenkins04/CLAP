/**
 * HdMapPlugin — ViewerPlugin for GM HD map overlay with full editing support.
 *
 * State machine:
 *   idle    — no project loaded
 *   ready   — tiles loaded, no selection
 *   selected — element highlighted (click in panel or 3D)
 *   editing  — ShapeEditorEngine active (vertex editing or sign repositioning)
 *
 * Transitions driven by useHdMapStore:
 *   setProject()     → start tile fetch → populate elements list
 *   selectElement()  → update 3D highlight
 *   setEditorMode()  → start/stop vertex editor
 *   deleteElement()  → rebuild renderer
 *   updateEdge/etc() → rebuild renderer (live preview during editing skips this)
 *
 * Save (called from panel):
 *   saveAllTiles() — patches raw XML for every dirty tile, writes via WRITE_FILE
 */

import { Raycaster, Vector2, Plane, Vector3 } from 'three';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { HdMapRenderer } from './hd-map-renderer';
import { loadHdMapTiles } from './hd-map-loader';
import { useHdMapStore } from './hd-map-store';
import { HdMapPanel } from './hd-map-panel';
import { HdMapScenePicker } from './hd-map-scene-picker';
import { HdMapVertexEditor, HdMapSignMover } from './hd-map-vertex-editor';
import { buildEditModel } from './hd-map-edit-model';
import { wgs84ToUtm } from './projection';
import { patchLxsx, patchRsgx } from './serializers/xml-patcher';
import { hdMapHistory } from './hd-map-history';
import type { HdMapProject } from './hd-map-project';
import type { HdMapElement } from './hd-map-edit-model';

// ── Module-level singleton so HdMapPanel can call saveAllTiles() ───────────────
let _instance: HdMapPlugin | null = null;
export function getHdMapPlugin(): HdMapPlugin | null { return _instance; }

const ELEVATION_SAMPLE_COUNT = 30;

export class HdMapPlugin implements ViewerPlugin {
  readonly id   = 'hd-map';
  readonly name = 'HD Map';
  readonly order = 90;
  readonly sidebarDefaultOpen = true;
  readonly SidebarPanel = HdMapPanel;

  private ctx:          ViewerPluginContext | null = null;
  private renderer:     HdMapRenderer | null = null;
  private picker:       HdMapScenePicker | null = null;
  private vertexEditor: HdMapVertexEditor | null = null;
  private signMover:    HdMapSignMover | null = null;
  private unsub:        (() => void) | null = null;
  private rawXml:       Map<string, string> = new Map();

  // Pointer drag detection (don't pick on drag)
  private pointerDownPos: { x: number; y: number } | null = null;

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;
    _instance = this;

    this.renderer     = new HdMapRenderer();
    this.picker       = new HdMapScenePicker(ctx.worldRoot);
    this.vertexEditor = new HdMapVertexEditor();
    this.signMover    = new HdMapSignMover();

    ctx.worldRoot.add(this.renderer.laneEdgesGroup);
    ctx.worldRoot.add(this.renderer.laneMarkersGroup);
    ctx.worldRoot.add(this.renderer.objectsGroup);
    ctx.worldRoot.add(this.renderer.signsGroup);

    // Pointer events for 3D picking
    const el = ctx.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerup',   this.onPointerUp);

    // React to store changes
    this.unsub = useHdMapStore.subscribe((state, prev) => {
      if (!this.renderer || !this.ctx) return;

      // Project opened / reset → load tiles
      if (state.project !== prev.project && state.project && state.loadState === 'idle') {
        this.loadTiles(state.project);
        return;
      }

      // Selection changed → update highlight + rebuild (to exclude from batch)
      if (state.selectedId !== prev.selectedId || state.elements !== prev.elements) {
        if (state.project && state.loadState === 'loaded') {
          this.rebuildRenderer(state.elements, state.project, state.elevationOffset, state.editorMode === 'vertex' ? state.selectedId : null);
          this.picker?.setHighlight(state.editorMode !== 'vertex' ? state.selectedId : null, state.elements, state.project, state.elevationOffset);
        }
      }

      // Editor mode changed
      if (state.editorMode !== prev.editorMode) {
        if (state.editorMode === 'none') {
          // Commit happens separately; just deactivate
          this.vertexEditor?.deactivate();
          this.signMover?.cancel();
          // Restore highlight + batch rendering
          if (state.project) {
            this.rebuildRenderer(state.elements, state.project, state.elevationOffset, null);
            this.picker?.setHighlight(state.selectedId, state.elements, state.project, state.elevationOffset);
          }
        } else if (state.editorMode === 'vertex' && state.selectedId && state.project) {
          const elem = state.elements.find(e => e.id === state.selectedId);
          if (elem && (elem.kind === 'edge-left' || elem.kind === 'edge-right' || elem.kind === 'marker-line' || elem.kind === 'road-object')) {
            this.vertexEditor!.activate(elem, state.project, state.elevationOffset, this.ctx!);
            // Hide from batch; ShapeEditorEngine shows it
            this.rebuildRenderer(state.elements, state.project, state.elevationOffset, elem.id);
            this.picker?.clearHighlight();
          }
        } else if (state.editorMode === 'sign-move' && state.selectedId && state.project) {
          this.signMover!.begin(state.project, state.elevationOffset);
          // Change cursor
          this.ctx.domElement.style.cursor = 'crosshair';
        }
      }

      // Layer visibility
      this.renderer.setEdgesVisible(state.showEdges);
      this.renderer.setMarkersVisible(state.showMarkers);
      this.renderer.setObjectsVisible(state.showObjects);
      this.renderer.setSignsVisible(state.showSigns);

      // Elevation offset changed → rebuild
      if (state.elevationOffset !== prev.elevationOffset && state.project && state.loadState === 'loaded') {
        this.rebuildRenderer(state.elements, state.project, state.elevationOffset, null);
        this.picker?.setHighlight(state.selectedId, state.elements, state.project, state.elevationOffset);
      }
    });
  }

  onPointCloudLoaded(): void {
    const { project, elements, elevationOffset, loadState } = useHdMapStore.getState();
    if (loadState === 'loaded' && elements.length > 0 && project) {
      this.refineElevationOffset(elements, project);
    }
  }

  onUpdate(delta: number): void {
    this.vertexEditor?.onUpdate(delta);
    this.picker?.animate(delta);
  }

  dispose(): void {
    _instance = null;
    this.unsub?.();
    this.unsub = null;

    const el = this.ctx?.domElement;
    if (el) {
      el.removeEventListener('pointerdown', this.onPointerDown);
      el.removeEventListener('pointerup',   this.onPointerUp);
    }

    this.vertexEditor?.deactivate();
    this.picker?.dispose();

    if (this.renderer && this.ctx) {
      this.ctx.worldRoot.remove(this.renderer.laneEdgesGroup);
      this.ctx.worldRoot.remove(this.renderer.laneMarkersGroup);
      this.ctx.worldRoot.remove(this.renderer.objectsGroup);
      this.ctx.worldRoot.remove(this.renderer.signsGroup);
      this.renderer.dispose();
    }

    this.ctx      = null;
    this.renderer = null;
    this.picker   = null;
    this.rawXml.clear();
  }

  // ── Public editor API (called from panel) ───────────────────────────────────

  /** Commit the current vertex-editing session and return updated GeoPoints. */
  commitVertexEdit(): import('./hd-map-edit-model').GeoPoint[] | null {
    return this.vertexEditor?.commit() ?? null;
  }

  undoVertexDrag(): void { this.vertexEditor?.undoVertexDrag(); }
  redoVertexDrag(): void { this.vertexEditor?.redoVertexDrag(); }

  // ── Save ────────────────────────────────────────────────────────────────────

  /**
   * Patch and write all dirty tile files.
   * Called from HdMapPanel when the user clicks Save.
   */
  async saveAllTiles(): Promise<void> {
    const store = useHdMapStore.getState();
    if (!store.project || store.dirtyFiles.size === 0) return;

    const { elements, project } = store;
    const errors: string[] = [];

    for (const key of store.dirtyFiles) {
      const [kind, idxStr] = key.split('_');
      const fi = parseInt(idxStr, 10);
      const originalXml = this.rawXml.get(key);
      if (!originalXml) continue;

      try {
        let patched: string;

        if (kind === 'lxsx') {
          const fileElems = elements.filter(e => e.fileIndex === fi && !e.id.startsWith('rsgx'));
          patched = patchLxsx(originalXml, {
            edgeUpdates: fileElems
              .filter(e => e.kind === 'edge-left' || e.kind === 'edge-right')
              .filter(e => !e.deleted)
              .map(e => ({
                segmentId:   e.segmentId,
                side:        e.kind === 'edge-left' ? 'left' : 'right',
                xSectionIds: (e as import('./hd-map-edit-model').HdMapEdgeElement).xSectionIds,
                geoPoints:   (e as import('./hd-map-edit-model').HdMapEdgeElement).geoPoints,
              })),
            markerUpdates: fileElems
              .filter(e => e.kind === 'marker-line')
              .filter(e => !e.deleted)
              .map(e => ({
                segmentId:   e.segmentId,
                pointId:     (e as import('./hd-map-edit-model').HdMapMarkerLineElement).pointId,
                xSectionIds: (e as import('./hd-map-edit-model').HdMapMarkerLineElement).xSectionIds,
                geoPoints:   (e as import('./hd-map-edit-model').HdMapMarkerLineElement).geoPoints,
              })),
            segmentDeletes: [...new Set(
              fileElems.filter(e => e.deleted).map(e => e.segmentId)
            )].map(segmentId => ({ segmentId })),
          });
        } else {
          const fileElems = elements.filter(e => e.fileIndex === fi && e.id.startsWith('rsgx'));
          patched = patchRsgx(originalXml, {
            objectUpdates: fileElems
              .filter(e => e.kind === 'road-object' && !e.deleted)
              .map(e => {
                const o = e as import('./hd-map-edit-model').HdMapObjectElement;
                return { roadId: o.roadId, segmentId: o.segmentId, objectId: o.objectId, edgePoints: o.edgePoints };
              }),
            signUpdates: fileElems
              .filter(e => e.kind === 'sign' && !e.deleted)
              .map(e => {
                const s = e as import('./hd-map-edit-model').HdMapSignElement;
                return { roadId: s.roadId, segmentId: s.segmentId, signId: s.signId, point: s.point, azimuth: s.azimuth };
              }),
            objectDeletes: fileElems
              .filter(e => e.kind === 'road-object' && e.deleted)
              .map(e => {
                const o = e as import('./hd-map-edit-model').HdMapObjectElement;
                return { roadId: o.roadId, segmentId: o.segmentId, objectId: o.objectId };
              }),
            signDeletes: fileElems
              .filter(e => e.kind === 'sign' && e.deleted)
              .map(e => {
                const s = e as import('./hd-map-edit-model').HdMapSignElement;
                return { roadId: s.roadId, segmentId: s.segmentId, signId: s.signId };
              }),
          });
        }

        // Write via existing WRITE_FILE IPC channel
        const { region } = project;
        const ext  = kind === 'lxsx' ? 'lxsx' : 'rsgx';
        const fileName = `${region}_${fi}.${ext}`;
        const filePath = `${project.tilesDir}/${fileName}`;
        const encoder  = new TextEncoder();
        const bytes    = encoder.encode(patched);
        await window.electron?.invoke('write-file', { path: filePath, data: bytes.buffer });

        // Update our in-memory copy so repeated saves are correct
        this.rawXml.set(key, patched);
      } catch (err) {
        errors.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (errors.length === 0) {
      useHdMapStore.getState().clearDirty();
    } else {
      useHdMapStore.getState().setLoadState('error', errors.join('\n'));
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async loadTiles(project: HdMapProject): Promise<void> {
    const { setLoadState, setElements } = useHdMapStore.getState();
    setLoadState('loading');

    try {
      const tiles = await loadHdMapTiles(project);

      // Store raw XML for save operations
      this.rawXml.clear();
      tiles.lxsxTexts.forEach((t, i) => this.rawXml.set(`lxsx_${i}`, t));
      tiles.rsgxTexts.forEach((t, i) => this.rawXml.set(`rsgx_${i}`, t));

      // Build edit model
      const elements = buildEditModel(tiles.lxsx, tiles.rsgx);
      setElements(elements);
      setLoadState('loaded');
      hdMapHistory.reset();

      // Build initial renderer geometry
      const { elevationOffset } = useHdMapStore.getState();
      this.rebuildRenderer(elements, project, elevationOffset, null);

      // Auto-refine elevation from DEM if available
      const dem = this.ctx?.getDem();
      if (dem) {
        this.refineElevationOffset(elements, project);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useHdMapStore.getState().setLoadState('error', msg);
    }
  }

  private rebuildRenderer(
    elements: HdMapElement[],
    project: HdMapProject,
    elevOff: number,
    excludeId: string | null,
  ): void {
    if (!this.renderer) return;
    this.renderer.buildFromElements(
      elements, elevOff,
      project.utmZone, project.utmHemisphere,
      project.utmOriginEasting, project.utmOriginNorthing,
      excludeId,
    );
    const state = useHdMapStore.getState();
    this.renderer.setEdgesVisible(state.showEdges);
    this.renderer.setMarkersVisible(state.showMarkers);
    this.renderer.setObjectsVisible(state.showObjects);
    this.renderer.setSignsVisible(state.showSigns);
  }

  private refineElevationOffset(elements: HdMapElement[], project: HdMapProject): void {
    const dem = this.ctx?.getDem();
    if (!dem) return;

    const samples: number[] = [];
    const edges = elements.filter(e => e.kind === 'edge-left' && !e.deleted);

    outer:
    for (const elem of edges) {
      for (const geo of (elem as import('./hd-map-edit-model').HdMapEdgeElement).geoPoints) {
        const [e, n] = wgs84ToUtm(geo.lat, geo.lon, project.utmZone, project.utmHemisphere);
        const tx = e - project.utmOriginEasting;
        const tz = n - project.utmOriginNorthing;
        const demY = dem.getElevation(tx, tz);
        if (demY !== null) samples.push(geo.elevation - demY);
        if (samples.length >= ELEVATION_SAMPLE_COUNT) break outer;
      }
    }

    if (samples.length === 0) return;
    const offset  = samples.reduce((a, b) => a + b, 0) / samples.length;
    const rounded = Math.round(offset * 100) / 100;
    useHdMapStore.getState().setElevationOffset(rounded);
    this.rebuildRenderer(elements, project, rounded, null);
  }

  // ── Pointer event handlers ──────────────────────────────────────────────────

  private onPointerDown = (e: PointerEvent): void => {
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
  };

  private onPointerUp = async (e: PointerEvent): Promise<void> => {
    if (!this.pointerDownPos) return;
    const dx = e.clientX - this.pointerDownPos.x;
    const dy = e.clientY - this.pointerDownPos.y;
    this.pointerDownPos = null;
    if (Math.hypot(dx, dy) > 5) return; // was a drag, not a click

    const state = useHdMapStore.getState();
    if (!state.project || state.loadState !== 'loaded') return;

    // Sign-move mode: reposition by clicking on ground plane
    if (state.editorMode === 'sign-move' && state.selectedId && this.ctx) {
      const camera = this.ctx.getActiveCamera();
      const rect   = this.ctx.domElement.getBoundingClientRect();
      const ndcX   = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      const ndcY   = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      // Ray vs horizontal plane at current elevation offset
      const raycaster = new Raycaster();
      raycaster.setFromCamera(new Vector2(ndcX, ndcY), camera);
      const plane = new Plane(new Vector3(0, 1, 0), -state.elevationOffset + 0.4);
      const hit   = new Vector3();
      raycaster.ray.intersectPlane(plane, hit);

      const dem   = this.ctx.getDem();
      const demY  = dem?.getElevation(hit.x, hit.z) ?? state.elevationOffset;
      const worldY = demY + 0.4; // Y_LIFT_SIGN

      const newGeo = this.signMover!.applyClick(hit.x, worldY, hit.z);
      if (newGeo) {
        const elem = state.elements.find(el => el.id === state.selectedId);
        if (elem?.kind === 'sign') {
          hdMapHistory.record();
          useHdMapStore.getState().updateSign(state.selectedId, newGeo, elem.azimuth);
          useHdMapStore.getState().setEditorMode('none');
          this.ctx.domElement.style.cursor = '';
        }
      }
      return;
    }

    // Normal mode: element picking
    if (state.editorMode !== 'none') return; // don't pick while editing
    if (!this.picker || !this.ctx) return;

    const id = this.picker.pick(
      e.clientX, e.clientY,
      this.ctx.getActiveCamera(),
      this.ctx.domElement,
      state.elements,
      state.project,
      state.elevationOffset,
    );

    useHdMapStore.getState().selectElement(id);
  };
}
