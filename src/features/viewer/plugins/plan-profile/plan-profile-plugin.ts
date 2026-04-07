import {
  ArrowHelper,
  PerspectiveCamera,
  Vector3,
  LineSegments,
} from 'three';
import { ClipMode } from 'potree-core';
import type { IClipBox } from 'potree-core';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import type { ObbShape, SelectSubMode, TransformMode } from '../../modules/shape-editor';
import { ShapeEditorEngine } from '../../modules/shape-editor';
import type { PlanProfileEditSubMode } from './plan-profile-store';
import {
  buildPlanSlab,
  buildProfileSlab,
  slabToClipBox,
  buildSlabWireframe,
  updateSlabWireframe,
  slabCameraParams,
  SecondaryViewport,
  type PlaneSlab,
} from '../../modules/plan-profile';
import { usePlanProfileStore } from './plan-profile-store';
import { filterSceneForSlabRender } from './slab-scene-filter';
import { useScanFilterStore } from '../scan-filter/scan-filter-store';
import { ScanFilterPlugin } from '../scan-filter';
import { useViewerModeStore } from '@/app/stores';

export class PlanProfilePlugin implements ViewerPlugin {
  readonly id = 'plan-profile';
  readonly name = 'Plan / Profile';
  readonly order = 70;

  private ctx: ViewerPluginContext | null = null;
  private unsub: (() => void) | null = null;

  // Draw engine — provides correct raycasting via PolylineDrawController.
  // maxPolylinePoints:2 makes it auto-commit after exactly 2 clicks.
  private drawEngine: ShapeEditorEngine | null = null;

  private static readonly OBB_ID = 'plan-profile-obb';

  // Active slab
  private slab: PlaneSlab | null = null;
  private slabWireframe: LineSegments | null = null;
  private directionArrow: ArrowHelper | null = null;
  private secondaryVp: SecondaryViewport | null = null;

  // Virtual perspective camera used solely to drive Potree LOD updates for
  // the slab region. Positioned close to the slab face so Potree loads
  // high-density octree nodes there, independent of the 3D camera distance.
  private lodCamera: PerspectiveCamera | null = null;

  // Trajectory follow mode
  private onCentroidClick: ((e: MouseEvent) => void) | null = null;
  // True if we entered scan-filter mode on behalf of follow-centroid picking.
  // Used to know whether to exit it after the centroid is committed.
  private enteredScanFilterMode = false;

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;

    // ShapeEditorEngine: used for 2-click ground raycasting AND OBB face editing.
    this.drawEngine = new ShapeEditorEngine(ctx, {
      showFaceExtrudeHandles: true,
      escapeHandled: true,
      deleteHandled: false,
      maxPolylinePoints: 2,
    });

    this.drawEngine.on('shape-created', (shape) => {
      if (shape.type !== 'polyline' || shape.points.length < 2) return;
      const a = new Vector3(shape.points[0].x, shape.points[0].y, shape.points[0].z);
      const b = new Vector3(shape.points[1].x, shape.points[1].y, shape.points[1].z);
      this.drawEngine!.clearShapes();
      this.commitLine(a, b);
    });

    // Live-update the slab while the user drags faces in OBB edit mode.
    this.drawEngine.on('shape-updated', (shape) => {
      if (shape.type !== 'obb' || shape.id !== PlanProfilePlugin.OBB_ID) return;
      this.updateSlabFromObb(shape);
    });

    this.drawEngine.on('draw-cancelled', () => {
      usePlanProfileStore.getState().close();
    });

