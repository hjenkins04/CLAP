import { useViewerStore } from '@/app/stores';
import type { ColorMode } from '../types';
import { formatNumber } from '../utils/format';

const COLOR_MODE_OPTIONS: { value: ColorMode; label: string }[] = [
  { value: 'rgb', label: 'RGB' },
  { value: 'height', label: 'Height' },
  { value: 'classification', label: 'Classification' },
  { value: 'intensity', label: 'Intensity' },
];

export function SidebarColoringPanel() {
  const colorMode = useViewerStore((s) => s.colorMode);
  const pointSize = useViewerStore((s) => s.pointSize);
  const pointBudget = useViewerStore((s) => s.pointBudget);
  const setColorMode = useViewerStore((s) => s.setColorMode);
  const setPointSize = useViewerStore((s) => s.setPointSize);
  const setPointBudget = useViewerStore((s) => s.setPointBudget);

  return (
    <>
      {/* Color Mode */}
      <div className="mb-3">
        <label className="mb-1 block text-xs text-muted-foreground">
          Color Mode
        </label>
        <select
          value={colorMode}
          onChange={(e) => setColorMode(e.target.value as ColorMode)}
          className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
        >
          {COLOR_MODE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Point Size */}
      <div className="mb-3">
        <label className="mb-1 block text-xs text-muted-foreground">
          Point Size: {pointSize.toFixed(1)}
        </label>
        <input
          type="range"
          min="0.1"
          max="5"
          step="0.1"
          value={pointSize}
          onChange={(e) => setPointSize(Number(e.target.value))}
          className="w-full accent-primary"
        />
      </div>

      {/* Point Budget */}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Point Budget: {formatNumber(pointBudget)}
        </label>
        <input
          type="range"
          min="100000"
          max="10000000"
          step="100000"
          value={pointBudget}
          onChange={(e) => setPointBudget(Number(e.target.value))}
          className="w-full accent-primary"
        />
      </div>
    </>
  );
}
