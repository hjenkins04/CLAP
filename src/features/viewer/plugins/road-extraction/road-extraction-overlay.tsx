import { Button } from '@clap/design-system';
import {
  Check,
  Edit2,
  Pencil,
  RotateCcw,
  X,
  ChevronRight,
  Loader2,
  Spline,
} from 'lucide-react';
import { useRoadExtractionStore } from './road-extraction-store';
import { useViewerModeStore } from '@/app/stores';
import { RoadExtractionPlugin } from './road-extraction-plugin';
import type { ViewerEngine } from '../../services/viewer-engine';

// ── Phase hint banner ─────────────────────────────────────────────────────────

function PhaseHint({ message }: { message: string }) {
  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2">
      <div className="rounded-lg bg-black/70 px-4 py-2 text-xs text-white backdrop-blur-sm">
        {message}
      </div>
    </div>
  );
}

// ── Drawing toolbar ───────────────────────────────────────────────────────────

function DrawingToolbar({ plugin }: { plugin: RoadExtractionPlugin | undefined }) {
  const pts = useRoadExtractionStore((s) => s.centerlinePoints);
  // While drawing, pointCount comes from the plugin's internal array,
  // but we track confirmability via the store's saved points
  const canConfirm = pts.length >= 2;

  return (
    <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card/95 px-2 py-1 shadow-md backdrop-blur-sm">
        <span className="mr-1 text-[11px] text-muted-foreground">
          Centreline: click to place · double-click on last point or press Enter to finish
        </span>
        <div className="mx-1 h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => plugin?.confirmCenterline()}
          disabled={!canConfirm}
        >
          <Check className="h-3.5 w-3.5 text-green-500" />
          Confirm
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-muted-foreground"
          onClick={() => plugin?.cancelDrawing()}
        >
          <X className="h-3.5 w-3.5" />
          Cancel
          <kbd className="ml-0.5 rounded bg-muted px-1 py-0.5 text-[10px]">Esc</kbd>
        </Button>
      </div>
    </div>
  );
}

// ── Shaping toolbar ───────────────────────────────────────────────────────────

function ShapingToolbar({ plugin }: { plugin: RoadExtractionPlugin | undefined }) {
  const leftCount  = useRoadExtractionStore((s) => s.shapingLeft.length);
  const rightCount = useRoadExtractionStore((s) => s.shapingRight.length);

  return (
    <>
      <div className="pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2">
        <div className="rounded-lg bg-black/70 px-4 py-2 text-xs text-white backdrop-blur-sm text-center leading-relaxed">
          <span className="font-medium text-green-400">Green</span> = left edge ·{' '}
          <span className="font-medium text-orange-400">Orange</span> = right edge
          <br />
          Drag handles to reshape · hover an edge midpoint and click to add a vertex
          <br />
          <span className="text-white/60">L: {leftCount} pts · R: {rightCount} pts</span>
        </div>
      </div>

      <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card/95 px-2 py-1 shadow-md backdrop-blur-sm">
          <Spline className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
          <span className="mr-1 text-[11px] text-muted-foreground">
            Road shape
          </span>
          <div className="mx-1 h-4 w-px bg-border" />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground"
            onClick={() => plugin?.redrawCenterline()}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Redraw
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground"
            onClick={() => plugin?.cancelDrawing()}
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </Button>
          <div className="mx-1 h-4 w-px bg-border" />
          <Button
            size="sm"
            className="h-7 gap-1.5 text-xs text-green-600 hover:text-green-500"
            variant="ghost"
            onClick={() => plugin?.confirmShaping()}
            disabled={leftCount < 2 || rightCount < 2}
          >
            <Check className="h-3.5 w-3.5" />
            Confirm & Extract
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </>
  );
}

// ── Extraction progress bar ───────────────────────────────────────────────────

