import {
  MousePointer2,
  GitCommitHorizontal,
  Spline,
  Square,
  Move,
  RotateCw,
  Scale3D,
} from 'lucide-react';
import { Button } from '@clap/design-system';
import type { ViewerEngine } from '../../services/viewer-engine';
import { usePlanProfileStore, type PlanProfileEditSubMode } from './plan-profile-store';
import { PlanProfilePlugin } from './plan-profile-plugin';

const EDIT_MODES: Array<{ id: PlanProfileEditSubMode; label: string; Icon: React.ElementType }> = [
  { id: 'shape',     label: 'Select',    Icon: MousePointer2      },
  { id: 'vertex',    label: 'Vertex',    Icon: GitCommitHorizontal },
  { id: 'edge',      label: 'Edge',      Icon: Spline             },
  { id: 'face',      label: 'Face',      Icon: Square             },
  { id: 'translate', label: 'Move',      Icon: Move               },
  { id: 'rotate',    label: 'Rotate',    Icon: RotateCw           },
  { id: 'scale',     label: 'Scale',     Icon: Scale3D            },
];

interface Props {
  engine: ViewerEngine | null;
}

export function PlanProfileEditToolbar({ engine }: Props) {
  const phase       = usePlanProfileStore((s) => s.phase);
  const editSubMode = usePlanProfileStore((s) => s.editSubMode);
  const stopEdit    = usePlanProfileStore((s) => s.stopEdit);

  if (phase !== 'editing') return null;

  const plugin = engine?.getPlugin<PlanProfilePlugin>('plan-profile');

  return (
    <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
      <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card/95 px-1 py-0.5 shadow-md backdrop-blur-sm">
        {EDIT_MODES.map(({ id, label, Icon }) => (
          <Button
            key={id}
            variant={editSubMode === id ? 'default' : 'ghost'}
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
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
          className="h-7 px-2 text-xs"
          onClick={stopEdit}
        >
          Done
        </Button>
      </div>
    </div>
  );
}
