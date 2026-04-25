import type { ViewerPlugin, ViewerPluginContext } from '../../types';
import {
  useClassificationLegendStore,
  buildMaterialClassification,
} from '../../services/classification-legend';
import { useAnnotateStore } from './annotate-store';

export class AnnotatePlugin implements ViewerPlugin {
  readonly id = 'annotate';
  readonly name = 'Annotate';
  readonly order = 45;

  private ctx: ViewerPluginContext | null = null;
  private unsubVisibility: (() => void) | null = null;
  private unsubLegend: (() => void) | null = null;

  onInit(ctx: ViewerPluginContext): void {
    this.ctx = ctx;

    this.unsubVisibility = useAnnotateStore.subscribe((state, prev) => {
      if (state.classVisibility !== prev.classVisibility) this.apply();
    });

    this.unsubLegend = useClassificationLegendStore.subscribe((state, prev) => {
      if (state.legend !== prev.legend) this.apply();
    });

    this.apply();
  }

  onPointCloudLoaded(): void {
    this.apply();
  }

  dispose(): void {
    this.unsubVisibility?.();
    this.unsubLegend?.();
    this.unsubVisibility = null;
    this.unsubLegend = null;
    this.ctx = null;
  }

  private apply(): void {
    if (!this.ctx) return;

    const legend = useClassificationLegendStore.getState().legend;
    const visibility = useAnnotateStore.getState().classVisibility;
    const classification = buildMaterialClassification(legend, visibility);

    for (const pco of this.ctx.getPointClouds()) {
      pco.material.classification = classification as unknown as typeof pco.material.classification;
    }
  }
}
