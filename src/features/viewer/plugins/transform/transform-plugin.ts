import { Matrix4, Euler, MathUtils } from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import type { PointCloudEditor } from '../../services/point-cloud-editor';
import { useTransformStore } from './transform-store';
import { useViewerModeStore } from '@/app/stores';

const DEG2RAD = MathUtils.DEG2RAD;
const RAD2DEG = MathUtils.RAD2DEG;

export class TransformPlugin implements ViewerPlugin {
  readonly id = 'transform';
  readonly name = 'Transform';
  readonly order = 50;

  private ctx: ViewerPluginContext | null = null;
  private gizmo: TransformControls | null = null;
  private editor: PointCloudEditor | null = null;
  private unsubTransform: (() => void) | null = null;
  private unsubMode: (() => void) | null = null;
  private unsubEditor: (() => void) | null = null;
  private hasPointCloud = false;

  /** Guard flag to prevent store→editor feedback loops during programmatic syncs. */
  private syncing = false;

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;
    this.editor = ctx.getEditor();

    // Create TransformControls
    this.gizmo = new TransformControls(
      ctx.getActiveCamera(),
      ctx.domElement
    );
    this.gizmo.setSpace('local');
    this.gizmo.visible = false;
    this.gizmo.enabled = false;
    ctx.worldRoot.add(this.gizmo);

    // Disable orbit controls while dragging gizmo.
    // On drag END: commit the final matrix and update store readouts.
    this.gizmo.addEventListener('dragging-changed', (event) => {
      ctx.controls.enabled = !event.value;

      if (!event.value) {
        this.commitCurrentTransform();
        this.syncGroupToStore();
      }
    });

    // Subscribe to transform store (snap settings, reset)
    this.unsubTransform = useTransformStore.subscribe((state, prevState) => {
      this.onTransformStoreChange(state, prevState);
    });

    // Subscribe to viewer mode store (enable/disable/mode)
    this.unsubMode = useViewerModeStore.subscribe((state, prevState) => {
      this.onModeChange(state, prevState);
    });

    // Subscribe to editor events to sync the group matrix back to the store
    const syncOnEvent = () => this.syncGroupToStore();
    const unsub1 = this.editor.on('undoRedo', syncOnEvent);
    const unsub2 = this.editor.on('loaded', syncOnEvent);
    this.unsubEditor = () => { unsub1(); unsub2(); };

    // Apply initial state
    this.applySettings(useTransformStore.getState());
    this.applyModeState(useViewerModeStore.getState());
  }

  onUpdate(): void {
    // Keep gizmo camera in sync (needed when switching perspective/ortho)
    if (this.gizmo && this.ctx) {
      const cam = this.ctx.getActiveCamera();
      if (this.gizmo.camera !== cam) {
        this.gizmo.camera = cam;
      }
    }
  }

  onPointCloudLoaded(): void {
    this.hasPointCloud = true;

    const modeState = useViewerModeStore.getState();
    if (modeState.mode === 'transform' && this.gizmo && !this.gizmo.object) {
      this.attachGizmo();
    }

    this.syncGroupToStore();
  }

  onPointCloudsUnloaded(): void {
    this.hasPointCloud = false;
    this.detachGizmo();
  }

  dispose(): void {
    this.unsubTransform?.();
    this.unsubTransform = null;
    this.unsubMode?.();
    this.unsubMode = null;
    this.unsubEditor?.();
    this.unsubEditor = null;

    this.detachGizmo();

    if (this.gizmo && this.ctx) {
      this.ctx.worldRoot.remove(this.gizmo);
      this.gizmo.dispose();
      this.gizmo = null;
    }

    this.editor = null;
    this.ctx = null;
  }

  // --- Mode store reactions ---

  private onModeChange(
    state: ReturnType<typeof useViewerModeStore.getState>,
    prevState: ReturnType<typeof useViewerModeStore.getState>
  ): void {
    const wasTransform = prevState.mode === 'transform';
    const isTransform = state.mode === 'transform';

    if (isTransform && !wasTransform) {
      this.attachGizmo();
    } else if (!isTransform && wasTransform) {
      this.detachGizmo();
    }

    if (isTransform) {
      this.applyModeState(state);
    }
  }

  private applyModeState(
    state: ReturnType<typeof useViewerModeStore.getState>
  ): void {
    if (!this.gizmo || state.mode !== 'transform') return;
    this.gizmo.setMode(state.transformSubMode);
  }

  // --- Transform store reactions ---

  private onTransformStoreChange(
    state: ReturnType<typeof useTransformStore.getState>,
    prevState: ReturnType<typeof useTransformStore.getState>
  ): void {
    if (this.syncing) return;

    this.applySettings(state);

    // If position/rotation changed via reset button
    if (
      state.positionX !== prevState.positionX ||
      state.positionY !== prevState.positionY ||
      state.positionZ !== prevState.positionZ ||
      state.rotationX !== prevState.rotationX ||
      state.rotationY !== prevState.rotationY ||
      state.rotationZ !== prevState.rotationZ
    ) {
      this.applyUserTransform(state);
    }
  }

  private applySettings(
    state: ReturnType<typeof useTransformStore.getState>
  ): void {
    if (!this.gizmo) return;

    this.gizmo.setTranslationSnap(
      state.translateSnapEnabled ? state.translateSnapValue : null
    );
    this.gizmo.setRotationSnap(
      state.rotateSnapEnabled ? state.rotateSnapDegrees * DEG2RAD : null
    );
  }

  /** Push a transform from store values to the editor (e.g. reset button). */
  private applyUserTransform(
    state: ReturnType<typeof useTransformStore.getState>
  ): void {
    if (!this.editor) return;

    const m = new Matrix4();
    const euler = new Euler(
      state.rotationX * DEG2RAD,
      state.rotationY * DEG2RAD,
      state.rotationZ * DEG2RAD
    );
    m.makeRotationFromEuler(euler);
    m.setPosition(state.positionX, state.positionY, state.positionZ);

    this.editor.setGlobalTransform(m);
  }

  /** Commit the current group matrix to the editor journal (one op per drag). */
  private commitCurrentTransform(): void {
    if (!this.editor) return;

    const group = this.editor.getTransformGroup();
    group.updateMatrix();
    this.editor.setGlobalTransform(group.matrix.clone());
  }

  /** Read the group's decomposed position/rotation and update the store readouts. */
  private syncGroupToStore(): void {
    if (!this.editor) return;

    const group = this.editor.getTransformGroup();
    const pos = group.position;
    const rot = group.rotation;
    const store = useTransformStore.getState();

    this.syncing = true;
    store.setPosition(
      parseFloat(pos.x.toFixed(4)),
      parseFloat(pos.y.toFixed(4)),
      parseFloat(pos.z.toFixed(4))
    );
    store.setRotation(
      parseFloat((rot.x * RAD2DEG).toFixed(2)),
      parseFloat((rot.y * RAD2DEG).toFixed(2)),
      parseFloat((rot.z * RAD2DEG).toFixed(2))
    );
    this.syncing = false;
  }

  private attachGizmo(): void {
    if (!this.gizmo || !this.editor || !this.hasPointCloud) return;
    const group = this.editor.getTransformGroup();
    this.gizmo.attach(group);
    this.gizmo.visible = true;
    this.gizmo.enabled = true;
  }

  private detachGizmo(): void {
    if (!this.gizmo) return;
    this.gizmo.detach();
    this.gizmo.visible = false;
    this.gizmo.enabled = false;
  }
}
