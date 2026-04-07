import { useState } from 'react';
import { Check, ChevronDown, Pencil, SquarePen, Trash2, X, Plus, Shapes } from 'lucide-react';
import { Button } from '@clap/design-system';
import { useViewerModeStore } from '@/app/stores';
import { usePolyAnnotStore } from './polygon-annotation-store';
import { POLYGON_CLASS_LABELS } from './polygon-annotation-types';
import { getPolyAnnotPlugin } from './polygon-annotation-plugin-ref';
import { geoAnnotHistory } from '../../services/geometry-annotations-history';

export function PolygonAnnotationPanel() {
  const mode = useViewerModeStore((s) => s.mode);
  const enterPolyAnnotMode = useViewerModeStore((s) => s.enterPolygonAnnotationMode);
  const exitMode = useViewerModeStore((s) => s.exitMode);

  const layers      = usePolyAnnotStore((s) => s.layers);
  const annotations = usePolyAnnotStore((s) => s.annotations);
  const activeLayerId      = usePolyAnnotStore((s) => s.activeLayerId);
  const phase              = usePolyAnnotStore((s) => s.phase);
  const editingAnnotationId = usePolyAnnotStore((s) => s.editingAnnotationId);

  const addLayer        = usePolyAnnotStore((s) => s.addLayer);
  const removeLayer     = usePolyAnnotStore((s) => s.removeLayer);
  const renameLayer     = usePolyAnnotStore((s) => s.renameLayer);
  const setLayerVisible = usePolyAnnotStore((s) => s.setLayerVisible);
  const setActiveLayer  = usePolyAnnotStore((s) => s.setActiveLayer);
  const deleteAnnotation     = usePolyAnnotStore((s) => s.deleteAnnotation);
  const setAnnotationVisible = usePolyAnnotStore((s) => s.setAnnotationVisible);

  const [newLayerName, setNewLayerName]   = useState('');
  const [renamingId, setRenamingId]       = useState<string | null>(null);
  const [renameVal, setRenameVal]         = useState('');
  const [collapsedLayers, setCollapsedLayers] = useState<Set<string>>(new Set());

  function toggleCollapsed(layerId: string) {
    setCollapsedLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });
  }

  const isActive  = mode === 'polygon-annotation';
  const isEditing = phase === 'editing';

  function handleAddLayer() {
    const name = newLayerName.trim() || `Layer ${layers.length + 1}`;
    geoAnnotHistory.record();
    addLayer(name);
    setNewLayerName('');
  }

  function handleEditAnnotation(annId: string) {
    if (!isActive) enterPolyAnnotMode();
    // Give the mode-enter time to fire, then start editing
    requestAnimationFrame(() => {
      getPolyAnnotPlugin()?.startEditing(annId);
    });
  }

  function handleStopEditing() {
    getPolyAnnotPlugin()?.stopEditing();
  }

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      {isEditing ? (
        <Button
          variant="default"
          size="sm"
          className="w-full gap-2 text-xs"
          onClick={handleStopEditing}
        >
          <Check className="h-3.5 w-3.5" />
          Done Editing
        </Button>
      ) : (
        <Button
          variant={isActive ? 'default' : 'outline'}
          size="sm"
          className="w-full gap-2 text-xs"
          onClick={() => isActive ? exitMode() : enterPolyAnnotMode()}
        >
          <Shapes className="h-3.5 w-3.5" />
          {isActive ? 'Exit Polygon Mode' : 'Enter Polygon Mode'}
        </Button>
      )}

      {/* Add layer */}
      <div className="flex gap-1">
        <input
          value={newLayerName}
          onChange={(e) => setNewLayerName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddLayer()}
          placeholder="New layer name…"
          className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <Button variant="outline" size="icon" className="h-7 w-7 shrink-0" onClick={handleAddLayer}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {layers.length === 0 && (
        <p className="text-xs text-muted-foreground">No layers yet — create one above.</p>
      )}

      {layers.map((layer) => {
        const layerAnns = annotations.filter((a) => a.layerId === layer.id);
        const isEditingName = renamingId === layer.id;
        const isActiveLayer = activeLayerId === layer.id;
        const isCollapsed   = collapsedLayers.has(layer.id);

        return (
          <div
            key={layer.id}
            className={`overflow-hidden rounded-md border ${isActiveLayer ? 'border-primary' : 'border-border'}`}
          >
            {/* Layer header */}
            <div
              className={`flex cursor-pointer items-center gap-2 px-2 py-1.5 ${
                isActiveLayer ? 'bg-primary/10' : 'hover:bg-muted/50'
              }`}
              onClick={() => setActiveLayer(layer.id)}
            >
              {/* Collapse/expand chevron */}
              {layerAnns.length > 0 && (
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={(e) => { e.stopPropagation(); toggleCollapsed(layer.id); }}
                >
                  <ChevronDown
                    className={`h-3 w-3 transition-transform duration-150 ${isCollapsed ? '-rotate-90' : ''}`}
                  />
                </button>
              )}
              {/* Spacer when no children so header stays aligned */}
              {layerAnns.length === 0 && <span className="h-3 w-3 shrink-0" />}

              <button
                type="button"
                className="shrink-0"
                onClick={(e) => { e.stopPropagation(); setLayerVisible(layer.id, !layer.visible); }}
              >
                <span
                  className="inline-block h-3 w-3 rounded-sm border border-border"
                  style={{
                    backgroundColor: layer.visible ? layer.color : 'transparent',
                    borderColor: layer.color,
                  }}
                />
              </button>

              {isEditingName ? (
                <input
                  autoFocus
                  value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { geoAnnotHistory.record(); renameLayer(layer.id, renameVal.trim() || layer.name); setRenamingId(null); }
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  className="h-5 flex-1 bg-transparent text-xs focus:outline-none"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-xs">
                  {layer.name}
                  <span className="ml-1 text-[10px] text-muted-foreground">({layerAnns.length})</span>
                </span>
              )}

              <div className="flex shrink-0 items-center gap-0.5">
                {isEditingName ? (
                  <>
                    <button type="button" className="rounded p-0.5 hover:bg-muted" onClick={(e) => { e.stopPropagation(); geoAnnotHistory.record(); renameLayer(layer.id, renameVal.trim() || layer.name); setRenamingId(null); }}>
                      <Check className="h-3 w-3" />
                    </button>
                    <button type="button" className="rounded p-0.5 hover:bg-muted" onClick={(e) => { e.stopPropagation(); setRenamingId(null); }}>
                      <X className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={(e) => { e.stopPropagation(); setRenamingId(layer.id); setRenameVal(layer.name); }}>
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive" onClick={(e) => { e.stopPropagation(); geoAnnotHistory.record(); removeLayer(layer.id); }}>
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Annotation rows */}
            {layerAnns.length > 0 && !isCollapsed && (
              <div className="border-t border-border">
                {layerAnns.map((ann) => {
                  const isEditingThis = editingAnnotationId === ann.id;
                  return (
                    <div
                      key={ann.id}
                      className={`flex items-center gap-2 px-3 py-1 ${isEditingThis ? 'bg-primary/10' : 'hover:bg-muted/30'}`}
                    >
                      <button
                        type="button"
                        className="shrink-0"
                        onClick={() => setAnnotationVisible(ann.id, !ann.visible)}
                      >
                        <span
                          className="inline-block h-2 w-2 rounded-full border"
                          style={{
                            backgroundColor: ann.visible ? layer.color : 'transparent',
                            borderColor: layer.color,
                          }}
                        />
                      </button>

                      <span className="min-w-0 flex-1 truncate text-[11px]">
                        {ann.label}
                        <span className="ml-1 text-muted-foreground">
                          · {POLYGON_CLASS_LABELS[ann.classification]}
                        </span>
                      </span>

                      {/* Edit button */}
                      <button
                        type="button"
                        title={isEditingThis ? 'Finish editing' : 'Edit vertices'}
                        className={`shrink-0 rounded p-0.5 ${
                          isEditingThis
                            ? 'text-primary'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                        onClick={() =>
                          isEditingThis ? handleStopEditing() : handleEditAnnotation(ann.id)
                        }
                      >
                        <SquarePen className="h-3 w-3" />
                      </button>

                      <button
                        type="button"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => { geoAnnotHistory.record(); deleteAnnotation(ann.id); }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
