/**
 * Filters the Three.js scene before a secondary (2D) slab render so that:
 *  - The shape-editor UI (handles, highlights) is hidden.
 *  - Static obstacle box wireframes that don't intersect the slab are hidden.
 *  - Polygon annotation fills are hidden; outlines are replaced with geometry
 *    showing only what passes through the slab volume:
 *      • halfDepth >= 0.5 m  →  clipped LineSegments (the actual edge fragments)
 *      • halfDepth <  0.5 m  →  one Point per intersecting edge (pierce point at
 *                                the midpoint of the clipped fragment), very small
 *
 * Returns a restore function — call it after the secondary render completes.
 */

import {
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Object3D,
  Points,
  PointsMaterial,
  Scene,
  Vector3,
} from 'three';
import type { Matrix4 } from 'three';
import type { IClipBox } from 'potree-core';

// ── OBB intersection ──────────────────────────────────────────────────────────

const UNIT_BOX = new Box3(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5));

/**
 * Check whether a world-space AABB intersects the oriented slab.
 * Transforms the 8 AABB corners into slab-local unit-cube space and checks
 * their AABB against [-0.5, 0.5]³.
 */
function worldBoxIntersectsSlab(worldBox: Box3, slabInverse: Matrix4): boolean {
  const localBox = new Box3();
  const p = new Vector3();
  const { min, max } = worldBox;
  for (const x of [min.x, max.x])
    for (const y of [min.y, max.y])
      for (const z of [min.z, max.z])
        localBox.expandByPoint(p.set(x, y, z).applyMatrix4(slabInverse));
  return localBox.intersectsBox(UNIT_BOX);
}

// ── 3-D Liang–Barsky segment clip ─────────────────────────────────────────────

/**
 * Clip segment a→b (in slab-local unit-cube space) against [-0.5, 0.5]³.
 * Returns [tNear, tFar] ∈ [0,1] or null if the segment is fully outside.
 */
function clipSegmentToUnitBox(a: Vector3, b: Vector3): [number, number] | null {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  let tNear = 0, tFar = 1;

  const checks: [number, number][] = [
    [-dx,  a.x + 0.5],   // left   x = -0.5
    [ dx,  0.5 - a.x],   // right  x = +0.5
    [-dy,  a.y + 0.5],   // bottom y = -0.5
    [ dy,  0.5 - a.y],   // top    y = +0.5
    [-dz,  a.z + 0.5],   // back   z = -0.5
    [ dz,  0.5 - a.z],   // front  z = +0.5
  ];

  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-10) {
      if (q < 0) return null;
    } else if (p < 0) {
      tNear = Math.max(tNear, q / p);
    } else {
      tFar = Math.min(tFar, q / p);
    }
    if (tNear > tFar) return null;
  }
  return [tNear, tFar];
}

// ── Main export ───────────────────────────────────────────────────────────────

