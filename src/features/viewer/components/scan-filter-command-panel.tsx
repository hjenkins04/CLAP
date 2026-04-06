import { useState } from 'react';
import { Check, Eye, EyeOff, FlipHorizontal2, RotateCcw, Trash2, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { useHotkey } from '@tanstack/react-hotkeys';
import { Button, Label } from '@clap/design-system';
import { useViewerModeStore } from '@/app/stores';
import { useScanFilterStore } from '../plugins/scan-filter';
import { ScanFilterPlugin } from '../plugins/scan-filter';
import { CommandPopup } from './command-popup';
import type { ViewerEngine } from '../services/viewer-engine';

/**
 * Parse scan ID input.
 *
 * Syntax:
 *   100           → include scan 100
 *   200-210       → include range 200–210
 *   ~623          → exclude scan 623
 *   ~623-800      → exclude range 623–800
 *   100-500,~200-300 → include 100–500 then subtract 200–300
 *
 * Returns:
 *   { ids, excluded } where:
 *   - ids      = the final resolved scan IDs (include-mode result)
 *   - excluded = the raw excluded IDs when the input was purely exclusion-based
 *                (caller should set selectedScanIds=excluded, then invertSelection
 *                 to get proper exclude-mode filter behaviour)
 */
function parseScanInput(
  input: string,
  globalMin: number,
  globalMax: number,
): { ids: number[]; excluded: number[] | null } | null {
  const inclusions = new Set<number>();
  const exclusions = new Set<number>();
  let hasInclusions = false;

  const parts = input.split(',').map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const neg = part.startsWith('~');
    const clean = part.replace(/~/g, '');
    const rangeMatch = clean.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1], 10);
      const hi = parseInt(rangeMatch[2], 10);
      if (isNaN(lo) || isNaN(hi) || lo > hi) return null;
      const target = neg ? exclusions : inclusions;
      if (!neg) hasInclusions = true;
      for (let i = lo; i <= Math.min(hi, lo + 10_000); i++) target.add(i);
    } else {
      const n = parseInt(clean, 10);
      if (isNaN(n)) return null;
      if (neg) {
        exclusions.add(n);
      } else {
        inclusions.add(n);
        hasInclusions = true;
      }
    }
  }

  const pureExclusion = !hasInclusions && exclusions.size > 0;

  if (pureExclusion) {
    for (let i = globalMin; i <= globalMax; i++) inclusions.add(i);
  }

  for (const id of exclusions) inclusions.delete(id);

  const ids = [...inclusions]
    .filter((id) => id >= globalMin && id <= globalMax)
    .sort((a, b) => a - b);
  if (ids.length === 0) return null;

  const excluded = pureExclusion
    ? [...exclusions].filter((id) => id >= globalMin && id <= globalMax).sort((a, b) => a - b)
    : null;

  return { ids, excluded };
}

interface ScanFilterCommandPanelProps {
  engine: ViewerEngine | null;
}

