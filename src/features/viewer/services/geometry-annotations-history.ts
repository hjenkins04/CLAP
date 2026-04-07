/**
 * Undo/redo history for geometry annotations (polygons + static obstacles).
 *
 * Uses full-snapshot diffing: each recorded operation captures the complete
 * state of both annotation stores before the mutation. Undo/redo swap
 * snapshots in and out of both Zustand stores.
 *
 * Exported as a singleton so it can be imported from plugins, panels, and hooks
 * without threading it through props.
 */

import { usePolyAnnotStore } from '../plugins/polygon-annotation/polygon-annotation-store';
import { useStaticObstacleStore } from '../plugins/static-obstacle/static-obstacle-store';
import type { PolygonAnnotation, PolygonLayer } from '../plugins/polygon-annotation/polygon-annotation-types';
import type { Annotation3D, AnnotationLayer3D } from '../plugins/static-obstacle/static-obstacle-types';

// ── Snapshot type ──────────────────────────────────────────────────────────────

export interface GeometrySnapshot {
  polygons: {
    layers: PolygonLayer[];
    annotations: PolygonAnnotation[];
    labelCounters: Record<string, number>;
  };
  obstacles: {
    layers: AnnotationLayer3D[];
    annotations: Annotation3D[];
    labelCounters: Record<string, number>;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function takeSnapshot(): GeometrySnapshot {
  const poly = usePolyAnnotStore.getState();
  const obs  = useStaticObstacleStore.getState();
  // Deep-clone via JSON so future mutations to store don't corrupt the snapshot.
  return JSON.parse(JSON.stringify({
    polygons: {
      layers:        poly.layers,
      annotations:   poly.annotations,
      labelCounters: poly.labelCounters,
    },
    obstacles: {
      layers:        obs.layers,
      annotations:   obs.annotations,
      labelCounters: obs.labelCounters,
    },
  }));
}

function applySnapshot(snap: GeometrySnapshot): void {
  usePolyAnnotStore.setState({
    layers:        snap.polygons.layers,
    annotations:   snap.polygons.annotations,
    labelCounters: snap.polygons.labelCounters,
  });
  useStaticObstacleStore.setState({
    layers:        snap.obstacles.layers,
    annotations:   snap.obstacles.annotations,
    labelCounters: snap.obstacles.labelCounters,
  });
}

// ── History class ──────────────────────────────────────────────────────────────

type Listener = () => void;

class GeometryAnnotationsHistory {
  private past: GeometrySnapshot[]   = [];
  private future: GeometrySnapshot[] = [];
  /** Dirty flag — set on record(), cleared on markSaved(). Simple and avoids store access. */
  private _dirty = false;

  private listeners = new Set<Listener>();

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Call this BEFORE a mutation to capture the pre-mutation state.
   * Clears the redo stack (new operation invalidates the redo branch).
   */
  record(): void {
    this.past.push(takeSnapshot());
    this.future = [];
    this._dirty = true;
    this.emit();
  }

  undo(): void {
    if (this.past.length === 0) return;
    this.future.push(takeSnapshot());
    const prev = this.past.pop()!;
    applySnapshot(prev);
    this._dirty = true;
    this.emit();
  }

  redo(): void {
    if (this.future.length === 0) return;
    this.past.push(takeSnapshot());
    const next = this.future.pop()!;
    applySnapshot(next);
    this._dirty = true;
    this.emit();
  }

  canUndo(): boolean { return this.past.length > 0; }
  canRedo(): boolean { return this.future.length > 0; }
  isDirty(): boolean { return this._dirty; }

  /** Called after a successful save — marks current state as clean. */
  markSaved(): void {
    this._dirty = false;
    this.emit();
  }

  /**
   * Clears undo/redo stacks — call when a new project/point-cloud is loaded
   * so stale history from a previous session doesn't leak.
   */
  reset(): void {
    this.past    = [];
    this.future  = [];
    this._dirty  = false;
    this.emit();
  }

  on(event: 'change', cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const geoAnnotHistory = new GeometryAnnotationsHistory();
