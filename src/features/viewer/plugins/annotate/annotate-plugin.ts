import { Vector4 } from 'three';
import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import { CLASSIFICATION_COLORS } from '../../services/viewer-engine';
import { useAnnotateStore } from './annotate-store';

export class AnnotatePlugin implements ViewerPlugin {
  readonly id = 'annotate';
  readonly name = 'Annotate';
  readonly order = 45;

  private ctx: ViewerPluginContext | null = null;
  private unsub: (() => void) | null = null;

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;

    this.unsub = useAnnotateStore.subscribe((state, prev) => {
      if (state.classVisibility !== prev.classVisibility) {
        this.applyVisibility(state.classVisibility);
      }
    });

    // Apply persisted state on init
    this.applyVisibility(useAnnotateStore.getState().classVisibility);
  }

  onPointCloudLoaded(): void {
    this.applyVisibility(useAnnotateStore.getState().classVisibility);
  }

  dispose(): void {
    this.unsub?.();
    this.unsub = null;
    this.ctx = null;
  }

  private applyVisibility(visibility: Record<string, boolean>): void {
    if (!this.ctx) return;

    const classification: Record<string, Vector4> = {};

    for (const [key, vec] of Object.entries(CLASSIFICATION_COLORS)) {
      if (key === 'DEFAULT') {
        classification[key] = vec.clone();
        continue;
      }
      const visible = visibility[key] ?? true;
      classification[key] = new Vector4(vec.x, vec.y, vec.z, visible ? vec.w : 0);
    }

    for (const pco of this.ctx.getPointClouds()) {
      pco.material.classification = classification as unknown as typeof pco.material.classification;
    }
  }
}
