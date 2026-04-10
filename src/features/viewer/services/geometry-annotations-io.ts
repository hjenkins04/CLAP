/**
 * Loads and saves geometry-annotations.bin alongside the point cloud files.
 * On load: replaces store contents with the file data.
 * On save: snapshots both stores into the file.
 */

import { usePolyAnnotStore } from '../plugins/polygon-annotation/polygon-annotation-store';
import { useStaticObstacleStore } from '../plugins/static-obstacle/static-obstacle-store';
import {
  serializeGeometryAnnotations,
  deserializeGeometryAnnotations,
  type GeometryAnnotationsFile,
} from './geometry-annotations-persistence';

const FILENAME = 'geometry-annotations.bin';

// ── File I/O helpers (mirrors point-cloud-editor pattern) ─────────────────────

async function readFile(path: string): Promise<ArrayBuffer | null> {
  if (window.electron) {
    return window.electron.invoke<ArrayBuffer | null>('read-file', { path });
  }
  // Browser dev fallback: try fetch
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return res.arrayBuffer();
  } catch {
    return null;
  }
}

async function writeFile(path: string, data: ArrayBuffer): Promise<void> {
  if (window.electron) {
    await window.electron.invoke('write-file', { path, data });
    return;
  }
  // Browser dev fallback: no-op (cannot write to filesystem)
  console.warn('[CLAP] geometry-annotations-io: write-file not available in browser mode');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Reads geometry-annotations.bin from `basePath` and populates both stores.
 * Always clears both stores first so stale data from a previously loaded
 * project never bleeds into the new one (even if the new project has no file).
 */
export async function loadGeometryAnnotations(basePath: string): Promise<void> {
  // Clear both stores unconditionally — ensures a clean slate when switching
  // projects, regardless of whether the new project has a bin file.
  usePolyAnnotStore.setState({
    layers: [],
    annotations: [],
    labelCounters: {},
    activeLayerId: null,
    isDirty: false,
  });
  useStaticObstacleStore.setState({
    layers: [],
    annotations: [],
    labelCounters: {},
    activeLayerId: null,
    isDirty: false,
  });

  const path = `${basePath}${FILENAME}`;
  const buffer = await readFile(path);
  if (!buffer) return; // new project — no file yet, stores stay empty

  const data = deserializeGeometryAnnotations(buffer);
  if (!data) return;

  // Replace polygon annotation store contents
  usePolyAnnotStore.setState({
    layers: data.polygons.layers,
    annotations: data.polygons.annotations,
    labelCounters: data.polygons.labelCounters,
    activeLayerId: data.polygons.layers[0]?.id ?? null,
    isDirty: false,
  });

  // Replace static obstacle store contents
  useStaticObstacleStore.setState({
    layers: data.obstacles.layers,
    annotations: data.obstacles.annotations,
    labelCounters: data.obstacles.labelCounters,
    activeLayerId: data.obstacles.layers[0]?.id ?? null,
    isDirty: false,
  });
}

/**
 * Snapshots both stores and writes geometry-annotations.bin to `basePath`.
 */
export async function saveGeometryAnnotations(basePath: string): Promise<void> {
  const poly = usePolyAnnotStore.getState();
  const obs  = useStaticObstacleStore.getState();

  const data: GeometryAnnotationsFile = {
    version: 1,
    polygons: {
      layers: poly.layers,
      annotations: poly.annotations,
      labelCounters: poly.labelCounters,
    },
    obstacles: {
      layers: obs.layers,
      annotations: obs.annotations,
      labelCounters: obs.labelCounters,
    },
  };

  const buffer = serializeGeometryAnnotations(data);
  await writeFile(`${basePath}${FILENAME}`, buffer);
}
