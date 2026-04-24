/**
 * HdMapElementBrowser — the Blender-style element tree rendered inside the
 * Scene Layers panel.
 *
 * Exports:
 *   HdMapLayersSection  — full HD map group with collapsible sub-sections
 */

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Eye, EyeOff, ChevronRight, Copy, Check } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@clap/design-system';
import { useHdMapStore } from './hd-map-store';
import { getHdMapPlugin } from './hd-map-plugin';
import { hdMapHistory } from './hd-map-history';
import type { HdMapElement, HdMapElementKind,
  HdMapEdgeElement, HdMapMarkerLineElement,
  HdMapObjectElement, HdMapSignElement } from './hd-map-edit-model';

// ── Kind badge ────────────────────────────────────────────────────────────────

const KIND_COLOR: Record<HdMapElementKind, string> = {
  'edge-left':   '#F97316',
  'edge-right':  '#A8916A',
  'marker-line': '#9CA3AF',
  'road-object': '#EF4444',
  'sign':        '#22C55E',
};
const KIND_ABBR: Record<HdMapElementKind, string> = {
  'edge-left':   'L',
  'edge-right':  'R',
  'marker-line': 'M',
  'road-object': 'O',
  'sign':        'S',
};

// ── Info modal ────────────────────────────────────────────────────────────────

function buildInfoText(elem: HdMapElement): string {
  const lines: string[] = [
    `Kind:       ${elem.kind}`,
    `Label:      ${elem.label}`,
    `App ID:     ${elem.id}`,
    `File Index: ${elem.fileIndex}`,
    `Segment ID: ${elem.segmentId}`,
  ];

  switch (elem.kind) {
    case 'edge-left':
    case 'edge-right': {
      const e = elem as HdMapEdgeElement;
      lines.push(`Edge Type:  ${e.edgeType}`);
      lines.push(`XSection IDs: ${e.xSectionIds.join(', ')}`);
      lines.push(`Vertices:   ${e.geoPoints.length}`);
      e.geoPoints.forEach((p, i) =>
        lines.push(`  [${i}] lat=${p.lat.toFixed(9)}  lon=${p.lon.toFixed(9)}  elev=${p.elevation.toFixed(4)}`));
      break;
    }
    case 'marker-line': {
      const m = elem as HdMapMarkerLineElement;
      lines.push(`Point ID:   ${m.pointId}`);
      lines.push(`Marker Type:  ${m.markerType}`);
      lines.push(`Marker Color: ${m.markerColor}`);
      lines.push(`XSection IDs: ${m.xSectionIds.join(', ')}`);
      lines.push(`Vertices:   ${m.geoPoints.length}`);
      m.geoPoints.forEach((p, i) =>
        lines.push(`  [${i}] lat=${p.lat.toFixed(9)}  lon=${p.lon.toFixed(9)}  elev=${p.elevation.toFixed(4)}`));
      break;
    }
    case 'road-object': {
      const o = elem as HdMapObjectElement;
      lines.push(`Road ID:    ${o.roadId}`);
      lines.push(`Object ID:  ${o.objectId}`);
      lines.push(`Type:       ${o.type}`);
      lines.push(`Closed:     ${o.edgeClosed}`);
      lines.push(`Center:     lat=${o.center.lat.toFixed(9)}  lon=${o.center.lon.toFixed(9)}  elev=${o.center.elevation.toFixed(4)}`);
      lines.push(`Vertices:   ${o.edgePoints.length}`);
      o.edgePoints.forEach((p, i) =>
        lines.push(`  [${i}] lat=${p.lat.toFixed(9)}  lon=${p.lon.toFixed(9)}  elev=${p.elevation.toFixed(4)}`));
      break;
    }
    case 'sign': {
      const s = elem as HdMapSignElement;
      lines.push(`Road ID:    ${s.roadId}`);
      lines.push(`Sign ID:    ${s.signId}`);
      lines.push(`Type:       ${s.type}`);
      lines.push(`Azimuth:    ${s.azimuth.toFixed(6)}°`);
      lines.push(`Position:   lat=${s.point.lat.toFixed(9)}  lon=${s.point.lon.toFixed(9)}  elev=${s.point.elevation.toFixed(4)}`);
      break;
    }
  }

  return lines.join('\n');
}

