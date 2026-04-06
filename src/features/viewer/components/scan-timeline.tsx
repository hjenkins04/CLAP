import { useMemo } from 'react';
import { useScanFilterStore } from '../plugins/scan-filter';
import { useViewerModeStore } from '@/app/stores';

export function ScanTimeline() {
  const mode = useViewerModeStore((s) => s.mode);
  const phase = useScanFilterStore((s) => s.phase);

  const trajectoryData   = useScanFilterStore((s) => s.trajectoryData);
  const selectedScanIds  = useScanFilterStore((s) => s.selectedScanIds);
  const effectiveMin     = useScanFilterStore((s) => s.effectiveScanIdMin);
  const effectiveMax     = useScanFilterStore((s) => s.effectiveScanIdMax);

  // useMemo must be before any early return (Rules of Hooks)
  const ticks = useMemo(() => {
    if (!trajectoryData) return [];
    const pts = trajectoryData.points;
    const step = Math.max(1, Math.floor(pts.length / 200));
    return pts.filter((_, i) => i % step === 0);
  }, [trajectoryData]);

  const visible = mode === 'scan-filter' || phase === 'applied';
  if (!visible || !trajectoryData) return null;

  const [globalMin, globalMax] = trajectoryData.scanIdRange;
  const [gpsMin, gpsMax] = trajectoryData.gpsTimeRange;
  const span = globalMax - globalMin || 1;

  const toPercent = (id: number) => ((id - globalMin) / span) * 100;

  const selMin = selectedScanIds.length > 0 ? selectedScanIds[0] : null;
  const selMax = selectedScanIds.length > 0 ? selectedScanIds[selectedScanIds.length - 1] : null;

  const effLeft  = toPercent(effectiveMin);
  const effRight = 100 - toPercent(effectiveMax);
  const selLeft  = selMin !== null ? toPercent(selMin) : null;
  const selRight = selMax !== null ? 100 - toPercent(selMax) : null;

  const totalScans = selectedScanIds.length > 0
    ? effectiveMax - effectiveMin + 1
    : 0;

  return (
    <div className="absolute left-1/2 top-11 z-10 -translate-x-1/2 w-[min(600px,60vw)]">
      <div className="rounded-md border border-border bg-card/90 px-3 py-2 shadow-sm backdrop-blur-sm">
        {/* Labels */}
        <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Scan {globalMin}</span>
          {totalScans > 0 ? (
            <span className="font-medium text-amber-400">
              {totalScans} scan{totalScans !== 1 ? 's' : ''} · IDs {effectiveMin}–{effectiveMax}
            </span>
          ) : (
            <span>Click trajectory points to select scans</span>
          )}
          <span>Scan {globalMax}</span>
        </div>

        {/* Track */}
        <div className="relative h-4">
          {/* Background track */}
          <div className="absolute inset-y-1 left-0 right-0 rounded-full bg-muted/60" />

          {/* Effective window (amber, behind selection) */}
          {totalScans > 0 && (
            <div
              className="absolute inset-y-1 rounded-full bg-amber-500/30"
              style={{ left: `${effLeft}%`, right: `${effRight}%` }}
            />
          )}

          {/* Selected range (amber solid) */}
          {selLeft !== null && selRight !== null && (
            <div
              className="absolute inset-y-0.5 rounded-full bg-amber-500/70"
              style={{ left: `${selLeft}%`, right: `${selRight}%` }}
            />
          )}

          {/* Trajectory point ticks */}
          {ticks.map((pt) => {
            const x = toPercent(pt.scanId);
            const isSelected = selectedScanIds.includes(pt.scanId);
            return (
              <div
                key={pt.scanId}
                className={`absolute top-0.5 bottom-0.5 w-px ${isSelected ? 'bg-amber-300' : 'bg-blue-400/60'}`}
                style={{ left: `${x}%` }}
              />
            );
          })}
        </div>

        {/* GPS time range */}
        <div className="mt-1 flex items-center justify-between text-[9px] text-muted-foreground/70">
          <span>GPS {gpsMin.toFixed(1)}s</span>
          <span>GPS {gpsMax.toFixed(1)}s</span>
        </div>
      </div>
    </div>
  );
}
