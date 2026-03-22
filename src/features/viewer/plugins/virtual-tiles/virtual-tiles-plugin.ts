import {
  Group,
  Mesh,
  PlaneGeometry,
  MeshBasicMaterial,
  EdgesGeometry,
  LineSegments,
  LineBasicMaterial,
  Raycaster,
  Vector2,
  Vector3,
  Box3,
  Matrix4,
} from 'three';
import type { PointCloudOctree } from 'potree-core';
import { ClipMode } from 'potree-core';
import type { IClipBox } from 'potree-core';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { useVirtualTilesStore, cellKey } from './virtual-tiles-store';
import { useViewerModeStore } from '@/app/stores';

const CELL_OPACITY_DEFAULT = 0.15;
const CELL_OPACITY_HOVER = 0.3;
const CELL_OPACITY_SELECTED = 0.35;
const CELL_COLOR_DEFAULT = 0x4488ff;
const CELL_COLOR_SELECTED = 0x44ff88;
const CELL_COLOR_HOVER = 0x88bbff;
const EDGE_COLOR = 0xffffff;
const EDGE_OPACITY = 0.6;

interface CellMeshData {
  row: number;
  col: number;
  mesh: Mesh;
  edges: LineSegments;
  material: MeshBasicMaterial;
}

export class VirtualTilesPlugin implements ViewerPlugin {
  readonly id = 'virtual-tiles';
  readonly name = 'Virtual Tiles';
  readonly order = 85;

  private ctx: ViewerPluginContext | null = null;
  private gridGroup: Group | null = null;
  private cells: Map<string, CellMeshData> = new Map();
  /** Bounding box in the PCO's local space (before editor transform group) */
  private localBBox: Box3 | null = null;

  private unsubMode: (() => void) | null = null;
  private unsubStore: (() => void) | null = null;
  private listening = false;
  private mouseDownPos = new Vector2();

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;
    this.gridGroup = new Group();
    this.gridGroup.visible = false;
    this.gridGroup.matrixAutoUpdate = false;
    this.gridGroup.renderOrder = 900;

    // Add grid directly to the scene (not the transform group) so it
    // renders reliably in the EDL layer-0 pass. We sync the matrix
    // with the transform group each frame in onUpdate().
    ctx.scene.add(this.gridGroup);

    this.unsubMode = useViewerModeStore.subscribe((state, prev) => {
      const was = prev.mode === 'virtual-tiles';
      const is = state.mode === 'virtual-tiles';
      if (is && !was) this.enterMode();
      else if (!is && was) this.exitMode();
    });

    this.unsubStore = useVirtualTilesStore.subscribe((state, prev) => {
      if (state.cellSize !== prev.cellSize) {
        if (state.phase === 'selecting') {
          this.deriveGridSize();
          this.rebuildGrid();
        }
      }
      if (state.selectedCells !== prev.selectedCells) {
        this.updateCellVisuals();
      }
      if (state.hoverCell !== prev.hoverCell) {
        this.updateCellVisuals();
      }
      if (state.phase !== prev.phase) {
        this.onPhaseChanged(state.phase);
      }
    });

