import { useState, useEffect, useCallback } from 'react';
import type { ViewerEngine } from '../services/viewer-engine';
import { useBaseMapStore } from '../plugins/base-map';

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
  const [editorCanUndo, setEditorCanUndo] = useState(false);
  const [editorCanRedo, setEditorCanRedo] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Base map editing state — when active, toolbar undo/redo drives base map history
  const bmEditing = useBaseMapStore((s) => s.editing);
  const bmCanUndo = useBaseMapStore((s) => s.canUndoEdit);
  const bmCanRedo = useBaseMapStore((s) => s.canRedoEdit);
  const bmOnUndo = useBaseMapStore((s) => s._onUndo);
  const bmOnRedo = useBaseMapStore((s) => s._onRedo);

  const sync = useCallback(() => {
    if (!engine) return;
    const editor = engine.getEditor();
    setEditorCanUndo(editor.canUndo());
    setEditorCanRedo(editor.canRedo());
    setDirty(editor.isDirty());
  }, [engine]);

  useEffect(() => {
    if (!engine) return;
    const editor = engine.getEditor();
    sync();
    const unsubs = [
      editor.on('operationAdded', sync),
      editor.on('undoRedo', sync),
      editor.on('saved', sync),
      editor.on('loaded', sync),
    ];
    return () => { for (const unsub of unsubs) unsub(); };
  }, [engine, sync]);

  const undo = useCallback(() => {
    if (bmEditing && bmOnUndo) {
      bmOnUndo();
    } else {
      engine?.getEditor().undo();
    }
  }, [engine, bmEditing, bmOnUndo]);

  const redo = useCallback(() => {
    if (bmEditing && bmOnRedo) {
      bmOnRedo();
    } else {
      engine?.getEditor().redo();
    }
  }, [engine, bmEditing, bmOnRedo]);

  const save = useCallback(async () => {
    if (!engine) return;
    const editor = engine.getEditor();
    const basePath = editor.getBasePath();
    const needsPrompt = !basePath || !isFilesystemPath(basePath);
    if (needsPrompt) {
      if (!window.electron) {
        // Browser fallback
      } else {
        const dir = await window.electron.invoke<string | null>('save-directory-dialog');
        if (!dir) return;
        const normalized = dir.endsWith('/') ? dir : `${dir}/`;
        editor.setBasePath(normalized);
      }
    }
    setSaving(true);
    try { await editor.save(); }
    catch (err) { console.error('[CLAP] Failed to save edits:', err); }
    finally { setSaving(false); }
  }, [engine]);

  // When base map editing is active, expose base map undo/redo state
  const canUndo = bmEditing ? bmCanUndo : editorCanUndo;
  const canRedo = bmEditing ? bmCanRedo : editorCanRedo;

  return { canUndo, canRedo, dirty, saving, undo, redo, save };
}

/** Check if a path is a real filesystem path vs a URL route like /pointclouds/test/ */
function isFilesystemPath(p: string): boolean {
  // Real filesystem paths on Linux/Mac start with / and contain typical dir structure
  // URL routes like /pointclouds/test/ are served by Vite dev server
  return p.startsWith('/home/') || p.startsWith('/tmp/') || p.startsWith('/Users/') || /^[A-Z]:\\/.test(p);
}
