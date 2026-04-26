/**
 * HdMapVertexEditor — wraps ShapeEditorEngine to provide vertex-level editing
 * for HD map elements (polylines and polygons).
 *
 * Workflow:
 *   1. Call activate(elem, project, elevOff, ctx) to begin editing.
 *   2. The element is loaded as a PolylineShape into ShapeEditorEngine.
 *   3. The user drags vertex handles in the 3D view.
 *   4. Call commit() → returns updated GeoPoints for the store.
 *   5. Call cancel() to discard changes and clean up.
 *
 * Coordinate conversion:
 *   WGS84 (canonical) ↔ Three.js local coords (via project() / unproject())
 *
 * Sign elements (single point) use a simplified translate-only mode —
 * see HdMapSignMover (a separate, simpler helper at the bottom of this file).
 */

import { Matrix4, Vector3 } from 'three';
import { ShapeEditorEngine } from '../../modules/shape-editor/shape-editor-engine';
import type { PolylineShape, EditorShape } from '../../modules/shape-editor/shape-editor-types';
import type { ViewerPluginContext } from '../../types';
import type { HdMapElement, HdMapEdgeElement, HdMapMarkerLineElement, HdMapObjectElement, GeoPoint } from './hd-map-edit-model';
import type { HdMapProject } from './hd-map-project';
import { project, unproject } from './projection';
import { useHdMapStore } from './hd-map-store';

const EDITOR_SHAPE_ID = 'hdmap-edit-shape';

// ── Coordinate helpers ────────────────────────────────────────────────────────

function toWorld(
  geo: GeoPoint, proj_: HdMapProject, elevOff: number,
): { x: number; y: number; z: number } {
  const [x, y, z] = project(
    geo.lat, geo.lon, geo.elevation, elevOff,
    proj_.utmZone, proj_.utmHemisphere,
    proj_.utmOriginEasting, proj_.utmOriginNorthing,
  );
  return { x, y, z };
}

function toGeo(
  x: number, y: number, z: number, proj_: HdMapProject, elevOff: number,
): GeoPoint {
  const [lat, lon, elevation] = unproject(
    x, y, z, elevOff,
    proj_.utmZone, proj_.utmHemisphere,
    proj_.utmOriginEasting, proj_.utmOriginNorthing,
  );
  return { lat, lon, elevation };
}

function geoArrayToVecs(
  pts: GeoPoint[], proj_: HdMapProject, elevOff: number
): { x: number; y: number; z: number }[] {
  return pts.map(g => toWorld(g, proj_, elevOff));
}

/**
 * Transform local-space (worldRoot frame) coords into scene-space coords by
 * applying the worldRoot's matrix. Used because ShapeEditorEngine renders
 * outside worldRoot, so its handles must be placed in true scene space to
 * line up with the rendered HD map (which IS under worldRoot and inherits
 * its scale, including any axis-flip).
 */
function localToScene(
  pts: { x: number; y: number; z: number }[],
  worldMatrix: Matrix4,
): { x: number; y: number; z: number }[] {
  const v = new Vector3();
  return pts.map(p => {
    v.set(p.x, p.y, p.z).applyMatrix4(worldMatrix);
    return { x: v.x, y: v.y, z: v.z };
  });
}

// ── Main editor class ─────────────────────────────────────────────────────────

export class HdMapVertexEditor {
  private engine: ShapeEditorEngine | null = null;
  private proj_:  HdMapProject | null = null;
  private elevOff = 0;
  private elem:   HdMapElement | null = null;

  // Per-drag undo/redo history (geo-point snapshots)
  private currentGeos:     GeoPoint[] = [];
  private vertexUndoStack: GeoPoint[][] = [];
  private vertexRedoStack: GeoPoint[][] = [];
  private _skipHistoryPush = false;

  // worldRoot matrices captured at activate(). Kept stable for the editing
  // session so handle positions don't drift if the user toggles axis flip
  // mid-edit (they shouldn't, but we don't want surprises).
  private worldMatrix = new Matrix4();
  private invWorldMatrix = new Matrix4();