    if (useViewerModeStore.getState().mode === 'virtual-tiles') {
      this.enterMode();
    }
  }

  onUpdate(_delta: number): void {
    if (!this.ctx || !this.gridGroup || !this.gridGroup.visible) return;
    // Sync grid group's world matrix with the transform group so the
    // grid follows the point cloud's rotation/translation.
    const transformGroup = this.ctx.getEditor().getTransformGroup();
    transformGroup.updateMatrixWorld(true);
    this.gridGroup.matrix.copy(transformGroup.matrixWorld);
    this.gridGroup.matrixWorldNeedsUpdate = true;
  }

  onPointCloudLoaded(_pco: PointCloudOctree): void {
    this.computeLocalBBox();
  }

  dispose(): void {
    this.exitMode();
    this.unsubMode?.();
    this.unsubMode = null;
    this.unsubStore?.();
    this.unsubStore = null;
    this.clearGrid();
    if (this.gridGroup && this.ctx) {
      this.ctx.scene.remove(this.gridGroup);
    }
    this.gridGroup = null;
    this.ctx = null;
  }

  // --- Mode lifecycle ---

  private enterMode(): void {
    this.computeLocalBBox();
    const store = useVirtualTilesStore.getState();
    store.setPhase('selecting');
    store.deselectAll();
    this.deriveGridSize();
    this.rebuildGrid();
    if (this.gridGroup) {
      this.gridGroup.visible = true;
    }
    this.startListening();
  }

  private exitMode(): void {
    this.stopListening();
    const store = useVirtualTilesStore.getState();
    if (store.phase === 'selecting') {
      this.clearClipBoxes();
    }
    store.setPhase('idle');
    if (this.gridGroup) this.gridGroup.visible = false;
  }

  private onPhaseChanged(phase: string): void {
    if (phase === 'applied') {
      this.applyClipBoxes();
      this.stopListening();
      if (this.gridGroup) this.gridGroup.visible = true;
      useViewerModeStore.getState().exitMode();
    } else if (phase === 'idle') {
      if (this.gridGroup) this.gridGroup.visible = false;
    }
  }

  applySelection(): void {
    const store = useVirtualTilesStore.getState();
    if (store.selectedCells.length === 0) return;
    if (store.selectedCells.length > 30) return; // shader clip box limit
    store.setPhase('applied');
  }

  cancelSelection(): void {
    this.clearClipBoxes();
    useViewerModeStore.getState().exitMode();
  }

  clearTiles(): void {
    this.clearClipBoxes();
    useVirtualTilesStore.getState().setPhase('idle');
    if (this.gridGroup) this.gridGroup.visible = false;
  }

  // --- Bounding box ---

  private computeLocalBBox(): void {
    if (!this.ctx) return;
    const pcos = this.ctx.getPointClouds();
    if (pcos.length === 0) return;

    const box = new Box3();
    for (const pco of pcos) {
      const b = pco.pcoGeometry.boundingBox;
      box.expandByPoint(b.min.clone().add(pco.position));
      box.expandByPoint(b.max.clone().add(pco.position));
    }
    this.localBBox = box;
  }

  private deriveGridSize(): void {
    if (!this.localBBox) return;
    const { cellSize } = useVirtualTilesStore.getState();
    const extX = this.localBBox.max.x - this.localBBox.min.x;
    const extY = this.localBBox.max.y - this.localBBox.min.y;
    const cols = Math.max(1, Math.ceil(extX / cellSize));
    const rows = Math.max(1, Math.ceil(extY / cellSize));
    useVirtualTilesStore.getState().setGridSize(rows, cols);
  }

  // --- Grid construction ---

  /**
   * Build grid cells on the XY plane at the bottom of the local bounding box.
   * Positions are in the PCO's local coordinate space; the gridGroup's matrix
   * is synced to the transform group's world matrix each frame by onUpdate().
   */
  private rebuildGrid(): void {
    this.clearGrid();
    if (!this.localBBox || !this.gridGroup) return;

    const { rows, cols, cellSize } = useVirtualTilesStore.getState();
    const min = this.localBBox.min;

    const cellW = cellSize;
    const cellH = cellSize;
    // Place grid just below the bottom of the point cloud on Z
    const zPos = min.z - 0.5;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const key = cellKey(r, c);

        const planeGeo = new PlaneGeometry(cellW, cellH);
        const mat = new MeshBasicMaterial({
          color: CELL_COLOR_DEFAULT,
          transparent: true,
          opacity: CELL_OPACITY_DEFAULT,
          depthTest: false,
          depthWrite: false,
          side: 2, // DoubleSide
        });
        const mesh = new Mesh(planeGeo, mat);
        mesh.renderOrder = 900;

        const cx = min.x + (c + 0.5) * cellW;
        const cy = min.y + (r + 0.5) * cellH;
        mesh.position.set(cx, cy, zPos);

        // Edge wireframe
        const edgeGeo = new EdgesGeometry(planeGeo);
        const edgeMat = new LineBasicMaterial({
          color: EDGE_COLOR,
          transparent: true,
          opacity: EDGE_OPACITY,
          depthTest: false,
          depthWrite: false,
        });
        const edges = new LineSegments(edgeGeo, edgeMat);
        edges.renderOrder = 901;
        edges.position.copy(mesh.position);

        this.gridGroup.add(mesh);
        this.gridGroup.add(edges);

        mesh.userData = { cellRow: r, cellCol: c };
        this.cells.set(key, { row: r, col: c, mesh, edges, material: mat });
      }
    }

  }

  private clearGrid(): void {
    if (this.gridGroup) {
      while (this.gridGroup.children.length > 0) {
        const child = this.gridGroup.children[0];
        this.gridGroup.remove(child);
        if (child instanceof Mesh || child instanceof LineSegments) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    }
    this.cells.clear();
  }

  private updateCellVisuals(): void {
    const { selectedCells, hoverCell } = useVirtualTilesStore.getState();
    const selectedSet = new Set(selectedCells);

    for (const [key, cell] of this.cells) {
      const isSelected = selectedSet.has(key);
      const isHover = hoverCell === key;

      if (isSelected) {
        cell.material.color.setHex(CELL_COLOR_SELECTED);
        cell.material.opacity = CELL_OPACITY_SELECTED;
      } else if (isHover) {
        cell.material.color.setHex(CELL_COLOR_HOVER);
        cell.material.opacity = CELL_OPACITY_HOVER;
      } else {
        cell.material.color.setHex(CELL_COLOR_DEFAULT);
        cell.material.opacity = CELL_OPACITY_DEFAULT;
      }
    }
  }

  // --- Clip box management ---

  private applyClipBoxes(): void {
    if (!this.ctx || !this.localBBox) return;

    const { cellSize, selectedCells } = useVirtualTilesStore.getState();
    if (selectedCells.length === 0) return;

    const min = this.localBBox.min;
    const max = this.localBBox.max;
    const cellW = cellSize;
    const cellH = cellSize;
    const zMin = min.z;
    const zMax = max.z;
    const zExtent = zMax - zMin;

    const transformGroup = this.ctx.getEditor().getTransformGroup();
    transformGroup.updateMatrixWorld(true);
    const groupWorld = transformGroup.matrixWorld;

    const clipBoxes: IClipBox[] = [];

    for (const key of selectedCells) {
      const [rStr, cStr] = key.split('-');
      const r = parseInt(rStr, 10);
      const c = parseInt(cStr, 10);

      const cx = min.x + (c + 0.5) * cellW;
      const cy = min.y + (r + 0.5) * cellH;
      const cz = (zMin + zMax) / 2;

      const cellMin = new Vector3(cx - cellW / 2, cy - cellH / 2, zMin);
      const cellMax = new Vector3(cx + cellW / 2, cy + cellH / 2, zMax);

      // Local cell matrix: translate to center, then scale to cell dimensions
      const localMatrix = new Matrix4();
      localMatrix.makeTranslation(cx, cy, cz);
      localMatrix.scale(new Vector3(cellW, cellH, zExtent));

      // World cell matrix: group transform * local cell
      const worldMatrix = groupWorld.clone().multiply(localMatrix);
      const inverse = worldMatrix.clone().invert();

      clipBoxes.push({
        box: new Box3(cellMin, cellMax),
        matrix: worldMatrix,
        inverse,
        position: new Vector3(cx, cy, cz).applyMatrix4(groupWorld),
      });
    }

    for (const pco of this.ctx.getPointClouds()) {
      pco.material.clipMode = ClipMode.CLIP_OUTSIDE;
      pco.material.useClipBox = true;
      pco.material.setClipBoxes(clipBoxes);
    }
  }

  private clearClipBoxes(): void {
    if (!this.ctx) return;
    for (const pco of this.ctx.getPointClouds()) {
      pco.material.clipMode = ClipMode.DISABLED;
      pco.material.useClipBox = false;
      pco.material.setClipBoxes([]);
    }
  }

  // --- Event listeners ---

  private startListening(): void {
    if (this.listening || !this.ctx) return;
    this.listening = true;
    this.ctx.domElement.style.cursor = 'pointer';
    this.ctx.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.ctx.domElement.addEventListener('pointerup', this.onPointerUp);
    this.ctx.domElement.addEventListener('pointermove', this.onPointerMove);
  }

  private stopListening(): void {
    if (!this.listening || !this.ctx) return;
    this.listening = false;
    this.ctx.domElement.style.cursor = '';
    this.ctx.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.ctx.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.ctx.domElement.removeEventListener('pointermove', this.onPointerMove);
    useVirtualTilesStore.getState().setHoverCell(null);
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.mouseDownPos.set(e.clientX, e.clientY);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const dx = e.clientX - this.mouseDownPos.x;
    const dy = e.clientY - this.mouseDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) return;

    const hit = this.raycastCell(e);
    if (hit) {
      useVirtualTilesStore.getState().toggleCell(hit.row, hit.col);
    }
  };

  private lastMoveTime = 0;
  private readonly onPointerMove = (e: PointerEvent): void => {
    const now = performance.now();
    if (now - this.lastMoveTime < 50) return;
    this.lastMoveTime = now;

    const hit = this.raycastCell(e);
    useVirtualTilesStore.getState().setHoverCell(
      hit ? cellKey(hit.row, hit.col) : null
    );
  };

  private raycastCell(e: PointerEvent): { row: number; col: number } | null {
    if (!this.ctx || !this.gridGroup) return null;

    const camera = this.ctx.getActiveCamera();
    const rect = this.ctx.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, camera);

    const meshes = Array.from(this.cells.values()).map((c) => c.mesh);
    const hits = raycaster.intersectObjects(meshes, false);

    if (hits.length > 0) {
      const obj = hits[0].object;
      const { cellRow, cellCol } = obj.userData;
      if (cellRow !== undefined && cellCol !== undefined) {
        return { row: cellRow, col: cellCol };
      }
    }
    return null;
  }
}
