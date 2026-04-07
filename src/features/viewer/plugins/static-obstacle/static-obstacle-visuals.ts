import {
  Group,
  LineSegments,
  EdgesGeometry,
  BoxGeometry,
  LineBasicMaterial,
  ArrowHelper,
  Vector3,
  Mesh,
  PlaneGeometry,
  MeshBasicMaterial,
  DoubleSide,
  Euler,
  Color,
} from 'three';
import type { NormalFace, Annotation3D } from './static-obstacle-types';

// ── Face helpers ─────────────────────────────────────────────────────────────

export function faceDirection(face: NormalFace): Vector3 {
  switch (face) {
    case 'PosX': return new Vector3(1, 0, 0);
    case 'NegX': return new Vector3(-1, 0, 0);
    case 'PosY': return new Vector3(0, 1, 0);
    case 'NegY': return new Vector3(0, -1, 0);
    case 'PosZ': return new Vector3(0, 0, 1);
    case 'NegZ': return new Vector3(0, 0, -1);
  }
}

export function faceCenterOffset(
  face: NormalFace,
  halfExtents: { x: number; y: number; z: number },
): Vector3 {
  const { x: hx, y: hy, z: hz } = halfExtents;
  switch (face) {
    case 'PosX': return new Vector3(hx, 0, 0);
    case 'NegX': return new Vector3(-hx, 0, 0);
    case 'PosY': return new Vector3(0, hy, 0);
    case 'NegY': return new Vector3(0, -hy, 0);
    case 'PosZ': return new Vector3(0, 0, hz);
    case 'NegZ': return new Vector3(0, 0, -hz);
  }
}

// ── Box wireframe ─────────────────────────────────────────────────────────────

/**
 * Build a wireframe box centred at `center`, sized by `halfExtents`.
 * Optionally includes a normal arrow for `frontFace`.
 */
export function buildBoxGroup(
  center: { x: number; y: number; z: number },
  halfExtents: { x: number; y: number; z: number },
  colorHex: string,
  frontFace: NormalFace | null = null,
  arrowColor = 0xffff00,
): Group {
  const group = new Group();
  group.position.set(center.x, center.y, center.z);

  const col = new Color(colorHex);
  const { x: hx, y: hy, z: hz } = halfExtents;
  const boxGeo = new BoxGeometry(hx * 2, hy * 2, hz * 2);
  const edges = new EdgesGeometry(boxGeo);
  boxGeo.dispose();
  const mat = new LineBasicMaterial({
    color: col,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
  });
  const wireframe = new LineSegments(edges, mat);
  wireframe.renderOrder = 900;
  group.add(wireframe);

  if (frontFace) {
    attachArrow(group, halfExtents, frontFace, arrowColor);
  }

  return group;
}

export function attachArrow(
  group: Group,
  halfExtents: { x: number; y: number; z: number },
  face: NormalFace,
  color: number,
): ArrowHelper {
  const dir = faceDirection(face);
  const origin = faceCenterOffset(face, halfExtents);
  const { x: hx, y: hy, z: hz } = halfExtents;
  const maxHalf = Math.max(hx, hy, hz);
  const arrowLen = Math.max(0.5, maxHalf * 1.2);
  const headLen = Math.min(arrowLen * 0.35, 0.6);
  const headWidth = headLen * 0.5;
  const arrow = new ArrowHelper(dir, origin, arrowLen, color, headLen, headWidth);
  arrow.renderOrder = 901;
  // Disable depth testing on sub-meshes for visibility
  arrow.traverse((obj) => {
    if (obj instanceof Mesh || obj instanceof LineSegments) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => { m.depthTest = false; });
      } else {
        obj.material.depthTest = false;
      }
    }
  });
  group.add(arrow);
  return arrow;
}

const FACE_HOVER_COLOR  = 0xff8800;
const FACE_HOVER_OPACITY = 0.28;

// ── Face-picking meshes ───────────────────────────────────────────────────────

/** Build 6 invisible plane meshes for raycasting during face-picking phase. */
export function buildFacePickMeshes(
  halfExtents: { x: number; y: number; z: number },
): Mesh[] {
  const { x: hx, y: hy, z: hz } = halfExtents;

  const configs: Array<{ face: NormalFace; pos: Vector3; rot: Euler; w: number; h: number }> = [
    { face: 'PosX', pos: new Vector3(hx, 0, 0),  rot: new Euler(0, -Math.PI / 2, 0), w: hz * 2, h: hy * 2 },
    { face: 'NegX', pos: new Vector3(-hx, 0, 0), rot: new Euler(0, Math.PI / 2, 0),  w: hz * 2, h: hy * 2 },
    { face: 'PosY', pos: new Vector3(0, hy, 0),  rot: new Euler(-Math.PI / 2, 0, 0), w: hx * 2, h: hz * 2 },
    { face: 'NegY', pos: new Vector3(0, -hy, 0), rot: new Euler(Math.PI / 2, 0, 0),  w: hx * 2, h: hz * 2 },
    { face: 'PosZ', pos: new Vector3(0, 0, hz),  rot: new Euler(0, 0, 0),             w: hx * 2, h: hy * 2 },
    { face: 'NegZ', pos: new Vector3(0, 0, -hz), rot: new Euler(0, Math.PI, 0),       w: hx * 2, h: hy * 2 },
  ];

  return configs.map(({ face, pos, rot, w, h }) => {
    const geo = new PlaneGeometry(Math.max(w, 0.05), Math.max(h, 0.05));
    const mat = new MeshBasicMaterial({
      color: FACE_HOVER_COLOR,
      side: DoubleSide,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new Mesh(geo, mat);
    mesh.renderOrder = 902;
    mesh.position.copy(pos);
    mesh.rotation.copy(rot);
    mesh.userData.face = face as NormalFace;
    return mesh;
  });
}

/** Set or clear the hover highlight on a face pick mesh. */
export function setFacePickHover(mesh: Mesh | null, hovered: boolean): void {
  if (!mesh) return;
  const mat = mesh.material as MeshBasicMaterial;
  mat.opacity = hovered ? FACE_HOVER_OPACITY : 0;
}

// ── Annotation group builder ──────────────────────────────────────────────────

/** Build the full visual group for a committed annotation. */
export function buildAnnotationGroup(ann: Annotation3D, layerColor: string): Group {
  return buildBoxGroup(ann.center, ann.halfExtents, layerColor, ann.frontFace, 0xffffff);
}

// ── Dispose ───────────────────────────────────────────────────────────────────

export function disposeGroup(group: Group): void {
  group.traverse((obj) => {
    if (obj instanceof Mesh || obj instanceof LineSegments) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m.dispose());
      } else {
        obj.material.dispose();
      }
    }
  });
}