  /** Callback invoked each time the user moves a vertex (live preview). */
  onLiveUpdate?: (id: string, pts: GeoPoint[]) => void;

  get isActive(): boolean { return this.engine !== null; }

  /**
   * Activate editing for the given element.
   * Adds ShapeEditorEngine scene objects; call deactivate() to remove them.
   */
  activate(
    elem: HdMapEdgeElement | HdMapMarkerLineElement | HdMapObjectElement,
    proj_: HdMapProject,
    elevOff: number,
    ctx: ViewerPluginContext,
  ): void {
    this.deactivate();

    this.proj_   = proj_;
    this.elevOff = elevOff;
    this.elem    = elem;

    // Capture worldRoot's transform: we render handles in scene space, but the
    // HD map renderer is under worldRoot and inherits its scale (axis-flip).
    // Apply worldMatrix on the way in (local→scene) and invWorldMatrix on the
    // way out (scene→local) so handles always line up with the visual.
    ctx.worldRoot.updateWorldMatrix(true, false);
    this.worldMatrix.copy(ctx.worldRoot.matrixWorld);
    this.invWorldMatrix.copy(this.worldMatrix).invert();

    const demTerrain = ctx.getDem();
    const inv = this.invWorldMatrix;
    const tmp = new Vector3();
    const elevFn = (wx: number, wz: number) => {
      // Engine passes scene-space (wx, wz); DEM is keyed by worldRoot-local coords.
      tmp.set(wx, 0, wz).applyMatrix4(inv);
      const localY = demTerrain?.getElevation(tmp.x, tmp.z) ?? elevOff;
      // Convert the local elevation back to scene-space Y for the engine.
      tmp.set(0, localY, 0).applyMatrix4(this.worldMatrix);
      return tmp.y;
    };

    this.engine = new ShapeEditorEngine(ctx, {
      rootGroupName:          'hdmap-vertex-editor',
      showFaceExtrudeHandles: false,
      showEdgeMidHandles:     true,
      vertexHandleRadius:     0.12,
      edgeHandleRadius:       0.09,
      escapeHandled:          false,  // plugin manages Escape itself
      deleteHandled:          false,  // don't let engine delete the shape
    });
    this.engine.setElevationFn(elevFn);

    const geoPoints =
      elem.kind === 'road-object' ? elem.edgePoints : elem.geoPoints;

    const shape: PolylineShape = {
      type:     'polyline',
      id:       EDITOR_SHAPE_ID,
      points:   localToScene(geoArrayToVecs(geoPoints, proj_, elevOff), this.worldMatrix),
      closed:   elem.kind === 'road-object' && elem.edgeClosed,
      metadata: {},
    };

    this.currentGeos     = [...geoPoints];
    this.vertexUndoStack = [];
    this.vertexRedoStack = [];
    useHdMapStore.getState().setVertexHistoryCounts(0, 0);

    this.engine.addShape(shape);
    this.engine.selectShape(EDITOR_SHAPE_ID);
    this.engine.startSelect('vertex');

    // Track per-drag history; engine.dispose() clears all handlers automatically
    this.engine.on('shape-updated', (updated: EditorShape) => {
      if (updated.type !== 'polyline' || !this.proj_) return;
      // Engine emits scene-space points; convert back to worldRoot-local first.
      const localPts = updated.points.map(p => {
        const v = new Vector3(p.x, p.y, p.z).applyMatrix4(this.invWorldMatrix);
        return { x: v.x, y: v.y, z: v.z };
      });
      const geos = localPts.map(p => toGeo(p.x, p.y, p.z, this.proj_!, this.elevOff));
      if (!this._skipHistoryPush) {
        this.vertexUndoStack.push([...this.currentGeos]);
        this.vertexRedoStack = [];
        useHdMapStore.getState().setVertexHistoryCounts(this.vertexUndoStack.length, 0);
      }
      this.currentGeos = geos;
      this.onLiveUpdate?.(this.elem!.id, geos);
    });
  }

  canUndoVertexDrag(): boolean { return this.vertexUndoStack.length > 0; }
  canRedoVertexDrag(): boolean { return this.vertexRedoStack.length > 0; }

