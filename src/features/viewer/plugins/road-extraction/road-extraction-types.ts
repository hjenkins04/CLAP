/** All TypeScript types for the Road Extraction plugin. */

// ── Phase state machine ───────────────────────────────────────────────────────

/**
 * Full state machine for one extraction session:
 *
 *   idle
 *    └─[Draw Centerline]──► drawing
 *                               ├─[Esc]──────────────────────────────► idle
 *                               └─[Enter / double-click]─────────────► extracting
 *                                                                           ├─[cancel]─► drawing  (centerline kept)
 *                                                                           └─[done]───► reviewing
 *   reviewing
 *    ├─[param change]──────────────────────────────────────────────────► extracting  (re-run)
 *    ├─[Edit Boundaries]──────────────────────────────────────────────► editing-boundary
 *    ├─[Accept]───────────────────────────────────────────────────────► committed
 *    ├─[Redraw]───────────────────────────────────────────────────────► drawing  (clear preview)
 *    └─[Cancel]───────────────────────────────────────────────────────► idle
 *
 *   editing-boundary
 *    ├─[Done Editing]─────────────────────────────────────────────────► reviewing
 *    ├─[Accept]───────────────────────────────────────────────────────► committed
 *    └─[Cancel]───────────────────────────────────────────────────────► reviewing
 *
 *   committed
 *    ├─[Continue / New Chunk]─────────────────────────────────────────► drawing  (prior loaded)
 *    └─[Done]─────────────────────────────────────────────────────────► idle
 */
export type RoadExtractionPhase =
  | 'idle'
  | 'drawing'            // user is placing centerline vertices
  | 'shaping'            // user adjusting the initial left/right road-edge polygon
  | 'extracting'         // algorithm is running (async)
  | 'reviewing'          // result shown, params adjustable
  | 'editing-boundary'   // user dragging individual boundary vertices
  | 'committed';         // chunk accepted, stored in result list

// ── Extraction parameters ─────────────────────────────────────────────────────

export interface ExtractionParams {
  /** Spacing between perpendicular cross-sections (metres). Default 0.5 */
  sectionSpacing: number;
  /** Half-depth of each slab in the tangent direction (metres). Default 0.15 */
  slabHalfDepth: number;
  /** Maximum lateral search distance from centreline on each side (metres). Default 15 */
  maxHalfWidth: number;
  /** Minimum upward height step to classify as a curb (metres). Default 0.06 */
  curbHeightMin: number;
  /** Maximum upward height allowed before it's a wall, not road (metres). Default 0.40 */
  curbHeightMax: number;
  /** Downward height drop that signals an embankment / edge (metres). Default 0.12 */
  dropOffThreshold: number;
  /** Intensity change (0-255 scale) that signals a surface-type transition. Default 50 */
  intensityThreshold: number;
  /** Minimum stable points before the intensity edge can fire. Default 5 */
  minStablePoints: number;
  /** Median-filter window (number of sections) for boundary smoothing. Default 9 */
  smoothingWindow: number;
  /** Height range above the centreline to include in the slab (metres). Default 0.5 */
  slabHeightAbove: number;
  /** Height range below the centreline to include in the slab (metres). Default 0.5 */
  slabHeightBelow: number;

  // ── Shaping-phase params ──────────────────────────────────────────────────
  /** Total initial road width for the shaping polygon (metres). Default 8.0 */
  roadWidth: number;
  /**
   * Arc-length spacing used to upsample the *raw drawn* centreline before
   * smoothing (metres). Finer = more source vertices fed into Chaikin.
   * Default 0.25 (half the post-smooth spacing).
   */
  centerlineUpsampleSpacing: number;
  /** Arc-length spacing used to re-sample the smoothed centreline before
   * offsetting into left/right edge lines (metres). Default 0.5 */
  upsampleSpacing: number;
  /** Number of Chaikin corner-cutting passes for centreline smoothing. Default 3 */
  smoothingPasses: number;
  /**
   * Half-width of the local search window around each shaping-line hint
   * (metres). When >0 the extractor only looks within ±window of the
   * pre-defined edge rather than the full maxHalfWidth. Default 2.5
   */
  shapingSearchWindow: number;
}

