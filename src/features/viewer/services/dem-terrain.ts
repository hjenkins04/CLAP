import {
  PlaneGeometry,
  Mesh,
  MeshBasicMaterial,
  DoubleSide,
  BufferAttribute,
} from 'three';
import { electronFetch } from './electron-fetch';

/**
 * JSON format produced by generate-dem.py
 */
export interface DemData {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  cellSize: number;
  cols: number;
  rows: number;
  /** Row-major grid: elevation[row][col] */
  elevation: number[][];
}

/**
 * DEM terrain service — loads a JSON DEM and provides:
 * - A Three.js mesh for raycasting (invisible by default)
 * - Elevation lookup at any (x,y) in local space
 *
 * The mesh lives in LiDAR local space (Z-up), same as point cloud geometry.
 */
export class DemTerrain {
  readonly data: DemData;
  readonly mesh: Mesh;

  private constructor(data: DemData, mesh: Mesh) {
    this.data = data;
    this.mesh = mesh;
  }

  static async load(url: string): Promise<DemTerrain> {
    const resp = await electronFetch(url);
    if (!resp.ok) throw new Error(`Failed to load DEM: ${resp.statusText}`);
    const data: DemData = await resp.json();
    const mesh = DemTerrain.buildMesh(data);
    return new DemTerrain(data, mesh);
  }

  /**
   * Build a PlaneGeometry in the XY plane (Z = elevation) for local LiDAR space.
   * The geometry has (cols) x (rows) vertices with Z values from the DEM grid.
   */
  private static buildMesh(dem: DemData): Mesh {
    const { cols, rows, xMin, yMin, xMax, yMax, elevation } = dem;
    const width = xMax - xMin;
    const height = yMax - yMin;

    // PlaneGeometry(width, height, widthSegments, heightSegments)
    // Creates a plane in XY with (widthSegments+1) x (heightSegments+1) vertices
    const geo = new PlaneGeometry(width, height, cols - 1, rows - 1);

    // PlaneGeometry creates vertices in X=[−w/2, w/2], Y=[h/2, −h/2], Z=0
    // We need to:
    //   1. Offset X/Y so they match [xMin, xMax] / [yMin, yMax]
    //   2. Set Z from the DEM elevation grid
    const pos = geo.getAttribute('position') as BufferAttribute;
    const centerX = (xMin + xMax) / 2;
    const centerY = (yMin + yMax) / 2;

    for (let iy = 0; iy < rows; iy++) {
      for (let ix = 0; ix < cols; ix++) {
        const vertIdx = iy * cols + ix;
        // PlaneGeometry goes top-to-bottom (Y: h/2 → −h/2),
        // but our grid row 0 = yMin (bottom). So flip the row index.
        const demRow = rows - 1 - iy;
        const z = elevation[demRow][ix];

        // Shift from centered coordinates to local LiDAR coordinates
        pos.setX(vertIdx, pos.getX(vertIdx) + centerX);
        pos.setY(vertIdx, pos.getY(vertIdx) + centerY);
        pos.setZ(vertIdx, z);
      }
    }

    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();

    const mat = new MeshBasicMaterial({
      visible: false, // invisible — only used for raycasting
      side: DoubleSide,
    });

    const mesh = new Mesh(geo, mat);
    mesh.name = 'dem-terrain';
    // Don't render at all — we only use it for raycasting
    mesh.layers.set(2);
    return mesh;
  }

  /**
   * Look up elevation at a given (x, y) in local LiDAR space.
   * Uses bilinear interpolation between grid cells.
   * Returns null if outside the DEM extent.
   */
  getElevation(x: number, y: number): number | null {
    return this.sampleElevation(x, y, false);
  }

  /**
   * Same as getElevation but clamps to the nearest edge cell instead of
   * returning null for out-of-bounds coordinates.
   */
  getElevationClamped(x: number, y: number): number {
    return this.sampleElevation(x, y, true) ?? 0;
  }

  private sampleElevation(x: number, y: number, clamp: boolean): number | null {
    const { xMin, yMin, cellSize, cols, rows, elevation } = this.data;

    let gx = (x - xMin) / cellSize - 0.5;
    let gy = (y - yMin) / cellSize - 0.5;

    if (!clamp) {
      if (gx < 0 || gy < 0 || gx >= cols - 1 || gy >= rows - 1) {
        return null;
      }
    } else {
      gx = Math.max(0, Math.min(cols - 1 - 1e-6, gx));
      gy = Math.max(0, Math.min(rows - 1 - 1e-6, gy));
    }

    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;

    const z00 = elevation[iy][ix];
    const z10 = elevation[iy][Math.min(ix + 1, cols - 1)];
    const z01 = elevation[Math.min(iy + 1, rows - 1)][ix];
    const z11 = elevation[Math.min(iy + 1, rows - 1)][Math.min(ix + 1, cols - 1)];

    return (
      z00 * (1 - fx) * (1 - fy) +
      z10 * fx * (1 - fy) +
      z01 * (1 - fx) * fy +
      z11 * fx * fy
    );
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}
