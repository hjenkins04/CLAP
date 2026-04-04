import { Group, Line, Mesh, Matrix4, Vector3 } from 'three';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { useCustomMapStore, CUSTOM_MAP_CATEGORIES, type CustomMapCategory } from './custom-map-store';
import { useWorldFrameStore } from '../world-frame';
import { buildCustomMapGroups, type ElevationFn } from './custom-map-renderer';
import { CustomMapPanel } from './custom-map-panel';

export class CustomMapPlugin implements ViewerPlugin {
  readonly id = 'custom-map';
  readonly name = 'Custom Map';
  readonly order = 7;
  readonly SidebarPanel = CustomMapPanel;
  readonly sidebarTitle = 'Custom Map';
  readonly sidebarDefaultOpen = false;

  private ctx: ViewerPluginContext | null = null;
  private rootGroup: Group | null = null;
  private categoryGroups = new Map<CustomMapCategory, Group>();

  private unsubWorldFrame: (() => void) | null = null;
  private unsubStore: (() => void) | null = null;

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;

    this.rootGroup = new Group();
    this.rootGroup.name = 'custom-map';
    ctx.worldRoot.add(this.rootGroup);

    this.unsubWorldFrame = useWorldFrameStore.subscribe((state, prev) => {
      if (state.transform !== prev.transform) {
        this.rebuild();
      }
    });

    this.unsubStore = useCustomMapStore.subscribe((state, prev) => {
      if (state.ways !== prev.ways) {
        this.rebuild();
        return;
      }
      if (state.visible !== prev.visible || state.opacity !== prev.opacity) {
        this.applyVisibility();
        return;
      }
      for (const cat of CUSTOM_MAP_CATEGORIES) {
        if (state.categories[cat] !== prev.categories[cat]) {
          this.applyCategoryVisibility();
          return;
        }
      }
    });
  }

  onPointCloudLoaded(): void {
    // Re-build when a point cloud loads (DEM may now be available)
    this.rebuild();
  }

  dispose(): void {
    this.unsubWorldFrame?.();
    this.unsubStore?.();
    this.clearGeometry();
    if (this.ctx && this.rootGroup) {
      this.ctx.worldRoot.remove(this.rootGroup);
    }
    this.rootGroup = null;
    this.ctx = null;
  }

  // ── Build ─────────────────────────────────────────────────────────────

  private rebuild(): void {
    this.clearGeometry();
    if (!this.ctx || !this.rootGroup) return;

    const { transform } = useWorldFrameStore.getState();
    if (!transform) return;

    const { ways, visible, opacity, categories } = useCustomMapStore.getState();
    if (ways.length === 0) return;

    const getElev = this.buildElevationFn();
    const newGroups = buildCustomMapGroups(ways, transform, opacity, getElev);

    for (const [cat, group] of newGroups) {
      group.visible = visible && categories[cat];
      this.rootGroup.add(group);
      this.categoryGroups.set(cat, group);
    }
  }

  private buildElevationFn(): ElevationFn {
    if (!this.ctx) return () => 0;
    const dem = this.ctx.getDem();
    if (!dem) return () => 0;

    const tg = this.ctx.getEditor().getTransformGroup();
    tg.updateMatrixWorld(true);
    const invTg = new Matrix4().copy(tg.matrixWorld).invert();

    // rootGroup is positioned at world origin in scene space
    // The scene uses Y-up; the DEM is queried in PCO local space (X=east, Z=north)
    return (sceneX: number, sceneZ: number): number => {
      // Scene position (x, 0, z) → PCO local space for DEM lookup
      const local = new Vector3(sceneX, 0, sceneZ).applyMatrix4(invTg);
      return dem.getElevationClamped(local.x, local.z);
    };
  }

  private clearGeometry(): void {
    if (!this.rootGroup) return;
    for (const group of this.categoryGroups.values()) {
      this.rootGroup.remove(group);
      for (const child of [...group.children]) {
        if (child instanceof Line || child instanceof Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    }
    this.categoryGroups.clear();
  }

  private applyVisibility(): void {
    const { visible, categories } = useCustomMapStore.getState();
    for (const [cat, group] of this.categoryGroups) {
      group.visible = visible && categories[cat];
    }
  }

  private applyCategoryVisibility(): void {
    const { visible, categories } = useCustomMapStore.getState();
    for (const [cat, group] of this.categoryGroups) {
      group.visible = visible && categories[cat];
    }
  }
}