export function filterSceneForSlabRender(
  scene: Scene,
  clipBox: IClipBox,
  halfDepth: number,
): () => void {
  const restores: Array<() => void> = [];

  const hide = (obj: Object3D): void => {
    if (!obj.visible) return;
    obj.visible = false;
    restores.push(() => { obj.visible = true; });
  };

  // ── 1. Shape editor UI (handles, highlights, pickers) ────────────────────────
  const editorRoot = scene.getObjectByName('shape-editor-root');
  if (editorRoot) hide(editorRoot);

  // ── 2. Static obstacle wireframe boxes ───────────────────────────────────────
  const obstaclesRoot = scene.getObjectByName('static-obstacles');
  if (obstaclesRoot) {
    for (const annotGroup of obstaclesRoot.children) {
      if (!annotGroup.userData.annotationId) { hide(annotGroup); continue; }
      const box = new Box3().setFromObject(annotGroup);
      if (box.isEmpty() || !worldBoxIntersectsSlab(box, clipBox.inverse)) {
        hide(annotGroup);
      }
      // Intersecting boxes shown as-is — project cleanly in 2D.
    }
  }

  // ── 3. Polygon annotation outlines ───────────────────────────────────────────
  // When halfDepth < 0.5 m (total buffer < 1 m) the slab is thin enough that
  // each polygon edge either misses it entirely or pierces it at essentially a
  // single point. In that case we render one tiny Point per intersecting edge
  // (the midpoint of the clipped fragment) rather than a line segment.
  const pointMode = halfDepth < 0.75;

  const polygonsRoot = scene.getObjectByName('polygon-annotations');
  if (polygonsRoot) {
    for (const annotGroup of polygonsRoot.children) {
      let outline: Object3D | null = null;
      let fill: Object3D | null = null;
      for (const child of annotGroup.children) {
        if (child.type === 'LineLoop') outline = child;
        if (child.type === 'Mesh')     fill    = child;
      }

      // No outline = draft/preview group; hide entirely.
      if (!outline) { hide(annotGroup); continue; }

      // Always hide the fill in the 2D view.
      if (fill) hide(fill);

      // Quick AABB reject.
      const box = new Box3().setFromObject(annotGroup);
      if (box.isEmpty() || !worldBoxIntersectsSlab(box, clipBox.inverse)) {
        hide(annotGroup);
        continue;
      }

      const geo = (outline as any).geometry as BufferGeometry | undefined;
      const posAttr = geo?.getAttribute('position');
      if (!posAttr || posAttr.count < 2) { hide(annotGroup); continue; }

      const n   = posAttr.count;
      const mw  = outline.matrixWorld;
      const inv = clipBox.inverse;
      const wA  = new Vector3(), wB = new Vector3();
      const lA  = new Vector3(), lB = new Vector3();

      // Collect clipped positions — either segment pairs or midpoints.
      const positions: number[] = [];

      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n; // LineLoop: last vertex wraps to first

        wA.set(posAttr.getX(i),    posAttr.getY(i),    posAttr.getZ(i)).applyMatrix4(mw);
        wB.set(posAttr.getX(next), posAttr.getY(next), posAttr.getZ(next)).applyMatrix4(mw);

        lA.copy(wA).applyMatrix4(inv);
        lB.copy(wB).applyMatrix4(inv);

        const clip = clipSegmentToUnitBox(lA, lB);
        if (!clip) continue;

        const [t0, t1] = clip;

        if (pointMode) {
          // Single pierce point: midpoint of the clipped fragment in world space.
          const mid = wA.clone().lerp(wB, (t0 + t1) / 2);
          positions.push(mid.x, mid.y, mid.z);
        } else {
          // Full clipped segment endpoints in world space.
          const cA = wA.clone().lerp(wB, t0);
          const cB = wA.clone().lerp(wB, t1);
          positions.push(cA.x, cA.y, cA.z, cB.x, cB.y, cB.z);
        }
      }

      const wasOutlineVisible = outline.visible;
      outline.visible = false;

      if (positions.length === 0) {
        hide(annotGroup);
        restores.push(() => { outline!.visible = wasOutlineVisible; });
        continue;
      }

      const origMat = (outline as any).material as LineBasicMaterial;
      const clippedGeo = new BufferGeometry();
      clippedGeo.setAttribute('position', new Float32BufferAttribute(positions, 3));

      let visual: LineSegments | Points;

      if (pointMode) {
        const ptMat = new PointsMaterial({
          color: origMat.color,
          size: 3,
          sizeAttenuation: false, // screen-space pixels — stays tiny regardless of zoom
          depthTest: false,
          transparent: true,
          opacity: origMat.opacity ?? 1,
        });
        visual = new Points(clippedGeo, ptMat);
      } else {
        const lineMat = new LineBasicMaterial({
          color: origMat.color,
          opacity: origMat.opacity,
          transparent: origMat.transparent,
          depthTest: false,
        });
        visual = new LineSegments(clippedGeo, lineMat);
      }

      visual.renderOrder = outline.renderOrder;
      annotGroup.add(visual);

      restores.push(() => {
        outline!.visible = wasOutlineVisible;
        annotGroup.remove(visual);
        clippedGeo.dispose();
        (visual.material as LineBasicMaterial | PointsMaterial).dispose();
      });
    }
  }

  return () => { for (const fn of restores) fn(); };
}
