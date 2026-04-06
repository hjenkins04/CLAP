/**
 * Cross-section edge-detection algorithm.
 *
 * For each SectionFrame along the centreline we:
 *   1. Query the spatial grid for points within the perpendicular slab.
 *   2. Project each hit point into (lateralDist, height, intensity).
 *   3. March outward from the centre on both sides, stopping when a boundary
 *      signal fires (curb, drop-off, or intensity transition).
 *   4. Smooth the raw per-section results with a 1-D median filter.
 *   5. Gap-fill sections with null results by linear interpolation.
 */

import type {
  SectionFrame,
  SectionPoint,
  SectionResult,
  ExtractionParams,
  RoadPrior,
  Vec3,
} from '../road-extraction-types';
import type { PointGridIndex } from './point-grid-index';

// ── Per-section analysis ─────────────────────────────────────────────────────

/**
 * Analyse one cross-section slab and return detected boundary distances.
 *
 * @param hintLeftDist  Optional: expected left edge lateral distance (metres,
 *   +ve).  When provided the search is narrowed to
 *   [hint − shapingSearchWindow, hint + shapingSearchWindow].
 * @param hintRightDist Optional: expected right edge lateral distance (metres,
 *   -ve).  Same narrowing applies.
 */
export function analyzeSection(
  index: PointGridIndex,
  frame: SectionFrame,
  frameIdx: number,
  params: ExtractionParams,
  prior: RoadPrior | null,
  hintLeftDist?: number | null,
  hintRightDist?: number | null,
): SectionResult {
  // Conservative AABB for the slab (diagonal of the rectangle)
  const diag = Math.sqrt(
    params.slabHalfDepth * params.slabHalfDepth +
    params.maxHalfWidth  * params.maxHalfWidth,
  );
  const minX = frame.position.x - diag;
  const maxX = frame.position.x + diag;
  const minZ = frame.position.z - diag;
  const maxZ = frame.position.z + diag;

  const candidates = index.queryBox(minX, maxX, minZ, maxZ);
  if (candidates.length < 3) {
    return emptyResult(frameIdx);
  }

  const baseY = frame.position.y;
  const sectionPoints: SectionPoint[] = [];

  for (const pt of candidates) {
    const dx = pt.wx - frame.position.x;
    const dz = pt.wz - frame.position.z;

    // Distance along the tangent (slab depth filter)
    const tangDist = dx * frame.tangent.x + dz * frame.tangent.z;
    if (Math.abs(tangDist) > params.slabHalfDepth) continue;

    // Lateral distance (signed: +ve = left, -ve = right)
    const latDist = dx * frame.lateral.x + dz * frame.lateral.z;
    if (Math.abs(latDist) > params.maxHalfWidth) continue;

    // Height filter: exclude underground / roof returns
    const dY = pt.wy - baseY;
    if (dY < -params.slabHeightBelow || dY > params.slabHeightAbove) continue;

    sectionPoints.push({
      lateralDist: latDist,
      height:      pt.wy,
      intensity:   pt.intensity,
      worldX:      pt.wx,
      worldZ:      pt.wz,
    });
  }

  if (sectionPoints.length < 3) return emptyResult(frameIdx);

  // Sort by lateralDist ascending (right → centre → left)
  sectionPoints.sort((a, b) => a.lateralDist - b.lateralDist);

  // Estimate the road-surface height at the centre: median of points within ±1 m
  const centrePts = sectionPoints.filter((p) => Math.abs(p.lateralDist) < 1.0);
  const centreHeight = centrePts.length > 0
    ? medianOf(centrePts.map((p) => p.height))
    : baseY;

  // Ground-level filter: only include returns within the road surface height band.
  // This eliminates cars, pedestrians, low vegetation, and other elevated objects
  // that would otherwise trigger false curb/wall signals in the marching step.
  const groundMax = centreHeight + params.curbHeightMax + 0.10;
  const groundMin = centreHeight - 0.30;
  const groundPts = sectionPoints.filter(
    (p) => p.height >= groundMin && p.height <= groundMax,
  );

  // Min-height bin: for each 0.1 m lateral bin keep only the lowest return.
  // Multiple overlapping returns at the same lateral position (multi-echo, low
  // vegetation floor) otherwise confuse the height-EMA in marchToEdge.
  const binnedLeft  = groundBin(groundPts.filter((p) => p.lateralDist >= 0));
  const binnedRight = groundBin(groundPts.filter((p) => p.lateralDist <= 0)).reverse();

  // When shaping hints are provided, narrow the search to a local window
  // around the expected edge position so the march doesn't traverse the
  // road interior and fire falsely on lane markings or internal features.
  const sw = params.shapingSearchWindow ?? 2.5;

  let leftPts  = binnedLeft;
  let rightPts = binnedRight;
  let leftSeed  = centreHeight;
  let rightSeed = centreHeight;

  if (hintLeftDist != null) {
    const minL = Math.max(0, hintLeftDist - sw);
    const maxL = hintLeftDist + sw;
    const filtered = binnedLeft.filter((p) => p.lateralDist >= minL && p.lateralDist <= maxL);
    if (filtered.length >= 3) {
      leftPts  = filtered;
      leftSeed = filtered.length > 0 ? medianOf(filtered.map((p) => p.height)) : centreHeight;
    }
  }

  if (hintRightDist != null) {
    const minR = hintRightDist - sw;
    const maxR = Math.min(0, hintRightDist + sw);
    const filtered = binnedRight.filter((p) => p.lateralDist >= minR && p.lateralDist <= maxR);
    if (filtered.length >= 3) {
      rightPts  = filtered;
      rightSeed = filtered.length > 0 ? medianOf(filtered.map((p) => p.height)) : centreHeight;
    }
  }

  const leftEdge  = marchToEdge(leftPts,  leftSeed,  params, prior);
  const rightEdge = marchToEdge(rightPts, rightSeed, params, prior);

  return {
    frameIdx,
    leftDist:   leftEdge.edgePt  ? leftEdge.dist   : null,
    rightDist:  rightEdge.edgePt ? rightEdge.dist   : null,
    leftWorld:  leftEdge.edgePt  ? {
      x: leftEdge.edgePt.worldX,
      y: leftEdge.edgePt.height,
      z: leftEdge.edgePt.worldZ,
    } : null,
    rightWorld: rightEdge.edgePt ? {
      x: rightEdge.edgePt.worldX,
      y: rightEdge.edgePt.height,
      z: rightEdge.edgePt.worldZ,
    } : null,
    hasCurbLeft:  leftEdge.hasCurb,
    hasCurbRight: rightEdge.hasCurb,
  };
}

