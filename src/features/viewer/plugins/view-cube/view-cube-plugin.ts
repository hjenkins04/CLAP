import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  AmbientLight,
  DirectionalLight,
  Raycaster,
  Vector2,
  Vector3,
  Quaternion,
  Spherical,
  Mesh,
  Group,
  BoxGeometry,
  SphereGeometry,
  CylinderGeometry,
  EdgesGeometry,
  LineSegments,
  LineBasicMaterial,
  MeshBasicMaterial,
  CanvasTexture,
  DoubleSide,
  Color,
} from 'three';
import type { Intersection, Object3D } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { usePoiStore } from '../poi/poi-store';
import { useViewerModeStore } from '@/app/stores';

// ── Constants ──────────────────────────────────────────────────────────

const WIDGET_SIZE = 128;
const RING_PADDING = 22;
const TOTAL_SIZE = WIDGET_SIZE + RING_PADDING * 2;
const OFFSET_TOP = 8;
const OFFSET_RIGHT = 8;
const CAM_DISTANCE = 3.6;
const ANIM_DURATION = 400;
const HOME_BTN_SIZE = 28;

// ── Styling ────────────────────────────────────────────────────────────

const FACE_COLOR = 0x1f2937;
const FACE_HOVER_COLOR = 0x2563eb;
const LABEL_COLOR = '#ffffff';
const EDGE_COLOR = 0x555555;
const EDGE_HOVER_COLOR = 0xffffff;
const CORNER_COLOR = 0x555555;
const CORNER_HOVER_COLOR = 0xffffff;
const RING_COLOR = '#4b5563';
const RING_HOVER_COLOR = '#2563eb';

// Lock SVG icons (Lucide lock / lock-open, 16x16)
const LOCK_CLOSED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
const LOCK_OPEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;

// ── Face / Edge / Corner definitions ───────────────────────────────────

interface SnapTarget {
  name: string;
  dir: Vector3;
  up: Vector3;
}

const FACES: SnapTarget[] = [
  { name: 'RIGHT', dir: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0) },
  { name: 'LEFT', dir: new Vector3(-1, 0, 0), up: new Vector3(0, 1, 0) },
  { name: 'TOP', dir: new Vector3(0, 1, 0), up: new Vector3(0, 0, -1) },
  { name: 'BOTTOM', dir: new Vector3(0, -1, 0), up: new Vector3(0, 0, 1) },
  { name: 'FRONT', dir: new Vector3(0, 0, 1), up: new Vector3(0, 1, 0) },
  { name: 'BACK', dir: new Vector3(0, 0, -1), up: new Vector3(0, 1, 0) },
];

// 12 edges — midpoints of each cube edge
function makeEdges(): SnapTarget[] {
  const s = 1;
  const edges: SnapTarget[] = [];
  const pairs: [string, number[]][] = [
    // top 4
    ['', [s, s, 0]],  ['', [0, s, s]],  ['', [-s, s, 0]], ['', [0, s, -s]],
    // bottom 4
    ['', [s, -s, 0]], ['', [0, -s, s]], ['', [-s, -s, 0]], ['', [0, -s, -s]],
    // middle 4
    ['', [s, 0, s]],  ['', [-s, 0, s]], ['', [-s, 0, -s]], ['', [s, 0, -s]],
  ];
  for (const [, pos] of pairs) {
    const dir = new Vector3(pos[0], pos[1], pos[2]).normalize();
    const up = Math.abs(dir.y) > 0.9 ? new Vector3(0, 0, -1) : new Vector3(0, 1, 0);
    edges.push({ name: '', dir, up });
  }
  return edges;
}

// 8 corners
function makeCorners(): SnapTarget[] {
  const corners: SnapTarget[] = [];
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        const dir = new Vector3(x, y, z).normalize();
        const up = y > 0 ? new Vector3(0, 1, 0) : new Vector3(0, -1, 0);
        // For top corners, tilt up slightly
        if (Math.abs(dir.y) > 0.5) {
          corners.push({
            name: '',
            dir,
            up: dir.y > 0 ? new Vector3(0, 0, -Math.sign(dir.z || 1)) : new Vector3(0, 0, Math.sign(dir.z || 1)),
          });
        } else {
          corners.push({ name: '', dir, up: new Vector3(0, 1, 0) });
        }
      }
    }
  }
  return corners;
}

const EDGE_TARGETS = makeEdges();
const CORNER_TARGETS = makeCorners();

// ── Plugin ─────────────────────────────────────────────────────────────

export class ViewCubePlugin implements ViewerPlugin {
  readonly id = 'view-cube';
  readonly name = 'View Cube';
  readonly order = 200;

  private ctx: ViewerPluginContext | null = null;

