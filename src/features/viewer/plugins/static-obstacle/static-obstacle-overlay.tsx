import { useState } from 'react';
import { Button } from '@clap/design-system';
import { geoAnnotHistory } from '../../services/geometry-annotations-history';
import {
  Check,
  GitCommitHorizontal,
  Move,
  MousePointer2,
  RotateCw,
  Scale3D,
  Spline,
  Square,
  X,
  ChevronRight,
} from 'lucide-react';
import { useStaticObstacleStore } from './static-obstacle-store';
import type { ObstacleEditSubMode } from './static-obstacle-store';
import { useViewerModeStore } from '@/app/stores';
import type {
  TrafficLightSubtype,
  SignSubtype,
  ObstacleClass,
} from './static-obstacle-types';
import { StaticObstaclePlugin } from './static-obstacle-plugin';
import type { ViewerEngine } from '../../services/viewer-engine';

// ── Classification options ─────────────────────────────────────────────────

const TL_SUBTYPES: Array<{ value: TrafficLightSubtype; label: string }> = [
  { value: 'ThreeBulb', label: '3-Bulb' },
  { value: 'FourBulb', label: '4-Bulb' },
  { value: 'DogHouse', label: 'Dog House' },
  { value: 'RailRoad', label: 'Rail Road' },
  { value: 'Crosswalk', label: 'Crosswalk' },
  { value: 'Triangle', label: 'Triangle' },
];

const SIGN_SUBTYPES: Array<{ value: SignSubtype; label: string }> = [
  { value: 'Stop', label: 'Stop' },
  { value: 'Yield', label: 'Yield' },
  { value: 'NoLeft', label: 'No Left' },
  { value: 'NoRight', label: 'No Right' },
  { value: 'OneWayRight', label: 'One Way →' },
  { value: 'OneWayLeft', label: '← One Way' },
  { value: 'DoNotEnter', label: 'Do Not Enter' },
  { value: 'NoTurn', label: 'No Turn' },
  { value: 'SpeedLimit', label: 'Speed Limit' },
];

// ── Edit sub-mode toolbar ──────────────────────────────────────────────────

const EDIT_MODES: Array<{
  id: ObstacleEditSubMode;
  label: string;
  Icon: typeof Move;
}> = [
  { id: 'shape',     label: 'Select',    Icon: MousePointer2 },
  { id: 'vertex',    label: 'Vertex',    Icon: GitCommitHorizontal },
  { id: 'edge',      label: 'Edge',      Icon: Spline },
  { id: 'face',      label: 'Face',      Icon: Square },
  { id: 'translate', label: 'Move',      Icon: Move },
  { id: 'rotate',    label: 'Rotate',    Icon: RotateCw },
  { id: 'scale',     label: 'Scale',     Icon: Scale3D },
];

// ── Phase hint ─────────────────────────────────────────────────────────────

function PhaseHint({ message }: { message: string }) {
  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2">
      <div className="rounded-lg bg-black/70 px-4 py-2 text-xs text-white backdrop-blur-sm">
        {message}
      </div>
    </div>
  );
}

// ── Attribute editor ───────────────────────────────────────────────────────

