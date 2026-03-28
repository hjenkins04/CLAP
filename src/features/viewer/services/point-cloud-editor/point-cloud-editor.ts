import { Group, Matrix4, Euler, MathUtils, Vector3, Quaternion } from 'three';
import type { PointCloudOctree } from 'potree-core';
import type {
  PointId,
  EditOperation,
  FlattenedEdits,
  EditJournalState,
} from './types';
import { EditJournal } from './edit-journal';
import { flattenOperations } from './edit-flattener';
import { VisualUpdater } from './visual-updater';
import {
  serializeFlattened,
  deserializeFlattened,
  serializeJournal,
  deserializeJournal,
} from './binary-persistence';

type EditorEvent = 'operationAdded' | 'undoRedo' | 'saved' | 'loaded' | 'dirty';

export class PointCloudEditor {
  private journal = new EditJournal();
  private visualUpdater = new VisualUpdater();
  private pcoGroup = new Group();
  private pco: PointCloudOctree | null = null;
  private basePath: string | null = null;
  private flattenedCache: FlattenedEdits | null = null;
  private listeners = new Map<EditorEvent, Set<() => void>>();
  private opCounter = 0;

  getTransformGroup(): Group {
    return this.pcoGroup;
  }

  // --- Lifecycle ---

  async attach(
    pco: PointCloudOctree,
    scene: { add: (obj: unknown) => void; remove: (obj: unknown) => void },
    basePath: string
  ): Promise<void> {
    this.pco = pco;
    this.basePath = basePath;

    // Reparent PCO into our group
    scene.remove(pco);
    this.pcoGroup.add(pco);
    scene.add(this.pcoGroup);

    this.visualUpdater.attach(pco);

    // Try to load existing edits
    await this.load();
  }

  detach(): void {
    this.visualUpdater.detach();
    this.journal.clear();
    this.flattenedCache = null;
    this.pco = null;
    this.basePath = null;

    // Move PCOs back out of group
    while (this.pcoGroup.children.length > 0) {
      this.pcoGroup.remove(this.pcoGroup.children[0]);
    }
  }

  // --- Editing API ---

  translate(dx: number, dy: number, dz: number): void {
    const m = new Matrix4();
    m.copy(this.getCurrentTransformMatrix());
    const t = new Matrix4().makeTranslation(dx, dy, dz);
    m.premultiply(t);
    this.pushGlobalTransform(m);
  }

  rotate(rx: number, ry: number, rz: number): void {
    const m = new Matrix4();
    m.copy(this.getCurrentTransformMatrix());
    const r = new Matrix4().makeRotationFromEuler(
      new Euler(
        rx * MathUtils.DEG2RAD,
        ry * MathUtils.DEG2RAD,
        rz * MathUtils.DEG2RAD
      )
    );
    m.premultiply(r);
    this.pushGlobalTransform(m);
  }

  setGlobalTransform(matrix: Matrix4): void {
    this.pushGlobalTransform(matrix);
  }

  setClassification(pointIds: PointId[], classValue: number): void {
    if (pointIds.length === 0) return;

    // Capture previous values for undo
    const previousValues = this.getPreviousClassifications(pointIds);

    const op: EditOperation = {
      id: this.nextOpId(),
      timestamp: Date.now(),
      type: 'SetClassification',
      pointIds: [...pointIds],
      previousValues,
      newValue: classValue,
    };

    this.journal.push(op);
    this.invalidateFlatCache();

    // Immediate visual update
    this.visualUpdater.applyImmediate(pointIds, 'classification', classValue);
    this.emit('operationAdded');
  }

  setIntensity(pointIds: PointId[], value: number): void {
    if (pointIds.length === 0) return;

    const previousValues = this.getPreviousIntensities(pointIds);

    const op: EditOperation = {
      id: this.nextOpId(),
      timestamp: Date.now(),
      type: 'SetIntensity',
      pointIds: [...pointIds],
      previousValues,
      newValue: value,
    };

    this.journal.push(op);
    this.invalidateFlatCache();
    this.visualUpdater.applyImmediate(pointIds, 'intensity', value);
    this.emit('operationAdded');
  }