  // DOM
  private wrapper: HTMLDivElement | null = null;
  private cubeCanvas: HTMLCanvasElement | null = null;
  private ringCanvas: HTMLCanvasElement | null = null;
  private homeBtn: HTMLButtonElement | null = null;
  private lockBtn: HTMLButtonElement | null = null;
  private unsubLock: (() => void) | null = null;

  // Mini 3D scene
  private miniRenderer: WebGLRenderer | null = null;
  private cubeScene: Scene | null = null;
  private cubeCam: PerspectiveCamera | null = null;

  // Cube mesh group
  private cubeGroup: Group | null = null;
  private faceMeshes: Mesh[] = [];
  private edgeMeshes: Mesh[] = [];
  private cornerMeshes: Mesh[] = [];
  private faceMaterials: MeshBasicMaterial[] = [];
  private edgeMaterials: MeshBasicMaterial[] = [];
  private cornerMaterials: MeshBasicMaterial[] = [];

  // Interaction
  private raycaster = new Raycaster();
  private mouse = new Vector2();
  private hoveredObj: Object3D | null = null;

  // Drag-to-orbit state
  private isDragging = false;
  private dragStart = new Vector2();
  private dragSpherical = new Spherical();

  // Ring drag state
  private isRingDragging = false;
  private ringDragStartAngle = 0;

  // Snap animation
  private animating = false;
  private animStart = 0;
  private animFromPos = new Vector3();
  private animToDir = new Vector3();
  private animFromUp = new Vector3();
  private animToUp = new Vector3();
  private animDist = 0;
  private animIsHome = false;
  private animFromTarget = new Vector3();
  private animToTarget = new Vector3();
  private animFromDist = 0;

  // Home camera state (captured on first point cloud load)
  private homePosition: Vector3 | null = null;
  private homeTarget: Vector3 | null = null;
  private homeUp: Vector3 | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────────

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;

