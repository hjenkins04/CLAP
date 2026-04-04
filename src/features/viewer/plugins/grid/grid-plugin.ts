import { GridHelper } from 'three';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { useGridStore } from './grid-store';
import { GridPanel } from './grid-panel';

export class GridPlugin implements ViewerPlugin {
  readonly id = 'grid';
  readonly name = 'Grid';
  readonly order = 100;
  readonly sidebarDefaultOpen = false;
  readonly SidebarPanel = GridPanel;

  private ctx: ViewerPluginContext | null = null;
  private gridHelper: GridHelper | null = null;
  private unsubscribe: (() => void) | null = null;

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;

    const state = useGridStore.getState();
    this.buildGrid(state.size, state.cellSize, state.visible);

    this.unsubscribe = useGridStore.subscribe((state) => {
      this.buildGrid(state.size, state.cellSize, state.visible);
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;

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
  }
}
