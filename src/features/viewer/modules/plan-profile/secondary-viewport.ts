import {
  OrthographicCamera,
  Scene,
  WebGLRenderer,
  Vector3,
} from 'three';
import { MOUSE } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * A secondary WebGL viewport with an orthographic camera and pan+zoom controls.
 * Used for the plan/profile 2D view panels.
 */
export class SecondaryViewport {
  readonly renderer: WebGLRenderer;
  readonly camera: OrthographicCamera;
  readonly controls: OrbitControls;

  private containerEl: HTMLElement | null = null;
  private frustumSize = 100;

  constructor() {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x000000, 0);

    this.camera = new OrthographicCamera(-50, 50, 50, -50, 0.1, 10000);
    this.camera.position.set(0, 500, 0);
    this.camera.lookAt(0, 0, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.updateProjectionMatrix();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableRotate = false;
    this.controls.mouseButtons = {
      LEFT: MOUSE.PAN,
      MIDDLE: MOUSE.DOLLY,
      RIGHT: MOUSE.PAN,
    };
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.zoomSpeed = 1.5;
  }

  /** Mount the renderer canvas into the given container element. */
  attach(container: HTMLElement): void {
    this.containerEl = container;
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.top = '0';
    this.renderer.domElement.style.left = '0';
    container.appendChild(this.renderer.domElement);
    this.resize();
  }

  /** Remove the canvas from the container. */
  detach(): void {
    if (this.containerEl && this.renderer.domElement.parentElement === this.containerEl) {
      this.containerEl.removeChild(this.renderer.domElement);
    }
    this.containerEl = null;
  }

  resize(): void {
    if (!this.containerEl) return;
    const { width, height } = this.containerEl.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height);
    this.updateCameraFrustum(this.frustumSize, width / height);
  }

  setCameraView(
    position: Vector3,
    target: Vector3,
    up: Vector3,
    frustumSize: number,
  ): void {
    this.frustumSize = frustumSize;
    const rect = this.containerEl?.getBoundingClientRect();
    const aspect = rect ? rect.width / rect.height : 1;

    this.camera.position.copy(position);
    this.camera.up.copy(up);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();

    this.controls.target.copy(target);
    this.controls.update();

    this.updateCameraFrustum(frustumSize, aspect);
  }

  private updateCameraFrustum(size: number, aspect: number): void {
    const h = size / 2;
    const w = h * aspect;
    this.camera.left = -w;
    this.camera.right = w;
    this.camera.top = h;
    this.camera.bottom = -h;
    this.camera.near = 0.1;
    this.camera.far = 10000;
    this.camera.updateProjectionMatrix();
  }

  render(scene: Scene): void {
    this.controls.update();
    this.renderer.render(scene, this.camera);
  }

  dispose(): void {
    this.controls.dispose();
    this.renderer.dispose();
    this.detach();
  }
}
