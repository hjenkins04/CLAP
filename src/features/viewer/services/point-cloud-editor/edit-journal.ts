import type { EditOperation, EditJournalState } from './types';

export class EditJournal {
  private operations: EditOperation[] = [];
  private cursor = 0;
  private savedCursor = 0;

  push(op: EditOperation): void {
    // Truncate any redo history beyond the cursor
    if (this.cursor < this.operations.length) {
      this.operations.length = this.cursor;
    }
    this.operations.push(op);
    this.cursor = this.operations.length;
  }

  undo(): EditOperation | null {
    if (this.cursor <= 0) return null;
    this.cursor--;
    return this.operations[this.cursor];
  }

  redo(): EditOperation | null {
    if (this.cursor >= this.operations.length) return null;
    const op = this.operations[this.cursor];
    this.cursor++;
    return op;
  }

  canUndo(): boolean {
    return this.cursor > 0;
  }

  canRedo(): boolean {
    return this.cursor < this.operations.length;
  }

  /** Returns the active operations (up to cursor, excluding undone). */
  getActiveOperations(): readonly EditOperation[] {
    return this.operations.slice(0, this.cursor);
  }

  getState(): EditJournalState {
    return {
      operations: [...this.operations],
      cursor: this.cursor,
    };
  }

  loadState(state: EditJournalState): void {
    this.operations = [...state.operations];
    // Clamp cursor to valid range; default to end if 0 with ops (legacy files)
    this.cursor = state.cursor > 0
      ? Math.min(state.cursor, this.operations.length)
      : this.operations.length;
    this.savedCursor = this.cursor;
  }

  markSaved(): void {
    this.savedCursor = this.cursor;
  }

  clear(): void {
    this.operations = [];
    this.cursor = 0;
    this.savedCursor = 0;
  }

  isDirty(): boolean {
    return this.cursor !== this.savedCursor;
  }
}
