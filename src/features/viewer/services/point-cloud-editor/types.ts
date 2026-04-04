export type PointId = string & { readonly __brand: 'PointId' };

export type EditOperationType =
  | 'GlobalTransform'
  | 'SetClassification'
  | 'SetIntensity'
  | 'DeletePoints'
  | 'RestorePoints'
  | 'AxisFlip';

interface EditOperationBase {
  id: string;
  timestamp: number;
  type: EditOperationType;
}

export interface GlobalTransformOp extends EditOperationBase {
  type: 'GlobalTransform';
  /** Column-major 4x4 matrix (16 floats) */
  matrix: number[];
}

export interface SetClassificationOp extends EditOperationBase {
  type: 'SetClassification';
  pointIds: PointId[];
  previousValues: number[];
  newValue: number;
}

export interface SetIntensityOp extends EditOperationBase {
  type: 'SetIntensity';
  pointIds: PointId[];
  previousValues: number[];
  newValue: number;
}

export interface DeletePointsOp extends EditOperationBase {
  type: 'DeletePoints';
  pointIds: PointId[];
}

export interface RestorePointsOp extends EditOperationBase {
  type: 'RestorePoints';
  pointIds: PointId[];
}

export interface AxisFlipOp extends EditOperationBase {
  type: 'AxisFlip';
  flipX: boolean;
  flipY: boolean;
  flipZ: boolean;
}

export type EditOperation =
  | GlobalTransformOp
  | SetClassificationOp
  | SetIntensityOp
  | DeletePointsOp
  | RestorePointsOp
  | AxisFlipOp;

export interface PointDiff {
  classification?: number;
  intensity?: number;
  deleted?: boolean;
}

export interface FlattenedEdits {
  globalTransform: Float64Array;
  axisFlip: { flipX: boolean; flipY: boolean; flipZ: boolean };
  pointEdits: Map<PointId, PointDiff>;
}

export interface EditJournalState {
  operations: EditOperation[];
  cursor: number;
}