export function ScanFilterCommandPanel({ engine }: ScanFilterCommandPanelProps) {
  const [scanInput, setScanInput]   = useState('');
  const [inputError, setInputError] = useState(false);

  const mode    = useViewerModeStore((s) => s.mode);
  const phase   = useScanFilterStore((s) => s.phase);
  const expanded    = useViewerModeStore((s) => s.isCommandPanelExpanded());
  const setExpanded = useViewerModeStore((s) => s.setCommandPanelExpanded);

  const selectedScanIds = useScanFilterStore((s) => s.selectedScanIds);
  const windowBefore    = useScanFilterStore((s) => s.windowBefore);
  const windowAfter     = useScanFilterStore((s) => s.windowAfter);
  const effectiveMin    = useScanFilterStore((s) => s.effectiveScanIdMin);
  const effectiveMax    = useScanFilterStore((s) => s.effectiveScanIdMax);
  const filterEnabled   = useScanFilterStore((s) => s.filterEnabled);
  const filterMode      = useScanFilterStore((s) => s.filterMode);
  const excludeRangeMin = useScanFilterStore((s) => s.excludeRangeMin);
  const excludeRangeMax = useScanFilterStore((s) => s.excludeRangeMax);
  const trajectoryVisible = useScanFilterStore((s) => s.trajectoryVisible);

  const trajectoryData     = useScanFilterStore((s) => s.trajectoryData);
  const setSelectedScanIds = useScanFilterStore((s) => s.setSelectedScanIds);
  const setFilterMode      = useScanFilterStore((s) => s.setFilterMode);
  const invertSelectionFn  = useScanFilterStore((s) => s.invertSelection);
  const stepScan           = useScanFilterStore((s) => s.stepScan);
  const setWindowBefore    = useScanFilterStore((s) => s.setWindowBefore);
  const setWindowAfter     = useScanFilterStore((s) => s.setWindowAfter);
  const setTrajectoryVisible = useScanFilterStore((s) => s.setTrajectoryVisible);

  const [gMin, gMax] = trajectoryData?.scanIdRange ?? [0, 0];

  function commitScanInput() {
    const parsed = parseScanInput(scanInput, gMin, gMax);
    if (!parsed) { setInputError(true); return; }
    setInputError(false);
    setScanInput('');
    if (parsed.excluded) {
      // Pure exclusion input (e.g. ~623-800): set the excluded IDs as the selection
      // first, then invert — this puts the store into exclude mode with the correct
      // excludeRange so the shader hides exactly those scan IDs.
      setSelectedScanIds(parsed.excluded);
      invertSelectionFn();
    } else {
      setSelectedScanIds([...new Set([...selectedScanIds, ...parsed.ids])]);
    }
  }

  function invertSelection() {
    // Single atomic store update — avoids intermediate states that would
    // trigger applyFilter() with a partially-updated (incorrect) range.
    invertSelectionFn();
  }

  const plugin = engine?.getPlugin<ScanFilterPlugin>('scan-filter');

  const isConfiguring = mode === 'scan-filter';
  const isApplied     = phase === 'applied';
  const selectionCount = selectedScanIds.length;
  const canRiffle = isApplied && filterMode === 'include' && selectionCount === 1;

  useHotkey('ArrowLeft',  (e) => { e.preventDefault(); stepScan(-1); }, { enabled: canRiffle });
  useHotkey('ArrowRight', (e) => { e.preventDefault(); stepScan(1);  }, { enabled: canRiffle });

  if (!isConfiguring && !isApplied) return null;

  const effectiveSpan  = effectiveMax - effectiveMin + 1;

  return (
    <CommandPopup
      title={isApplied ? 'Scan Filter Active' : 'Scan Filter'}
      expanded={expanded}
      onToggleExpand={() => setExpanded(!expanded)}
      className="absolute bottom-16 left-3 z-10 w-72"
      onClose={() => plugin?.clearAll()}
    >
      <div className="space-y-3">

        {/* ── Configuring: selection info + window sliders ───────────────── */}
        {isConfiguring && (
          <>
            <p className="text-xs text-muted-foreground">
              {selectionCount === 0
                ? 'Click to select · Ctrl+click/drag to add · Alt+click/drag to deselect'
                : filterMode === 'exclude'
                  ? `Excluding ${effectiveSpan} scan${effectiveSpan !== 1 ? 's' : ''} (${effectiveMin}–${effectiveMax}) · showing all others`
                  : `${selectionCount} point${selectionCount !== 1 ? 's' : ''} selected · effective range: ${effectiveMin}–${effectiveMax} (${effectiveSpan} scan${effectiveSpan !== 1 ? 's' : ''})`}
            </p>

            {/* Trajectory visibility toggle */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-full gap-1.5 text-xs"
              onClick={() => setTrajectoryVisible(!trajectoryVisible)}
            >
              {trajectoryVisible
                ? <Eye className="h-3.5 w-3.5" />
                : <EyeOff className="h-3.5 w-3.5" />}
              {trajectoryVisible ? 'Hide Trajectory' : 'Show Trajectory'}
            </Button>

            {/* Window sliders */}
            <div className="space-y-2">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Window Before</Label>
                  <span className="text-xs font-medium tabular-nums">{windowBefore}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={windowBefore}
                  onChange={(e) => setWindowBefore(Number(e.target.value))}
                  className="h-1 w-full cursor-pointer accent-amber-500"
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Window After</Label>
                  <span className="text-xs font-medium tabular-nums">{windowAfter}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={windowAfter}
                  onChange={(e) => setWindowAfter(Number(e.target.value))}
                  className="h-1 w-full cursor-pointer accent-amber-500"
                />
              </div>
            </div>

            {/* Scan ID text input */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Enter Scan IDs</Label>
              <div className="flex gap-1">
                <input
                  type="text"
                  placeholder="e.g. 100, 200-210, ~300-400"
                  value={scanInput}
                  onChange={(e) => { setScanInput(e.target.value); setInputError(false); }}
                  onKeyDown={(e) => e.key === 'Enter' && commitScanInput()}
                  className={`h-7 flex-1 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-1 ${
                    inputError
                      ? 'border-destructive focus:ring-destructive'
                      : 'border-input focus:ring-ring'
                  }`}
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={commitScanInput}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
              {inputError && (
                <p className="text-[10px] text-destructive">
                  Invalid. Use: 100, 200-210, ~300 (~ to exclude)
                </p>
              )}
            </div>

            {/* Invert selection */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-full gap-1.5 text-xs"
              onClick={invertSelection}
            >
              <FlipHorizontal2 className="h-3.5 w-3.5" />
              Invert Selection
            </Button>

            {/* Apply button */}
            {selectionCount > 0 && (
              <Button
                variant="default"
                size="sm"
                className="h-7 w-full gap-1.5 text-xs"
                onClick={() => plugin?.enableFilter()}
              >
                <Check className="h-3.5 w-3.5" />
                Apply Filter
              </Button>
            )}

            {/* Clear */}
            {selectionCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-full gap-1.5 text-xs text-destructive hover:text-destructive"
                onClick={() => plugin?.clearAll()}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear Selection
              </Button>
            )}
          </>
        )}

        {/* ── Applied state ──────────────────────────────────────────────── */}
        {isApplied && (
          <>
            <p className="text-xs text-muted-foreground">
              {filterMode === 'exclude'
                ? `Excluding scans ${effectiveMin}–${effectiveMax} · showing all others`
                : `Showing scans ${effectiveMin}–${effectiveMax} (${effectiveSpan} scan${effectiveSpan !== 1 ? 's' : ''})`}
              {(windowBefore > 0 || windowAfter > 0) ? ` · window ±${windowBefore}/${windowAfter}` : ''}
            </p>

            {/* Scan riffle — only when a single scan is filtered */}
            {canRiffle && (
              <div className="flex items-center gap-1">
                <Button
                  variant="outline" size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => stepScan(-1)}
                  title="Previous scan (←)"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="flex-1 text-center text-xs font-medium tabular-nums">
                  Scan {selectedScanIds[0]}
                </span>
                <Button
                  variant="outline" size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => stepScan(1)}
                  title="Next scan (→)"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              className="h-7 w-full gap-1.5 text-xs"
              onClick={() => plugin?.redefine()}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Redefine Selection
            </Button>

            {filterEnabled && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-full gap-1.5 text-xs"
                onClick={() => plugin?.disableFilter()}
              >
                <EyeOff className="h-3.5 w-3.5" />
                Disable Filter
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              className="h-7 w-full gap-1.5 text-xs text-destructive hover:text-destructive"
              onClick={() => plugin?.clearAll()}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear Filter
            </Button>
          </>
        )}

      </div>
    </CommandPopup>
  );
}
