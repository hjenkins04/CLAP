import { useDemVisualizationStore } from './dem-visualization-store';

export function DemVisualizationPanel() {
  const enabled   = useDemVisualizationStore((s) => s.enabled);
  const opacity   = useDemVisualizationStore((s) => s.opacity);
  const wireframe = useDemVisualizationStore((s) => s.wireframe);
  const step      = useDemVisualizationStore((s) => s.step);

  const setEnabled   = useDemVisualizationStore((s) => s.setEnabled);
  const setOpacity   = useDemVisualizationStore((s) => s.setOpacity);
  const setWireframe = useDemVisualizationStore((s) => s.setWireframe);
  const setStep      = useDemVisualizationStore((s) => s.setStep);

  return (
    <>
      {/* Visible toggle */}
      <div className="mb-3 flex items-center justify-between">
        <label className="text-xs text-muted-foreground">Visible</label>
        <button
          onClick={() => setEnabled(!enabled)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            enabled ? 'bg-primary' : 'bg-muted'
          }`}
        >
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-background transition-transform ${
              enabled ? 'translate-x-5' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Opacity */}
      <div className="mb-3">
        <label className="mb-1 block text-xs text-muted-foreground">
          Opacity: {Math.round(opacity * 100)}%
        </label>
        <input
          type="range"
          min="0.05"
          max="1"
          step="0.05"
          value={opacity}
          onChange={(e) => setOpacity(parseFloat(e.target.value))}
          disabled={!enabled}
          className="w-full accent-primary disabled:opacity-40"
        />
      </div>

      {/* Resolution */}
      <div className="mb-3">
        <label className="mb-1 block text-xs text-muted-foreground">
          Resolution: {step === 1 ? 'Full (1:1)' : `1:${step}`}
        </label>
        <input
          type="range"
          min="1"
          max="8"
          step="1"
          value={step}
          onChange={(e) => setStep(parseInt(e.target.value, 10))}
          disabled={!enabled}
          className="w-full accent-primary disabled:opacity-40"
        />
        <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
          <span>Full</span><span>Coarse</span>
        </div>
      </div>

      {/* Wireframe toggle */}
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground">Wireframe</label>
        <button
          disabled={!enabled}
          onClick={() => setWireframe(!wireframe)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40 ${
            wireframe ? 'bg-primary' : 'bg-muted'
          }`}
        >
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-background transition-transform ${
              wireframe ? 'translate-x-5' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </>
  );
}