// ── Full-run pipeline ─────────────────────────────────────────────────────────

/**
 * Run the complete extraction pipeline on all section frames.
 *
 * Returns smoothed left and right boundary point arrays, plus
 * per-point curb flags.
 */
export function buildBoundaryFromResults(
  raw: SectionResult[],
  frames: SectionFrame[],
  smoothingWindow: number,
): {
  leftPoints:      Vec3[];
  rightPoints:     Vec3[];
  leftCurbFlags:   boolean[];
  rightCurbFlags:  boolean[];
  updatedPriorHints: { intensityMean: number; intensityStd: number } | null;
} {
  if (raw.length === 0) {
    return {
      leftPoints: [], rightPoints: [],
      leftCurbFlags: [], rightCurbFlags: [],
      updatedPriorHints: null,
    };
  }

  // 1. Gap-fill: linear interpolation for null entries
  const filledLeft  = gapFill(raw.map((r) => r.leftWorld));
  const filledRight = gapFill(raw.map((r) => r.rightWorld));

  // 2. Outlier rejection: nullify sections where the lateral distance deviates
  //    more than 4 m from the local median of ±5 neighbours.  Handles the case
  //    where one section fires at an isolated obstacle (sign post, parked car
  //    remnant) while all surrounding sections agree on the real edge.
  const rawLeftDists  = rejectOutliers(raw.map((r) => r.leftDist),  4.0, 11);
  const rawRightDists = rejectOutliers(raw.map((r) => r.rightDist), 4.0, 11);

  // 3. Smooth world positions with a sliding-median on lateral distances
  //    (operate on the raw dist values, then reconstruct world pts from frames)
  const smoothedLeftDists  = medianFilter(rawLeftDists,  smoothingWindow);
  const smoothedRightDists = medianFilter(rawRightDists, smoothingWindow);

  // 4. Build final world points: prefer filled+smoothed, fall back to raw
  const leftPoints:     Vec3[]    = [];
  const rightPoints:    Vec3[]    = [];
  const leftCurbFlags:  boolean[] = [];
  const rightCurbFlags: boolean[] = [];

  for (let i = 0; i < raw.length; i++) {
    const frame = frames[i];

    // Left
    const ld = smoothedLeftDists[i];
    if (ld !== null && frame) {
      leftPoints.push(lateralDistToWorld(frame, ld, filledLeft[i]?.y ?? frame.position.y));
    } else if (filledLeft[i]) {
      leftPoints.push(filledLeft[i]!);
    }
    leftCurbFlags.push(raw[i]?.hasCurbLeft ?? false);

    // Right
    const rd = smoothedRightDists[i];
    if (rd !== null && frame) {
      rightPoints.push(lateralDistToWorld(frame, rd, filledRight[i]?.y ?? frame.position.y));
    } else if (filledRight[i]) {
      rightPoints.push(filledRight[i]!);
    }
    rightCurbFlags.push(raw[i]?.hasCurbRight ?? false);
  }

  return {
    leftPoints,
    rightPoints,
    leftCurbFlags,
    rightCurbFlags,
    updatedPriorHints: null, // populated by plugin after inspecting road stats
  };
}

