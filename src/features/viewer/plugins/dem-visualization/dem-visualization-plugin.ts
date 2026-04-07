import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  DoubleSide,
} from 'three';
import type { PointCloudOctree } from 'potree-core';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { useDemVisualizationStore } from './dem-visualization-store';
import { DemVisualizationPanel } from './dem-visualization-panel';

// ── Colormap ──────────────────────────────────────────────────────────────────

/** 5-stop terrain gradient — maps normalised elevation t ∈ [0,1] to RGB ∈ [0,1]. */
function terrainColor(t: number): [number, number, number] {
  const stops: [number, number, number, number][] = [
    [0.00, 0.05, 0.38, 0.28],  // deep water / lowest terrain  (dark teal)
    [0.25, 0.25, 0.62, 0.28],  // lowland                       (green)
    [0.55, 0.56, 0.73, 0.32],  // mid-elevation                 (light sage)
    [0.75, 0.70, 0.60, 0.38],  // sub-alpine                    (warm tan)
    [1.00, 0.92, 0.92, 0.92],  // peak / alpine snow            (near-white)
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, r0, g0, b0] = stops[i];
    const [t1, r1, g1, b1] = stops[i + 1];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return [r0 + f * (r1 - r0), g0 + f * (g1 - g0), b0 + f * (b1 - b0)];
    }
  }
  return [0.92, 0.92, 0.92];
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export class DemVisualizationPlugin implements ViewerPlugin {
  readonly id    = 'dem-visualization';
  readonly name  = 'DEM Surface';
  readonly order = 65;

  readonly SidebarPanel       = DemVisualizationPanel;
  readonly sidebarDefaultOpen = false;

  private ctx: ViewerPluginContext | null = null;
  private demMesh: Mesh | null = null;
  private unsub: (() => void) | null = null;


  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;

    this.unsub = useDemVisualizationStore.subscribe((state, prev) => {
      // Toggle visibility without a rebuild when possible
      if (state.enabled !== prev.enabled) {
        if (state.enabled && !this.demMesh) {
          this.buildDemMesh();
        } else if (this.demMesh) {
          this.demMesh.visible = state.enabled;
        }
      }
      // Opacity: update material in-place
      if (state.opacity !== prev.opacity && this.demMesh) {
        (this.demMesh.material as MeshBasicMaterial).opacity = state.opacity;
      }
      // Wireframe or step: requires a full geometry rebuild
      if (state.wireframe !== prev.wireframe || state.step !== prev.step) {
        this.buildDemMesh();
      }
    });
  }

  onPointCloudLoaded(_pco: PointCloudOctree): void {
    // DEM becomes available when the first point cloud loads.
    // Rebuild (or build for the first time) if the panel is enabled.
    if (useDemVisualizationStore.getState().enabled) {
      this.buildDemMesh();
    }
  }

  onPointCloudsUnloaded(): void {
    this.clearDemMesh();
  }

  dispose(): void {
    this.clearDemMesh();
    this.unsub?.();
    this.unsub = null;
    this.ctx = null;
  }

  // ── Mesh management ──────────────────────────────────────────────────────────

  private clearDemMesh(): void {
    if (this.demMesh && this.ctx) {
      this.ctx.worldRoot.remove(this.demMesh);
      this.demMesh.geometry.dispose();
      (this.demMesh.material as MeshBasicMaterial).dispose();
    }
    this.demMesh = null;
  }

  private buildDemMesh(): void {
    if (!this.ctx) return;
    const dem = this.ctx.getDem();
    if (!dem) return;

    this.clearDemMesh();

    const { rows, cols, cellSize, xMin, yMin, elevation } = dem.data;
    const { enabled, opacity, wireframe, step } = useDemVisualizationStore.getState();

    const dRows = Math.floor((rows - 1) / step) + 1;
    const dCols = Math.floor((cols - 1) / step) + 1;
    const vCount = dRows * dCols;

    // ── Elevation range for colormap ───────────────────────────────────────────
    let eMin = Infinity, eMax = -Infinity;
    for (const row of elevation)
      for (const e of row) {
        if (e < eMin) eMin = e;
        if (e > eMax) eMax = e;
      }
    const eRange = Math.max(eMax - eMin, 0.01);

    // ── Vertex positions + vertex colours ─────────────────────────────────────
    const positions = new Float32Array(vCount * 3);
    const colors    = new Float32Array(vCount * 3);

    for (let ri = 0; ri < dRows; ri++) {
      const r = Math.min(ri * step, rows - 1);
      for (let ci = 0; ci < dCols; ci++) {
        const c  = Math.min(ci * step, cols - 1);
        const vi = ri * dCols + ci;
        const e  = elevation[r][c];

        positions[vi * 3]     = xMin + (c + 0.5) * cellSize;
        positions[vi * 3 + 1] = e;
        positions[vi * 3 + 2] = yMin + (r + 0.5) * cellSize;

        const [cr, cg, cb] = terrainColor((e - eMin) / eRange);
        colors[vi * 3]     = cr;
        colors[vi * 3 + 1] = cg;
        colors[vi * 3 + 2] = cb;
      }
    }

    // ── Triangle indices ───────────────────────────────────────────────────────
    const indexArr = new Uint32Array((dRows - 1) * (dCols - 1) * 6);
    let idx = 0;
    for (let ri = 0; ri < dRows - 1; ri++) {
      for (let ci = 0; ci < dCols - 1; ci++) {
        const a = ri * dCols + ci;
        const b = a + 1;
        const c = (ri + 1) * dCols + ci;
        const d = c + 1;
        // Two triangles per quad
        indexArr[idx++] = a; indexArr[idx++] = b; indexArr[idx++] = d;
        indexArr[idx++] = a; indexArr[idx++] = d; indexArr[idx++] = c;
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setAttribute('color',    new Float32BufferAttribute(colors,    3));
    // Must wrap in BufferAttribute — passing a raw TypedArray to setIndex bypasses
    // the BufferAttribute constructor and leaves onUploadCallback undefined, which
    // crashes the PotreeRenderer's geometry upload loop.
    const indexTyped = indexArr.length > 65535 ? indexArr : new Uint16Array(indexArr);
    geo.setIndex(new BufferAttribute(indexTyped, 1));
    geo.computeVertexNormals();
    geo.computeBoundingBox();

    const mat = new MeshBasicMaterial({
      vertexColors: true,
      transparent:  true,
      opacity,
      side:         DoubleSide,
      depthWrite:   false,
      wireframe,
    });

    this.demMesh = new Mesh(geo, mat);
    this.demMesh.name        = 'dem-visualization';
    this.demMesh.renderOrder = 1;
    this.demMesh.visible     = enabled;
    this.ctx.worldRoot.add(this.demMesh);
  }
}
