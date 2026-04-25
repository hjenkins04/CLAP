export { DEFAULT_CLASSIFICATION_LEGEND } from './default-legend';
export { useClassificationLegendStore } from './classification-legend-store';
export {
  fetchProjectLegend,
  loadDefaultLegend,
  validateLegend,
  buildMaterialClassification,
  deriveInitialVisibility,
  deriveInitialActive,
  findLegendClass,
  isClassVisible,
  parseColor,
} from './legend-loader';
export type {
  ClassificationLegend,
  LegendGroup,
  LegendClass,
  LegendRange,
} from './types';
