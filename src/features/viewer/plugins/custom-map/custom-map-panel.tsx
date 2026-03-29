import { useRef } from 'react';
import { Button } from '@clap/design-system';
import { FolderOpen, X } from 'lucide-react';
import {
  useCustomMapStore,
  CUSTOM_MAP_CATEGORIES,
  CATEGORY_LABELS,
} from './custom-map-store';
import { parseLanelet2Osm } from './lanelet2-parser';
import { useWorldFrameStore } from '../world-frame';

export function CustomMapPanel() {
  const fileName = useCustomMapStore((s) => s.fileName);
  const visible = useCustomMapStore((s) => s.visible);
  const opacity = useCustomMapStore((s) => s.opacity);
  const categories = useCustomMapStore((s) => s.categories);
  const setFile = useCustomMapStore((s) => s.setFile);
  const clearFile = useCustomMapStore((s) => s.clearFile);
  const setVisible = useCustomMapStore((s) => s.setVisible);
  const setOpacity = useCustomMapStore((s) => s.setOpacity);
  const setCategoryVisible = useCustomMapStore((s) => s.setCategoryVisible);
  const transform = useWorldFrameStore((s) => s.transform);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result;
      if (typeof text !== 'string') return;
      try {
        const ways = parseLanelet2Osm(text);
        setFile(file.name, ways);
      } catch (err) {
        console.warn('[CLAP] Failed to parse OSM file:', err);
      }
    };
    reader.readAsText(file);
    // Reset input so the same file can be re-loaded if needed
    e.target.value = '';
  };

  return (
    <div className="space-y-3">
      {/* File loader */}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".osm"
          className="hidden"
          onChange={handleFileChange}
        />
        {fileName ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 truncate text-xs text-muted-foreground" title={fileName}>
              {fileName}
            </span>
            <button
              onClick={clearFile}
              className="text-muted-foreground hover:text-foreground"
              title="Unload map"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 text-xs"
            onClick={() => fileInputRef.current?.click()}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Load OSM / Lanelet2 file…
          </Button>
        )}
      </div>

      {!transform && fileName && (
        <p className="text-xs text-muted-foreground">
          Set a world frame to display the map.
        </p>
      )}

      {fileName && (
        <>
          {/* Opacity */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Opacity: {Math.round(opacity * 100)}%
            </label>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="w-full accent-primary"
            />
          </div>

          {/* Master visibility */}
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={visible}
              onChange={(e) => setVisible(e.target.checked)}
              className="accent-primary"
            />
            Show all
          </label>

          {/* Per-category visibility */}
          <div className="space-y-1 border-t border-border pt-2">
            {CUSTOM_MAP_CATEGORIES.map((cat) => (
              <label key={cat} className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={categories[cat]}
                  onChange={(e) => setCategoryVisible(cat, e.target.checked)}
                  className="accent-primary"
                />
                {CATEGORY_LABELS[cat]}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
