import {
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Vector3,
} from 'three';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { useDatasetTilesStore } from './dataset-tiles-store';
import type { TileInfo } from './dataset-tiles-types';

/**
 * Renders a wireframe bbox per tile described by the manifest. Parented to the
 * editor's transform group so tile boxes share the same local→world transform
 * as the point clouds themselves.
 *
 * Visibility is driven by `useDatasetTilesStore.boundsLayerVisible`; the
 * overlay is rebuilt when the manifest changes (new dataset loaded).
 */
export class DatasetTilesPlugin implements ViewerPlugin {
  readonly id = 'dataset-tiles';
  readonly order = 25;

  private ctx: ViewerPluginContext | null = null;
  private group: Group | null = null;
  private lines: LineSegments | null = null;
  private unsubVisibility: (() => void) | null = null;
  private unsubManifest: (() => void) | null = null;
  private parentedToTransform = false;

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;

    const group = new Group();
    group.name = 'dataset-tile-bounds';
    group.visible = useDatasetTilesStore.getState().boundsLayerVisible;
    ctx.worldRoot.add(group);
    this.group = group;

    this.unsubVisibility = useDatasetTilesStore.subscribe((s, prev) => {
      if (s.boundsLayerVisible !== prev.boundsLayerVisible && this.group) {
        this.group.visible = s.boundsLayerVisible;
      }
    });

    this.unsubManifest = useDatasetTilesStore.subscribe((s, prev) => {
      if (s.manifest !== prev.manifest) {
        this.rebuildFromManifest(s.manifest?.tiles ?? []);
      }
    });

    // Initial build if a manifest is already present
    const { manifest } = useDatasetTilesStore.getState();
    if (manifest?.tiles.length) this.rebuildFromManifest(manifest.tiles);
  }

  onPointCloudLoaded(): void {
    // Reparent under the editor's transform group on first PC load so the
    // overlay shares the same world transform as the point cloud.
    if (this.parentedToTransform || !this.ctx || !this.group) return;
    const editor = this.ctx.getEditor();
    const tg = editor.getTransformGroup();
    tg.add(this.group);
    this.parentedToTransform = true;
  }

  onPointCloudsUnloaded(): void {
    // Keep the overlay so user can still see the tile grid even when nothing
    // is loaded — it's driven by the manifest, not the loaded PCOs.
  }

  onUpdate(): void {}

  dispose(): void {
    this.unsubVisibility?.();
    this.unsubManifest?.();
    this.unsubVisibility = null;
    this.unsubManifest = null;

    if (this.lines) {
      this.lines.geometry.dispose();
      (this.lines.material as LineBasicMaterial).dispose();
      this.lines = null;
    }
    if (this.group?.parent) this.group.parent.remove(this.group);
    this.group = null;
    this.parentedToTransform = false;
    this.ctx = null;
  }

  // ── Geometry builder ────────────────────────────────────────────────

  private rebuildFromManifest(tiles: TileInfo[]): void {
    if (!this.group) return;

    if (this.lines) {
      this.group.remove(this.lines);
      this.lines.geometry.dispose();
      (this.lines.material as LineBasicMaterial).dispose();
      this.lines = null;
    }
    if (tiles.length === 0) return;

    const positions: number[] = [];
    const box = new Box3();
    const corners = new Array<Vector3>(8);
    for (let i = 0; i < 8; i++) corners[i] = new Vector3();

    for (const tile of tiles) {
      box.min.set(tile.bounds.min[0], tile.bounds.min[1], tile.bounds.min[2]);
      box.max.set(tile.bounds.max[0], tile.bounds.max[1], tile.bounds.max[2]);
      // 8 corners of the AABB
      corners[0].set(box.min.x, box.min.y, box.min.z);
      corners[1].set(box.max.x, box.min.y, box.min.z);
      corners[2].set(box.max.x, box.min.y, box.max.z);
      corners[3].set(box.min.x, box.min.y, box.max.z);
      corners[4].set(box.min.x, box.max.y, box.min.z);
      corners[5].set(box.max.x, box.max.y, box.min.z);
      corners[6].set(box.max.x, box.max.y, box.max.z);
      corners[7].set(box.min.x, box.max.y, box.max.z);

      // 12 edges as line pairs
      const edges: Array<[number, number]> = [
        [0, 1], [1, 2], [2, 3], [3, 0], // bottom
        [4, 5], [5, 6], [6, 7], [7, 4], // top
        [0, 4], [1, 5], [2, 6], [3, 7], // verticals
      ];
      for (const [a, b] of edges) {
        positions.push(corners[a].x, corners[a].y, corners[a].z);
        positions.push(corners[b].x, corners[b].y, corners[b].z);
      }
    }

    const geom = new BufferGeometry();
    geom.setAttribute('position', new Float32BufferAttribute(positions, 3));

    const mat = new LineBasicMaterial({
      color: 0x4fc3f7,
      transparent: true,
      opacity: 0.6,
      depthTest: true,
    });
    const lines = new LineSegments(geom, mat);
    lines.name = 'dataset-tile-bounds-lines';
    this.group.add(lines);
    this.lines = lines;
  }
}
