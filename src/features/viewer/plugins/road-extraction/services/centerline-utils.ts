/**
 * Centreline geometry utilities for the shaping phase.
 *
 * Pipeline:
 *   raw drawn points
 *     → upsamplePolyline   (uniform arc-length resampling)
 *     → chaikinSmooth      (corner cutting, N passes, preserves endpoints)
 *     → offsetPolyline     (lateral XZ offset for left / right edges)
 *
 *   After user editing:
 *     deriveCenterline     (midpoints of resampled left + right)
 *     projectLineToFrames  (per-frame signed lateral distance hints)
 */

import type { Vec3, SectionFrame } from '../road-extraction-types';

// ── Arc-length helpers ────────────────────────────────────────────────────────

function buildArcTable(points: Vec3[]): number[] {
  const t: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dz = points[i].z - points[i - 1].z;
    t.push(t[i - 1] + Math.sqrt(dx * dx + dz * dz));
  }
  return t;
}

function sampleAt(points: Vec3[], arc: number[], s: number): Vec3 {
  const clamped = Math.max(0, Math.min(s, arc[arc.length - 1]));
  let lo = 0, hi = arc.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arc[mid] <= clamped) lo = mid; else hi = mid - 1;
  }
  const span = arc[lo + 1] - arc[lo];
  const t = span > 1e-10 ? (clamped - arc[lo]) / span : 0;
  return {
    x: points[lo].x + t * (points[lo + 1].x - points[lo].x),
    y: points[lo].y + t * (points[lo + 1].y - points[lo].y),
    z: points[lo].z + t * (points[lo + 1].z - points[lo].z),
  };
}

// ── Resampling ────────────────────────────────────────────────────────────────

/**
 * Resample a polyline to uniform arc-length spacing.
 * Preserves the exact first and last points.
 */
export function upsamplePolyline(points: Vec3[], spacing: number): Vec3[] {
  if (points.length < 2 || spacing <= 0) return [...points];

  const arc = buildArcTable(points);
  const total = arc[arc.length - 1];
  if (total < 1e-6) return [...points];

  const result: Vec3[] = [];
  for (let s = 0; s <= total; s += spacing) {
    result.push(sampleAt(points, arc, s));
  }

  // Always include the exact last point
  const last = points[points.length - 1];
  const prev = result[result.length - 1];
  if (Math.abs(prev.x - last.x) > 1e-3 || Math.abs(prev.z - last.z) > 1e-3) {
    result.push({ ...last });
  }
  return result;
}

/**
 * Resample a polyline to exactly N evenly-spaced points.
 */
export function resampleToCount(points: Vec3[], count: number): Vec3[] {
  if (points.length < 2 || count < 2) return [...points];

  const arc = buildArcTable(points);
  const total = arc[arc.length - 1];
  const result: Vec3[] = [];

  for (let j = 0; j < count; j++) {
    result.push(sampleAt(points, arc, (j / (count - 1)) * total));
  }
  return result;
}

// ── Smoothing ─────────────────────────────────────────────────────────────────

/**
 * Chaikin corner-cutting smoothing.
 * Each pass roughly doubles the point count; endpoints are preserved.
 * For N passes, output has approximately (2^N × input) points — caller should
 * re-sample to a target density after smoothing.
 */
export function chaikinSmooth(points: Vec3[], passes: number): Vec3[] {
  if (points.length < 3 || passes <= 0) return [...points];

  let pts = [...points];
  for (let p = 0; p < passes; p++) {
    const next: Vec3[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      next.push({
        x: 0.75 * pts[i].x + 0.25 * pts[i + 1].x,
        y: 0.75 * pts[i].y + 0.25 * pts[i + 1].y,
        z: 0.75 * pts[i].z + 0.25 * pts[i + 1].z,
      });
      next.push({
        x: 0.25 * pts[i].x + 0.75 * pts[i + 1].x,
        y: 0.25 * pts[i].y + 0.75 * pts[i + 1].y,
        z: 0.25 * pts[i].z + 0.75 * pts[i + 1].z,
      });
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

// ── Offset ────────────────────────────────────────────────────────────────────

/**
 * Offset a polyline laterally in the XZ plane.
 * +ve lateralDist = left (CCW when viewed from above).
 * -ve lateralDist = right.
 * Elevation (Y) is preserved per-point.
 */
export function offsetPolyline(points: Vec3[], lateralDist: number): Vec3[] {
  if (points.length < 2) return [...points];

  return points.map((pt, i) => {
    const prev = i > 0 ? points[i - 1] : points[i];
    const next = i < points.length - 1 ? points[i + 1] : points[i];

    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const len = Math.sqrt(tx * tx + tz * tz);
    if (len < 1e-8) return { ...pt };

    // Lateral = 90° CCW of tangent in XZ
    const lx = -tz / len;
    const lz =  tx / len;

    return {
      x: pt.x + lx * lateralDist,
      y: pt.y,
      z: pt.z + lz * lateralDist,
    };
  });
}

// ── Centreline derivation ─────────────────────────────────────────────────────

/**
 * Re-derive the centreline as the midpoints of corresponding left/right edge
 * points after resampling both to the same point count.
 */
export function deriveCenterline(left: Vec3[], right: Vec3[]): Vec3[] {
  if (left.length < 2 || right.length < 2) return [];

  const count = Math.max(left.length, right.length);
  const l = resampleToCount(left, count);
  const r = resampleToCount(right, count);

  return l.map((lp, i) => ({
    x: (lp.x + r[i].x) / 2,
    y: (lp.y + r[i].y) / 2,
    z: (lp.z + r[i].z) / 2,
  }));
}

// ── Frame projection ──────────────────────────────────────────────────────────

/**
 * For each section frame, find the closest point on the given polyline and
 * return the signed lateral distance from the frame origin to that point.
 *
 * Used to pass pre-defined edge positions as hints to the extraction algorithm
 * so it can perform a narrow local search around the expected boundary.
 *
 * Returns null for frames where no line point falls within maxSearchDist.
 */
export function projectLineToFrames(
  line: Vec3[],
  frames: SectionFrame[],
  maxSearchDist = 25,
): (number | null)[] {
  if (line.length < 2) return frames.map(() => null);

  return frames.map((frame) => {
    let bestLat: number | null = null;
    let bestDistSq = maxSearchDist * maxSearchDist;

    for (let i = 0; i < line.length - 1; i++) {
      const ax = line[i].x,     az = line[i].z;
      const bx = line[i + 1].x, bz = line[i + 1].z;
      const px = frame.position.x, pz = frame.position.z;

      const abx = bx - ax, abz = bz - az;
      const apx = px - ax, apz = pz - az;
      const abLen2 = abx * abx + abz * abz;
      const t = abLen2 > 1e-10
        ? Math.max(0, Math.min(1, (apx * abx + apz * abz) / abLen2))
        : 0;

      const cx = ax + t * abx;
      const cz = az + t * abz;
      const dx = cx - px, dz = cz - pz;
      const distSq = dx * dx + dz * dz;

      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestLat = dx * frame.lateral.x + dz * frame.lateral.z;
      }
    }

    return bestLat;
  });
}
