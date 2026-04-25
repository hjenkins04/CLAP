import type { ClassificationLegend } from './types';

/**
 * Baked-in fallback legend used when a project folder does not ship its own
 * `classification_legend.json`. Mirrors the historic CLASSIFICATION_CLASSES /
 * CLASSIFICATION_COLORS pair that was previously hardcoded in
 * viewer-engine.ts and annotate/classification-classes.ts.
 */
export const DEFAULT_CLASSIFICATION_LEGEND: ClassificationLegend = {
  version: 1,
  name: 'Default (AutoDrive / FLAINet)',
  defaultColor: '#4d4d4d',
  groups: [{ id: 'default', name: 'Classes', defaultExpanded: true }],
  classes: [
    { id: 1,  groupId: 'default', name: 'Other',            color: '#808080' },
    { id: 2,  groupId: 'default', name: 'Roads',            color: '#666666' },
    { id: 3,  groupId: 'default', name: 'Sidewalks',        color: '#b3b3b3' },
    { id: 4,  groupId: 'default', name: 'OtherGround',      color: '#8c734d' },
    { id: 5,  groupId: 'default', name: 'TrafficIslands',   color: '#cccc33' },
    { id: 6,  groupId: 'default', name: 'Buildings',        color: '#e64d33' },
    { id: 7,  groupId: 'default', name: 'Trees',            color: '#1aa626' },
    { id: 8,  groupId: 'default', name: 'OtherVegetation',  color: '#66cc4d' },
    { id: 9,  groupId: 'default', name: 'TrafficLights',    color: '#ffd900' },
    { id: 10, groupId: 'default', name: 'TrafficSigns',     color: '#ff8c00' },
    { id: 11, groupId: 'default', name: 'Wires',            color: '#00b3e6' },
    { id: 12, groupId: 'default', name: 'Masts',            color: '#994dcc' },
    { id: 13, groupId: 'default', name: 'Pedestrians',      color: '#ff66b3' },
    { id: 15, groupId: 'default', name: 'TwoWheel',         color: '#0073d9' },
    { id: 16, groupId: 'default', name: 'MobFourWheel',     color: '#3333cc' },
    { id: 17, groupId: 'default', name: 'StaFourWheel',     color: '#004d99' },
    { id: 18, groupId: 'default', name: 'Noise',            color: '#e61a1a' },
    { id: 40, groupId: 'default', name: 'TreeTrunks',       color: '#8c5926' },
  ],
};
