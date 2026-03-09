import { useViewerStore } from '@/app/stores';

export function SidebarEdlPanel() {
  const edlEnabled = useViewerStore((s) => s.edlEnabled);
  const edlStrength = useViewerStore((s) => s.edlStrength);
  const edlRadius = useViewerStore((s) => s.edlRadius);
  const setEdlEnabled = useViewerStore((s) => s.setEdlEnabled);
  const setEdlStrength = useViewerStore((s) => s.setEdlStrength);
  const setEdlRadius = useViewerStore((s) => s.setEdlRadius);

  return (
    <>
      {/* EDL Toggle */}
      <div className="mb-3 flex items-center justify-between">
        <label className="text-xs text-muted-foreground">Enabled</label>
        <button
          onClick={() => setEdlEnabled(!edlEnabled)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            edlEnabled ? 'bg-primary' : 'bg-muted'
          }`}
        >
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-background transition-transform ${
              edlEnabled ? 'translate-x-5' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* EDL Strength */}
      <div className="mb-3">
        <label className="mb-1 block text-xs text-muted-foreground">
          Strength: {edlStrength.toFixed(2)}
        </label>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={edlStrength}
          onChange={(e) => setEdlStrength(Number(e.target.value))}
          disabled={!edlEnabled}
          className="w-full accent-primary disabled:opacity-40"
        />
      </div>

      {/* EDL Radius */}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Radius: {edlRadius.toFixed(1)}
        </label>
        <input
          type="range"
          min="0.5"
          max="5"
          step="0.1"
          value={edlRadius}
          onChange={(e) => setEdlRadius(Number(e.target.value))}
          disabled={!edlEnabled}
          className="w-full accent-primary disabled:opacity-40"
        />
      </div>
    </>
  );
}
