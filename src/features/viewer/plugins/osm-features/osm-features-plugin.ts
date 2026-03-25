import { Group, Line, Mesh, Box3, Vector3, Matrix4 } from 'three';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { useOsmFeaturesStore, OSM_LAYER_KEYS, type OsmLayerKey } from './osm-features-store';
import { useWorldFrameStore } from '../world-frame';
import { localToGeo, type WorldFrameTransform } from '../world-frame/geo-utils';
import { fetchOsmFeatures, type OverpassBBox } from './overpass-client';
import {
  classifyFeature,
  buildLineGeometry,
  buildPolygonGeometry,
  buildRoadGeometry,
  LAYER_COLORS,
  type ElevationFn,
} from './osm-renderer';
import { OsmFeaturesPanel } from './osm-features-panel';

export class OsmFeaturesPlugin implements ViewerPlugin {
  readonly id = 'osm-features';
  readonly name = 'OSM Features';
  readonly order = 6;
  readonly SidebarPanel = OsmFeaturesPanel;
  readonly sidebarTitle = 'OSM Features';
  readonly sidebarDefaultOpen = false;

  private ctx: ViewerPluginContext | null = null;
  private rootGroup: Group | null = null;
  private layerGroups = new Map<OsmLayerKey, Group>();
  private pcBounds: Box3 | null = null;

  private unsubWorldFrame: (() => void) | null = null;
  private unsubStore: (() => void) | null = null;

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;

    this.rootGroup = new Group();
    this.rootGroup.name = 'osm-features';
    ctx.scene.add(this.rootGroup);

    // Create a sub-group per layer
    for (const key of OSM_LAYER_KEYS) {
      const g = new Group();
      g.name = `osm-${key}`;
      this.rootGroup.add(g);
      this.layerGroups.set(key, g);
    }

    this.unsubWorldFrame = useWorldFrameStore.subscribe((state, prev) => {
      if (state.transform !== prev.transform || state.phase !== prev.phase) {
        this.applyGroupTransform();
      }
    });

