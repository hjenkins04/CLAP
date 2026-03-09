import { useState, useEffect, useCallback } from 'react';
import type { ViewerEngine } from '../services/viewer-engine';

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
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const sync = useCallback(() => {
    if (!engine) return;
    const editor = engine.getEditor();
    setCanUndo(editor.canUndo());
    setCanRedo(editor.canRedo());
    setDirty(editor.isDirty());
  }, [engine]);

  useEffect(() => {
    if (!engine) return;
    const editor = engine.getEditor();

    // Sync initial state
    sync();

    // Subscribe to all relevant events
    const unsubs = [
      editor.on('operationAdded', sync),
      editor.on('undoRedo', sync),
      editor.on('saved', sync),
      editor.on('loaded', sync),
    ];

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [engine, sync]);

  const undo = useCallback(() => {
    engine?.getEditor().undo();
  }, [engine]);

  const redo = useCallback(() => {
    engine?.getEditor().redo();
  }, [engine]);

  const save = useCallback(async () => {
    if (!engine) return;

    const editor = engine.getEditor();
    const basePath = editor.getBasePath();

    // If basePath is a URL (not a real filesystem path), ask user where to save
    const needsPrompt = !basePath || !isFilesystemPath(basePath);
    if (needsPrompt) {
      if (!window.electron) {
        // Browser fallback: save to IndexedDB with current basePath
      } else {
        const dir = await window.electron.invoke<string | null>(
          'save-directory-dialog'
        );
        if (!dir) return; // User cancelled
        const normalized = dir.endsWith('/') ? dir : `${dir}/`;
        editor.setBasePath(normalized);
      }
    }

    setSaving(true);
    try {
      await editor.save();
    } catch (err) {
      console.error('[CLAP] Failed to save edits:', err);
    } finally {
      setSaving(false);
    }
  }, [engine]);

  return { canUndo, canRedo, dirty, saving, undo, redo, save };
}

/** Check if a path is a real filesystem path vs a URL route like /pointclouds/test/ */
function isFilesystemPath(p: string): boolean {
  // Real filesystem paths on Linux/Mac start with / and contain typical dir structure
  // URL routes like /pointclouds/test/ are served by Vite dev server
  return p.startsWith('/home/') || p.startsWith('/tmp/') || p.startsWith('/Users/') || /^[A-Z]:\\/.test(p);
}
