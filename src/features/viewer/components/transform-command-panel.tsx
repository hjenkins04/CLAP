import { useViewerModeStore } from '@/app/stores';
import { useTransformStore } from '../plugins/transform/transform-store';
import { CommandPopup } from './command-popup';

const SNAP_DEGREE_PRESETS = [5, 10, 15, 30, 45, 90];

export function TransformCommandPanel() {
  const { transformSubMode, setTransformSubMode, exitMode } =
    useViewerModeStore();
  const expanded = useViewerModeStore((s) => s.isCommandPanelExpanded());
  const setExpanded = useViewerModeStore((s) => s.setCommandPanelExpanded);

  const {
    translateSnapEnabled,
    translateSnapValue,
    rotateSnapEnabled,
    rotateSnapDegrees,
    positionX,
    positionY,
    positionZ,
    rotationX,
    rotationY,
    rotationZ,
    setTranslateSnapEnabled,
    setTranslateSnapValue,
    setRotateSnapEnabled,
    setRotateSnapDegrees,
    resetTransform,
  } = useTransformStore();

  const title =
    transformSubMode === 'translate' ? 'Translate' : 'Rotate';

  return (
    <CommandPopup
      title={title}
      expanded={expanded}
      onToggleExpand={() => setExpanded(!expanded)}
      onClose={exitMode}
    >
      {/* Mode Toggle */}
      <div className="mb-2">
        <div className="flex gap-1">
          {(['translate', 'rotate'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setTransformSubMode(m)}
              className={`flex-1 rounded-md px-2 py-1 text-xs capitalize transition-colors ${
                transformSubMode === m
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Snap Settings */}
      {transformSubMode === 'translate' ? (
        <div className="mb-2 rounded-md border border-border p-2">
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs text-muted-foreground">Snap</label>
            <button
              onClick={() => setTranslateSnapEnabled(!translateSnapEnabled)}
              className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                translateSnapEnabled ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`inline-block h-2.5 w-2.5 transform rounded-full bg-background transition-transform ${
                  translateSnapEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
          <label className="mb-1 block text-xs text-muted-foreground">
            {translateSnapValue}m
          </label>
          <input
            type="range"
            min="0.1"
            max="10"
            step="0.1"
            value={translateSnapValue}
            onChange={(e) => setTranslateSnapValue(Number(e.target.value))}
            disabled={!translateSnapEnabled}
            className="w-full accent-primary disabled:opacity-40"
          />
        </div>
      ) : (
        <div className="mb-2 rounded-md border border-border p-2">
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs text-muted-foreground">Snap</label>
            <button
              onClick={() => setRotateSnapEnabled(!rotateSnapEnabled)}
              className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                rotateSnapEnabled ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`inline-block h-2.5 w-2.5 transform rounded-full bg-background transition-transform ${
                  rotateSnapEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {SNAP_DEGREE_PRESETS.map((deg) => (
              <button
                key={deg}
                onClick={() => setRotateSnapDegrees(deg)}
                disabled={!rotateSnapEnabled}
                className={`rounded px-1.5 py-0.5 text-xs transition-colors disabled:opacity-40 ${
                  rotateSnapDegrees === deg
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {deg}°
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Position / Rotation Readout */}
      <div className="mb-2">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Position (m)
        </label>
        <div className="grid grid-cols-3 gap-1 text-xs text-muted-foreground">
          <span className="rounded bg-muted px-1 py-0.5 text-center">
            X: {positionX.toFixed(2)}
          </span>
          <span className="rounded bg-muted px-1 py-0.5 text-center">
            Y: {positionY.toFixed(2)}
          </span>
          <span className="rounded bg-muted px-1 py-0.5 text-center">
            Z: {positionZ.toFixed(2)}
          </span>
        </div>
      </div>

      <div className="mb-2">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Rotation (°)
        </label>
        <div className="grid grid-cols-3 gap-1 text-xs text-muted-foreground">
          <span className="rounded bg-muted px-1 py-0.5 text-center">
            X: {rotationX.toFixed(1)}
          </span>
          <span className="rounded bg-muted px-1 py-0.5 text-center">
            Y: {rotationY.toFixed(1)}
          </span>
          <span className="rounded bg-muted px-1 py-0.5 text-center">
            Z: {rotationZ.toFixed(1)}
          </span>
        </div>
      </div>

      {/* Reset */}
      <button
        onClick={resetTransform}
        className="w-full rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted"
      >
        Reset Transform
      </button>
    </CommandPopup>
  );
}
