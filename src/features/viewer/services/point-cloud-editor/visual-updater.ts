import type { BufferGeometry } from 'three';
import type { PointCloudOctree } from 'potree-core';
import type { FlattenedEdits, PointId } from './types';
import { parsePointId } from './point-id';

type SavedOriginals = {
  classification?: Float32Array;
  intensity?: Float32Array;
};

/**
 * Applies per-point edits to loaded potree geometry buffers.
 *
 * Design invariant: when `setFlattenedEdits` is called (including on undo/redo),
 * `patchedNodes` is cleared so every visible node is re-processed next frame.
 * Re-processing first restores the node's saved original attribute values, then
 * applies only the edits that are active in the current flattened state.  This
 * means undo/redo correctly reverts points that are no longer in any active op.
 */
export class VisualUpdater {
  private pco: PointCloudOctree | null = null;
  private patchedNodes = new Set<string>();
  private flattenedEdits: FlattenedEdits | null = null;

  /** Per-node edit index: nodeName → [{pointIndex, diff}] */
  private nodeEditIndex = new Map<
    string,
    { pointIndex: number; classification?: number; intensity?: number; deleted?: boolean }[]
  >();

  /**
   * Saved original attribute values captured the first time a node is touched
   * by applyImmediate or frameUpdate.  These are used during re-patch (undo/redo)
   * to restore the true source-data values before applying the current edit set.
   */
  private savedOriginals = new Map<string, SavedOriginals>();

  attach(pco: PointCloudOctree): void {
    this.pco = pco;
    this.patchedNodes.clear();
  }

  detach(): void {
    this.pco = null;
    this.patchedNodes.clear();
    this.nodeEditIndex.clear();
    this.flattenedEdits = null;
    this.savedOriginals.clear();
  }

  /** Rebuild the per-node edit index from flattened edits (called on every undo/redo/new edit). */
  setFlattenedEdits(edits: FlattenedEdits): void {
    this.flattenedEdits = edits;
    this.nodeEditIndex.clear();
    this.patchedNodes.clear(); // trigger full re-patch next frame

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
   * Apply a single per-point edit immediately to loaded geometry buffers.
   * Captures original values before the first modification so they can be
   * restored during undo.
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

      // Capture originals before the very first modification of this node
      this.maybeCaptureOriginals(node.geometryNode.name, geometry);

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
   * Called each frame. Re-patches any visible nodes that have become unpatch
   * since the last setFlattenedEdits call.
   */
  frameUpdate(): void {
    if (!this.pco) return;
    // Skip only when nothing has ever been edited
    if (this.nodeEditIndex.size === 0 && this.savedOriginals.size === 0) return;

    for (const node of this.pco.visibleNodes) {
      const name = node.geometryNode.name;
      if (this.patchedNodes.has(name)) continue;

      const geometry = node.sceneNode?.geometry;
      if (!geometry) continue;

      const edits = this.nodeEditIndex.get(name);

      if (!edits) {
        // Node has no active edits — restore to originals if we've ever touched it
        this.restoreOriginals(name, geometry);
        this.patchedNodes.add(name);
        continue;
      }

      // Capture originals before the first frameUpdate patch (in case applyImmediate
      // was never called for this node, e.g. it was freshly loaded after an edit)
      this.maybeCaptureOriginals(name, geometry);

      // Restore to originals first so that points removed from the active edit
      // set (via undo) revert to their source-data values
      this.restoreOriginals(name, geometry);

      // Apply current active edits on top
      const classAttr = geometry.getAttribute('classification');
      const intensityAttr = geometry.getAttribute('intensity');

      for (const edit of edits) {
        if (edit.classification !== undefined && classAttr && edit.pointIndex < classAttr.count) {
          classAttr.setX(edit.pointIndex, edit.classification);
        }
        if (edit.intensity !== undefined && intensityAttr && edit.pointIndex < intensityAttr.count) {
          intensityAttr.setX(edit.pointIndex, edit.intensity);
        }
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

    this.pruneUnloadedNodes();
  }

  // --- Private helpers ---

  /**
   * Save a snapshot of the node's current attribute arrays if we haven't yet.
   * Must be called BEFORE any modification so the snapshot reflects source-data values.
   */
  private maybeCaptureOriginals(name: string, geometry: BufferGeometry): void {
    if (this.savedOriginals.has(name)) return;

    const classAttr = geometry.getAttribute('classification');
    const intensityAttr = geometry.getAttribute('intensity');

    this.savedOriginals.set(name, {
      classification: classAttr
        ? new Float32Array(classAttr.array as Float32Array)
        : undefined,
      intensity: intensityAttr
        ? new Float32Array(intensityAttr.array as Float32Array)
        : undefined,
    });
  }

  /**
   * Write saved originals back into the geometry's attribute arrays.
   * No-op if no originals exist for this node.
   */
  private restoreOriginals(name: string, geometry: BufferGeometry): void {
    const saved = this.savedOriginals.get(name);
    if (!saved) return;

    if (saved.classification) {
      const classAttr = geometry.getAttribute('classification');
      if (classAttr) {
        (classAttr.array as Float32Array).set(saved.classification);
        classAttr.needsUpdate = true;
      }
    }
    if (saved.intensity) {
      const intensityAttr = geometry.getAttribute('intensity');
      if (intensityAttr) {
        (intensityAttr.array as Float32Array).set(saved.intensity);
        intensityAttr.needsUpdate = true;
      }
    }
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
        // Node was evicted from memory — it will reload fresh from disk, so
        // the saved originals are no longer needed (reload gives fresh values)
        this.savedOriginals.delete(name);
      }
    }
  }
}