  undoVertexDrag(): void {
    if (!this.engine || !this.proj_ || this.vertexUndoStack.length === 0) return;
    this.vertexRedoStack.push([...this.currentGeos]);
    this.currentGeos = this.vertexUndoStack.pop()!;
    this._skipHistoryPush = true;
    this.engine.updateShape({
      type: 'polyline',
      id: EDITOR_SHAPE_ID,
      points: localToScene(geoArrayToVecs(this.currentGeos, this.proj_, this.elevOff), this.worldMatrix),
      closed: (this.elem as import('./hd-map-edit-model').HdMapObjectElement)?.edgeClosed ?? false,
      metadata: {},
    });
    this._skipHistoryPush = false;
    useHdMapStore.getState().setVertexHistoryCounts(this.vertexUndoStack.length, this.vertexRedoStack.length);
  }

  redoVertexDrag(): void {
    if (!this.engine || !this.proj_ || this.vertexRedoStack.length === 0) return;
    this.vertexUndoStack.push([...this.currentGeos]);
    this.currentGeos = this.vertexRedoStack.pop()!;
    this._skipHistoryPush = true;
    this.engine.updateShape({
      type: 'polyline',
      id: EDITOR_SHAPE_ID,
      points: localToScene(geoArrayToVecs(this.currentGeos, this.proj_, this.elevOff), this.worldMatrix),
      closed: (this.elem as import('./hd-map-edit-model').HdMapObjectElement)?.edgeClosed ?? false,
      metadata: {},
    });
    this._skipHistoryPush = false;
    useHdMapStore.getState().setVertexHistoryCounts(this.vertexUndoStack.length, this.vertexRedoStack.length);
  }

  /**
   * Commit current vertex positions → returns updated GeoPoints.
   * Does NOT deactivate; call deactivate() separately to clean up.
   */
  commit(): GeoPoint[] | null {
    if (!this.engine || !this.proj_) return null;
    const shape = this.engine.getShape(EDITOR_SHAPE_ID);
    if (!shape || shape.type !== 'polyline') return null;
    // Engine points are scene-space; convert to worldRoot-local before unproject
    const v = new Vector3();
    return shape.points.map(p => {
      v.set(p.x, p.y, p.z).applyMatrix4(this.invWorldMatrix);
      return toGeo(v.x, v.y, v.z, this.proj_!, this.elevOff);
    });
  }

  /** Forward per-frame update to ShapeEditorEngine (call from plugin.onUpdate). */
  onUpdate(delta: number): void {
    this.engine?.onUpdate(delta);
  }

  /** Discard edits and remove all scene objects. */
  deactivate(): void {
    this.engine?.dispose();
    this.engine          = null;
    this.elem            = null;
    this.proj_           = null;
    this.currentGeos     = [];
    this.vertexUndoStack = [];
    this.vertexRedoStack = [];
    useHdMapStore.getState().setVertexHistoryCounts(0, 0);
  }
}

// ── Sign repositioning helper ─────────────────────────────────────────────────

/**
 * HdMapSignMover — simpler helper for repositioning a sign (single point).
 * The user clicks anywhere on the DEM surface to move the sign.
 * Call startListening() with a DEM-elevation function, then setNewPosition()
 * when the user clicks.
 */
export class HdMapSignMover {
  private active = false;
  private proj_: HdMapProject | null = null;
  private elevOff = 0;

  /** True while waiting for the user to click a new position. */
  get isActive(): boolean { return this.active; }

  begin(proj_: HdMapProject, elevOff: number): void {
    this.proj_   = proj_;
    this.elevOff = elevOff;
    this.active  = true;
  }

  /**
   * Convert a Three.js world-space click position to a GeoPoint.
   * Returns null if not active.
   */
  applyClick(worldX: number, worldY: number, worldZ: number): GeoPoint | null {
    if (!this.active || !this.proj_) return null;
    return toGeo(worldX, worldY, worldZ, this.proj_, this.elevOff);
  }

  cancel(): void {
    this.active = false;
  }
}
