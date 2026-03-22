export interface ClassificationClass {
  id: number;
  name: string;
  color: [number, number, number]; // RGB 0-1
}

export const CLASSIFICATION_CLASSES: ClassificationClass[] = [
  { id: 1,  name: 'Other',          color: [0.50, 0.50, 0.50] },
  { id: 2,  name: 'Roads',          color: [0.40, 0.40, 0.40] },
  { id: 3,  name: 'Sidewalks',      color: [0.70, 0.70, 0.70] },
  { id: 4,  name: 'OtherGround',    color: [0.55, 0.45, 0.30] },
  { id: 5,  name: 'TrafficIslands', color: [0.80, 0.80, 0.20] },
  { id: 6,  name: 'Buildings',      color: [0.90, 0.30, 0.20] },
  { id: 7,  name: 'Trees',          color: [0.10, 0.65, 0.15] },
  { id: 8,  name: 'OtherVegetation',color: [0.40, 0.80, 0.30] },
  { id: 9,  name: 'TrafficLights',  color: [1.00, 0.85, 0.00] },
  { id: 10, name: 'TrafficSigns',   color: [1.00, 0.55, 0.00] },
  { id: 11, name: 'Wires',          color: [0.00, 0.70, 0.90] },
  { id: 12, name: 'Masts',          color: [0.60, 0.30, 0.80] },
  { id: 13, name: 'Pedestrians',    color: [1.00, 0.40, 0.70] },
  { id: 15, name: 'TwoWheel',       color: [0.00, 0.45, 0.85] },
  { id: 16, name: 'MobFourWheel',   color: [0.20, 0.20, 0.80] },
  { id: 17, name: 'StaFourWheel',   color: [0.00, 0.30, 0.60] },
  { id: 18, name: 'Noise',          color: [0.90, 0.10, 0.10] },
  { id: 40, name: 'TreeTrunks',     color: [0.55, 0.35, 0.15] },
];
