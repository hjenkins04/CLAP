import { useState } from 'react';
import { Button } from '@clap/design-system';
import { Plus, Trash2, Download, BoxSelect, StopCircle, Pencil } from 'lucide-react';
import { useStaticObstacleStore } from './static-obstacle-store';
import { useViewerModeStore } from '@/app/stores';
import { annotationsToGeoJson, downloadGeoJson } from './annotation-export';

export function StaticObstaclePanel() {
  const layers = useStaticObstacleStore((s) => s.layers);
  const activeLayerId = useStaticObstacleStore((s) => s.activeLayerId);
  const annotations = useStaticObstacleStore((s) => s.annotations);
  const addLayer = useStaticObstacleStore((s) => s.addLayer);
  const removeLayer = useStaticObstacleStore((s) => s.removeLayer);
  const setLayerVisible = useStaticObstacleStore((s) => s.setLayerVisible);
  const setActiveLayer = useStaticObstacleStore((s) => s.setActiveLayer);
  const renameLayer = useStaticObstacleStore((s) => s.renameLayer);

  const mode = useViewerModeStore((s) => s.mode);
  const enterStaticObstacleMode = useViewerModeStore((s) => s.enterStaticObstacleMode);
  const exitMode = useViewerModeStore((s) => s.exitMode);

  const [newLayerName, setNewLayerName] = useState('');
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const isActive = mode === 'static-obstacle';

  const handleAddLayer = () => {
    const name = newLayerName.trim() || `Layer ${layers.length + 1}`;
    addLayer(name);
    setNewLayerName('');
  };

  const handleExport = () => {
    const json = annotationsToGeoJson(annotations, layers);
    downloadGeoJson(json, 'static-obstacles.geojson');
  };

  const handleRenameCommit = (id: string) => {
    if (editingName.trim()) {
      renameLayer(id, editingName.trim());
    }
    setEditingLayerId(null);
    setEditingName('');
  };

  return (
    <div className="space-y-3">
      {/* New layer input */}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={newLayerName}
          onChange={(e) => setNewLayerName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddLayer()}
          placeholder="Layer name…"
          className="h-7 flex-1 rounded border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2"
          onClick={handleAddLayer}
          title="Create layer"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Layer list */}
      {layers.length > 0 && (
        <div className="space-y-0.5">
          {layers.map((layer) => {
            const count = annotations.filter((a) => a.layerId === layer.id).length;
            const isSelected = layer.id === activeLayerId;
            return (
              <div
                key={layer.id}
                className={`group flex items-center gap-1.5 rounded px-1.5 py-1 cursor-pointer transition-colors ${
                  isSelected ? 'bg-primary/10 text-foreground' : 'hover:bg-muted'
                }`}
                onClick={() => setActiveLayer(layer.id)}
              >
                {/* Color swatch + visibility toggle */}
                <button
                  className="h-3.5 w-3.5 flex-shrink-0 rounded-sm border border-border"
                  style={{ backgroundColor: layer.color }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setLayerVisible(layer.id, !layer.visible);
                  }}
                  title={layer.visible ? 'Hide layer' : 'Show layer'}
                />

                {/* Name */}
                {editingLayerId === layer.id ? (
                  <input
                    autoFocus
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => handleRenameCommit(layer.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenameCommit(layer.id);
                      if (e.key === 'Escape') {
                        setEditingLayerId(null);
                        setEditingName('');
                      }
                      e.stopPropagation();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-5 flex-1 rounded border border-border bg-background px-1 text-xs focus:outline-none"
                  />
                ) : (
                  <span
                    className={`flex-1 truncate text-xs ${
                      !layer.visible ? 'opacity-50' : ''
                    }`}
                  >
                    {layer.name}
                  </span>
                )}

                <span className="text-[10px] text-muted-foreground">{count}</span>

                {/* Actions — show on hover */}
                <button
                  className="invisible ml-0.5 rounded p-0.5 text-muted-foreground opacity-0 transition-all hover:text-foreground group-hover:visible group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingLayerId(layer.id);
                    setEditingName(layer.name);
                  }}
                  title="Rename"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  className="invisible ml-0.5 rounded p-0.5 text-muted-foreground opacity-0 transition-all hover:text-destructive group-hover:visible group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeLayer(layer.id);
                  }}
                  title="Delete layer"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {layers.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Create a layer to start annotating.
        </p>
      )}

      {/* Annotation mode button */}
      <div className="border-t border-border pt-2">
        {isActive ? (
          <Button
            variant="destructive"
            size="sm"
            className="w-full gap-2 text-xs"
            onClick={exitMode}
          >
            <StopCircle className="h-3.5 w-3.5" />
            Exit Annotation Mode
          </Button>
        ) : (
          <Button
            variant="default"
            size="sm"
            className="w-full gap-2 text-xs"
            onClick={enterStaticObstacleMode}
            disabled={layers.length === 0}
          >
            <BoxSelect className="h-3.5 w-3.5" />
            Enter Annotation Mode
          </Button>
        )}
      </div>

      {/* Export */}
      {annotations.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2 text-xs"
          onClick={handleExport}
        >
          <Download className="h-3.5 w-3.5" />
          Export GeoJSON ({annotations.length})
        </Button>
      )}
    </div>
  );
}