export const DEFAULT_PARAMS: ExtractionParams = {
  sectionSpacing:      0.5,
  slabHalfDepth:       0.15,
  maxHalfWidth:        15,
  curbHeightMin:       0.06,
  curbHeightMax:       0.40,
  dropOffThreshold:    0.12,
  intensityThreshold:  50,
  minStablePoints:     5,
  smoothingWindow:     9,
  slabHeightAbove:     0.5,
  slabHeightBelow:     0.5,
  roadWidth:                  8.0,
  centerlineUpsampleSpacing:  0.25,
  upsampleSpacing:            0.5,
  smoothingPasses:     3,
  shapingSearchWindow: 2.5,
};

// ── Geometry ──────────────────────────────────────────────────────────────────

/** A sample frame along the centreline (position + orthonormal basis). */
export interface SectionFrame {
  /** World-space centre of this cross-section. */
  position: { x: number; y: number; z: number };
  /** Unit vector along the road direction (XZ plane). */
  tangent: { x: number; z: number };
  /**
   * Unit vector perpendicular to tangent in the XZ plane, pointing left
   * (when facing the tangent direction).
   */
  lateral: { x: number; z: number };
}

/** One point projected into a cross-section's local coordinate system. */
export interface SectionPoint {
  /** Signed lateral distance from centreline (+ve = left). */
  lateralDist: number;
  /** World-space Y (elevation). */
  height: number;
  /** Normalised intensity [0–255]. */
  intensity: number;
  /** Original world X for back-projection. */
  worldX: number;
  /** Original world Z for back-projection. */
  worldZ: number;
}

/** Result of analysing one cross-section. */
export interface SectionResult {
  frameIdx: number;
  /** Lateral distance to the detected left boundary (null = not found). */
  leftDist:  number | null;
  /** Lateral distance to the detected right boundary (null = not found). */
  rightDist: number | null;
  /** World-space position of the left boundary point. */
  leftWorld:  { x: number; y: number; z: number } | null;
  /** World-space position of the right boundary point. */
  rightWorld: { x: number; y: number; z: number } | null;
  /** Whether the left edge was detected as a curb (height discontinuity). */
  hasCurbLeft:  boolean;
  /** Whether the right edge was detected as a curb (height discontinuity). */
  hasCurbRight: boolean;
}

// ── Prior information ─────────────────────────────────────────────────────────

/**
 * Statistics learned from a previously accepted extraction chunk.
 * Used to improve detection on the next chunk.
 */
export interface RoadPrior {
  /** Mean intensity of the accepted road surface. */
  intensityMean: number;
  /** Standard deviation of road surface intensity. */
  intensityStd:  number;
  /** Average accepted half-width on the left side. */
  halfWidthLeft:  number;
  /** Average accepted half-width on the right side. */
  halfWidthRight: number;
  /** True when curb signal fired consistently (>50 % of sections). */
  hasCurbs: boolean;
  /** Mean height of detected curbs. */
  curbHeightMean: number;
}

// ── Committed result ──────────────────────────────────────────────────────────

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A single accepted extraction chunk stored in the result list. */
export interface RoadBoundary {
  id: string;
  /** Label shown in the panel (e.g. "Road 1"). */
  label: string;
  /** The centreline points the user drew. */
  centerlinePoints: Vec3[];
  /** Smoothed left boundary points. */
  leftPoints: Vec3[];
  /** Smoothed right boundary points. */
  rightPoints: Vec3[];
  /** Prior snapshot at acceptance time (for debugging / re-use). */
  prior: RoadPrior;
  /** Params used for this extraction. */
  params: ExtractionParams;
  createdAt: number;
  visible: boolean;
}

// ── Extraction progress ───────────────────────────────────────────────────────

export interface ExtractionProgress {
  /** Sections processed so far. */
  done: number;
  /** Total sections to process. */
  total: number;
}
