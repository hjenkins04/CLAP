import type { PointCloudOctree } from 'potree-core';
import type { FlattenedEdits, PointId } from './types';
import { parsePointId } from './point-id';

/**
 * Applies per-point edits to loaded potree geometry buffers.
 * Tracks which nodes have been patched and re-patches when nodes reload.
 */
export class VisualUpdater {
  private pco: PointCloudOctree | null = null;
  private patchedNodes = new Set<string>();
  private flattenedEdits: FlattenedEdits | null = null;

  /** Index: nodeName → array of { pointIndex, diff } for fast lookup */
  private nodeEditIndex = new Map<
    string,
    { pointIndex: number; classification?: number; intensity?: number; deleted?: boolean }[]
  >();

  attach(pco: PointCloudOctree): void {
    this.pco = pco;
    this.patchedNodes.clear();
  }

  detach(): void {
    this.pco = null;
    this.patchedNodes.clear();
    this.nodeEditIndex.clear();
    this.flattenedEdits = null;
  }

  /** Rebuild the per-node edit index from flattened edits. */
  setFlattenedEdits(edits: FlattenedEdits): void {
    this.flattenedEdits = edits;
    this.nodeEditIndex.clear();
    this.patchedNodes.clear();

    for (const [id, diff] of edits.pointEdits) {
      const { nodeName, pointIndex } = parsePointId(id);
      let arr = this.nodeEditIndex.get(nodeName);
      if (!arr) {
        arr = [];
        this.nodeEditIndex.set(nodeName, arr);
      }
      arr.push({ pointIndex, ...diff });
    }
  }

  /**
   * Apply a single per-point edit immediately to loaded geometry.
   * Used for real-time feedback when the user makes an edit.
   */
  applyImmediate(
    pointIds: PointId[],
    attribute: 'classification' | 'intensity',
    value: number
  ): void {
    if (!this.pco) return;

    const nodeGroups = new Map<string, number[]>();
    for (const id of pointIds) {
      const { nodeName, pointIndex } = parsePointId(id);
      let arr = nodeGroups.get(nodeName);
      if (!arr) {
        arr = [];
        nodeGroups.set(nodeName, arr);
      }
      arr.push(pointIndex);
    }

    for (const node of this.pco.visibleNodes) {
      const indices = nodeGroups.get(node.geometryNode.name);
      if (!indices) continue;

      const geometry = node.sceneNode?.geometry;
      if (!geometry) continue;

      const attr = geometry.getAttribute(attribute);
      if (!attr) continue;

      for (const idx of indices) {
        if (idx < attr.count) {
          attr.setX(idx, value);
        }
      }
      attr.needsUpdate = true;
    }
  }

  /**
   * Apply per-point varying values to loaded geometry. Used when undoing
   * an operation where each point needs its own distinct previous value restored.
   */
  applyImmediateMany(
    pointIds: PointId[],
    attribute: 'classification' | 'intensity',
    values: number[],
  ): void {
    if (!this.pco) return;

    const nodeGroups = new Map<string, { pointIndex: number; value: number }[]>();
    for (let i = 0; i < pointIds.length; i++) {
      const { nodeName, pointIndex } = parsePointId(pointIds[i]);
      let arr = nodeGroups.get(nodeName);
      if (!arr) {
        arr = [];
        nodeGroups.set(nodeName, arr);
      }
      arr.push({ pointIndex, value: values[i] });
    }

    for (const node of this.pco.visibleNodes) {
      const entries = nodeGroups.get(node.geometryNode.name);
      if (!entries) continue;

      const geometry = node.sceneNode?.geometry;
      if (!geometry) continue;

      const attr = geometry.getAttribute(attribute);
      if (!attr) continue;

      for (const { pointIndex, value } of entries) {
        if (pointIndex < attr.count) {
          attr.setX(pointIndex, value);
        }
      }
      attr.needsUpdate = true;
    }
  }

  /**
   * Called each frame. Checks for newly loaded nodes and patches them
   * with any pending edits from the flattened state.
   */
  frameUpdate(): void {
    if (!this.pco || this.nodeEditIndex.size === 0) return;

    for (const node of this.pco.visibleNodes) {
      const name = node.geometryNode.name;
      if (this.patchedNodes.has(name)) continue;

      const edits = this.nodeEditIndex.get(name);
      if (!edits) {
        // No edits for this node, mark as patched to skip next frame
        this.patchedNodes.add(name);
        continue;
      }

      const geometry = node.sceneNode?.geometry;
      if (!geometry) continue;

      const classAttr = geometry.getAttribute('classification');
      const intensityAttr = geometry.getAttribute('intensity');

      for (const edit of edits) {
        if (edit.classification !== undefined && classAttr && edit.pointIndex < classAttr.count) {
          classAttr.setX(edit.pointIndex, edit.classification);
        }
        if (edit.intensity !== undefined && intensityAttr && edit.pointIndex < intensityAttr.count) {
          intensityAttr.setX(edit.pointIndex, edit.intensity);
        }
        // Deleted points: set position to Infinity to clip them
        if (edit.deleted) {
          const posAttr = geometry.getAttribute('position');
          if (posAttr && edit.pointIndex < posAttr.count) {
            posAttr.setXYZ(edit.pointIndex, Infinity, Infinity, Infinity);
            posAttr.needsUpdate = true;
          }
        }
      }

      if (classAttr) classAttr.needsUpdate = true;
      if (intensityAttr) intensityAttr.needsUpdate = true;

      this.patchedNodes.add(name);
    }

    // Invalidate nodes that were unloaded (so they get re-patched on reload)
    this.pruneUnloadedNodes();
  }

  private pruneUnloadedNodes(): void {
    if (!this.pco) return;

    const visibleNames = new Set<string>();
    for (const node of this.pco.visibleNodes) {
      visibleNames.add(node.geometryNode.name);
    }

    for (const name of this.patchedNodes) {
      if (!visibleNames.has(name)) {
        this.patchedNodes.delete(name);
      }
    }
  }
}
