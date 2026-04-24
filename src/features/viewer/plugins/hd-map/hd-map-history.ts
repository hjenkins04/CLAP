/**
 * Undo/redo history for HD map edits (vertex moves, deletes, sign repositioning).
 *
 * Follows the same full-snapshot pattern as GeometryAnnotationsHistory:
 * call record() BEFORE each mutation, then undo/redo swap snapshots in/out
 * of the Zustand store.
 *
 * Exported as a singleton so it can be imported by the plugin, element browser,
 * and use-editor-state without threading it through props.
 */

import { useHdMapStore } from './hd-map-store';
import type { HdMapElement } from './hd-map-edit-model';

// ── Snapshot ──────────────────────────────────────────────────────────────────

interface HdMapSnapshot {
  elements:   HdMapElement[];
  isDirty:    boolean;
  dirtyFiles: string[];   // Set serialised as array for JSON round-trip
}

function takeSnapshot(): HdMapSnapshot {
  const s = useHdMapStore.getState();
  return JSON.parse(JSON.stringify({
    elements:   s.elements,
    isDirty:    s.isDirty,
    dirtyFiles: [...s.dirtyFiles],
  }));
}

function applySnapshot(snap: HdMapSnapshot): void {
  useHdMapStore.setState({
    elements:   snap.elements,
    isDirty:    snap.isDirty,
    dirtyFiles: new Set(snap.dirtyFiles),
  });
}

// ── History class ─────────────────────────────────────────────────────────────

type Listener = () => void;

class HdMapHistory {
  private past:   HdMapSnapshot[] = [];
  private future: HdMapSnapshot[] = [];
  private listeners = new Set<Listener>();

  /**
   * Call this BEFORE a mutation to capture the pre-mutation state.
   * Clears the redo stack (new operation invalidates the redo branch).
   */
  record(): void {
    this.past.push(takeSnapshot());
    this.future = [];
    this.emit();
  }

  undo(): void {
    if (this.past.length === 0) return;
    this.future.push(takeSnapshot());
    applySnapshot(this.past.pop()!);
    this.emit();
  }

  redo(): void {
    if (this.future.length === 0) return;
    this.past.push(takeSnapshot());
    applySnapshot(this.future.pop()!);
    this.emit();
  }

  canUndo(): boolean { return this.past.length > 0; }
  canRedo(): boolean { return this.future.length > 0; }

  /** Clear all history — call when a new project is loaded. */
  reset(): void {
    this.past   = [];
    this.future = [];
    this.emit();
  }

  on(event: 'change', cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const hdMapHistory = new HdMapHistory();