// ── Edge marching ─────────────────────────────────────────────────────────────

interface MarchResult {
  dist: number;
  edgePt: SectionPoint | null;
  hasCurb: boolean;
}

/**
 * March outward from the centreline along a sorted array of section points,
 * returning the lateral distance and world point where the road edge is detected.
 *
 * @param pts  Points sorted from centre outward (ascending absolute lateralDist).
 */
function marchToEdge(
  pts: SectionPoint[],
  centreHeight: number,
  params: ExtractionParams,
  prior: RoadPrior | null,
): MarchResult {
  if (pts.length === 0) return { dist: 0, edgePt: null, hasCurb: false };

  // Exponential-moving-average state
  let hEma = centreHeight;
  let iEma = -1;           // -1 = not yet seeded
  let stableCount = 0;
  let lastPt: SectionPoint | null = null;
  let hasCurb = false;

  // Adaptive intensity threshold: tighter when we have a prior
  const iThreshold = prior?.intensityStd != null
    ? Math.max(params.intensityThreshold, prior.intensityStd * 2.5)
    : params.intensityThreshold;

  for (const pt of pts) {
    const absLat = Math.abs(pt.lateralDist);
    if (absLat > params.maxHalfWidth) break;

    const dH = pt.height - hEma;

    // ── SIGNAL 1: Curb — significant upward height step ───────────────────
    if (dH > params.curbHeightMin && dH < params.curbHeightMax) {
      hasCurb = true;
      return { dist: lastPt?.lateralDist ?? 0, edgePt: lastPt, hasCurb };
    }

    // ── SIGNAL 2: Wall / tall obstacle — too large to be a curb ──────────
    if (dH > params.curbHeightMax) {
      // Don't count as curb, but still stop
      return { dist: lastPt?.lateralDist ?? 0, edgePt: lastPt, hasCurb: false };
    }

    // ── SIGNAL 3: Drop-off / embankment ───────────────────────────────────
    if (dH < -params.dropOffThreshold) {
      return { dist: lastPt?.lateralDist ?? 0, edgePt: lastPt, hasCurb };
    }

    // ── SIGNAL 4: Intensity transition (surface-type change) ──────────────
    if (iEma < 0) {
      // Seed on the first point we accept
      iEma = pt.intensity;
    } else {
      const dI = Math.abs(pt.intensity - iEma);
      if (dI > iThreshold && stableCount >= params.minStablePoints) {
        return { dist: lastPt?.lateralDist ?? 0, edgePt: lastPt, hasCurb };
      }
      // Low-pass update (slow adaptation = sensitive to sustained change)
      iEma = 0.25 * pt.intensity + 0.75 * iEma;
    }

    // Update height EMA (very conservative — road should be flat)
    hEma = 0.08 * pt.height + 0.92 * hEma;

    stableCount++;
    lastPt = pt;
  }

  // Reached max width or ran out of points
  return { dist: lastPt?.lateralDist ?? 0, edgePt: lastPt, hasCurb };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function emptyResult(frameIdx: number): SectionResult {
  return {
    frameIdx,
    leftDist:    null,
    rightDist:   null,
    leftWorld:   null,
    rightWorld:  null,
    hasCurbLeft:  false,
    hasCurbRight: false,
  };
}

/**
 * For each 0.1 m lateral bin, keep only the point with the lowest height.
 * This picks the ground-surface return when multiple echoes exist at the same
 * lateral position (e.g. ground + low vegetation canopy).
 * Output is sorted by lateralDist ascending.
 */
function groundBin(pts: SectionPoint[], binSize = 0.1): SectionPoint[] {
  const bins = new Map<number, SectionPoint>();
  for (const pt of pts) {
    const key = Math.round(pt.lateralDist / binSize);
    const existing = bins.get(key);
    if (!existing || pt.height < existing.height) {
      bins.set(key, pt);
    }
  }
  return [...bins.values()].sort((a, b) => a.lateralDist - b.lateralDist);
}

/**
 * Nullify entries that deviate more than `maxDev` from the median of their
 * local ±(window/2) neighbourhood.  Handles isolated outlier sections caused
 * by sign-posts, parked vehicles, or missing data.
 */
function rejectOutliers(
  dists: (number | null)[],
  maxDev: number,
  window: number,
): (number | null)[] {
  const half = Math.floor(window / 2);
  return dists.map((d, i) => {
    if (d === null) return null;
    const neighbours: number[] = [];
    for (let j = Math.max(0, i - half); j <= Math.min(dists.length - 1, i + half); j++) {
      if (dists[j] !== null) neighbours.push(dists[j]!);
    }
    if (neighbours.length < 3) return d;
    const med = median(neighbours);
    return Math.abs(d - med) > maxDev ? null : d;
  });
}

/** Compute the median of an array of numbers. */
function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Alias used by internal helpers that previously called median(). */
const median = medianOf;

/** 1-D median filter over nullable number array. */
function medianFilter(
  arr: (number | null)[],
  window: number,
): (number | null)[] {
  const half   = Math.floor(window / 2);
  const result = new Array<number | null>(arr.length);

  for (let i = 0; i < arr.length; i++) {
    const vals: number[] = [];
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) {
      if (arr[j] !== null) vals.push(arr[j]!);
    }
    result[i] = vals.length > 0 ? median(vals) : null;
  }
  return result;
}

/** Linear-interpolate null entries in a world-point array. */
function gapFill(pts: (Vec3 | null)[]): (Vec3 | null)[] {
  const result = [...pts];
  let i = 0;

  while (i < result.length) {
    if (result[i] !== null) { i++; continue; }

    // Find next valid
    let j = i + 1;
    while (j < result.length && result[j] === null) j++;

    if (i === 0 || j === result.length) {
      // At the ends — can't interpolate, leave null
      i = j;
      continue;
    }

    const start = result[i - 1]!;
    const end   = result[j]!;
    const steps = j - (i - 1);

    for (let k = i; k < j; k++) {
      const t = (k - (i - 1)) / steps;
      result[k] = {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
        z: start.z + (end.z - start.z) * t,
      };
    }
    i = j;
  }

  return result;
}

/**
 * Convert a lateral distance on a section frame back to a world-space point,
 * using a known elevation.
 */
function lateralDistToWorld(frame: SectionFrame, lateralDist: number, worldY: number): Vec3 {
  return {
    x: frame.position.x + frame.lateral.x * lateralDist,
    y: worldY,
    z: frame.position.z + frame.lateral.z * lateralDist,
  };
}
