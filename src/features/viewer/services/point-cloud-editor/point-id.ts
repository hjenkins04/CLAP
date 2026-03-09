import type { PointId } from './types';

export function makePointId(nodeName: string, pointIndex: number): PointId {
  return `${nodeName}_${pointIndex}` as PointId;
}

export function parsePointId(id: PointId): {
  nodeName: string;
  pointIndex: number;
} {
  const sep = id.lastIndexOf('_');
  return {
    nodeName: id.slice(0, sep),
    pointIndex: parseInt(id.slice(sep + 1), 10),
  };
}

export function groupByNode(
  pointIds: PointId[]
): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const id of pointIds) {
    const { nodeName, pointIndex } = parsePointId(id);
    let arr = groups.get(nodeName);
    if (!arr) {
      arr = [];
      groups.set(nodeName, arr);
    }
    arr.push(pointIndex);
  }
  return groups;
}
