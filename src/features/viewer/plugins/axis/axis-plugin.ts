import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { useAxisStore } from './axis-store';
import { AxisPanel } from './axis-panel';

export class AxisPlugin implements ViewerPlugin {
  readonly id = 'axis';
  readonly name = 'Axis Settings';
  readonly order = 110;
  readonly SidebarPanel = AxisPanel;
  readonly sidebarTitle = 'Axis Settings';
  readonly sidebarDefaultOpen = false;

  private ctx: ViewerPluginContext | null = null;
  private unsub: (() => void) | null = null;
  /** Prevents re-pushing to the journal when we're restoring state from it. */
  private restoring = false;

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;

    // Apply persisted localStorage state immediately
    this.applyFlips(useAxisStore.getState());

    // React to future store changes
    this.unsub = useAxisStore.subscribe((state) => {
      this.applyFlips(state);
      // Push to the journal when the user actively changes a setting
      if (!this.restoring) {
        const editor = this.ctx?.getEditor();
        if (editor?.getBasePath()) {
          editor.setAxisFlip(state.flipX, state.flipY, state.flipZ);
        }
      }
    });
  }

  /** Called after a point cloud (and its journal) has been loaded. */
  onPointCloudLoaded(): void {
    if (!this.ctx) return;
    const editor = this.ctx.getEditor();
    const flat = editor.flatten();

    // Restore axis flip from the dataset's journal — overrides localStorage
    const { flipX, flipY, flipZ } = flat.axisFlip;
    const current = useAxisStore.getState();
    if (
      current.flipX !== flipX ||
      current.flipY !== flipY ||
      current.flipZ !== flipZ
    ) {
      this.restoring = true;
      useAxisStore.setState({ flipX, flipY, flipZ });
      this.restoring = false;
    }
  }

  dispose(): void {
    this.unsub?.();
    this.unsub = null;
    this.ctx = null;
  }

  private applyFlips({ flipX, flipY, flipZ }: { flipX: boolean; flipY: boolean; flipZ: boolean }): void {
    if (!this.ctx) return;
    this.ctx.worldRoot.scale.set(flipX ? -1 : 1, flipY ? -1 : 1, flipZ ? -1 : 1);
  }
}