  deletePoints(pointIds: PointId[]): void {
    if (pointIds.length === 0) return;

    const op: EditOperation = {
      id: this.nextOpId(),
      timestamp: Date.now(),
      type: 'DeletePoints',
      pointIds: [...pointIds],
    };

    this.journal.push(op);
    this.invalidateFlatCache();
    this.rebuildVisuals();
    this.emit('operationAdded');
  }

  restorePoints(pointIds: PointId[]): void {
    if (pointIds.length === 0) return;

    const op: EditOperation = {
      id: this.nextOpId(),
      timestamp: Date.now(),
      type: 'RestorePoints',
      pointIds: [...pointIds],
    };

    this.journal.push(op);
    this.invalidateFlatCache();
    this.rebuildVisuals();
    this.emit('operationAdded');
  }

  // --- Undo/Redo ---

  undo(): void {
    const op = this.journal.undo();
    if (!op) return;
    this.invalidateFlatCache();

    // Immediately revert the visual effect of the undone operation.
    // rebuildVisuals() alone won't restore GPU buffers for nodes whose
    // only edit was the undone op — applyImmediateMany handles that gap.
    if (op.type === 'SetClassification') {
      this.visualUpdater.applyImmediateMany(op.pointIds, 'classification', op.previousValues);
    } else if (op.type === 'SetIntensity') {
      this.visualUpdater.applyImmediateMany(op.pointIds, 'intensity', op.previousValues);
    }

    this.rebuildVisuals();
    this.applyGlobalTransformFromFlattened();
    this.emit('undoRedo');
  }

  redo(): void {
    const op = this.journal.redo();
    if (!op) return;
    this.invalidateFlatCache();
    this.rebuildVisuals();
    this.applyGlobalTransformFromFlattened();
    this.emit('undoRedo');
  }

  canUndo(): boolean {
    return this.journal.canUndo();
  }

  canRedo(): boolean {
    return this.journal.canRedo();
  }

  // --- Query ---

  flatten(): FlattenedEdits {
    if (!this.flattenedCache) {
      this.flattenedCache = flattenOperations(
        this.journal.getActiveOperations()
      );
    }
    return this.flattenedCache;
  }

  isDirty(): boolean {
    return this.journal.isDirty();
  }

  getJournal(): Readonly<EditJournalState> {
    return this.journal.getState();
  }

  // --- Persistence ---

  getBasePath(): string | null {
    return this.basePath;
  }

  setBasePath(path: string): void {
    this.basePath = path;
  }

  async save(): Promise<void> {
    if (!this.basePath) return;

    const flattened = this.flatten();
    const journalState = this.journal.getState();

    // Write both files
    const editsBuffer = serializeFlattened(flattened);
    const journalBuffer = serializeJournal(journalState);

    await this.writeFile(`${this.basePath}edits.bin`, editsBuffer);
    await this.writeFile(`${this.basePath}edits.journal.bin`, journalBuffer);

    this.journal.markSaved();
    this.emit('saved');
  }

  async load(): Promise<void> {
    if (!this.basePath) return;

    // Try loading the journal first (has full undo history)
    const journalPath = `${this.basePath}edits.journal.bin`;
    const journalBuffer = await this.readFile(journalPath);
    if (journalBuffer) {
      try {
        const state = deserializeJournal(journalBuffer);
        this.journal.loadState(state);
        this.opCounter = state.operations.length;
        this.invalidateFlatCache();
        this.rebuildVisuals();
        this.applyGlobalTransformFromFlattened();
        this.emit('loaded');
        return;
      } catch (err) {
        console.warn('[CLAP] Failed to parse edit journal, falling back:', err);
      }
    }

    // Fallback: load flattened edits (no undo history)
    const editsPath = `${this.basePath}edits.bin`;
    const editsBuffer = await this.readFile(editsPath);
    if (editsBuffer) {
      try {
        const flattened = deserializeFlattened(editsBuffer);
        this.flattenedCache = flattened;
        this.visualUpdater.setFlattenedEdits(flattened);
        this.applyGlobalTransformFromFlattened();
        console.info(`[CLAP] Loaded flattened edits from ${editsPath}`);
        this.emit('loaded');
      } catch (err) {
        console.warn('[CLAP] Failed to parse flattened edits:', err);
      }
    }
  }

