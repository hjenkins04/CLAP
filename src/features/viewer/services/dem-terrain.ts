import {
  Mesh,
  MeshBasicMaterial,
  DoubleSide,
  BufferGeometry,
  Float32BufferAttribute,
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
 * - Elevation lookup at any (x, z) in Three.js Y-up world space
 *
 * Coordinate convention (Y-up, matches pre-transformed point clouds):
 *   DEM JSON xMin/xMax  = east  range  → Three.js X
 *   DEM JSON yMin/yMax  = north range  → Three.js Z
 *   DEM JSON elevation  = elevation    → Three.js Y
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
   * Build a mesh in Three.js Y-up world space.
   *
   * Vertices are placed at cell centres:
   *   position.x = xMin + (col + 0.5) * cellSize   (east)
   *   position.y = elevation[row][col]              (up)
   *   position.z = yMin + (row + 0.5) * cellSize   (north, using JSON "y" axis)
   */
  private static buildMesh(dem: DemData): Mesh {
    const { cols, rows, xMin, yMin, cellSize, elevation } = dem;

    const vertCount = cols * rows;
    const positions = new Float32Array(vertCount * 3);

    for (let ir = 0; ir < rows; ir++) {
      for (let ic = 0; ic < cols; ic++) {
        const vi = ir * cols + ic;
        positions[vi * 3 + 0] = xMin + (ic + 0.5) * cellSize;  // east  → X
        positions[vi * 3 + 1] = elevation[ir][ic];               // elev  → Y
        positions[vi * 3 + 2] = yMin + (ir + 0.5) * cellSize;   // north → Z
      }
    }

    const indices: number[] = [];
    for (let ir = 0; ir < rows - 1; ir++) {
      for (let ic = 0; ic < cols - 1; ic++) {
        const a = ir * cols + ic;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        indices.push(a, b, d, a, d, c);
      }
    }

    const geo = new BufferGeometry();
    geo.setIndex(indices);
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();

    const mat = new MeshBasicMaterial({ visible: false, side: DoubleSide });
    const mesh = new Mesh(geo, mat);
    mesh.name = 'dem-terrain';
    mesh.layers.set(2);
    return mesh;
  }

  /**
   * Look up the elevation (Three.js Y) at a ground-plane position.
   *
   * @param x  Three.js X — east offset in metres
   * @param z  Three.js Z — north offset in metres (stored as "y" in the DEM JSON)
   * Returns null if the position is outside the DEM extent.
   */
  getElevation(x: number, z: number): number | null {
    return this.sampleElevation(x, z, false);
  }

  /**
   * Same as getElevation but clamps out-of-bounds positions to the nearest edge cell.
   */
  getElevationClamped(x: number, z: number): number {
    return this.sampleElevation(x, z, true) ?? 0;
  }

  private sampleElevation(x: number, z: number, clamp: boolean): number | null {
    const { xMin, yMin, cellSize, cols, rows, elevation } = this.data;
    // xMin = east min, yMin = north min (JSON "y" axis = Three.js Z)
    let gx = (x - xMin) / cellSize - 0.5;
    let gy = (z - yMin) / cellSize - 0.5;

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