interface InfoRow { label: string; value: string; mono?: boolean }

function InfoTable({ rows }: { rows: InfoRow[] }) {
  return (
    <table className="w-full text-[11px] border-collapse">
      <tbody>
        {rows.map(r => (
          <tr key={r.label} className="border-b border-border/40 last:border-0">
            <td className="py-1 pr-3 text-muted-foreground whitespace-nowrap align-top w-[38%]">{r.label}</td>
            <td className={`py-1 break-all align-top ${r.mono ? 'font-mono text-[10px]' : ''}`}>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ElementInfoModal({ elem, open, onClose }: { elem: HdMapElement; open: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(buildInfoText(elem)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [elem]);

  const commonRows: InfoRow[] = [
    { label: 'Kind',       value: elem.kind },
    { label: 'Label',      value: elem.label },
    { label: 'App ID',     value: elem.id,        mono: true },
    { label: 'File Index', value: String(elem.fileIndex) },
    { label: 'Segment ID', value: String(elem.segmentId) },
  ];

  let kindRows: InfoRow[] = [];
  let geoSection: { header: string; rows: string[] } | null = null;

  switch (elem.kind) {
    case 'edge-left':
    case 'edge-right': {
      const e = elem as HdMapEdgeElement;
      kindRows = [
        { label: 'Edge Type',    value: e.edgeType },
        { label: 'XSection IDs', value: e.xSectionIds.join(', '), mono: true },
      ];
      geoSection = {
        header: `Vertices (${e.geoPoints.length})`,
        rows: e.geoPoints.map((p, i) =>
          `[${i}]  ${p.lat.toFixed(9)}  ${p.lon.toFixed(9)}  ${p.elevation.toFixed(4)} m`),
      };
      break;
    }
    case 'marker-line': {
      const m = elem as HdMapMarkerLineElement;
      kindRows = [
        { label: 'Point ID',     value: String(m.pointId) },
        { label: 'Marker Type',  value: m.markerType },
        { label: 'Marker Color', value: m.markerColor },
        { label: 'XSection IDs', value: m.xSectionIds.join(', '), mono: true },
      ];
      geoSection = {
        header: `Vertices (${m.geoPoints.length})`,
        rows: m.geoPoints.map((p, i) =>
          `[${i}]  ${p.lat.toFixed(9)}  ${p.lon.toFixed(9)}  ${p.elevation.toFixed(4)} m`),
      };
      break;
    }
    case 'road-object': {
      const o = elem as HdMapObjectElement;
      kindRows = [
        { label: 'Road ID',   value: String(o.roadId) },
        { label: 'Object ID', value: String(o.objectId) },
        { label: 'Type',      value: o.type },
        { label: 'Closed',    value: String(o.edgeClosed) },
        { label: 'Center',    value: `${o.center.lat.toFixed(9)}, ${o.center.lon.toFixed(9)}, ${o.center.elevation.toFixed(4)} m`, mono: true },
      ];
      geoSection = {
        header: `Edge Points (${o.edgePoints.length})`,
        rows: o.edgePoints.map((p, i) =>
          `[${i}]  ${p.lat.toFixed(9)}  ${p.lon.toFixed(9)}  ${p.elevation.toFixed(4)} m`),
      };
      break;
    }
    case 'sign': {
      const s = elem as HdMapSignElement;
      kindRows = [
        { label: 'Road ID', value: String(s.roadId) },
        { label: 'Sign ID', value: String(s.signId) },
        { label: 'Type',    value: s.type },
        { label: 'Azimuth', value: `${s.azimuth.toFixed(6)}°` },
        { label: 'Position', value: `${s.point.lat.toFixed(9)}, ${s.point.lon.toFixed(9)}, ${s.point.elevation.toFixed(4)} m`, mono: true },
      ];
      break;
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <span
              className="inline-flex w-5 h-5 rounded-sm text-[10px] font-bold items-center justify-center flex-shrink-0"
              style={{ background: KIND_COLOR[elem.kind] + '30', color: KIND_COLOR[elem.kind] }}
            >
              {KIND_ABBR[elem.kind]}
            </span>
            {elem.label}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-1">
          <InfoTable rows={[...commonRows, ...kindRows]} />

          {geoSection && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                {geoSection.header}
              </p>
              <div className="rounded bg-muted/40 px-2 py-1.5 max-h-40 overflow-y-auto">
                {geoSection.rows.map((r, i) => (
                  <p key={i} className="font-mono text-[10px] leading-5 text-muted-foreground">{r}</p>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleCopy}
            className="w-full flex items-center justify-center gap-1.5 rounded border border-border py-1.5 text-[11px] text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
          >
            {copied
              ? <><Check className="w-3.5 h-3.5 text-green-500" /> Copied</>
              : <><Copy className="w-3.5 h-3.5" /> Copy to clipboard</>}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Element row ───────────────────────────────────────────────────────────────

function ElementRow({ elem }: { elem: HdMapElement }) {
  const selectedId  = useHdMapStore(s => s.selectedId);
  const editorMode  = useHdMapStore(s => s.editorMode);
  const { selectElement, setEditorMode, deleteElement,
          toggleElementHidden, updateEdgePoints, updateObjectPoints } = useHdMapStore();

  const isSelected = elem.id === selectedId;
  const isEditing  = isSelected && editorMode !== 'none';
  const plugin     = getHdMapPlugin();
  const [infoOpen, setInfoOpen] = useState(false);

  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isSelected) rowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [isSelected]);

  const handleCommit = (ev: React.MouseEvent) => {
    ev.stopPropagation();
    const pts = plugin?.commitVertexEdit();
    if (pts) {
      hdMapHistory.record();
      elem.kind === 'road-object'
        ? updateObjectPoints(elem.id, pts)
        : updateEdgePoints(elem.id, pts);
    }
    setEditorMode('none');
  };

  const handleCancel = (ev: React.MouseEvent) => {
    ev.stopPropagation();
    setEditorMode('none');
  };

  return (
    <>
    <div
      ref={rowRef}
      onClick={() => selectElement(isSelected ? null : elem.id)}
      className={`flex items-center gap-1 px-2 py-[3px] rounded cursor-pointer text-[11px] transition-colors ${
        isSelected
          ? 'bg-primary/15 text-foreground'
          : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
      }`}
    >
      {/* Kind dot */}
      <span
        className="flex-shrink-0 w-3.5 h-3.5 rounded-sm text-[9px] font-bold flex items-center justify-center"
        style={{ background: KIND_COLOR[elem.kind] + '30', color: KIND_COLOR[elem.kind] }}
      >
        {KIND_ABBR[elem.kind]}
      </span>

      {/* Label */}
      <span className={`flex-1 truncate ${elem.hidden ? 'opacity-40' : ''}`}>{elem.label}</span>

      {/* Info button — always visible */}
      <span className="flex-shrink-0" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => setInfoOpen(true)}
          title="Element info"
          className="p-0.5 rounded text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/80"
        >
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="currentColor">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 2.5a.875.875 0 1 1 0 1.75A.875.875 0 0 1 8 3.5zm1.5 8h-3a.5.5 0 0 1 0-1H7V8h-.5a.5.5 0 0 1 0-1H8a.5.5 0 0 1 .5.5v3h1a.5.5 0 0 1 0 1z"/>
          </svg>
        </button>
      </span>

      {/* Hidden indicator — always visible when element is hidden and row is not selected */}
      {elem.hidden && !isSelected && (
        <span className="flex-shrink-0 text-muted-foreground/40" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => { hdMapHistory.record(); toggleElementHidden(elem.id); }}
            title="Show"
            className="p-0.5 rounded hover:bg-muted/80"
          >
            <EyeOff className="w-3 h-3" />
          </button>
        </span>
      )}

      {/* Controls — visible only when row is selected */}
      {isSelected && !isEditing && (
        <span className="flex items-center gap-0.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => { hdMapHistory.record(); toggleElementHidden(elem.id); }}
            title={elem.hidden ? 'Show' : 'Hide'}
            className="p-0.5 rounded hover:bg-muted/80"
          >
            {elem.hidden
              ? <EyeOff className="w-3 h-3" />
              : <Eye className="w-3 h-3" />}
          </button>

          {elem.kind !== 'sign' && (
            <button
              onClick={() => setEditorMode('vertex')}
              title="Edit vertices"
              className="p-0.5 rounded hover:bg-primary/20 text-primary"
            >
              {/* pencil icon */}
              <svg viewBox="0 0 16 16" className="w-3 h-3" fill="currentColor">
                <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61z"/>
              </svg>
            </button>
          )}

          {elem.kind === 'sign' && (
            <button
              onClick={() => setEditorMode('sign-move')}
              title="Reposition sign"
              className="p-0.5 rounded hover:bg-primary/20 text-primary"
            >
              <svg viewBox="0 0 16 16" className="w-3 h-3" fill="currentColor">
                <path d="M8 1.5a.75.75 0 0 1 .75.75v3.5h3.5a.75.75 0 0 1 0 1.5h-3.5v3.5a.75.75 0 0 1-1.5 0v-3.5H3.75a.75.75 0 0 1 0-1.5h3.5v-3.5A.75.75 0 0 1 8 1.5z"/>
              </svg>
            </button>
          )}

          <button
            onClick={() => { hdMapHistory.record(); deleteElement(elem.id); }}
            title="Delete"
            className="p-0.5 rounded hover:bg-destructive/20 text-destructive"
          >
            {/* trash icon */}
            <svg viewBox="0 0 16 16" className="w-3 h-3" fill="currentColor">
              <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75zM4.496 6.559a.75.75 0 1 0-1.492.141l.686 7.21a1.75 1.75 0 0 0 1.742 1.59h5.135a1.75 1.75 0 0 0 1.743-1.59l.686-7.21a.75.75 0 0 0-1.492-.141l-.686 7.21a.25.25 0 0 1-.249.227H5.432a.25.25 0 0 1-.249-.227L4.496 6.56z"/>
            </svg>
          </button>
        </span>
      )}

      {/* Commit / Cancel while vertex-editing */}
      {isEditing && (
        <span className="flex items-center gap-0.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button onClick={handleCommit} className="px-1 py-px text-[10px] rounded bg-green-600/80 hover:bg-green-600 text-white">Done</button>
          <button onClick={handleCancel} className="px-1 py-px text-[10px] rounded bg-muted hover:bg-muted/80">✕</button>
        </span>
      )}
    </div>
    <ElementInfoModal elem={elem} open={infoOpen} onClose={() => setInfoOpen(false)} />
    </>
  );
}

// ── Sub-section (Lane Edges, Markers, etc.) ───────────────────────────────────

interface SubSectionProps {
  title: string;
  count: number;
  layerVisible: boolean;
  onToggleLayer: () => void;
  elements: HdMapElement[];
}

function SubSection({ title, count, layerVisible, onToggleLayer, elements }: SubSectionProps) {
  const selectedId = useHdMapStore(s => s.selectedId);
  const hasSelected = selectedId !== null && elements.some(e => e.id === selectedId && !e.deleted);
  const [manualOpen, setManualOpen] = useState(false);
  const open = manualOpen || hasSelected;
  const visible = elements.filter(e => !e.deleted);

  return (
    <div>
      <div className="flex items-center pl-5 pr-1 py-[3px]">
        <button
          onClick={() => setManualOpen(o => !o)}
          className="flex items-center gap-0.5 flex-1 text-left text-[11px] text-muted-foreground hover:text-foreground min-w-0"
        >
          <ChevronRight className={`h-3 w-3 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
          <span className="truncate">{title}</span>
          <span className="ml-1 text-muted-foreground/60 font-normal">{count}</span>
        </button>
        <button
          onClick={onToggleLayer}
          title={layerVisible ? 'Hide layer' : 'Show layer'}
          className={`p-0.5 rounded hover:bg-muted flex-shrink-0 ${layerVisible ? 'text-muted-foreground' : 'text-muted-foreground/30'}`}
        >
          {layerVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
        </button>
      </div>

      {open && (
        <div className="pl-7 max-h-44 overflow-y-auto space-y-px pr-1">
          {visible.length === 0
            ? <p className="text-[10px] text-muted-foreground py-1">None</p>
            : visible.map(e => <ElementRow key={e.id} elem={e} />)
          }
        </div>
      )}
    </div>
  );
}

// ── Top-level HD Map group ────────────────────────────────────────────────────

export function HdMapLayersSection() {
  const loadState   = useHdMapStore(s => s.loadState);
  const project     = useHdMapStore(s => s.project);
  const elements    = useHdMapStore(s => s.elements);
  const showEdges   = useHdMapStore(s => s.showEdges);
  const showMarkers = useHdMapStore(s => s.showMarkers);
  const showObjects = useHdMapStore(s => s.showObjects);
  const showSigns   = useHdMapStore(s => s.showSigns);
  const selectedId = useHdMapStore(s => s.selectedId);
  const { setShowEdges, setShowMarkers, setShowObjects, setShowSigns, selectElement } = useHdMapStore();

  const [open, setOpen] = useState(true);

  // Deselect the currently selected element if it belongs to a layer being hidden
  const deselectIfIn = (elems: typeof edges) => {
    if (selectedId && elems.some(e => e.id === selectedId)) selectElement(null);
  };

  const edges   = useMemo(() => elements.filter(e => e.kind === 'edge-left' || e.kind === 'edge-right'), [elements]);
  const markers = useMemo(() => elements.filter(e => e.kind === 'marker-line'),  [elements]);
  const objects = useMemo(() => elements.filter(e => e.kind === 'road-object'),  [elements]);
  const signs   = useMemo(() => elements.filter(e => e.kind === 'sign'),          [elements]);

  const isLoaded  = loadState === 'loaded';
  const isLoading = loadState === 'loading';

  const totalVisible = elements.filter(e => !e.deleted).length;

  // Always show the group header so the user can see HD Map status
  const allVisible = showEdges && showMarkers && showObjects && showSigns;
  const toggleAll  = () => {
    const v = !allVisible;
    if (!v) deselectIfIn(elements); // hiding all — deselect anything selected
    setShowEdges(v); setShowMarkers(v); setShowObjects(v); setShowSigns(v);
  };

  return (
    <div>
      {/* Group header row */}
      <div className="flex items-center justify-between py-1.5">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setOpen(o => !o)}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            disabled={!isLoaded}
          >
            <ChevronRight className={`h-3 w-3 transition-transform ${open && isLoaded ? 'rotate-90' : ''}`} />
          </button>
          {/* HD map icon */}
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" fill="currentColor">
            <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zM1.5 8a6.5 6.5 0 0 1 11.14-4.57L3.07 13.64A6.48 6.48 0 0 1 1.5 8zm2.07 5.22L13.5 3.5A6.5 6.5 0 0 1 3.57 13.22z"/>
          </svg>
          <span className="text-xs text-muted-foreground">
            HD Map
            {isLoaded && project && (
              <span className="ml-1 text-muted-foreground/60">{project.name}</span>
            )}
            {isLoading && <span className="ml-1 text-yellow-500 text-[10px]">loading…</span>}
          </span>
        </div>
        {isLoaded && (
          <button
            onClick={toggleAll}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {allVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {/* Sub-sections */}
      {isLoaded && open && (
        <div className="border-l border-border ml-3 mb-1">
          <SubSection
            title="Lane Edges"
            count={edges.filter(e => !e.deleted).length}
            layerVisible={showEdges}
            onToggleLayer={() => { if (showEdges) deselectIfIn(edges); setShowEdges(!showEdges); }}
            elements={edges}
          />
          <SubSection
            title="Lane Markers"
            count={markers.filter(e => !e.deleted).length}
            layerVisible={showMarkers}
            onToggleLayer={() => { if (showMarkers) deselectIfIn(markers); setShowMarkers(!showMarkers); }}
            elements={markers}
          />
          <SubSection
            title="Road Objects"
            count={objects.filter(e => !e.deleted).length}
            layerVisible={showObjects}
            onToggleLayer={() => { if (showObjects) deselectIfIn(objects); setShowObjects(!showObjects); }}
            elements={objects}
          />
          <SubSection
            title="Signs & Lights"
            count={signs.filter(e => !e.deleted).length}
            layerVisible={showSigns}
            onToggleLayer={() => { if (showSigns) deselectIfIn(signs); setShowSigns(!showSigns); }}
            elements={signs}
          />
        </div>
      )}
    </div>
  );
}
