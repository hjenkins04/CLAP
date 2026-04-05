/**
 * 2-D XZ spatial grid index over world-space point cloud data.
 *
 * Built once per "Extract" click from the currently visible Potree nodes,
 * then queried cheaply for each perpendicular slab.
 */

export interface GridPoint {
  wx: number;
  wy: number;
  wz: number;
  /** Normalised intensity in the range [0, 255]. */
  intensity: number;
}

export class PointGridIndex {
  private readonly cells = new Map<string, GridPoint[]>();
  private readonly cellSize: number;
  /** Axis-aligned bounding box of all inserted points. */
  private minX = Infinity;
  private maxX = -Infinity;
  private minZ = Infinity;
  private maxZ = -Infinity;
  private _count = 0;

  constructor(cellSize = 0.5) {
    this.cellSize = cellSize;
  }

  get count(): number { return this._count; }

  // ── Building ──────────────────────────────────────────────────────────────

  /**
   * Insert a single world-space point.
   * Faster variant: pass pre-transformed coordinates.
   */
  insert(wx: number, wy: number, wz: number, intensity: number): void {
    const k = this.cellKey(wx, wz);
    let cell = this.cells.get(k);
    if (!cell) { cell = []; this.cells.set(k, cell); }
    cell.push({ wx, wy, wz, intensity });
    this._count++;
    if (wx < this.minX) this.minX = wx;
    if (wx > this.maxX) this.maxX = wx;
    if (wz < this.minZ) this.minZ = wz;
    if (wz > this.maxZ) this.maxZ = wz;
  }

  /**
   * Bulk-insert from a Potree geometry node.
   *
   * @param positions  Float32Array (x,y,z interleaved) in node-local space.
   * @param intensities Float32Array of raw intensity values (same count).
   * @param matrixElements  16-element column-major Float32Array (matrixWorld.elements).
   * @param intensityMin  Lower bound of the cloud's intensity range (for normalisation).
   * @param intensityMax  Upper bound of the cloud's intensity range.
   * @param count  Number of points in this node.
   */
  insertFromNode(
    positions: Float32Array,
    intensities: Float32Array | null,
    matrixElements: number[],
    intensityMin: number,
    intensityMax: number,
    count: number,
  ): void {
    const me = matrixElements;
    const iRange = intensityMax - intensityMin || 1;

    for (let i = 0; i < count; i++) {
      const lx = positions[i * 3];
      const ly = positions[i * 3 + 1];
      const lz = positions[i * 3 + 2];

      // Apply matrixWorld (column-major, no perspective division needed)
      const wx = me[0] * lx + me[4] * ly + me[8]  * lz + me[12];
      const wy = me[1] * lx + me[5] * ly + me[9]  * lz + me[13];
      const wz = me[2] * lx + me[6] * ly + me[10] * lz + me[14];

      // Normalise intensity to [0, 255]
      const rawI = intensities ? intensities[i] : 128;
      const normI = ((rawI - intensityMin) / iRange) * 255;

      this.insert(wx, wy, wz, normI);
    }
  }

  // ── Querying ──────────────────────────────────────────────────────────────

  /**
   * Return all points whose world XZ position falls within the given
   * axis-aligned rectangle (inclusive).  No height filtering here — callers
   * do that after projection.
   */
  queryBox(minX: number, maxX: number, minZ: number, maxZ: number): GridPoint[] {
    const result: GridPoint[] = [];
    const cxMin = Math.floor(minX / this.cellSize);
    const cxMax = Math.floor(maxX / this.cellSize);
    const czMin = Math.floor(minZ / this.cellSize);
    const czMax = Math.floor(maxZ / this.cellSize);

    for (let cx = cxMin; cx <= cxMax; cx++) {
      for (let cz = czMin; cz <= czMax; cz++) {
        const pts = this.cells.get(`${cx},${cz}`);
        if (!pts) continue;
        for (const p of pts) {
          if (p.wx >= minX && p.wx <= maxX && p.wz >= minZ && p.wz <= maxZ) {
            result.push(p);
          }
        }
      }
    }
    return result;
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  /** Compute mean and standard deviation of intensities in an AABB. */
  intensityStats(minX: number, maxX: number, minZ: number, maxZ: number): {
    mean: number;
    std: number;
    count: number;
  } {
    const pts = this.queryBox(minX, maxX, minZ, maxZ);
    if (pts.length === 0) return { mean: 128, std: 30, count: 0 };

    let sum = 0;
    for (const p of pts) sum += p.intensity;
    const mean = sum / pts.length;

    let sqSum = 0;
    for (const p of pts) sqSum += (p.intensity - mean) ** 2;
    const std = Math.sqrt(sqSum / pts.length);

    return { mean, std, count: pts.length };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private cellKey(wx: number, wz: number): string {
    return `${Math.floor(wx / this.cellSize)},${Math.floor(wz / this.cellSize)}`;
  }
}
