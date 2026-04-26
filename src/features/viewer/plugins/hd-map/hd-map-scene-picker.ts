/**
 * HdMapScenePicker — handles:
 *   1. Screen-space element picking (click on a line in the 3D view)
 *   2. Selection highlight overlay with fat lines + glow effect
 *
 * Highlight uses Line2 (three.js extras) for actual pixel-width lines.
 * Two layers: a thin bright core line + a wider semi-transparent glow line.
 * Call animate(elapsedSeconds) each frame to pulse the glow.
 */

import {
  DoubleSide,
  Group,
  Matrix4,
  Vector2,
  Vector3,
  type Camera,
} from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import type { HdMapElement } from './hd-map-edit-model';
import { getElementGeoPoints, isElementClosed } from './hd-map-edit-model';
import { project } from './projection';
import type { HdMapProject } from './hd-map-project';

const PICK_THRESHOLD_PX  = 10;
const SIGN_PICK_RADIUS_PX = 16;
const HIGHLIGHT_LIFT      = 0.08;

// Core line: bright white-gold
const COLOR_CORE = 0xffe566;
// Glow line: cyan for contrast against orange point clouds
const COLOR_GLOW = 0x00d8ff;

type Vec2 = [number, number];

// ── Screen-space geometry helpers ─────────────────────────────────────────────

function distPointToSegment2D(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const apx = p[0] - a[0], apy = p[1] - a[1];
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby + 1e-10)));
  const dx = apx - t * abx, dy = apy - t * aby;
  return Math.hypot(dx, dy);
}

function toScreen(v3: Vector3, camera: Camera, w: number, h: number, transform?: Matrix4): Vec2 {
  const v = v3.clone();
  if (transform) v.applyMatrix4(transform);
  const c = v.project(camera);
  return [(c.x + 1) * w / 2, (1 - c.y) * h / 2];
}

// ── World-space positions for an element ─────────────────────────────────────

function elementWorldPoints(
  elem: HdMapElement,
  proj_: HdMapProject,
  elevOff: number,
): [number, number, number][] {
  const geos = getElementGeoPoints(elem);
  const pts = geos.map(g =>
    project(g.lat, g.lon, g.elevation, elevOff,
      proj_.utmZone, proj_.utmHemisphere,
      proj_.utmOriginEasting, proj_.utmOriginNorthing)
  );
  if (isElementClosed(elem) && pts.length > 2) pts.push(pts[0]);
  return pts;
}

// ── Line2 factory ─────────────────────────────────────────────────────────────

function makeLine2(positions: number[], color: number, linewidth: number, opacity: number, resolution: Vector2): Line2 {
  const geo = new LineGeometry();
  geo.setPositions(positions);
  const mat = new LineMaterial({
    color,
    linewidth,
    opacity,
    transparent: opacity < 1,
    depthTest: false,
    resolution,
    // DoubleSide: when worldRoot's scale has a negative axis (axis-flip plugin),
    // the model matrix has a negative determinant. The renderer auto-flips the
    // front face for such matrices, which would cull these screen-space line
    // quads. DoubleSide bypasses that.
    side: DoubleSide,
  });
  const line = new Line2(geo, mat);
  line.computeLineDistances();
  line.renderOrder = 999;
  return line;
}

// Build a circle of N segments as flat positions array (lifted by dy)
function circlePositions(cx: number, cy: number, cz: number, radius: number, dy: number, segments = 32): number[] {
  const pos: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pos.push(cx + Math.cos(a) * radius, cy + dy, cz + Math.sin(a) * radius);
  }
  return pos;
}

// ── Main class ────────────────────────────────────────────────────────────────

export class HdMapScenePicker {
  private readonly highlightGroup = new Group();
  private highlightObjects: (Line2)[] = [];
  private readonly worldRoot: Group;

  // Viewport resolution — needed by LineMaterial
  private vpRes = new Vector2(window.innerWidth, window.innerHeight);

  constructor(worldRoot: Group) {
    this.worldRoot = worldRoot;
    this.highlightGroup.name = 'hdmap-selection-highlight';
    worldRoot.add(this.highlightGroup);

    // Keep viewport size in sync so LineMaterial resolution is correct
    const onResize = () => {
      this.vpRes.set(window.innerWidth, window.innerHeight);
      for (const l of this.highlightObjects) {
        (l.material as LineMaterial).resolution.copy(this.vpRes);
      }
    };
    window.addEventListener('resize', onResize);
  }

  // ── Picking ────────────────────────────────────────────────────────────────

