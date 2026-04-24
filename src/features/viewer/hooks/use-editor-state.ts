import { useState, useEffect, useCallback } from 'react';
import type { ViewerEngine } from '../services/viewer-engine';
import { useBaseMapStore } from '../plugins/base-map';
import { useViewerModeStore } from '@/app/stores';
import { saveGeometryAnnotations } from '../services/geometry-annotations-io';
import { geoAnnotHistory } from '../services/geometry-annotations-history';
import { hdMapHistory } from '../plugins/hd-map/hd-map-history';
import { useHdMapStore } from '../plugins/hd-map/hd-map-store';
import { getHdMapPlugin } from '../plugins/hd-map/hd-map-plugin';

interface EditorState {
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  saving: boolean;
  undo: () => void;
  redo: () => void;
  save: () => void;
}

export function useEditorState(engine: ViewerEngine | null): EditorState {
  // ── All hooks declared unconditionally at the top ──────────────────────────
  const [editorCanUndo, setEditorCanUndo] = useState(false);
  const [editorCanRedo, setEditorCanRedo] = useState(false);
  const [geoCanUndo, setGeoCanUndo]       = useState(false);
  const [geoCanRedo, setGeoCanRedo]       = useState(false);
  const [hdCanUndo,  setHdCanUndo]        = useState(false);
  const [hdCanRedo,  setHdCanRedo]        = useState(false);
  const [dirty, setDirty]                 = useState(false);
  const [saving, setSaving]               = useState(false);

  const mode        = useViewerModeStore((s) => s.mode);
  const bmEditing   = useBaseMapStore((s) => s.editing);
  const bmCanUndo   = useBaseMapStore((s) => s.canUndoEdit);
  const bmCanRedo   = useBaseMapStore((s) => s.canRedoEdit);
  const bmOnUndo    = useBaseMapStore((s) => s._onUndo);
  const bmOnRedo    = useBaseMapStore((s) => s._onRedo);
  const hdMapLoaded       = useHdMapStore((s) => s.loadState === 'loaded');
  const hdmapEditing      = useHdMapStore((s) => s.loadState === 'loaded' && s.editorMode !== 'none');
  const hdmapVertexCanUndo = useHdMapStore((s) => s.vertexUndoCount > 0);
  const hdmapVertexCanRedo = useHdMapStore((s) => s.vertexRedoCount > 0);

  const syncEditor = useCallback(() => {
    if (!engine) return;
    const editor = engine.getEditor();
    setEditorCanUndo(editor.canUndo());
    setEditorCanRedo(editor.canRedo());
    setDirty(editor.isDirty() || geoAnnotHistory.isDirty());
  }, [engine]);

  const syncGeo = useCallback(() => {
    setGeoCanUndo(geoAnnotHistory.canUndo());
    setGeoCanRedo(geoAnnotHistory.canRedo());
    setDirty((engine?.getEditor()?.isDirty() ?? false) || geoAnnotHistory.isDirty());
  }, [engine]);

  const syncHd = useCallback(() => {
    setHdCanUndo(hdMapHistory.canUndo());
    setHdCanRedo(hdMapHistory.canRedo());
  }, []);

  useEffect(() => {
    if (!engine) return;
    const editor = engine.getEditor();
    syncEditor();
    syncGeo();
    syncHd();
    const unsubs = [
      editor.on('operationAdded', syncEditor),
      editor.on('undoRedo', syncEditor),
      editor.on('saved', syncEditor),
      editor.on('loaded', syncEditor),
      geoAnnotHistory.on('change', syncGeo),
      hdMapHistory.on('change', syncHd),
    ];
    return () => { for (const unsub of unsubs) unsub(); };
  }, [engine, syncEditor, syncGeo, syncHd]);

  const inAnnotationMode = mode === 'polygon-annotation' || mode === 'static-obstacle';

  const undo = useCallback(() => {
    if (bmEditing && bmOnUndo) {
      bmOnUndo();
    } else if (hdmapEditing) {
      getHdMapPlugin()?.undoVertexDrag();
    } else if (hdMapLoaded && hdMapHistory.canUndo()) {
      hdMapHistory.undo();
    } else if (inAnnotationMode && geoAnnotHistory.canUndo()) {
      geoAnnotHistory.undo();
    } else {
      engine?.getEditor().undo();
    }
  }, [engine, bmEditing, bmOnUndo, hdmapEditing, hdMapLoaded, inAnnotationMode]);

  const redo = useCallback(() => {
    if (bmEditing && bmOnRedo) {
      bmOnRedo();
    } else if (hdmapEditing) {
      getHdMapPlugin()?.redoVertexDrag();
    } else if (hdMapLoaded && hdMapHistory.canRedo()) {
      hdMapHistory.redo();
    } else if (inAnnotationMode && geoAnnotHistory.canRedo()) {
      geoAnnotHistory.redo();
    } else {
      engine?.getEditor().redo();
    }
  }, [engine, bmEditing, bmOnRedo, hdmapEditing, hdMapLoaded, inAnnotationMode]);

  const save = useCallback(async () => {
    if (!engine) return;
    const editor = engine.getEditor();
    const basePath = editor.getBasePath();
    const needsPrompt = !basePath || !isFilesystemPath(basePath);
    if (needsPrompt) {
      if (window.electron) {
        const dir = await window.electron.invoke<string | null>('save-directory-dialog');
        if (!dir) return;
        const normalized = dir.endsWith('/') ? dir : `${dir}/`;
        editor.setBasePath(normalized);
      }
    }
    setSaving(true);
    try {
      await editor.save();
      const finalPath = editor.getBasePath();
      if (finalPath) {
        await saveGeometryAnnotations(finalPath);
        geoAnnotHistory.markSaved();
      }
    } catch (err) {
      console.error('[CLAP] Failed to save edits:', err);
    } finally {
      setSaving(false);
    }
  }, [engine]);

  // ── Derive exposed state based on active context ───────────────────────────
  const canUndo = bmEditing    ? bmCanUndo
    : hdmapEditing             ? hdmapVertexCanUndo
    : hdMapLoaded              ? hdCanUndo
    : inAnnotationMode         ? geoCanUndo
    : editorCanUndo;
  const canRedo = bmEditing    ? bmCanRedo
    : hdmapEditing             ? hdmapVertexCanRedo
    : hdMapLoaded              ? hdCanRedo
    : inAnnotationMode         ? geoCanRedo
    : editorCanRedo;

  return { canUndo, canRedo, dirty, saving, undo, redo, save };
}

/** Check if a path is a real filesystem path vs a URL route like /pointclouds/test/ */
function isFilesystemPath(p: string): boolean {
  return (
    p.startsWith('/home/') ||
    p.startsWith('/tmp/') ||
    p.startsWith('/Users/') ||
    /^[A-Z]:\\/.test(p)
  );
}