    this.buildDOM(ctx.container);
    this.buildScene();
    this.buildCube();
  }

  onPointCloudLoaded(): void {
    // Capture home position — use a short delay so the camera has settled
    // after fitCameraToPointCloud + controls.update
    if (!this.homePosition) {
      requestAnimationFrame(() => this.captureHome());
    }
  }

  onAfterRender(): void {
    if (!this.ctx || !this.cubeCam || !this.cubeScene || !this.cubeCanvas) return;

    const mainCam = this.ctx.getActiveCamera();
    const controls = this.ctx.controls;

    if (this.animating) {
      this.updateAnimation(controls);
    }

    // Mirror the main camera's viewing direction around origin
    const eye = mainCam.position.clone().sub(controls.target).normalize();
    this.cubeCam.position.copy(eye.multiplyScalar(CAM_DISTANCE));
    this.cubeCam.lookAt(0, 0, 0);
    this.cubeCam.up.copy(mainCam.up);

    this.miniRenderer?.render(this.cubeScene, this.cubeCam);

    // Redraw the ring overlay (orientation-aware)
    this.drawRing();
  }

  onResize(): void {
    if (!this.cubeCanvas || !this.miniRenderer) return;
    const dpr = window.devicePixelRatio;
    this.cubeCanvas.width = WIDGET_SIZE * dpr;
    this.cubeCanvas.height = WIDGET_SIZE * dpr;
    this.miniRenderer.setPixelRatio(dpr);
    this.miniRenderer.setSize(WIDGET_SIZE, WIDGET_SIZE);
  }

  dispose(): void {
    // Remove event listeners
    this.cubeCanvas?.removeEventListener('mousedown', this.onCubeMouseDown);
    this.cubeCanvas?.removeEventListener('mousemove', this.onCubeMouseMove);
    this.cubeCanvas?.removeEventListener('mouseleave', this.onCubeMouseLeave);
    this.ringCanvas?.removeEventListener('mousedown', this.onRingMouseDown);
    document.removeEventListener('mousemove', this.onDocMouseMove);
    document.removeEventListener('mouseup', this.onDocMouseUp);

    this.miniRenderer?.dispose();
    this.miniRenderer = null;

    // Dispose materials
    this.faceMaterials.forEach((m) => m.dispose());
    this.edgeMaterials.forEach((m) => m.dispose());
    this.cornerMaterials.forEach((m) => m.dispose());

    // Dispose geometries
    [...this.faceMeshes, ...this.edgeMeshes, ...this.cornerMeshes].forEach((m) => {
      m.geometry.dispose();
    });

    this.unsubLock?.();
    this.unsubLock = null;

    this.wrapper?.remove();
    this.wrapper = null;
    this.cubeCanvas = null;
    this.ringCanvas = null;
    this.homeBtn = null;
    this.lockBtn = null;
    this.cubeScene = null;
    this.cubeCam = null;
    this.cubeGroup = null;
    this.ctx = null;
  }

  // ── DOM Construction ───────────────────────────────────────────────

  private buildDOM(container: HTMLElement): void {
    // Wrapper
    this.wrapper = document.createElement('div');
    this.wrapper.style.cssText = `
      position: absolute;
      top: ${OFFSET_TOP}px;
      right: ${OFFSET_RIGHT}px;
      width: ${TOTAL_SIZE}px;
      height: ${TOTAL_SIZE + HOME_BTN_SIZE + 4}px;
      pointer-events: none;
      z-index: 10;
    `;
    container.appendChild(this.wrapper);

    // Ring canvas (behind cube)
    this.ringCanvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio;
    this.ringCanvas.width = TOTAL_SIZE * dpr;
    this.ringCanvas.height = TOTAL_SIZE * dpr;
    this.ringCanvas.style.cssText = `
      position: absolute; top: 0; left: 0;
      width: ${TOTAL_SIZE}px; height: ${TOTAL_SIZE}px;
      pointer-events: auto; cursor: grab;
    `;
    this.wrapper.appendChild(this.ringCanvas);

    // Cube canvas (on top)
    this.cubeCanvas = document.createElement('canvas');
    this.cubeCanvas.width = WIDGET_SIZE * dpr;
    this.cubeCanvas.height = WIDGET_SIZE * dpr;
    this.cubeCanvas.style.cssText = `
      position: absolute;
      top: ${RING_PADDING}px; left: ${RING_PADDING}px;
      width: ${WIDGET_SIZE}px; height: ${WIDGET_SIZE}px;
      pointer-events: auto; cursor: grab;
    `;
    this.wrapper.appendChild(this.cubeCanvas);

    // Home button
    this.homeBtn = document.createElement('button');
    this.homeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
    this.homeBtn.title = 'Reset camera';
    this.homeBtn.style.cssText = `
      position: absolute;
      bottom: 0;
      left: calc(50% - ${HOME_BTN_SIZE + 1}px);
      width: ${HOME_BTN_SIZE}px; height: ${HOME_BTN_SIZE}px;
      border: none; border-radius: 6px;
      background: #1f2937; color: #9ca3af;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; pointer-events: auto;
      transition: background 0.15s, color 0.15s;
    `;
    this.homeBtn.addEventListener('mouseenter', () => {
      if (this.homeBtn) {
        this.homeBtn.style.background = '#2563eb';
        this.homeBtn.style.color = '#ffffff';
      }
    });
    this.homeBtn.addEventListener('mouseleave', () => {
      if (this.homeBtn) {
        this.homeBtn.style.background = '#1f2937';
        this.homeBtn.style.color = '#9ca3af';
      }
    });
    this.homeBtn.addEventListener('click', this.onHomeClick);
    this.wrapper.appendChild(this.homeBtn);

    // Lock button (right of home)
    this.lockBtn = document.createElement('button');
    this.lockBtn.innerHTML = LOCK_OPEN_SVG;
    this.lockBtn.title = 'Lock camera orientation';
    this.lockBtn.style.cssText = `
      position: absolute;
      bottom: 0;
      left: calc(50% + 1px);
      width: ${HOME_BTN_SIZE}px; height: ${HOME_BTN_SIZE}px;
      border: none; border-radius: 6px;
      background: #1f2937; color: #9ca3af;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; pointer-events: auto;
      transition: background 0.15s, color 0.15s;
    `;
    this.lockBtn.addEventListener('mouseenter', () => {
      if (this.lockBtn && !useViewerModeStore.getState().cameraLocked) {
        this.lockBtn.style.background = '#2563eb';
        this.lockBtn.style.color = '#ffffff';
      }
    });
    this.lockBtn.addEventListener('mouseleave', () => {
      if (this.lockBtn && !useViewerModeStore.getState().cameraLocked) {
        this.lockBtn.style.background = '#1f2937';
        this.lockBtn.style.color = '#9ca3af';
      }
    });
    this.lockBtn.addEventListener('click', this.onLockClick);
    this.wrapper.appendChild(this.lockBtn);

    // Subscribe to camera lock changes to update button style + controls
    let prevLocked = useViewerModeStore.getState().cameraLocked;
    this.unsubLock = useViewerModeStore.subscribe((state) => {
      if (state.cameraLocked !== prevLocked) {
        prevLocked = state.cameraLocked;
        this.onCameraLockChanged(state.cameraLocked);
      }
    });

    // Event listeners
    this.cubeCanvas.addEventListener('mousedown', this.onCubeMouseDown);
    this.cubeCanvas.addEventListener('mousemove', this.onCubeMouseMove);
    this.cubeCanvas.addEventListener('mouseleave', this.onCubeMouseLeave);
    this.ringCanvas.addEventListener('mousedown', this.onRingMouseDown);
    document.addEventListener('mousemove', this.onDocMouseMove);
    document.addEventListener('mouseup', this.onDocMouseUp);
  }

  // ── 3D Scene Construction ──────────────────────────────────────────

  private buildScene(): void {
    this.cubeScene = new Scene();
    this.cubeScene.add(new AmbientLight(0xffffff, 0.9));
    const dl = new DirectionalLight(0xffffff, 0.3);
    dl.position.set(2, 3, 4);
    this.cubeScene.add(dl);

    this.cubeCam = new PerspectiveCamera(40, 1, 0.1, 100);
    this.cubeCam.position.set(0, 0, CAM_DISTANCE);

    this.miniRenderer = new WebGLRenderer({
      canvas: this.cubeCanvas!,
      alpha: true,
      antialias: true,
    });
    this.miniRenderer.setPixelRatio(window.devicePixelRatio);
    this.miniRenderer.setSize(WIDGET_SIZE, WIDGET_SIZE);
  }

  private buildCube(): void {
    if (!this.cubeScene) return;

    this.cubeGroup = new Group();
    this.cubeScene.add(this.cubeGroup);

    const cubeHalf = 0.65;
    const edgeRadius = 0.07;
    const cornerRadius = 0.1;

    // ── Faces ──
    const faceGeo = new BoxGeometry(cubeHalf * 2 - 0.02, cubeHalf * 2 - 0.02, 0.01);
    const facePositions: [Vector3, Vector3][] = [
      [new Vector3(cubeHalf, 0, 0), new Vector3(0, Math.PI / 2, 0)],   // +X RIGHT
      [new Vector3(-cubeHalf, 0, 0), new Vector3(0, -Math.PI / 2, 0)], // -X LEFT
      [new Vector3(0, cubeHalf, 0), new Vector3(-Math.PI / 2, 0, 0)],  // +Y TOP
      [new Vector3(0, -cubeHalf, 0), new Vector3(Math.PI / 2, 0, 0)],  // -Y BOTTOM
      [new Vector3(0, 0, cubeHalf), new Vector3(0, 0, 0)],             // +Z FRONT
      [new Vector3(0, 0, -cubeHalf), new Vector3(0, Math.PI, 0)],      // -Z BACK
    ];

    for (let i = 0; i < 6; i++) {
      const tex = this.makeFaceTexture(FACES[i].name, FACE_COLOR);
      const mat = new MeshBasicMaterial({ map: tex, side: DoubleSide });
      const mesh = new Mesh(faceGeo, mat);
      mesh.position.copy(facePositions[i][0]);
      mesh.rotation.setFromVector3(facePositions[i][1]);
      mesh.userData = { type: 'face', index: i };
      this.cubeGroup.add(mesh);
      this.faceMeshes.push(mesh);
      this.faceMaterials.push(mat);
    }

    // ── Edges (12 cylinders) ──
    const edgeLen = cubeHalf * 2 - cornerRadius * 4;
    const edgeGeo = new CylinderGeometry(edgeRadius, edgeRadius, edgeLen, 8);

    // Helper to create edge at a position/rotation
    const addEdge = (pos: Vector3, rotAxis: Vector3, rotAngle: number, idx: number) => {
      const mat = new MeshBasicMaterial({ color: EDGE_COLOR });
      const mesh = new Mesh(edgeGeo, mat);
      mesh.position.copy(pos);
      if (rotAngle !== 0) mesh.rotateOnAxis(rotAxis, rotAngle);
      mesh.userData = { type: 'edge', index: idx };
      this.cubeGroup!.add(mesh);
      this.edgeMeshes.push(mesh);
      this.edgeMaterials.push(mat);
    };

    const c = cubeHalf;
    const xAxis = new Vector3(1, 0, 0);
    const zAxis = new Vector3(0, 0, 1);

    // Top 4 edges (along X and Z at y=+c)
    addEdge(new Vector3(0, c, c), zAxis, Math.PI / 2, 0);    // top-front
    addEdge(new Vector3(0, c, -c), zAxis, Math.PI / 2, 1);   // top-back
    addEdge(new Vector3(c, c, 0), xAxis, 0, 2);              // top-right (default Y-aligned)

    // Wait, cylinder is Y-aligned by default. Let me fix the orientation logic.
    // Clear and redo properly.
    this.edgeMeshes = [];
    this.edgeMaterials = [];
    // Remove previously added
    while (this.cubeGroup.children.length > 6) {
      this.cubeGroup.remove(this.cubeGroup.children[this.cubeGroup.children.length - 1]);
    }

    // Edges: cylinder default orientation is along Y axis.
    // For X-aligned edges, rotate Z by 90°. For Z-aligned, rotate X by 90°.
    const edgeDefs: { pos: number[]; rot: [Vector3, number] }[] = [
      // Top 4
      { pos: [c, c, 0], rot: [zAxis, 0] },        // top-right (Z-aligned → no, this is Y-aligned at top-right)
      // Let me think about this differently.
    ];

    // Actually, let me just use a simpler approach: create thin box geometries for edges
    this.buildEdges(cubeHalf, edgeRadius);
    this.buildCorners(cubeHalf, cornerRadius);

    // Wireframe outline
    const wireGeo = new BoxGeometry(cubeHalf * 2, cubeHalf * 2, cubeHalf * 2);
    const wireEdges = new EdgesGeometry(wireGeo);
    const wireMat = new LineBasicMaterial({ color: 0x374151, transparent: true, opacity: 0.4 });
    const wireframe = new LineSegments(wireEdges, wireMat);
    this.cubeGroup.add(wireframe);
  }

  private buildEdges(half: number, radius: number): void {
    if (!this.cubeGroup) return;

    // Each edge is a thin box connecting two adjacent corners
    const len = half * 2 - radius * 4; // leave room for corner spheres
    let idx = 0;

    // Cylinder is Y-axis aligned by default
    const geoY = new CylinderGeometry(radius, radius, len, 6);
    const geoSwap = new CylinderGeometry(radius, radius, len, 6);

    // 4 top edges (y = +half)
    // top-front (along X): pos(0, half, half) rotated to X-axis
    this.addEdgeMesh(new Vector3(0, half, half), 'z', len, radius, idx++);
    // top-back
    this.addEdgeMesh(new Vector3(0, half, -half), 'z', len, radius, idx++);
    // top-right (along Z)
    this.addEdgeMesh(new Vector3(half, half, 0), 'x', len, radius, idx++);
    // top-left
    this.addEdgeMesh(new Vector3(-half, half, 0), 'x', len, radius, idx++);

    // 4 bottom edges
    this.addEdgeMesh(new Vector3(0, -half, half), 'z', len, radius, idx++);
    this.addEdgeMesh(new Vector3(0, -half, -half), 'z', len, radius, idx++);
    this.addEdgeMesh(new Vector3(half, -half, 0), 'x', len, radius, idx++);
    this.addEdgeMesh(new Vector3(-half, -half, 0), 'x', len, radius, idx++);

    // 4 vertical edges (along Y)
    this.addEdgeMesh(new Vector3(half, 0, half), 'y', len, radius, idx++);
    this.addEdgeMesh(new Vector3(-half, 0, half), 'y', len, radius, idx++);
    this.addEdgeMesh(new Vector3(-half, 0, -half), 'y', len, radius, idx++);
    this.addEdgeMesh(new Vector3(half, 0, -half), 'y', len, radius, idx++);
  }

  private addEdgeMesh(
    pos: Vector3,
    axis: 'x' | 'y' | 'z',
    len: number,
    radius: number,
    idx: number
  ): void {
    const geo = new CylinderGeometry(radius, radius, len, 6);
    const mat = new MeshBasicMaterial({ color: EDGE_COLOR });
    const mesh = new Mesh(geo, mat);
    mesh.position.copy(pos);

    if (axis === 'x') {
      mesh.rotation.x = Math.PI / 2;
    } else if (axis === 'z') {
      mesh.rotation.z = Math.PI / 2;
    }
    // 'y' is default

    mesh.userData = { type: 'edge', index: idx };
    this.cubeGroup!.add(mesh);
    this.edgeMeshes.push(mesh);
    this.edgeMaterials.push(mat);
  }

  private buildCorners(half: number, radius: number): void {
    if (!this.cubeGroup) return;

    const geo = new SphereGeometry(radius, 8, 8);
    let idx = 0;

    for (const x of [-1, 1]) {
      for (const y of [-1, 1]) {
        for (const z of [-1, 1]) {
          const mat = new MeshBasicMaterial({ color: CORNER_COLOR });
          const mesh = new Mesh(geo, mat);
          mesh.position.set(x * half, y * half, z * half);
          mesh.userData = { type: 'corner', index: idx };
          this.cubeGroup.add(mesh);
          this.cornerMeshes.push(mesh);
          this.cornerMaterials.push(mat);
          idx++;
        }
      }
    }
  }

  // ── Texture ────────────────────────────────────────────────────────

  private faceTextureCache = new Map<string, CanvasTexture>();

  private makeFaceTexture(label: string, bgColorNum: number): CanvasTexture {
    const key = `${label}-${bgColorNum}`;
    const cached = this.faceTextureCache.get(key);
    if (cached) return cached;

    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const c = canvas.getContext('2d')!;

    const bgColor = '#' + new Color(bgColorNum).getHexString();

    // Rounded rect
    const r = 12;
    c.fillStyle = bgColor;
    c.beginPath();
    c.moveTo(r, 0);
    c.lineTo(size - r, 0);
    c.quadraticCurveTo(size, 0, size, r);
    c.lineTo(size, size - r);
    c.quadraticCurveTo(size, size, size - r, size);
    c.lineTo(r, size);
    c.quadraticCurveTo(0, size, 0, size - r);
    c.lineTo(0, r);
    c.quadraticCurveTo(0, 0, r, 0);
    c.closePath();
    c.fill();

    // Label
    c.fillStyle = LABEL_COLOR;
    c.font = 'bold 44px Arial, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(label, size / 2, size / 2);

    const tex = new CanvasTexture(canvas);
    this.faceTextureCache.set(key, tex);
    return tex;
  }

  // ── Ring Drawing ───────────────────────────────────────────────────

  private drawRing(): void {
    if (!this.ringCanvas) return;

    const dpr = window.devicePixelRatio;
    const w = TOTAL_SIZE * dpr;
    const c = this.ringCanvas.getContext('2d');
    if (!c) return;

    // Ensure canvas dimensions
    if (this.ringCanvas.width !== w || this.ringCanvas.height !== w) {
      this.ringCanvas.width = w;
      this.ringCanvas.height = w;
    }

    c.clearRect(0, 0, w, w);

    const cx = w / 2;
    const cy = w / 2;
    const r = (WIDGET_SIZE / 2 + RING_PADDING / 2) * dpr;
    const lineWidth = (this.isRingDragging ? 5 : 3.5) * dpr;

    const color = this.isRingDragging ? RING_HOVER_COLOR : RING_COLOR;

    c.strokeStyle = color;
    c.lineWidth = lineWidth;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.stroke();
  }

  // ── Hover & Hit Detection ──────────────────────────────────────────

  private hitTest(e: MouseEvent): Object3D | null {
    if (!this.cubeCanvas || !this.cubeCam || !this.cubeGroup) return null;

    const rect = this.cubeCanvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.cubeCam);
    const all = [...this.faceMeshes, ...this.edgeMeshes, ...this.cornerMeshes];
    const hits = this.raycaster.intersectObjects(all, false);

    return hits.length > 0 ? hits[0].object : null;
  }

  private setHover(obj: Object3D | null): void {
    if (obj === this.hoveredObj) return;

    // Restore previous
    if (this.hoveredObj) {
      const ud = this.hoveredObj.userData;
      if (ud.type === 'face') {
        const mat = this.faceMaterials[ud.index];
        mat.map = this.makeFaceTexture(FACES[ud.index].name, FACE_COLOR);
        mat.color.setHex(0xffffff);
        mat.needsUpdate = true;
      } else if (ud.type === 'edge') {
        this.edgeMaterials[ud.index].color.setHex(EDGE_COLOR);
      } else if (ud.type === 'corner') {
        this.cornerMaterials[ud.index].color.setHex(CORNER_COLOR);
      }
    }

    // Apply new
    if (obj) {
      const ud = obj.userData;
      if (ud.type === 'face') {
        const mat = this.faceMaterials[ud.index];
        mat.map = this.makeFaceTexture(FACES[ud.index].name, FACE_HOVER_COLOR);
        mat.needsUpdate = true;
      } else if (ud.type === 'edge') {
        this.edgeMaterials[ud.index].color.setHex(EDGE_HOVER_COLOR);
      } else if (ud.type === 'corner') {
        this.cornerMaterials[ud.index].color.setHex(CORNER_HOVER_COLOR);
      }
    }

    this.hoveredObj = obj;

    if (this.cubeCanvas) {
      this.cubeCanvas.style.cursor = obj ? 'pointer' : 'grab';
    }
  }

  // ── Event Handlers ─────────────────────────────────────────────────

  private readonly onCubeMouseMove = (e: MouseEvent): void => {
    if (this.isDragging) return;
    this.setHover(this.hitTest(e));
  };

  private readonly onCubeMouseLeave = (): void => {
    if (!this.isDragging) {
      this.setHover(null);
    }
  };

  private readonly onCubeMouseDown = (e: MouseEvent): void => {
    if (!this.ctx) return;
    e.preventDefault();

    const hit = this.hitTest(e);
    if (hit) {
      // Will be a click-to-snap if mouse doesn't move much
      this.dragStart.set(e.clientX, e.clientY);
      this.isDragging = false; // not yet — wait for move threshold
      // Store which object was clicked for potential snap
      (this as Record<string, unknown>)._pendingSnap = hit;
    }

    // Always prepare for drag-to-orbit
    this.dragStart.set(e.clientX, e.clientY);

    const cam = this.ctx.getActiveCamera();
    const offset = cam.position.clone().sub(this.ctx.controls.target);
    this.dragSpherical.setFromVector3(offset);

    (this as Record<string, unknown>)._dragReady = true;
  };

  private readonly onRingMouseDown = (e: MouseEvent): void => {
    if (!this.ctx || !this.ringCanvas) return;
    e.preventDefault();
    e.stopPropagation();

    this.isRingDragging = true;
    if (this.ringCanvas) this.ringCanvas.style.cursor = 'grabbing';

    const rect = this.ringCanvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    this.ringDragStartAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
  };

  private readonly onDocMouseMove = (e: MouseEvent): void => {
    // Ring drag
    if (this.isRingDragging && this.ctx && this.ringCanvas) {
      const rect = this.ringCanvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const angle = Math.atan2(e.clientY - cy, e.clientX - cx);
      const delta = angle - this.ringDragStartAngle;
      this.ringDragStartAngle = angle;

      const cam = this.ctx.getActiveCamera();
      const controls = this.ctx.controls;
      const offset = cam.position.clone().sub(controls.target);
      const sph = new Spherical().setFromVector3(offset);
      sph.theta -= delta;
      offset.setFromSpherical(sph);
      cam.position.copy(controls.target).add(offset);
      controls.update();
      return;
    }

    // Cube drag-to-orbit
    if (!(this as Record<string, unknown>)._dragReady) return;

    const dx = e.clientX - this.dragStart.x;
    const dy = e.clientY - this.dragStart.y;

    if (!this.isDragging && Math.hypot(dx, dy) > 3) {
      this.isDragging = true;
      (this as Record<string, unknown>)._pendingSnap = null;
      if (this.cubeCanvas) this.cubeCanvas.style.cursor = 'grabbing';
      // Disable orbit controls while we drag
      if (this.ctx) this.ctx.controls.enabled = false;

      // Capture current spherical
      const cam = this.ctx!.getActiveCamera();
      const offset = cam.position.clone().sub(this.ctx!.controls.target);
      this.dragSpherical.setFromVector3(offset);
      this.dragStart.set(e.clientX, e.clientY);
    }

    if (this.isDragging && this.ctx) {
      const sensitivity = 0.008;
      const ndx = e.clientX - this.dragStart.x;
      const ndy = e.clientY - this.dragStart.y;

      this.dragSpherical.theta -= ndx * sensitivity;
      this.dragSpherical.phi -= ndy * sensitivity;
      this.dragSpherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, this.dragSpherical.phi));

      this.dragStart.set(e.clientX, e.clientY);

      const cam = this.ctx.getActiveCamera();
      const offset = new Vector3().setFromSpherical(this.dragSpherical);
      cam.position.copy(this.ctx.controls.target).add(offset);
      cam.up.set(0, 1, 0);
      this.ctx.controls.update();
    }
  };

  private readonly onDocMouseUp = (_e: MouseEvent): void => {
    // End ring drag
    if (this.isRingDragging) {
      this.isRingDragging = false;
      if (this.ringCanvas) this.ringCanvas.style.cursor = 'grab';
      return;
    }

    if (!(this as Record<string, unknown>)._dragReady) return;

    // End cube drag or trigger snap
    if (this.isDragging) {
      this.isDragging = false;
      if (this.cubeCanvas) this.cubeCanvas.style.cursor = 'grab';
      if (this.ctx) this.ctx.controls.enabled = true;
    } else {
      // It was a click, not a drag — snap to the clicked face/edge/corner
      const snap = (this as Record<string, unknown>)._pendingSnap as Object3D | null;
      if (snap) {
        this.snapToObject(snap);
      }
    }

    (this as Record<string, unknown>)._dragReady = false;
    (this as Record<string, unknown>)._pendingSnap = null;
  };

  // ── Camera Lock ──────────────────────────────────────────────────

  private readonly onLockClick = (e: MouseEvent): void => {
    e.stopPropagation();
    useViewerModeStore.getState().toggleCameraLocked();
  };

  private onCameraLockChanged(locked: boolean): void {
    if (!this.ctx) return;
    const controls = this.ctx.controls;
    controls.enableRotate = !locked;
    controls.enablePan = !locked;
    controls.enableZoom = !locked;

    if (this.lockBtn) {
      this.lockBtn.innerHTML = locked ? LOCK_CLOSED_SVG : LOCK_OPEN_SVG;
      this.lockBtn.title = locked ? 'Unlock camera' : 'Lock camera orientation';
      this.lockBtn.style.background = locked ? '#2563eb' : '#1f2937';
      this.lockBtn.style.color = locked ? '#ffffff' : '#9ca3af';
    }
  }

  /**
   * Snap the main camera to a top-down view looking down the Y axis.
   * Uses the same smooth animation as face clicks.
   */
  snapToTopDown(): void {
    if (!this.ctx) return;
    // TOP face: dir = (0,1,0), up = (0,0,-1)
    const target = FACES[2]; // TOP
    const cam = this.ctx.getActiveCamera();
    const controls = this.ctx.controls;

    this.animFromPos.copy(cam.position);
    this.animFromUp.copy(cam.up);
    this.animToDir.copy(target.dir);
    this.animToUp.copy(target.up);
    this.animDist = cam.position.distanceTo(controls.target);
    this.animStart = performance.now();
    this.animating = true;
    this.animIsHome = false;
  }

  private readonly onHomeClick = (e: MouseEvent): void => {
    e.stopPropagation();
    if (!this.ctx) return;

    // If no home position was captured yet, capture it now as a fallback
    if (!this.homePosition) {
      this.captureHome();
    }
    if (!this.homePosition || !this.homeTarget || !this.homeUp) return;

    const cam = this.ctx.getActiveCamera();
    const controls = this.ctx.controls;

    // Use POI as target if one is set, otherwise use the original home target
    const poi = usePoiStore.getState().position;
    const target = poi
      ? new Vector3(poi.x, poi.y, poi.z)
      : this.homeTarget.clone();

    this.animFromPos.copy(cam.position);
    this.animFromUp.copy(cam.up);

    const dir = this.homePosition.clone().sub(this.homeTarget).normalize();
    this.animToDir.copy(dir);
    this.animToUp.copy(this.homeUp);
    this.animDist = this.homePosition.distanceTo(this.homeTarget);

    this.animFromTarget = controls.target.clone();
    this.animToTarget = target;
    this.animFromDist = cam.position.distanceTo(controls.target);

    this.animStart = performance.now();
    this.animating = true;
    this.animIsHome = true;
  };

  private captureHome(): void {
    if (!this.ctx) return;
    const cam = this.ctx.getActiveCamera();
    this.homePosition = cam.position.clone();
    this.homeTarget = this.ctx.controls.target.clone();
    this.homeUp = cam.up.clone();
  }

  // ── Snap Logic ─────────────────────────────────────────────────────

  private snapToObject(obj: Object3D): void {
    const ud = obj.userData;
    let target: SnapTarget | undefined;

    if (ud.type === 'face') {
      target = FACES[ud.index];
    } else if (ud.type === 'edge') {
      target = EDGE_TARGETS[ud.index];
    } else if (ud.type === 'corner') {
      target = CORNER_TARGETS[ud.index];
    }

    if (!target || !this.ctx) return;

    const cam = this.ctx.getActiveCamera();
    const controls = this.ctx.controls;

    this.animFromPos.copy(cam.position);
    this.animFromUp.copy(cam.up);
    this.animToDir.copy(target.dir);
    this.animToUp.copy(target.up);
    this.animDist = cam.position.distanceTo(controls.target);
    this.animStart = performance.now();
    this.animating = true;
    this.animIsHome = false;
  }

  // ── Animation ──────────────────────────────────────────────────────

  private updateAnimation(controls: OrbitControls): void {
    if (!this.ctx) return;

    const elapsed = performance.now() - this.animStart;
    let t = Math.min(elapsed / ANIM_DURATION, 1);
    // Ease out cubic
    t = 1 - Math.pow(1 - t, 3);

    const cam = this.ctx.getActiveCamera();

    // For home animation, also lerp the target and distance
    if (this.animIsHome) {
      controls.target.lerpVectors(this.animFromTarget, this.animToTarget, t);
    }

    const currentDist = this.animIsHome
      ? this.animFromDist + (this.animDist - this.animFromDist) * t
      : this.animDist;

    // Slerp from current direction to target direction
    const fromDir = this.animFromPos.clone().sub(this.animIsHome ? this.animFromTarget : controls.target).normalize();
    const qFrom = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), fromDir);
    const qTo = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), this.animToDir);
    const qCurrent = qFrom.clone().slerp(qTo, t);
    const dir = new Vector3(0, 0, 1).applyQuaternion(qCurrent);

    cam.position.copy(controls.target).add(dir.multiplyScalar(currentDist));

    // During animation, interpolate the up vector for visual smoothness
    cam.up.lerpVectors(this.animFromUp, this.animToUp, t);
    controls.update();

    if (t >= 1) {
      this.animating = false;

      // After snap completes, restore camera.up to the standard Y-up.
      // OrbitControls derives its internal coordinate frame from camera.up;
      // a non-standard up (e.g. (0,0,-1) for top-down) breaks pan/orbit axes.
      // We offset the polar angle slightly from the poles to avoid gimbal lock.
      const finalDir = this.animToDir.clone();
      const absY = Math.abs(finalDir.y);
      if (absY > 0.99) {
        // Looking straight down or up — nudge camera slightly off-axis
        // so OrbitControls can resolve the up direction from (0,1,0)
        const nudge = 0.001 * currentDist;
        cam.position.z += finalDir.y > 0 ? -nudge : nudge;
      }
      cam.up.set(0, 1, 0);
      controls.update();
    }
  }
}
