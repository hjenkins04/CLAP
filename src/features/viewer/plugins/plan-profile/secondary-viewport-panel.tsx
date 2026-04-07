import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Minus, Plus, ArrowLeftRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Separator } from '@clap/design-system';
import { usePlanProfileStore } from './plan-profile-store';
import { useScanFilterStore } from '../scan-filter/scan-filter-store';
import type { PlanProfilePlugin } from './plan-profile-plugin';
import type { ViewerEngine } from '../../services/viewer-engine';

interface SecondaryViewportPanelProps {
  engine: ViewerEngine | null;
}

export function SecondaryViewportPanel({ engine }: SecondaryViewportPanelProps) {
  const phase            = usePlanProfileStore((s) => s.phase);
  const trajectoryPhase  = usePlanProfileStore((s) => s.trajectoryPhase);
  const viewType         = usePlanProfileStore((s) => s.viewType);
  const halfDepth        = usePlanProfileStore((s) => s.halfDepth);
  const setHalfDepth     = usePlanProfileStore((s) => s.setHalfDepth);
  const pointSize        = usePlanProfileStore((s) => s.pointSize);
  const setPointSize     = usePlanProfileStore((s) => s.setPointSize);
  const viewFlipped      = usePlanProfileStore((s) => s.viewFlipped);
  const toggleViewFlip   = usePlanProfileStore((s) => s.toggleViewFlip);
  const close            = usePlanProfileStore((s) => s.close);
  const followIndex = usePlanProfileStore((s) => s.followIndex);

  const trajectoryData = useScanFilterStore((s) => s.trajectoryData);

  const containerRef  = useRef<HTMLDivElement>(null);
  const panelRef      = useRef<HTMLDivElement>(null);
  const inputRef      = useRef<HTMLInputElement>(null);
  const scanInputRef  = useRef<HTMLInputElement>(null);

  const [editing, setEditing]         = useState(false);
  const [inputVal, setInputVal]       = useState('');
  const [scanEditing, setScanEditing] = useState(false);
  const [scanInputVal, setScanInputVal] = useState('');
  // null = use default CSS (h-1/2); number = explicit pixel height
  const [panelHeight, setPanelHeight] = useState<number | null>(null);

  const isActive = phase !== 'idle';

  const plugin = engine?.getPlugin<PlanProfilePlugin>('plan-profile');
  const navigate = useCallback((delta: number) => plugin?.navigateFollow(delta), [plugin]);

  // Attach/detach the secondary renderer when the panel becomes active
  useEffect(() => {
    if (!isActive || !containerRef.current) return;
    const plugin = engine?.getPlugin<PlanProfilePlugin>('plan-profile');
    if (!plugin) return;
    plugin.attachSecondaryContainer(containerRef.current);
    return () => { plugin.detachSecondaryContainer(); };
  }, [engine, isActive]);

  // Handle resize of the canvas inside the panel
  useEffect(() => {
    if (!isActive || !containerRef.current) return;
    const plugin = engine?.getPlugin<PlanProfilePlugin>('plan-profile');
    if (!plugin) return;
    const observer = new ResizeObserver(() => plugin.resizeSecondary());
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [engine, isActive]);

  // Focus input when entering inline edit mode
  useEffect(() => {
    if (editing) {
      setInputVal(halfDepth < 1 ? halfDepth.toFixed(2) : halfDepth.toFixed(1));
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [editing, halfDepth]);

  const commitInput = useCallback(() => {
    const parsed = parseFloat(inputVal);
    if (!isNaN(parsed)) setHalfDepth(parsed);
    setEditing(false);
  }, [inputVal, setHalfDepth]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitInput();
    else if (e.key === 'Escape') setEditing(false);
  }, [commitInput]);

  // Focus scan input when entering scan-id edit mode
  useEffect(() => {
    if (scanEditing && trajectoryData) {
      const currentScanId = trajectoryData.points[followIndex]?.scanId;
      setScanInputVal(currentScanId != null ? String(currentScanId) : '');
      setTimeout(() => scanInputRef.current?.select(), 0);
    }
  }, [scanEditing, followIndex, trajectoryData]);

  const commitScanInput = useCallback(() => {
    const parsed = parseInt(scanInputVal, 10);
    if (!isNaN(parsed)) plugin?.navigateToScanId(parsed);
    setScanEditing(false);
  }, [scanInputVal, plugin]);

  const handleScanKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitScanInput();
    else if (e.key === 'Escape') setScanEditing(false);
  }, [commitScanInput]);

  // ── Vertical resize drag ───────────────────────────────────────────────────
  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();

    const startY      = e.clientY;
    const startHeight = panelRef.current?.getBoundingClientRect().height ?? 300;
    const parent      = panelRef.current?.parentElement;

    const onMove = (mv: MouseEvent) => {
      const delta     = startY - mv.clientY;           // drag up → bigger panel
      const parentH   = parent?.getBoundingClientRect().height ?? window.innerHeight;
      const clamped   = Math.min(Math.max(startHeight + delta, 120), parentH - 80);
      setPanelHeight(clamped);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor     = 'ns-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  if (!isActive) return null;

  const title      = viewType === 'plan' ? 'Plan View' : 'Profile View';
  const depthLabel = viewType === 'plan' ? 'Height band' : 'Buffer depth';

  const heightStyle = panelHeight !== null
    ? { height: panelHeight, flexShrink: 0 }
    : undefined;
  const heightClass = panelHeight !== null ? '' : 'h-1/2';

  return (
    <div
      ref={panelRef}
      style={heightStyle}
      className={`relative flex flex-col border-t border-border bg-background ${heightClass}`}
    >
      {/* Drag handle — sits on the top border */}
      <div
        className="absolute inset-x-0 top-0 z-20 h-1 cursor-ns-resize hover:bg-primary/40 active:bg-primary/60"
        onMouseDown={onResizeMouseDown}
      />

      {/* Panel header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card/80 px-3 py-1 backdrop-blur-sm">
        <span className="text-xs font-medium">{title}</span>
        <Separator orientation="vertical" className="h-4" />

        {/* Buffer depth control */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">{depthLabel}:</span>
          <div className="flex items-center gap-0.5 rounded border border-border bg-background px-1 py-0.5">
            <Button
              size="icon"
              variant="ghost"
              className="h-4 w-4"
              onClick={() => setHalfDepth(halfDepth - 0.5)}
            >
              <Minus className="h-2.5 w-2.5" />
            </Button>

            {editing ? (
              <input
                ref={inputRef}
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onBlur={commitInput}
                onKeyDown={handleKeyDown}
                className="w-[5ch] min-w-[4ch] bg-transparent text-center text-[10px] tabular-nums outline-none"
              />
            ) : (
              <span
                className="min-w-[4ch] cursor-text text-center text-[10px] tabular-nums"
                title="Double-click to enter value"
                onDoubleClick={() => setEditing(true)}
              >
                {halfDepth < 1 ? `${halfDepth.toFixed(2)}m` : `${halfDepth.toFixed(1)}m`}
              </span>
            )}

            <Button
              size="icon"
              variant="ghost"
              className="h-4 w-4"
              onClick={() => setHalfDepth(halfDepth + 0.5)}
            >
              <Plus className="h-2.5 w-2.5" />
            </Button>
          </div>
          <span className="text-[10px] text-muted-foreground">(0.001–15m)</span>
        </div>

        <div className="flex-1" />

        {/* Point size slider */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">Pt size:</span>
          <input
            type="range"
            min={0.5}
            max={10}
            step={0.5}
            value={pointSize}
            onChange={(e) => setPointSize(parseFloat(e.target.value))}
            className="h-1 w-20 cursor-pointer accent-primary"
            title={`Point size: ${pointSize}`}
          />
          <span className="w-[3ch] text-[10px] tabular-nums text-muted-foreground">
            {pointSize % 1 === 0 ? pointSize.toFixed(0) : pointSize.toFixed(1)}
          </span>
        </div>

        <Separator orientation="vertical" className="h-4" />

        {/* Flip view direction */}
        <Button
          size="icon"
          variant={viewFlipped ? 'default' : 'ghost'}
          className="h-5 w-5"
          title={viewFlipped ? 'Viewing from Side B — click to flip' : 'Viewing from Side A — click to flip'}
          onClick={toggleViewFlip}
        >
          <ArrowLeftRight className="h-3 w-3" />
        </Button>

        <Button size="icon" variant="ghost" className="h-5 w-5" onClick={close}>
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Trajectory follow navigation bar */}
      {trajectoryPhase === 'active' && trajectoryData && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-3 py-1">
          {/* Prev / Next */}
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            disabled={followIndex <= 0}
            onClick={() => navigate(-1)}
            title="Previous trajectory point"
          >
            <ChevronLeft className="h-3 w-3" />
          </Button>

          <span className="text-[10px] tabular-nums text-muted-foreground">
            Scan&nbsp;
            {scanEditing ? (
              <input
                ref={scanInputRef}
                value={scanInputVal}
                onChange={(e) => setScanInputVal(e.target.value)}
                onBlur={commitScanInput}
                onKeyDown={handleScanKeyDown}
                className="w-[6ch] bg-transparent text-center text-[10px] font-medium tabular-nums outline-none ring-1 ring-primary/60 rounded-sm"
              />
            ) : (
              <span
                className="cursor-text font-medium text-foreground"
                title="Double-click to jump to scan"
                onDoubleClick={() => setScanEditing(true)}
              >
                {trajectoryData.points[followIndex]?.scanId ?? '—'}
              </span>
            )}
            &nbsp;({followIndex + 1} / {trajectoryData.points.length})
          </span>

          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            disabled={followIndex >= trajectoryData.points.length - 1}
            onClick={() => navigate(+1)}
            title="Next trajectory point"
          >
            <ChevronRight className="h-3 w-3" />
          </Button>

        </div>
      )}

      {/* Follow-centroid instruction overlay */}
      {trajectoryPhase === 'centroid-picking' && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-border bg-primary/10 px-3 py-1.5">
          <span className="text-[11px] font-medium text-primary">
            Click in the 3D view to set the starting trajectory position
          </span>
        </div>
      )}

      {/* Canvas container — fills remaining height */}
      <div ref={containerRef} className="relative min-h-0 flex-1" />
    </div>
  );
}
