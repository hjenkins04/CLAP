import { Matrix4 } from 'three';
import type {
  EditOperation,
  FlattenedEdits,
  PointDiff,
  PointId,
} from './types';

/**
 * Flattens an ordered list of active operations into a single per-point diff map
 * and a composed global transform. Pure function — does not mutate input.
 */
export function flattenOperations(
  operations: readonly EditOperation[]
): FlattenedEdits {
  const composed = new Matrix4(); // identity
  const pointEdits = new Map<PointId, PointDiff>();

  for (const op of operations) {
    switch (op.type) {
      case 'GlobalTransform': {
        const m = new Matrix4();
        m.fromArray(op.matrix);
        composed.copy(m);
        break;
      }

      case 'SetClassification': {
        for (const id of op.pointIds) {
          const existing = pointEdits.get(id) ?? {};
          existing.classification = op.newValue;
          pointEdits.set(id, existing);
        }
        break;
      }

      case 'SetIntensity': {
        for (const id of op.pointIds) {
          const existing = pointEdits.get(id) ?? {};
          existing.intensity = op.newValue;
          pointEdits.set(id, existing);
        }
        break;
      }

      case 'DeletePoints': {
        for (const id of op.pointIds) {
          const existing = pointEdits.get(id) ?? {};
          existing.deleted = true;
          pointEdits.set(id, existing);
        }
        break;
      }

      case 'RestorePoints': {
        for (const id of op.pointIds) {
          const existing = pointEdits.get(id);
          if (existing) {
            existing.deleted = false;
          }
        }
        break;
      }
    }
  }

  const globalTransform = new Float64Array(16);
  composed.toArray(globalTransform);

  return { globalTransform, pointEdits };
}