function AttributeEditor({
  attrs,
  onChange,
}: {
  attrs: Record<string, string | number | boolean>;
  onChange: (attrs: Record<string, string | number | boolean>) => void;
}) {
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');

  const handleAdd = () => {
    const k = newKey.trim();
    if (!k) return;
    onChange({ ...attrs, [k]: newVal });
    setNewKey('');
    setNewVal('');
  };

  return (
    <div className="space-y-1">
      {Object.entries(attrs).map(([k, v]) => (
        <div key={k} className="flex items-center gap-1.5">
          <span className="w-24 truncate text-[11px] text-muted-foreground">{k}</span>
          <input
            type="text"
            value={String(v)}
            onChange={(e) => onChange({ ...attrs, [k]: e.target.value })}
            className="h-6 flex-1 rounded border border-border bg-background px-1.5 text-xs"
          />
          <button
            onClick={() => {
              const next = { ...attrs };
              delete next[k];
              onChange(next);
            }}
            className="text-muted-foreground hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          placeholder="key"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          className="h-6 w-24 rounded border border-border bg-background px-1.5 text-[11px]"
        />
        <input
          type="text"
          placeholder="value"
          value={newVal}
          onChange={(e) => setNewVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          className="h-6 flex-1 rounded border border-border bg-background px-1.5 text-[11px]"
        />
        <button
          onClick={handleAdd}
          className="rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-muted"
        >
          +
        </button>
      </div>
    </div>
  );
}

// ── Classification form ────────────────────────────────────────────────────

function ClassificationForm() {
  const classifyDraft = useStaticObstacleStore((s) => s.classifyDraft);
  const attributeDraft = useStaticObstacleStore((s) => s.attributeDraft);
  const setClassifyDraft = useStaticObstacleStore((s) => s.setClassifyDraft);
  const setAttributeDraft = useStaticObstacleStore((s) => s.setAttributeDraft);
  const commitAnnotation = useStaticObstacleStore((s) => s.commitAnnotation);
  const discardPending = useStaticObstacleStore((s) => s.discardPending);

  const kind = classifyDraft?.kind ?? null;

  const setKind = (k: 'TrafficLight' | 'Sign') => {
    if (k === 'TrafficLight') {
      setClassifyDraft({ kind: 'TrafficLight', subtype: 'ThreeBulb' });
    } else {
      setClassifyDraft({ kind: 'Sign', subtype: 'Stop' });
    }
  };

  const canCommit = !!classifyDraft;

  return (
    <div className="absolute right-4 top-1/2 -translate-y-1/2 w-72 rounded-xl border border-border bg-card shadow-2xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-semibold">Classify Object</span>
        <button onClick={discardPending} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setKind('TrafficLight')}
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              kind === 'TrafficLight'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border hover:bg-muted'
            }`}
          >
            Traffic Light
          </button>
          <button
            onClick={() => setKind('Sign')}
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              kind === 'Sign'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border hover:bg-muted'
            }`}
          >
            Sign
          </button>
        </div>

        {kind === 'TrafficLight' && (
          <div className="grid grid-cols-3 gap-1.5">
            {TL_SUBTYPES.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setClassifyDraft({ kind: 'TrafficLight', subtype: value })}
                className={`rounded-md border px-1.5 py-1.5 text-[11px] transition-colors ${
                  classifyDraft?.kind === 'TrafficLight' && classifyDraft.subtype === value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {kind === 'Sign' && (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-1.5">
              {SIGN_SUBTYPES.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() =>
                    setClassifyDraft({
                      kind: 'Sign',
                      subtype: value,
                      ...(value === 'SpeedLimit' && {
                        speed: (classifyDraft as { speed?: number })?.speed ?? 0,
                        unit: (classifyDraft as { unit?: 'mph' | 'kph' })?.unit ?? 'kph',
                      }),
                    })
                  }
                  className={`rounded-md border px-1.5 py-1.5 text-[11px] transition-colors ${
                    classifyDraft?.kind === 'Sign' && classifyDraft.subtype === value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {classifyDraft?.kind === 'Sign' && classifyDraft.subtype === 'SpeedLimit' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Speed</span>
                <input
                  type="number"
                  min={0}
                  max={200}
                  value={classifyDraft.speed ?? 0}
                  onChange={(e) =>
                    setClassifyDraft({ ...classifyDraft, speed: Number(e.target.value) })
                  }
                  className="h-7 w-16 rounded border border-border bg-background px-2 text-xs"
                />
                <div className="flex rounded border border-border text-xs overflow-hidden">
                  {(['kph', 'mph'] as const).map((u) => (
                    <button
                      key={u}
                      onClick={() => setClassifyDraft({ ...classifyDraft, unit: u })}
                      className={`px-2 py-1 transition-colors ${
                        classifyDraft.unit === u
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted'
                      }`}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {kind && (
          <div>
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Attributes
            </p>
            <AttributeEditor attrs={attributeDraft} onChange={setAttributeDraft} />
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs"
            onClick={discardPending}
          >
            Discard
          </Button>
          <Button
            size="sm"
            className="flex-1 gap-1 text-xs"
            onClick={() => { geoAnnotHistory.record(); commitAnnotation(); }}
            disabled={!canCommit}
          >
            Save <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Editing toolbar ────────────────────────────────────────────────────────

interface EditingToolbarProps {
  plugin: StaticObstaclePlugin | undefined;
}

function EditingToolbar({ plugin }: EditingToolbarProps) {
  const editSubMode = useStaticObstacleStore((s) => s.editSubMode);

  return (
    <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card/95 px-1 py-0.5 shadow-md backdrop-blur-sm">
        {EDIT_MODES.map(({ id, label, Icon }) => (
          <Button
            key={id}
            variant={editSubMode === id ? 'default' : 'ghost'}
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => plugin?.setEditSubMode(id)}
            title={label}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </Button>
        ))}

        <div className="mx-1 h-4 w-px bg-border" />

        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-green-500 hover:text-green-400"
          onClick={() => plugin?.confirmShape()}
        >
          <Check className="h-3.5 w-3.5" />
          Confirm
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-muted-foreground"
          onClick={() => plugin?.discardPendingShape()}
        >
          <X className="h-3.5 w-3.5" />
          Discard
          <kbd className="ml-0.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
            Esc
          </kbd>
        </Button>
      </div>
    </div>
  );
}

// ── Main overlay ───────────────────────────────────────────────────────────

interface StaticObstacleOverlayProps {
  engine: ViewerEngine | null;
}

export function StaticObstacleOverlay({ engine }: StaticObstacleOverlayProps) {
  const mode = useViewerModeStore((s) => s.mode);
  const phase = useStaticObstacleStore((s) => s.phase);
  const layers = useStaticObstacleStore((s) => s.layers);

  const plugin = engine?.getPlugin<StaticObstaclePlugin>('static-obstacle');

  if (mode !== 'static-obstacle') return null;

  return (
    <>
      {phase === 'idle' && layers.length === 0 && (
        <PhaseHint message="Create a layer in the sidebar to begin annotating" />
      )}
      {phase === 'drawing' && (
        <PhaseHint message="Click and drag to draw box footprint · drag up to set height · Esc to cancel" />
      )}
      {phase === 'editing' && (
        <>
          <div className="pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2">
            <div className="rounded-lg bg-black/70 px-4 py-2 text-xs text-white backdrop-blur-sm">
              Use handles or gizmo to adjust the box · Confirm when done
            </div>
          </div>
          <EditingToolbar plugin={plugin} />
        </>
      )}
      {phase === 'picking-face' && (
        <PhaseHint message="Click a face to set the front direction · Esc to cancel" />
      )}
      {phase === 'classifying' && <ClassificationForm />}
    </>
  );
}