    this.unsubStore = useOsmFeaturesStore.subscribe((state, prev) => {
      if (state.visible !== prev.visible) this.applyVisibility();
      if (state.opacity !== prev.opacity) this.applyOpacity();
      for (const key of OSM_LAYER_KEYS) {
        if (state.layers[key] && !prev.layers[key]) {
          // Layer toggled ON — fetch if not already loaded, then show
          this.fetchLayer(key);
        } else if (!state.layers[key] && prev.layers[key]) {
          // Layer toggled OFF — just hide
          const g = this.layerGroups.get(key);
          if (g) g.visible = false;
        }
      }
    });
  }

  onPointCloudLoaded(): void {
    if (!this.ctx) return;
    const pcos = this.ctx.getPointClouds();
    const tg = this.ctx.getEditor().getTransformGroup();
    tg.updateMatrixWorld(true);

    const box = new Box3();
    for (const pco of pcos) {
      // Build a tight box from the position attribute's actual min/max
      // (not the octree bbox which is padded to a cube).
      const attrs = pco.pcoGeometry.pointAttributes;
      const posAttr = attrs?.attributes?.find(
        (a: { name: string }) => a.name === 'position',
      );
      let b: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
      if (posAttr?.range && Array.isArray(posAttr.range[0])) {
        // range = [[minX,minY,minZ], [maxX,maxY,maxZ]]
        const [mn, mx] = posAttr.range as [number[], number[]];
        b = {
          min: { x: mn[0], y: mn[1], z: mn[2] },
          max: { x: mx[0], y: mx[1], z: mx[2] },
        };
      } else {
        b = pco.pcoGeometry.boundingBox;
      }

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
  }

  dispose(): void {
    this.unsubWorldFrame?.();
    this.unsubStore?.();
    this.clearGeometry();
    if (this.ctx && this.rootGroup) this.ctx.scene.remove(this.rootGroup);
    this.rootGroup = null;
    this.ctx = null;
  }

  // ── Fetch & Render ─────────────────────────────────────────────────

  private applyGroupTransform(): void {
    if (!this.rootGroup) return;
    const { transform, flipX, flipZ } = useWorldFrameStore.getState();
    if (!transform) return;

    this.rootGroup.position.set(transform.translation.x, 0, transform.translation.z);
    this.rootGroup.rotation.set(0, 0, 0);
    this.rootGroup.rotation.y = transform.rotation;
    this.rootGroup.scale.x = flipX ? -1 : 1;
    this.rootGroup.scale.z = flipZ ? -1 : 1;
    this.applyVisibility();
  }

  /**
   * Fetch a single OSM layer on demand. If already fetched, just show it.
   */
  private async fetchLayer(key: OsmLayerKey): Promise<void> {
    const store = useOsmFeaturesStore.getState();
    const group = this.layerGroups.get(key);

    // Already loaded — just show
    if (store.loadedLayers[key] && group) {
      group.visible = true;
      return;
    }

    if (!this.ctx || !this.pcBounds) return;
    const { transform } = useWorldFrameStore.getState();
    if (!transform) return;

    const bbox = this.computeBBox(transform);
    if (!bbox) return;

    this.applyGroupTransform();

    useOsmFeaturesStore.getState().setLoadingLayer(key);

    try {
      const geojson = await fetchOsmFeatures(bbox, [key]);
      this.renderFeatures(geojson, transform);
      useOsmFeaturesStore.getState().setLoadedLayer(key);
      if (group) group.visible = true;
    } catch (err) {
      console.warn(`[CLAP] OSM ${key} fetch failed:`, err);
    } finally {
      useOsmFeaturesStore.getState().setLoadingLayer(null);
    }
  }

  private computeBBox(transform: WorldFrameTransform): OverpassBBox | null {
    if (!this.pcBounds) return null;

    const corners = [
      { x: this.pcBounds.min.x, z: this.pcBounds.min.z },
      { x: this.pcBounds.min.x, z: this.pcBounds.max.z },
      { x: this.pcBounds.max.x, z: this.pcBounds.min.z },
      { x: this.pcBounds.max.x, z: this.pcBounds.max.z },
    ];

    let south = Infinity, north = -Infinity;
    let west = Infinity, east = -Infinity;

    for (const c of corners) {
      const geo = localToGeo(c, transform);
      south = Math.min(south, geo.lat);
      north = Math.max(north, geo.lat);
      west = Math.min(west, geo.lng);
      east = Math.max(east, geo.lng);
    }

    return { south, north, west, east };
  }

  /**
   * Build an elevation lookup function that converts from the OSM group's
   * local frame (geo-meters: x=east, z=north at Y=0) to DEM elevation.
   */
  private buildElevationFn(): ElevationFn {
    if (!this.ctx || !this.rootGroup) return () => 0;

    const dem = this.ctx.getDem();
    if (!dem) return () => 0;

    const tg = this.ctx.getEditor().getTransformGroup();
    tg.updateMatrixWorld(true);
    this.rootGroup.updateMatrixWorld(true);

    const invTg = new Matrix4().copy(tg.matrixWorld).invert();
    const invGroup = new Matrix4().copy(this.rootGroup.matrixWorld).invert();
    const groupMat = this.rootGroup.matrixWorld;
    const tgMat = tg.matrixWorld;

    const { zOffset } = useWorldFrameStore.getState();

    return (geoX: number, geoZ: number): number => {
      // Group-local (geoX, 0, geoZ) → world
      const world = new Vector3(geoX, 0, geoZ).applyMatrix4(groupMat);
      // World → DEM-local
      const demLocal = world.applyMatrix4(invTg);
      // Look up elevation (DEM uses X/Y horizontal, Z = elevation)
      const elev = dem.getElevationClamped(demLocal.x, demLocal.y);
      demLocal.z = elev + zOffset;
      // DEM-local → world → group-local
      demLocal.applyMatrix4(tgMat);
      demLocal.applyMatrix4(invGroup);
      return demLocal.y;
    };
  }

  private renderFeatures(
    geojson: GeoJSON.FeatureCollection,
    transform: WorldFrameTransform,
  ): void {
    const { opacity, layers } = useOsmFeaturesStore.getState();
    const getElev = this.buildElevationFn();

    for (const feature of geojson.features) {
      const layerKey = classifyFeature(
        (feature.properties ?? {}) as Record<string, unknown>,
      );
      if (!layerKey) continue;

      const group = this.layerGroups.get(layerKey);
      if (!group) continue;
      group.visible = layers[layerKey];

      const geom = feature.geometry;
      const color = LAYER_COLORS[layerKey];

      const props = (feature.properties ?? {}) as Record<string, unknown>;

      if (geom.type === 'LineString') {
        if (layerKey === 'roads') {
          group.add(buildRoadGeometry(geom.coordinates as number[][], transform, color, opacity, getElev, props));
        } else {
          group.add(buildLineGeometry(geom.coordinates as number[][], transform, color, opacity, getElev));
        }
      } else if (geom.type === 'Polygon') {
        group.add(buildPolygonGeometry(geom.coordinates as number[][][], transform, color, opacity, getElev));
      } else if (geom.type === 'MultiPolygon') {
        for (const ring of geom.coordinates as number[][][][]) {
          group.add(buildPolygonGeometry(ring, transform, color, opacity, getElev));
        }
      } else if (geom.type === 'MultiLineString') {
        if (layerKey === 'roads') {
          for (const coords of geom.coordinates as number[][][]) {
            group.add(buildRoadGeometry(coords, transform, color, opacity, getElev, props));
          }
        } else {
          for (const coords of geom.coordinates as number[][][]) {
            group.add(buildLineGeometry(coords, transform, color, opacity, getElev));
          }
        }
      }
    }

    this.applyVisibility();
  }

  private clearGeometry(): void {
    for (const group of this.layerGroups.values()) {
      while (group.children.length > 0) {
        const child = group.children[0];
        group.remove(child);
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
  }

  private applyVisibility(): void {
    if (!this.rootGroup) return;
    const { visible } = useOsmFeaturesStore.getState();
    const hasTransform = !!useWorldFrameStore.getState().transform;
    this.rootGroup.visible = visible && hasTransform;
  }

  private applyOpacity(): void {
    // Re-render with new opacity would be expensive; skip for now
    // Opacity only applies on next fetch
  }
}