    this.unsub = usePlanProfileStore.subscribe((state, prev) => {
      if (state.halfDepth !== prev.halfDepth && this.slab) {
        this.slab.halfDepth = state.halfDepth;
        this.updateSlabVisuals();
      }

      // Plan/profile phase transitions
      if (state.phase !== prev.phase) {
        if (state.phase === 'drawing-first')              this.startDrawing();
        else if (state.phase === 'editing')               this.enterEditMode();
        else if (state.phase === 'active' && prev.phase === 'editing') this.exitEditMode();
        else if (state.phase === 'idle' && prev.phase !== 'idle') this.deactivateAll();
      }

      // Trajectory follow phase transitions (independent of plan/profile phase)
      if (state.trajectoryPhase !== prev.trajectoryPhase) {
        if (state.trajectoryPhase === 'centroid-picking') {
          this.startFollowCentroid();
        } else if (prev.trajectoryPhase === 'centroid-picking') {
          // Centroid picked (→ 'active') or cancelled (→ 'idle').
          this.cancelFollowCentroid();
          if (state.trajectoryPhase === 'idle' && this.enteredScanFilterMode) {
            // Cancelled without picking — close the scan-filter mode we opened.
            useViewerModeStore.getState().exitMode();
            this.enteredScanFilterMode = false;
          }
          // If → 'active': keep scan-filter mode open so user can manage the filter.
        } else if (state.trajectoryPhase === 'idle' && prev.trajectoryPhase === 'active') {
          // stopFollow() while active — exit scan-filter mode if we opened it.
          if (this.enteredScanFilterMode) {
            useViewerModeStore.getState().exitMode();
            this.enteredScanFilterMode = false;
          }
          this.ctx?.host.getPlugin<ScanFilterPlugin>('scan-filter')?.setFollowHighlight(null);
        }
      }

      if (state.editSubMode !== prev.editSubMode && state.phase === 'editing') {
        this.applyEditSubMode(state.editSubMode);
      }
      if (state.viewFlipped !== prev.viewFlipped) {
        this.updateDirectionArrow();
        this.applySlabToSecondary();
      }
    });
  }

  onUpdate(delta: number): void {
    this.drawEngine?.onUpdate(delta);
  }

  onAfterRender(): void {
    this.driveSecondaryLod();
    this.renderSecondary();
  }

  dispose(): void {
    this.deactivateAll();
    this.unsub?.();
    this.unsub = null;
    this.drawEngine?.dispose();
    this.drawEngine = null;
    this.ctx = null;
  }

  // ── Public API (called by React) ────────────────────────────────────────────

  attachSecondaryContainer(el: HTMLElement): void {
    if (!this.secondaryVp) this.secondaryVp = new SecondaryViewport();
    this.secondaryVp.attach(el);
    if (this.slab) this.applySlabToSecondary();
  }

  detachSecondaryContainer(): void {
    this.secondaryVp?.detach();
  }

  resizeSecondary(): void {
    this.secondaryVp?.resize();
  }

  // ── Drawing ──────────────────────────────────────────────────────────────────

  private startDrawing(): void {
    if (!this.ctx || !this.drawEngine) return;
    const dem = this.ctx.getDem();
    if (dem) {
      // DEM gives correct scene-space ground elevation at any XZ position.
      this.drawEngine.setElevationFn((x, z) => dem.getElevationClamped(x, z));
    } else {
      // Fallback: orbit-controls target Y is where the user is focused.
      const groundY = this.ctx.controls.target.y;
      this.drawEngine.setElevationFn((_x, _z) => groundY);
    }
    this.drawEngine.setModeIdle();
    this.drawEngine.clearShapes();
    this.drawEngine.startDrawPolyline();
  }

  private stopDrawing(): void {
    this.drawEngine?.setModeIdle();
    this.drawEngine?.clearShapes();
  }

  private commitLine(a: Vector3, b: Vector3): void {
    if (!this.ctx) return;
    this.stopDrawing();

    const { viewType, halfDepth } = usePlanProfileStore.getState();
    const centerX = (a.x + b.x) / 2;
    const centerZ = (a.z + b.z) / 2;

    // Ground Y — DEM elevation at the line centre, fallback to drawn line Y.
    const dem = this.ctx.getDem();
    let groundY = dem
      ? dem.getElevationClamped(centerX, centerZ)
      : (a.y + b.y) / 2;

    // Vertical extent — fixed margins above and below the terrain elevation at the
    // cut centre. Using the full-line DEM range inflates height on sloped terrain.
    const ABOVE_GROUND = 15; // m above terrain (covers buildings, trees, poles)
    const BELOW_GROUND = 15; // m below terrain (subsurface / below-grade points)
    const slabBottom = groundY - BELOW_GROUND;
    const slabTop    = groundY + ABOVE_GROUND;

    // Clamp: slab must be at least 5 m tall.
    const halfHeight = Math.max((slabTop - slabBottom) / 2, 2.5);
    const centerY = slabBottom + halfHeight;

    this.slab = viewType === 'plan'
      ? buildPlanSlab(a, b, halfDepth, centerY, halfHeight)
      : buildProfileSlab(a, b, halfDepth, centerY, halfHeight);

    this.buildSlabVisuals();
    this.applySlabToSecondary();
    this.rebuildLodCamera();

    usePlanProfileStore.getState().setPhase('active');
  }

  // ── Edit mode (OBB face/vertex/transform) ────────────────────────────────────

  private enterEditMode(): void {
    if (!this.drawEngine || !this.slab) return;
    // Hide the plugin's own wireframe — the engine draws its own OBB visual.
    if (this.slabWireframe) this.slabWireframe.visible = false;
    const obb = this.slabToObb(this.slab);
    this.drawEngine.addShape(obb);
    this.drawEngine.selectShape(obb.id);
    this.drawEngine.startSelect('shape');
  }

  private exitEditMode(): void {
    if (!this.drawEngine) return;
    this.drawEngine.setModeIdle();
    this.drawEngine.clearShapes();
    // Restore the plugin's wireframe now that the engine visual is gone.
    if (this.slabWireframe) this.slabWireframe.visible = true;
  }

  /** Called by the React edit-toolbar. */
  setEditSubMode(mode: PlanProfileEditSubMode): void {
    usePlanProfileStore.getState().setEditSubMode(mode);
  }

  // ── Trajectory follow mode ───────────────────────────────────────────────────

  /**
   * Move the slab to the next (+1) or previous (-1) trajectory point.
   * Called by the < > navigation buttons in the secondary panel.
   */
  navigateFollow(delta: number): void {
    if (!this.slab || !this.ctx) return;
    const trajectoryData = useScanFilterStore.getState().trajectoryData;
    if (!trajectoryData || trajectoryData.points.length === 0) return;

    const { followIndex } = usePlanProfileStore.getState();
    const newIndex = Math.max(0, Math.min(trajectoryData.points.length - 1, followIndex + delta));
    if (newIndex === followIndex) return;

    this.applyFollowIndex(newIndex, trajectoryData.points);
  }

  navigateToScanId(scanId: number): void {
    if (!this.slab || !this.ctx) return;
    const trajectoryData = useScanFilterStore.getState().trajectoryData;
    if (!trajectoryData || trajectoryData.points.length === 0) return;

    const index = trajectoryData.points.findIndex((p) => p.scanId === scanId);
    if (index === -1) return;
    this.applyFollowIndex(index, trajectoryData.points);
  }

  private startFollowCentroid(): void {
    if (!this.ctx) return;
    useScanFilterStore.getState().setTrajectoryVisible(true);

    this.cancelFollowCentroid();

    // Enter scan-filter mode so the trajectory toolbar icon shows as active
    // and the command panel appears (collapsed). ScanFilterPlugin's own pointer
    // listeners handle hover highlighting — no need to duplicate that here.
    const modeStore = useViewerModeStore.getState();
    if (modeStore.mode !== 'scan-filter') {
      modeStore.enterScanFilterMode();
      // Collapse the panel so it doesn't obscure the 3D view while picking.
      modeStore.setCommandPanelExpanded(false);
      this.enteredScanFilterMode = true;
    }

    // One-shot click to commit the selected trajectory point.
    this.onCentroidClick = (e: MouseEvent) => {
      this.cancelFollowCentroid();
      this.pickFollowCentroid(e.clientX, e.clientY);
    };
    this.ctx.domElement.addEventListener('click', this.onCentroidClick, { once: true });
  }

  private cancelFollowCentroid(): void {
    if (this.onCentroidClick && this.ctx) {
      this.ctx.domElement.removeEventListener('click', this.onCentroidClick);
      this.onCentroidClick = null;
    }
    this.ctx?.host.getPlugin<ScanFilterPlugin>('scan-filter')?.clearHover();
  }

  /**
   * Screen-space pick the trajectory dot nearest to the click, reusing the same
   * logic as the ScanFilterPlugin hover/click hit-test.
   * Transitions trajectoryPhase → 'active' on success, → 'idle' on miss.
   */
  private pickFollowCentroid(clientX: number, clientY: number): void {
    if (!this.ctx || !this.slab) return;

    const trajectoryData = useScanFilterStore.getState().trajectoryData;
    if (!trajectoryData || trajectoryData.points.length === 0) {
      usePlanProfileStore.getState().stopFollow();
      return;
    }

    const scanFilter = this.ctx.host.getPlugin<ScanFilterPlugin>('scan-filter');
    const index = scanFilter?.pickNearestTrajectoryIndex(clientX, clientY) ?? null;

    if (index === null) {
      usePlanProfileStore.getState().stopFollow();
      return;
    }

    this.applyFollowIndex(index, trajectoryData.points);
  }

  /**
   * Move the slab center to trajectory point [index] and refresh all visuals.
   * The scan filter is NOT touched here — the user manages it independently
   * via the trajectory/scan-filter panel. The 2D view is already filtered to
   * the slab bounding box via the clip box applied in renderSecondary().
   */
  private applyFollowIndex(
    index: number,
    points: { x: number; y: number; z: number; scanId: number }[],
  ): void {
    if (!this.slab || !this.ctx) return;
    const pt = points[index];

    // Convert trajectory local coords → world space via transform group
    const tg = this.ctx.getEditor().getTransformGroup();
    tg.updateMatrixWorld(true);
    const worldPt = new Vector3(pt.x, pt.y, pt.z).applyMatrix4(tg.matrixWorld);

    const dem = this.ctx.getDem();
    // DEM takes transform-group-local coords; terrain Y is unaffected by XZ translation
    const newTerrainY = dem ? dem.getElevationClamped(pt.x, pt.z) : worldPt.y;

    // Reposition the 3D camera so it orbits around the new slab centre while
    // preserving the current orbit radius/angle. Doing this correctly requires
    // preserving the camera→target offset, NOT a slab-delta approach (which
    // only works when controls.target ≡ slab.center, which isn't guaranteed).
    const camera   = this.ctx.getActiveCamera();
    const controls = this.ctx.controls;
    const orbitOffset = camera.position.clone().sub(controls.target);

    this.slab.center.set(worldPt.x, newTerrainY, worldPt.z);
    this.slab.groundY = newTerrainY - this.slab.halfHeight;

    controls.target.copy(this.slab.center);
    camera.position.copy(this.slab.center).add(orbitOffset);
    controls.update();

    usePlanProfileStore.getState()._setFollowIndex(index);

    // Keep the trajectory dot for the active follow position highlighted yellow.
    const scanFilter = this.ctx.host.getPlugin<ScanFilterPlugin>('scan-filter');
    scanFilter?.setFollowHighlight(points[index].scanId);

    this.updateSlabVisuals();
    this.applySlabToSecondary();
    this.rebuildLodCamera();
  }

  private applyEditSubMode(mode: PlanProfileEditSubMode): void {
    if (!this.drawEngine) return;
    if (mode === 'translate' || mode === 'rotate' || mode === 'scale') {
      this.drawEngine.startTransform(mode as TransformMode);
      if (this.drawEngine.getSelection().shapes.size === 0) {
        this.drawEngine.selectShape(PlanProfilePlugin.OBB_ID);
      }
    } else {
      this.drawEngine.setSubMode(mode as SelectSubMode);
    }
  }

  /** Convert the current slab geometry into an ObbShape the editor understands. */
  private slabToObb(slab: PlaneSlab): ObbShape {
    // Three.js makeRotationY(θ) maps local X → world (cos θ, 0, −sin θ).
    // slab.tangent = (cos α, 0, +sin α), so we need θ = −α so that
    // local X → world (cos α, 0, sin α) = tangent.
    const rotationY = -Math.atan2(slab.tangent.z, slab.tangent.x);
    return {
      type: 'obb',
      id: PlanProfilePlugin.OBB_ID,
      center: { x: slab.center.x, y: slab.center.y, z: slab.center.z },
      halfExtents: { x: slab.halfLength, y: slab.halfHeight, z: slab.halfDepth },
      rotationY,
      metadata: {},
    };
  }

  /** Apply an updated ObbShape back onto the live slab and refresh all visuals. */
  private updateSlabFromObb(obb: ObbShape): void {
    if (!this.slab) return;
    // Inverse of slabToObb: with rotationY = −α, local X → world (cos α, 0, sin α).
    const tangent = new Vector3(Math.cos(obb.rotationY), 0, -Math.sin(obb.rotationY));
    const viewDir  = new Vector3(Math.sin(obb.rotationY), 0,  Math.cos(obb.rotationY));
    this.slab.center.set(obb.center.x, obb.center.y, obb.center.z);
    this.slab.tangent.copy(tangent);
    this.slab.viewDir.copy(viewDir);
    this.slab.halfLength = obb.halfExtents.x;
    this.slab.halfHeight = obb.halfExtents.y;
    this.slab.halfDepth  = obb.halfExtents.z;
    // Keep the store's halfDepth in sync so the UI slider reflects reality.
    usePlanProfileStore.getState().setHalfDepth(obb.halfExtents.z);
    // Rebuild wireframe but keep it hidden while in edit mode.
    this.buildSlabVisuals();
    if (this.slabWireframe) this.slabWireframe.visible = false;
    this.applySlabToSecondary();
    this.rebuildLodCamera();
  }

  // ── Slab visuals ─────────────────────────────────────────────────────────────

  private buildSlabVisuals(): void {
    if (!this.ctx || !this.slab) return;
    this.clearSlabVisuals();
    this.slabWireframe = buildSlabWireframe(this.slab);
    this.ctx.scene.add(this.slabWireframe);
    this.buildDirectionArrow();
  }

  private buildDirectionArrow(): void {
    if (!this.ctx || !this.slab) return;
    if (this.directionArrow) {
      this.ctx.scene.remove(this.directionArrow);
      this.directionArrow.dispose();
    }
    this.updateDirectionArrow();
  }

  private updateDirectionArrow(): void {
    if (!this.ctx || !this.slab) return;
    const { slab } = this;
    const flipped = usePlanProfileStore.getState().viewFlipped;
    // Arrow points in the direction the secondary camera is looking (into the scene).
    // Camera is on the -viewDir side (not flipped) → looks in +viewDir direction.
    const arrowDir = flipped
      ? slab.viewDir.clone().negate()
      : slab.viewDir.clone();
    const arrowLen = Math.max(slab.halfDepth * 3, 3);

    if (this.directionArrow) {
      this.directionArrow.position.copy(slab.center);
      this.directionArrow.setDirection(arrowDir);
      this.directionArrow.setLength(arrowLen, arrowLen * 0.35, arrowLen * 0.2);
    } else {
      this.directionArrow = new ArrowHelper(
        arrowDir,
        slab.center.clone(),
        arrowLen,
        0xff6600,          // orange
        arrowLen * 0.35,
        arrowLen * 0.2,
      );
      this.ctx.scene.add(this.directionArrow);
    }
  }

  private updateSlabVisuals(): void {
    if (!this.slab) return;
    if (this.slabWireframe) updateSlabWireframe(this.slabWireframe, this.slab);
    this.updateDirectionArrow();
    this.applySlabToSecondary();
  }

  private clearSlabVisuals(): void {
    if (this.ctx) {
      if (this.slabWireframe)  this.ctx.scene.remove(this.slabWireframe);
      if (this.directionArrow) this.ctx.scene.remove(this.directionArrow);
    }
    this.slabWireframe = null;
    if (this.directionArrow) { this.directionArrow.dispose(); this.directionArrow = null; }
  }

  // ── Secondary LOD ─────────────────────────────────────────────────────────────

  /**
   * Rebuild the virtual perspective camera used for driving Potree LOD updates.
   *
   * The camera is placed close to the slab face (on the -viewDir side, i.e. the
   * same side as the secondary orthographic camera) so that Potree treats the
   * slab region as "near" and queues high-density octree nodes for it — regardless
   * of where the 3D camera is positioned.
   *
   * Distance is proportional to the slab face extent so the frustum naturally
   * covers the whole face at ~90° FOV.
   */
  private rebuildLodCamera(): void {
    if (!this.slab) return;
    if (!this.lodCamera) {
      this.lodCamera = new PerspectiveCamera(90, 1, 0.1, 100000);
    }
    this.updateLodCamera();
  }

  private updateLodCamera(): void {
    if (!this.slab || !this.lodCamera) return;
    const { center, viewDir, halfLength, halfHeight } = this.slab;
    // Distance chosen so the frustum covers the slab face at FOV=90°.
    // Significantly closer than the orthographic secondary camera → higher LOD.
    const dist = Math.max(halfLength, halfHeight) * 0.5 + 1;
    // Aspect ratio matches the slab face proportions.
    this.lodCamera.aspect  = halfLength / Math.max(halfHeight, 0.1);
    this.lodCamera.far     = dist * 4 + this.slab.halfDepth * 2;
    this.lodCamera.updateProjectionMatrix();
    // Place on the -viewDir side, looking toward slab centre.
    this.lodCamera.position.copy(center).addScaledVector(viewDir, -dist);
    this.lodCamera.lookAt(center);
  }

  /**
   * Called every frame (from onAfterRender, before renderSecondary).
   *
   * Runs an extra Potree LOD update pass with the virtual LOD camera so that
   * high-density nodes for the slab region are queued for async download.
   * They will be available (in the Three.js scene) within a few frames and
   * will then appear in the secondary render automatically.
   *
   * For slabs wider than 100 m we cap maxLevel to avoid an unreasonable
   * download budget; for smaller slabs we allow full depth.
   */
  private driveSecondaryLod(): void {
    if (!this.ctx || !this.slab || !this.secondaryVp || !this.lodCamera) return;

    // Keep the virtual camera in sync when the slab changes (e.g. halfDepth tweaks).
    this.updateLodCamera();

    const pcos = this.ctx.getPointClouds();
    if (pcos.length === 0) return;

    // LOD cap based on the horizontal width of the drawn line.
    // Wide slabs cover many octree nodes at max depth → cap to stay performant.
    const slabWidth = this.slab.halfLength * 2;
    const lodMaxLevel: number =
      slabWidth <= 150 ? Infinity :
      slabWidth <= 300 ? 8 :
      slabWidth <= 500 ? 6 :
      4;

    // Temporarily cap maxLevel, run the secondary LOD pass, restore.
    const savedLevels = pcos.map((p) => p.maxLevel);
    for (const pco of pcos) pco.maxLevel = lodMaxLevel;
    this.ctx.updatePointCloudsForCamera(this.lodCamera);
    for (let i = 0; i < pcos.length; i++) pcos[i].maxLevel = savedLevels[i];
  }

  // ── Secondary render ─────────────────────────────────────────────────────────

  private applySlabToSecondary(): void {
    if (!this.slab || !this.secondaryVp) return;
    const flipped = usePlanProfileStore.getState().viewFlipped;
    const params  = slabCameraParams(this.slab, flipped);
    this.secondaryVp.setCameraView(params.position, params.target, params.up, params.frustumSize);
  }

  private renderSecondary(): void {
    if (!this.ctx || !this.slab || !this.secondaryVp) return;

    const pcos = this.ctx.getPointClouds();
    const clipBox = slabToClipBox(this.slab);

    // Hide 3D-only overlays and filter annotations for the secondary render.
    if (this.directionArrow) this.directionArrow.visible = false;
    const scanFilter = this.ctx.host.getPlugin<ScanFilterPlugin>('scan-filter');
    scanFilter?.setTrajectoryMeshesVisible(false);
    const restoreScene = filterSceneForSlabRender(this.ctx.scene, clipBox, this.slab.halfDepth);

    if (pcos.length === 0) {
      this.secondaryVp.render(this.ctx.scene);
    } else {
      const { pointSize } = usePlanProfileStore.getState();
      const savedStates = pcos.map((pco) => ({
        mode:    pco.material.clipMode,
        boxes:   [...(pco.material.clipBoxes ?? [])] as IClipBox[],
        size:    pco.material.size,
        minSize: pco.material.minSize,
        maxSize: pco.material.maxSize,
      }));

      for (const pco of pcos) {
        pco.material.clipMode = ClipMode.CLIP_OUTSIDE;
        pco.material.setClipBoxes([clipBox]);
        // Force an exact pixel size by pinning minSize = maxSize = pointSize.
        // This bypasses the adaptive formula (which depends on 3D camera distance)
        // without touching pointSizeType (which would trigger a shader recompile).
        pco.material.size    = pointSize;
        pco.material.minSize = pointSize;
        pco.material.maxSize = pointSize;
      }

      this.secondaryVp.render(this.ctx.scene);

      for (let i = 0; i < pcos.length; i++) {
        pcos[i].material.clipMode  = savedStates[i].mode;
        pcos[i].material.setClipBoxes(savedStates[i].boxes);
        pcos[i].material.size      = savedStates[i].size;
        pcos[i].material.minSize   = savedStates[i].minSize;
        pcos[i].material.maxSize   = savedStates[i].maxSize;
      }
    }

    restoreScene();
    scanFilter?.setTrajectoryMeshesVisible(true);
    if (this.directionArrow) this.directionArrow.visible = true;
  }

  // ── Deactivate ───────────────────────────────────────────────────────────────

  private deactivateAll(): void {
    this.stopDrawing();
    this.cancelFollowCentroid();
    if (this.enteredScanFilterMode) {
      useViewerModeStore.getState().exitMode();
      this.enteredScanFilterMode = false;
    }
    this.ctx?.host.getPlugin<ScanFilterPlugin>('scan-filter')?.setFollowHighlight(null);
    this.clearSlabVisuals();
    this.slab = null;
    this.lodCamera = null;
  }
}