  pick(
    clientX: number,
    clientY: number,
    camera: Camera,
    domElement: HTMLElement,
    elements: HdMapElement[],
    proj_: HdMapProject,
    elevOff: number,
  ): string | null {
    const rect = domElement.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const w  = rect.width;
    const h  = rect.height;

    let bestId: string | null = null;
    let bestDist = Infinity;

    // Element vertices are in worldRoot-local coords; the rendered geometry
    // sits under worldRoot and inherits its transform (including axis-flip
    // scale ±1). We must apply the same transform before screen projection,
    // otherwise picks miss everything when an axis is flipped.
    this.worldRoot.updateWorldMatrix(true, false);
    const xform = this.worldRoot.matrixWorld;

    for (const elem of elements) {
      if (elem.deleted || elem.hidden) continue;
      const pts = elementWorldPoints(elem, proj_, elevOff);

      if (elem.kind === 'sign') {
        const v = new Vector3(pts[0][0], pts[0][1], pts[0][2]);
        const [ex, ey] = toScreen(v, camera, w, h, xform);
        const d = Math.hypot(sx - ex, sy - ey);
        if (d < SIGN_PICK_RADIUS_PX && d < bestDist) { bestDist = d; bestId = elem.id; }
      } else {
        for (let i = 0; i < pts.length - 1; i++) {
          const va = new Vector3(...pts[i]);
          const vb = new Vector3(...pts[i + 1]);
          const sa = toScreen(va, camera, w, h, xform);
          const sb = toScreen(vb, camera, w, h, xform);
          const d  = distPointToSegment2D([sx, sy], sa, sb);
          if (d < PICK_THRESHOLD_PX && d < bestDist) { bestDist = d; bestId = elem.id; }
        }
      }
    }

    return bestId;
  }

  // ── Highlight ──────────────────────────────────────────────────────────────

  setHighlight(
    id: string | null,
    elements: HdMapElement[],
    proj_: HdMapProject,
    elevOff: number,
  ): void {
    this.clearHighlight();
    if (!id) return;

    const elem = elements.find(e => e.id === id);
    if (!elem || elem.deleted) return;

    const res = this.vpRes;

    if (elem.kind === 'sign') {
      const pts = elementWorldPoints(elem, proj_, elevOff);
      const [x, y, z] = pts[0];

      // Outer glow ring
      const glowRingPos = circlePositions(x, y, z, 1.8, HIGHLIGHT_LIFT + 0.02);
      const glowRing = makeLine2(glowRingPos, COLOR_GLOW, 6, 0.5, res);
      this.highlightGroup.add(glowRing);
      this.highlightObjects.push(glowRing);

      // Inner core ring
      const coreRingPos = circlePositions(x, y, z, 1.2, HIGHLIGHT_LIFT);
      const coreRing = makeLine2(coreRingPos, COLOR_CORE, 2.5, 1, res);
      this.highlightGroup.add(coreRing);
      this.highlightObjects.push(coreRing);

      // Crosshair spokes
      const r = 1.8;
      const crossPos = [
        x - r, y + HIGHLIGHT_LIFT, z,  x + r, y + HIGHLIGHT_LIFT, z,
      ];
      const cross1 = makeLine2(crossPos, COLOR_CORE, 2, 1, res);
      this.highlightGroup.add(cross1);
      this.highlightObjects.push(cross1);

      const crossPos2 = [
        x, y + HIGHLIGHT_LIFT, z - r,  x, y + HIGHLIGHT_LIFT, z + r,
      ];
      const cross2 = makeLine2(crossPos2, COLOR_CORE, 2, 1, res);
      this.highlightGroup.add(cross2);
      this.highlightObjects.push(cross2);

    } else {
      const pts = elementWorldPoints(elem, proj_, elevOff);
      if (pts.length < 2) return;

      const flatCore: number[] = [];
      const flatGlow: number[] = [];
      for (const [x, y, z] of pts) {
        flatCore.push(x, y + HIGHLIGHT_LIFT, z);
        flatGlow.push(x, y + HIGHLIGHT_LIFT + 0.02, z);
      }

      // Wide glow line (behind)
      const glowLine = makeLine2(flatGlow, COLOR_GLOW, 10, 0.45, res);
      this.highlightGroup.add(glowLine);
      this.highlightObjects.push(glowLine);

      // Thin bright core line (in front)
      const coreLine = makeLine2(flatCore, COLOR_CORE, 3, 1, res);
      this.highlightGroup.add(coreLine);
      this.highlightObjects.push(coreLine);
    }
  }

  animate(_delta: number): void { /* no-op — static highlight, no pulse */ }

  clearHighlight(): void {
    for (const obj of this.highlightObjects) {
      obj.geometry.dispose();
      (obj.material as LineMaterial).dispose();
      this.highlightGroup.remove(obj);
    }
    this.highlightObjects = [];
  }

  dispose(): void {
    this.clearHighlight();
    this.highlightGroup.parent?.remove(this.highlightGroup);
  }
}
