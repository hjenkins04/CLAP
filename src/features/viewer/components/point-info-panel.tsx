import { Filter } from 'lucide-react';
import { Button } from '@clap/design-system';
import { useViewerModeStore } from '@/app/stores';
import { usePointInfoStore } from '../plugins/point-info';
import { useScanFilterStore } from '../plugins/scan-filter';
import { ScanFilterPlugin } from '../plugins/scan-filter';
import { CommandPopup } from './command-popup';
import type { ViewerEngine } from '../services/viewer-engine';
import {
  useClassificationLegendStore,
  findLegendClass,
  parseColor,
  type ClassificationLegend,
  type LegendClass,
} from '../services/classification-legend';

interface Props {
  engine: ViewerEngine | null;
}

function getGroupName(legend: ClassificationLegend, groupId: string): string | null {
  return legend.groups.find((g) => g.id === groupId)?.name ?? null;
}

function ClassRow({ classId, legend }: { classId: number; legend: ClassificationLegend }) {
  const resolved: LegendClass | null = findLegendClass(classId, legend);
  const label = resolved?.name ?? `Class ${classId}`;
  const groupName = resolved ? getGroupName(legend, resolved.groupId) : null;
  const [r, g, b] = parseColor(resolved?.color ?? legend.defaultColor ?? '#808080');
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 text-xs text-muted-foreground">Class</span>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10"
          style={{
            backgroundColor: `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`,
          }}
        />
        <span className="min-w-0 truncate text-right text-xs" title={label}>
          {label}
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
          {classId}
        </span>
        {groupName && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
            {groupName}
          </span>
        )}
      </div>
    </div>
  );
}

export function PointInfoPanel({ engine }: Props) {
  const mode        = useViewerModeStore((s) => s.mode);
  const expanded    = useViewerModeStore((s) => s.isCommandPanelExpanded());
  const setExpanded = useViewerModeStore((s) => s.setCommandPanelExpanded);

  const pickedPoint  = usePointInfoStore((s) => s.pickedPoint);
  const previewPoint = usePointInfoStore((s) => s.previewPoint);
  const clear        = usePointInfoStore((s) => s.clear);
  const legend       = useClassificationLegendStore((s) => s.legend);

  const isPicking = mode === 'point-info';

  if (!isPicking && !pickedPoint) return null;

  // Show preview info while hovering, fall back to picked info
  const displayPoint = (isPicking && previewPoint) ? previewPoint : pickedPoint;

  function handleIsolateScan() {
    if (!pickedPoint?.scanId == null) return;
    const scanId = pickedPoint!.scanId!;
    const store = useScanFilterStore.getState();
    store.setSelectedScanIds([scanId]);
    store.setWindowBefore(0);
    store.setWindowAfter(0);
    engine?.getPlugin<ScanFilterPlugin>('scan-filter')?.enableFilter();
  }

  function handleClose() {
    clear();
    if (isPicking) useViewerModeStore.getState().exitMode();
  }

  return (
    <CommandPopup
      title="Point Info"
      expanded={expanded}
      onToggleExpand={() => setExpanded(!expanded)}
      className="absolute bottom-16 right-3 z-10 w-72"
      onClose={handleClose}
    >
      <div className="space-y-3">

        {isPicking && !previewPoint && !pickedPoint && (
          <p className="text-xs text-muted-foreground">
            Hover over the point cloud to inspect points. Click to pin a point.
          </p>
        )}

        {isPicking && previewPoint && (
          <p className="text-xs text-amber-400/80">
            Click to pin this point.
          </p>
        )}

        {displayPoint && (
          <div className="space-y-1.5">
            <InfoRow label="X" value={displayPoint.worldPos.x.toFixed(3)} mono />
            <InfoRow label="Y" value={displayPoint.worldPos.y.toFixed(3)} mono />
            <InfoRow label="Z" value={displayPoint.worldPos.z.toFixed(3)} mono />

            {displayPoint.scanId !== null && (
              <InfoRow label="Scan ID" value={String(displayPoint.scanId)} mono />
            )}

            {displayPoint.classification !== null && (
              <ClassRow classId={displayPoint.classification} legend={legend} />
            )}

            {displayPoint.intensity !== null && (
              <InfoRow
                label="Intensity"
                value={`${displayPoint.intensity} (${((displayPoint.intensity / 65535) * 100).toFixed(1)}%)`}
                mono
              />
            )}

            {displayPoint.gpsTime !== null && (
              <InfoRow label="GPS Time" value={displayPoint.gpsTime.toFixed(3)} mono />
            )}
          </div>
        )}

        {/* Isolate Scan Sweep — only when a point is pinned with a scan ID */}
        {pickedPoint?.scanId != null && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full gap-1.5 text-xs"
            onClick={handleIsolateScan}
          >
            <Filter className="h-3.5 w-3.5" />
            Isolate Scan {pickedPoint.scanId}
          </Button>
        )}

      </div>
    </CommandPopup>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={`text-xs text-right break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
