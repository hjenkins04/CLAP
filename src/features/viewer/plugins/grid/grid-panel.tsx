import { useGridStore } from './grid-store';

export function GridPanel() {
  const visible = useGridStore((s) => s.visible);
  const size = useGridStore((s) => s.size);
  const cellSize = useGridStore((s) => s.cellSize);
  const setVisible = useGridStore((s) => s.setVisible);
  const setSize = useGridStore((s) => s.setSize);
  const setCellSize = useGridStore((s) => s.setCellSize);

  return (
    <>
      {/* Visible Toggle */}
      <div className="mb-3 flex items-center justify-between">
        <label className="text-xs text-muted-foreground">Visible</label>
        <button
          onClick={() => setVisible(!visible)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            visible ? 'bg-primary' : 'bg-muted'
          }`}
        >
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-background transition-transform ${
              visible ? 'translate-x-5' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Grid Size */}
      <div className="mb-3">
        <label className="mb-1 block text-xs text-muted-foreground">
          Size: {size}m
        </label>
        <input
          type="range"
          min="10"
          max="1000"
          step="10"
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          disabled={!visible}
          className="w-full accent-primary disabled:opacity-40"
        />
      </div>

      {/* Cell Size */}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Cell Size: {cellSize}m
        </label>
        <input
          type="range"
          min="0.5"
          max="50"
          step="0.5"
          value={cellSize}
          onChange={(e) => setCellSize(Number(e.target.value))}
          disabled={!visible}
          className="w-full accent-primary disabled:opacity-40"
        />
      </div>
    </>
  );
}
