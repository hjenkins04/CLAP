import { useState } from 'react';
import { Check, Trash2, Undo2, X } from 'lucide-react';
import { Button, Label } from '@clap/design-system';
import { useViewerModeStore } from '@/app/stores';
import { usePolyAnnotStore } from './polygon-annotation-store';
import { POLYGON_CLASS_LABELS, POLYGON_CLASS_COLORS, type PolygonClass } from './polygon-annotation-types';
import type { ViewerEngine } from '../../services/viewer-engine';
import { PolygonAnnotationPlugin } from './polygon-annotation-plugin';

interface PolygonAnnotationOverlayProps {
  engine: ViewerEngine | null;
}

const POLY_CLASSES = Object.entries(POLYGON_CLASS_LABELS) as [PolygonClass, string][];

export function PolygonAnnotationOverlay({ engine }: PolygonAnnotationOverlayProps) {
  const mode  = useViewerModeStore((s) => s.mode);
  const phase = usePolyAnnotStore((s) => s.phase);
  const draftVertices  = usePolyAnnotStore((s) => s.draftVertices);
  const classifyDraft  = usePolyAnnotStore((s) => s.classifyDraft);
  const attributeDraft = usePolyAnnotStore((s) => s.attributeDraft);
  const setClassifyDraft  = usePolyAnnotStore((s) => s.setClassifyDraft);
  const setAttributeDraft = usePolyAnnotStore((s) => s.setAttributeDraft);

  const [newAttrKey, setNewAttrKey] = useState('');
  const [newAttrVal, setNewAttrVal] = useState('');

  const plugin = engine?.getPlugin<PolygonAnnotationPlugin>('polygon-annotation');

  if (mode !== 'polygon-annotation' || phase === 'idle' || phase === 'editing') return null;

  // ── Drawing phase hint ─────────────────────────────────────────────────────

  if (phase === 'drawing') {
    return (
      <div className="pointer-events-none absolute bottom-20 left-1/2 z-20 -translate-x-1/2">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card/90 px-4 py-2 shadow-lg backdrop-blur-sm">
          <div className="flex flex-col gap-0.5 text-center">
            <span className="text-xs text-foreground">
              {draftVertices.length === 0
                ? 'Click to place first vertex'
                : draftVertices.length < 3
                  ? `${draftVertices.length} vert${draftVertices.length !== 1 ? 's' : ''} — keep clicking to add more`
                  : `${draftVertices.length} verts — click first vertex or press Enter to close`}
            </span>
            <span className="text-[10px] text-muted-foreground">
              Backspace to undo last · Esc to clear · hold near vertex to snap
            </span>
          </div>
          {draftVertices.length > 0 && (
            <button
              className="pointer-events-auto rounded p-1 text-muted-foreground hover:text-foreground"
              onClick={() => plugin?.cancelDraft()}
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Classifying phase ──────────────────────────────────────────────────────

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
      <div className="w-80 rounded-xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold">Classify Polygon</span>
          <span className="text-xs text-muted-foreground">{draftVertices.length} vertices</span>
        </div>

        <div className="space-y-4 p-4">
          {/* Class picker */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Surface Type</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {POLY_CLASSES.map(([id, label]) => {
                const selected = classifyDraft === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setClassifyDraft(id)}
                    className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                      selected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background hover:bg-muted'
                    }`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: POLYGON_CLASS_COLORS[id] }}
                    />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Attributes */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Attributes</Label>
            {Object.entries(attributeDraft).length > 0 && (
              <div className="space-y-1 rounded-md border border-border p-2">
                {Object.entries(attributeDraft).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 text-xs">
                    <span className="flex-1 truncate font-mono text-muted-foreground">{k}</span>
                    <span className="flex-1 truncate">{String(v)}</span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        const next = { ...attributeDraft };
                        delete next[k];
                        setAttributeDraft(next);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-1">
              <input
                placeholder="key"
                value={newAttrKey}
                onChange={(e) => setNewAttrKey(e.target.value)}
                className="h-7 w-24 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <input
                placeholder="value"
                value={newAttrVal}
                onChange={(e) => setNewAttrVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newAttrKey.trim()) {
                    setAttributeDraft({ ...attributeDraft, [newAttrKey.trim()]: newAttrVal });
                    setNewAttrKey('');
                    setNewAttrVal('');
                  }
                }}
                className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={!newAttrKey.trim()}
                onClick={() => {
                  if (!newAttrKey.trim()) return;
                  setAttributeDraft({ ...attributeDraft, [newAttrKey.trim()]: newAttrVal });
                  setNewAttrKey('');
                  setNewAttrVal('');
                }}
              >
                +
              </Button>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 border-t border-border px-4 py-3">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5 text-xs text-destructive hover:text-destructive"
            onClick={() => plugin?.cancelDraft()}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Discard
          </Button>
          <Button
            variant="default"
            size="sm"
            className="flex-1 gap-1.5 text-xs"
            disabled={!classifyDraft}
            onClick={() => plugin?.commitPolygon()}
          >
            <Check className="h-3.5 w-3.5" />
            Save Polygon
          </Button>
        </div>
      </div>
    </div>
  );
}
