/**
 * Utilities for sampling a user-drawn centreline polyline at uniform spacing
 * and generating perpendicular cross-section frames.
 */

import type { SectionFrame, Vec3 } from '../road-extraction-types';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sample a polyline at `spacing` metre intervals, producing one SectionFrame
 * per sample.  The frame's lateral vector points to the LEFT when facing
 * the tangent direction (right-hand rule, Y-up world).
 *
 * @param points  World-space vertices of the user's centreline.
 * @param spacing  Spacing between cross-sections in metres.
 * @returns        Array of SectionFrames along the centreline.
 */
export function sampleCenterline(
  points: Vec3[],
  spacing: number,
): SectionFrame[] {
  if (points.length < 2 || spacing <= 0) return [];

  const frames: SectionFrame[] = [];

  // Build cumulative arc-length table
  const arcLengths: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dz = points[i].z - points[i - 1].z;
    arcLengths.push(arcLengths[i - 1] + Math.sqrt(dx * dx + dz * dz));
  }

  const totalLength = arcLengths[arcLengths.length - 1];
  if (totalLength < spacing) return [];

  // Walk along the polyline at `spacing` intervals
  let segIdx   = 0;
  let distAlongSeg = 0;
  let travelled    = 0;

  while (travelled <= totalLength) {
    // Find the segment that contains this arc-length
    while (
      segIdx < points.length - 2 &&
      arcLengths[segIdx + 1] <= travelled
    ) {
      segIdx++;
    }

    const A = points[segIdx];
    const B = points[segIdx + 1];
    const segLen = arcLengths[segIdx + 1] - arcLengths[segIdx];

    distAlongSeg = segLen > 0
      ? (travelled - arcLengths[segIdx]) / segLen
      : 0;

    // Interpolated world position
    const px = A.x + (B.x - A.x) * distAlongSeg;
    const py = A.y + (B.y - A.y) * distAlongSeg;
    const pz = A.z + (B.z - A.z) * distAlongSeg;

    // Tangent: forward direction in XZ, normalised
    const rawTx = B.x - A.x;
    const rawTz = B.z - A.z;
    const tLen  = Math.sqrt(rawTx * rawTx + rawTz * rawTz);
    const tx = tLen > 0 ? rawTx / tLen : 1;
    const tz = tLen > 0 ? rawTz / tLen : 0;

    // Lateral: perpendicular left in XZ ( rotate tangent 90° CCW )
    const lx = -tz;
    const lz =  tx;

    frames.push({
      position: { x: px, y: py, z: pz },
      tangent:  { x: tx, z: tz },
      lateral:  { x: lx, z: lz },
    });

    travelled += spacing;
  }

  return frames;
}

/**
 * Total arc-length of a polyline in XZ (metres).
 */
export function polylineLength(points: Vec3[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dz = points[i].z - points[i - 1].z;
    len += Math.sqrt(dx * dx + dz * dz);
  }
  return len;
}