  // --- Frame Update ---

  frameUpdate(): void {
    this.visualUpdater.frameUpdate();
  }

  // --- Events ---

  on(event: EditorEvent, cb: () => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  }

  // --- Private ---

  private pushGlobalTransform(matrix: Matrix4): void {
    const arr: number[] = [];
    matrix.toArray(arr);

    const op: EditOperation = {
      id: this.nextOpId(),
      timestamp: Date.now(),
      type: 'GlobalTransform',
      matrix: arr,
    };

    this.journal.push(op);
    this.invalidateFlatCache();

    this.applyMatrixToGroup(matrix);
    this.emit('operationAdded');
  }

  private applyGlobalTransformFromFlattened(): void {
    const flat = this.flatten();
    const m = new Matrix4();
    m.fromArray(flat.globalTransform);
    this.applyMatrixToGroup(m);
  }

  /** Apply a matrix to the group, decomposing into position/rotation/scale
   *  so that TransformControls (which reads those properties) stays in sync. */
  private applyMatrixToGroup(m: Matrix4): void {
    const pos = new Vector3();
    const quat = new Quaternion();
    const scl = new Vector3();
    m.decompose(pos, quat, scl);

    this.pcoGroup.position.copy(pos);
    this.pcoGroup.quaternion.copy(quat);
    this.pcoGroup.scale.copy(scl);
    this.pcoGroup.updateMatrix();
    this.pcoGroup.matrixWorldNeedsUpdate = true;
  }

  private getCurrentTransformMatrix(): Matrix4 {
    return this.pcoGroup.matrix.clone();
  }

  private rebuildVisuals(): void {
    const flat = this.flatten();
    this.visualUpdater.setFlattenedEdits(flat);
  }

  private getPreviousClassifications(pointIds: PointId[]): number[] {
    const flat = this.flatten();
    return pointIds.map((id) => {
      const diff = flat.pointEdits.get(id);
      return diff?.classification ?? 0;
    });
  }

  private getPreviousIntensities(pointIds: PointId[]): number[] {
    const flat = this.flatten();
    return pointIds.map((id) => {
      const diff = flat.pointEdits.get(id);
      return diff?.intensity ?? 0;
    });
  }

  private invalidateFlatCache(): void {
    this.flattenedCache = null;
  }

  private emit(event: EditorEvent): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const cb of set) cb();
    }
  }

  private nextOpId(): string {
    return `op_${++this.opCounter}_${Date.now()}`;
  }

  private async writeFile(filePath: string, data: ArrayBuffer): Promise<void> {
    if (window.electron) {
      await window.electron.invoke('write-file', { path: filePath, data });
    } else {
      await idbPut(filePath, data);
    }
  }

  private async readFile(filePath: string): Promise<ArrayBuffer | null> {
    if (window.electron) {
      return await window.electron.invoke<ArrayBuffer | null>('read-file', {
        path: filePath,
      });
    } else {
      try {
        const url = `${filePath}?t=${Date.now()}`;
        const resp = await fetch(url);
        if (resp.ok) return await resp.arrayBuffer();
      } catch {
        // fetch failed, try IndexedDB
      }
      return await idbGet(filePath);
    }
  }
}

// --- Simple IndexedDB fallback for browser dev mode ---

const IDB_NAME = 'clap-editor';
const IDB_STORE = 'files';

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: ArrayBuffer): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key: string): Promise<ArrayBuffer | null> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}
