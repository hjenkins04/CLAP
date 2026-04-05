import { GridHelper } from 'three';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { useGridStore } from './grid-store';
import { useWorldFrameStore } from '../world-frame/world-frame-store';
import { GridPanel } from './grid-panel';

export class GridPlugin implements ViewerPlugin {
  readonly id = 'grid';
  readonly name = 'Grid';
  readonly order = 100;
  readonly sidebarDefaultOpen = false;
  readonly SidebarPanel = GridPanel;

  private ctx: ViewerPluginContext | null = null;
  private gridHelper: GridHelper | null = null;
  private demAvgElevation: number | null = null;
  private unsubGrid: (() => void) | null = null;
  private unsubWorldFrame: (() => void) | null = null;

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;

    const state = useGridStore.getState();
    this.buildGrid(state.size, state.cellSize, state.visible);

    this.unsubGrid = useGridStore.subscribe((state) => {
      this.buildGrid(state.size, state.cellSize, state.visible);
    });

    this.unsubWorldFrame = useWorldFrameStore.subscribe((state, prev) => {
      if (state.anchor1 !== prev.anchor1 || state.phase !== prev.phase) {
        this.syncOrigin();
      }
    });
  }

  onPointCloudLoaded(): void {
    const dem = this.ctx?.getDem();
    if (dem) {
      // Compute mean elevation across all DEM cells
      const grid = dem.data.elevation;
      let sum = 0;
      let count = 0;
      for (const row of grid) {
        for (const v of row) {
          sum += v;
          count++;
        }
      }
      this.demAvgElevation = count > 0 ? sum / count : null;
    } else {
      this.demAvgElevation = null;
    }
    this.syncOrigin();
  }

  dispose(): void {
    this.unsubGrid?.();
    this.unsubWorldFrame?.();
    this.unsubGrid = null;
    this.unsubWorldFrame = null;

    if (this.gridHelper && this.ctx) {
      this.ctx.worldRoot.remove(this.gridHelper);
      this.gridHelper.dispose();
      this.gridHelper = null;
    }

    this.ctx = null;
  }

  private buildGrid(size: number, cellSize: number, visible: boolean): void {
    if (!this.ctx) return;

    if (this.gridHelper) {
      this.ctx.worldRoot.remove(this.gridHelper);
      this.gridHelper.dispose();
    }

    const divisions = Math.max(1, Math.round(size / cellSize));
    this.gridHelper = new GridHelper(size, divisions, 0x444444, 0x222222);
    this.gridHelper.visible = visible;
    this.ctx.worldRoot.add(this.gridHelper);
    this.syncOrigin();
  }

  /** Position the grid at the world-frame anchor (XZ) at the DEM average
   *  elevation (Y).  Falls back to anchor1.pc.y when no DEM is loaded. */
  private syncOrigin(): void {
    if (!this.gridHelper) return;
    const { phase, anchor1 } = useWorldFrameStore.getState();
    if (phase === 'confirmed' && anchor1) {
      const y = this.demAvgElevation ?? anchor1.pc.y;
      this.gridHelper.position.set(anchor1.pc.x, y, anchor1.pc.z);
    } else {
      const y = this.demAvgElevation ?? 0;
      this.gridHelper.position.set(0, y, 0);
    }
  }
}
