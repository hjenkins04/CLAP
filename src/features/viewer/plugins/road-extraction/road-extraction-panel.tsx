import { Button } from '@clap/design-system';
import {
  Play,
  StopCircle,
  Trash2,
  Eye,
  EyeOff,
  RotateCcw,
  Download,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';
import { useState } from 'react';
import { useRoadExtractionStore } from './road-extraction-store';
import { useViewerModeStore } from '@/app/stores';
import type { ExtractionParams } from './road-extraction-types';
import { DEFAULT_PARAMS } from './road-extraction-types';

// ── Param slider row ──────────────────────────────────────────────────────────

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  tooltip?: string;
  onChange: (v: number) => void;
}

function SliderRow({ label, value, min, max, step, unit = '', tooltip, onChange }: SliderRowProps) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {label}
          {tooltip && (
            <span title={tooltip} className="cursor-help opacity-60">
              <Info className="h-3 w-3" />
            </span>
          )}
        </span>
        <span className="text-[11px] font-mono text-foreground">
          {value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer accent-primary"
      />
    </div>
  );
}

// ── Params section ────────────────────────────────────────────────────────────

function ParamsSection({ onRerun }: { onRerun: () => void }) {
  const [open, setOpen] = useState(true);
  const params    = useRoadExtractionStore((s) => s.params);
  const setParams = useRoadExtractionStore((s) => s.setParams);
  const resetParams = useRoadExtractionStore((s) => s.resetParams);
  const phase     = useRoadExtractionStore((s) => s.phase);

  const canRerun  = phase === 'reviewing' || phase === 'editing-boundary';

  const set = (partial: Partial<ExtractionParams>) => {
    setParams(partial);
  };

  return (
    <div className="rounded-lg border border-border">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium"
        onClick={() => setOpen((o) => !o)}
      >
        <span>Detection Parameters</span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div className="space-y-3 border-t border-border px-3 pb-3 pt-2">
          <SliderRow
            label="Max road half-width"
            value={params.maxHalfWidth}
            min={3} max={25} step={0.5} unit=" m"
            tooltip="Maximum distance to search from centreline on each side"
            onChange={(v) => set({ maxHalfWidth: v })}
          />
          <SliderRow
            label="Curb height (min)"
            value={params.curbHeightMin}
            min={0.03} max={0.30} step={0.01} unit=" m"
            tooltip="Minimum height step to be classified as a curb. Lower = more sensitive."
            onChange={(v) => set({ curbHeightMin: v })}
          />
          <SliderRow
            label="Curb height (max)"
            value={params.curbHeightMax}
            min={0.10} max={1.00} step={0.05} unit=" m"
            tooltip="Height steps above this are walls, not curbs."
            onChange={(v) => set({ curbHeightMax: v })}
          />
          <SliderRow
            label="Drop-off threshold"
            value={params.dropOffThreshold}
            min={0.05} max={0.50} step={0.01} unit=" m"
            tooltip="Downward height drop signalling an embankment edge."
            onChange={(v) => set({ dropOffThreshold: v })}
          />
          <SliderRow
            label="Intensity threshold"
            value={params.intensityThreshold}
            min={5} max={100} step={1} unit=""
            tooltip="Intensity change (0–255) that signals a surface-type transition (no-curb case)."
            onChange={(v) => set({ intensityThreshold: v })}
          />
          <SliderRow
            label="Section spacing"
            value={params.sectionSpacing}
            min={0.25} max={2.0} step={0.25} unit=" m"
            tooltip="Distance between cross-sections. Smaller = more precise, slower."
            onChange={(v) => set({ sectionSpacing: v })}
          />
          <SliderRow
            label="Smoothing window"
            value={params.smoothingWindow}
            min={1} max={15} step={2} unit=" sec"
            tooltip="Median filter window applied to boundary distances."
            onChange={(v) => set({ smoothingWindow: v })}
          />

          <div className="flex gap-1.5 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1 text-xs"
              onClick={resetParams}
              title="Reset to defaults"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </Button>
            {canRerun && (
              <Button
                variant="default"
                size="sm"
                className="flex-1 gap-1 text-xs"
                onClick={onRerun}
              >
                <Play className="h-3 w-3" />
                Re-run
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Prior info display ────────────────────────────────────────────────────────

function PriorSection() {
  const prior = useRoadExtractionStore((s) => s.prior);
  const setPrior = useRoadExtractionStore((s) => s.setPrior);
  const [open, setOpen] = useState(false);

  if (!prior) return null;

  return (
    <div className="rounded-lg border border-border">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          Prior from previous chunk
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div className="space-y-1 border-t border-border px-3 pb-3 pt-2 text-[11px]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Intensity mean</span>
            <span className="font-mono">{prior.intensityMean.toFixed(1)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Intensity std</span>
            <span className="font-mono">{prior.intensityStd.toFixed(1)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Half-width L/R</span>
            <span className="font-mono">
              {prior.halfWidthLeft.toFixed(1)} / {prior.halfWidthRight.toFixed(1)} m
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Curbs detected</span>
            <span className={prior.hasCurbs ? 'text-green-500' : 'text-muted-foreground'}>
              {prior.hasCurbs ? 'Yes' : 'No'}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full text-xs text-muted-foreground"
            onClick={() => setPrior(null)}
          >
            Clear prior
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Results list ──────────────────────────────────────────────────────────────

function ResultsList() {
  const boundaries      = useRoadExtractionStore((s) => s.boundaries);
  const deleteBoundary  = useRoadExtractionStore((s) => s.deleteBoundary);
  const setVisible      = useRoadExtractionStore((s) => s.setBoundaryVisible);

  if (boundaries.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        No accepted chunks yet. Draw a centreline to begin.
      </p>
    );
  }

  return (
    <div className="space-y-0.5">
      {boundaries.map((b) => (
        <div
          key={b.id}
          className="group flex items-center gap-1.5 rounded px-1.5 py-1.5 hover:bg-muted"
        >
          {/* Visibility toggle */}
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setVisible(b.id, !b.visible)}
            title={b.visible ? 'Hide' : 'Show'}
          >
            {b.visible
              ? <Eye className="h-3.5 w-3.5" />
              : <EyeOff className="h-3.5 w-3.5 opacity-40" />
            }
          </button>

          <div className="flex flex-1 flex-col min-w-0">
            <span className="truncate text-xs">{b.label}</span>
            <span className="text-[10px] text-muted-foreground">
              L:{b.leftPoints.length} R:{b.rightPoints.length} pts
              {b.prior.hasCurbs ? ' · curbs' : ''}
            </span>
          </div>

          {/* Delete */}
          <button
            className="invisible text-muted-foreground opacity-0 transition-all hover:text-destructive group-hover:visible group-hover:opacity-100"
            onClick={() => deleteBoundary(b.id)}
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Export ────────────────────────────────────────────────────────────────────

function exportGeoJson(boundaries: ReturnType<typeof useRoadExtractionStore.getState>['boundaries']): string {
  const features = boundaries.flatMap((b) => [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: b.leftPoints.map((p) => [p.x, p.z, p.y]),
      },
      properties: {
        id: `${b.id}-left`,
        label: `${b.label} Left`,
        role: 'road-boundary-left',
        hasCurb: b.prior.hasCurbs,
        pointCount: b.leftPoints.length,
        createdAt: new Date(b.createdAt).toISOString(),
        // Lanelet2 suggested tags
        lanelet2_type: b.prior.hasCurbs ? 'curbstone' : 'road_border',
        lanelet2_subtype: b.prior.hasCurbs ? 'high' : undefined,
      },
    },
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: b.rightPoints.map((p) => [p.x, p.z, p.y]),
      },
      properties: {
        id: `${b.id}-right`,
        label: `${b.label} Right`,
        role: 'road-boundary-right',
        hasCurb: b.prior.hasCurbs,
        pointCount: b.rightPoints.length,
        createdAt: new Date(b.createdAt).toISOString(),
        lanelet2_type: b.prior.hasCurbs ? 'curbstone' : 'road_border',
        lanelet2_subtype: b.prior.hasCurbs ? 'high' : undefined,
      },
    },
  ]);

  return JSON.stringify({
    type: 'FeatureCollection',
    metadata: {
      exportedAt: new Date().toISOString(),
      boundaryCount: boundaries.length,
      coordinateSystem: 'local-metres',
    },
    features,
  }, null, 2);
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function RoadExtractionPanel() {
  const mode    = useViewerModeStore((s) => s.mode);
  const phase   = useRoadExtractionStore((s) => s.phase);
  const boundaries = useRoadExtractionStore((s) => s.boundaries);
  const enterRoadExtractionMode = useViewerModeStore((s) => s.enterRoadExtractionMode);
  const exitMode = useViewerModeStore((s) => s.exitMode);
  const rerunFn = useRoadExtractionStore((s) => s.setPhase);

  const isActive = mode === 'road-extraction';

  const handleExport = () => {
    const json = exportGeoJson(boundaries);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `road-boundaries-${Date.now()}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div>
        {isActive ? (
          <Button
            variant="destructive"
            size="sm"
            className="w-full gap-2 text-xs"
            onClick={exitMode}
          >
            <StopCircle className="h-3.5 w-3.5" />
            Exit Extraction Mode
          </Button>
        ) : (
          <Button
            variant="default"
            size="sm"
            className="w-full gap-2 text-xs"
            onClick={enterRoadExtractionMode}
          >
            <Play className="h-3.5 w-3.5" />
            Enter Extraction Mode
          </Button>
        )}
      </div>

      {/* Current phase hint */}
      {isActive && phase !== 'idle' && (
        <div className="rounded-md bg-muted px-3 py-2 text-[11px] text-muted-foreground">
          {phase === 'drawing'          && 'Click to trace road centreline in 3D view'}
          {phase === 'extracting'       && 'Analysing point cloud…'}
          {phase === 'reviewing'        && 'Review boundaries in 3D · adjust params below'}
          {phase === 'editing-boundary' && 'Drag handles in 3D view to adjust boundaries'}
          {phase === 'committed'        && 'Chunk accepted · continue or export'}
        </div>
      )}

      {/* Parameters */}
      <ParamsSection
        onRerun={() => rerunFn('extracting')}
      />

      {/* Prior */}
      <PriorSection />

      {/* Separator */}
      <div className="border-t border-border" />

      {/* Results */}
      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Accepted Chunks ({boundaries.length})
        </p>
        <ResultsList />
      </div>

      {/* Export */}
      {boundaries.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2 text-xs"
          onClick={handleExport}
        >
          <Download className="h-3.5 w-3.5" />
          Export GeoJSON ({boundaries.length * 2} lines)
        </Button>
      )}
    </div>
  );
}