function ExtractionProgress({ plugin }: { plugin: RoadExtractionPlugin | undefined }) {
  const progress = useRoadExtractionStore((s) => s.progress);

  const pct = progress && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  return (
    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
      <div className="w-72 rounded-xl border border-border bg-card/95 px-5 py-4 shadow-xl backdrop-blur-sm">
        <div className="mb-3 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm font-medium">Analysing cross-sections…</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{progress?.done ?? 0} / {progress?.total ?? 0} sections</span>
          <span>{pct}%</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 w-full text-xs text-muted-foreground"
          onClick={() => plugin?.redrawCenterline()}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── Reviewing toolbar ─────────────────────────────────────────────────────────

function ReviewingToolbar({ plugin }: { plugin: RoadExtractionPlugin | undefined }) {
  const hasPending = useRoadExtractionStore((s) => s.hasPendingResult());
  const leftCount  = useRoadExtractionStore((s) => s.pendingLeft.length);
  const rightCount = useRoadExtractionStore((s) => s.pendingRight.length);

  return (
    <>
      {/* Result summary hint */}
      <div className="pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2">
        <div className="rounded-lg bg-black/60 px-4 py-2 text-xs text-white backdrop-blur-sm">
          {hasPending
            ? `Left: ${leftCount} pts · Right: ${rightCount} pts — adjust params in the sidebar or edit boundaries`
            : 'No boundary detected — check parameters or redraw centreline'}
        </div>
      </div>

      {/* Action toolbar */}
      <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card/95 px-2 py-1 shadow-md backdrop-blur-sm">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => plugin?.enterEditBoundary()}
            disabled={!hasPending}
          >
            <Edit2 className="h-3.5 w-3.5" />
            Edit Boundaries
          </Button>

          <div className="mx-1 h-4 w-px bg-border" />

          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground"
            onClick={() => plugin?.backToShaping()}
          >
            <Spline className="h-3.5 w-3.5" />
            Reshape
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground"
            onClick={() => plugin?.redrawCenterline()}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Redraw
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground"
            onClick={() => plugin?.exitToIdle()}
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </Button>

          <div className="mx-1 h-4 w-px bg-border" />

          <Button
            size="sm"
            className="h-7 gap-1.5 text-xs text-green-600 hover:text-green-500"
            variant="ghost"
            onClick={() => plugin?.acceptResult()}
            disabled={!hasPending}
          >
            <Check className="h-3.5 w-3.5" />
            Accept
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </>
  );
}

// ── Edit-boundary toolbar ─────────────────────────────────────────────────────

function EditBoundaryToolbar({ plugin }: { plugin: RoadExtractionPlugin | undefined }) {
  return (
    <>
      <PhaseHint message="Drag boundary handles to adjust · Done when finished" />
      <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card/95 px-2 py-1 shadow-md backdrop-blur-sm">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => plugin?.doneEditBoundary()}
          >
            <Pencil className="h-3.5 w-3.5" />
            Done Editing
          </Button>

          <div className="mx-1 h-4 w-px bg-border" />

          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-xs text-green-600 hover:text-green-500"
            onClick={() => plugin?.acceptResult()}
          >
            <Check className="h-3.5 w-3.5" />
            Accept
          </Button>
        </div>
      </div>
    </>
  );
}

// ── Committed toolbar ─────────────────────────────────────────────────────────

function CommittedToolbar({ plugin }: { plugin: RoadExtractionPlugin | undefined }) {
  const count = useRoadExtractionStore((s) => s.boundaries.length);

  return (
    <>
      <div className="pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2">
        <div className="rounded-lg bg-black/60 px-4 py-2 text-xs text-white backdrop-blur-sm">
          Chunk accepted ({count} total) — continue to trace the next segment
        </div>
      </div>
      <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card/95 px-2 py-1 shadow-md backdrop-blur-sm">
          <Button
            variant="default"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => plugin?.continueNewChunk()}
          >
            <ChevronRight className="h-3.5 w-3.5" />
            Continue (next chunk)
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground"
            onClick={() => plugin?.exitToIdle()}
          >
            Done
          </Button>
        </div>
      </div>
    </>
  );
}

// ── Main overlay ──────────────────────────────────────────────────────────────

interface RoadExtractionOverlayProps {
  engine: ViewerEngine | null;
}

export function RoadExtractionOverlay({ engine }: RoadExtractionOverlayProps) {
  const mode  = useViewerModeStore((s) => s.mode);
  const phase = useRoadExtractionStore((s) => s.phase);

  if (mode !== 'road-extraction') return null;

  const plugin = engine?.getPlugin<RoadExtractionPlugin>('road-extraction');

  return (
    <>
      {phase === 'drawing' && (
        <>
          <PhaseHint message="Click to place centreline vertices · double-click or Enter to finish · Backspace to undo · Esc to cancel" />
          <DrawingToolbar plugin={plugin} />
        </>
      )}

      {phase === 'shaping' && (
        <ShapingToolbar plugin={plugin} />
      )}

      {phase === 'extracting' && (
        <ExtractionProgress plugin={plugin} />
      )}

      {phase === 'reviewing' && (
        <ReviewingToolbar plugin={plugin} />
      )}

      {phase === 'editing-boundary' && (
        <EditBoundaryToolbar plugin={plugin} />
      )}

      {phase === 'committed' && (
        <CommittedToolbar plugin={plugin} />
      )}
    </>
  );
}
