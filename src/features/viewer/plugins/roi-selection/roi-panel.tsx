import { Button } from '@clap/design-system';
import { BoxSelect, Eye, EyeOff, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useRoiStore } from './roi-store';
import { useViewerModeStore } from '@/app/stores';
import { getRoiPlugin } from './roi-plugin-ref';

export function RoiPanel() {
  const phase = useRoiStore((s) => s.phase);
  const shapeCount = useRoiStore((s) => s.shapeCount);
  const clipEnabled = useRoiStore((s) => s.clipEnabled);
  const clipVisible = useRoiStore((s) => s.clipVisible);
  const enterRoiSelectionMode = useViewerModeStore((s) => s.enterRoiSelectionMode);

  const isApplied = phase === 'applied';

  return (
    <div className="space-y-3">
      {phase === 'idle' && (
        <p className="text-xs text-muted-foreground">No ROI defined.</p>
      )}

      {isApplied && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            {shapeCount} shape{shapeCount !== 1 ? 's' : ''} · Clip{' '}
            {clipEnabled ? 'active' : 'inactive'}
          </p>

          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 text-xs"
            onClick={() =>
              clipEnabled ? getRoiPlugin()?.disableClip() : getRoiPlugin()?.enableClip()
            }
          >
            {clipEnabled ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            {clipEnabled ? 'Disable Clip' : 'Enable Clip'}
          </Button>

          {clipEnabled && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2 text-xs"
              onClick={() => getRoiPlugin()?.toggleClipVisible()}
            >
              {clipVisible ? (
                <Eye className="h-3.5 w-3.5" />
              ) : (
                <EyeOff className="h-3.5 w-3.5" />
              )}
              {clipVisible ? 'Hide Shapes' : 'Show Shapes'}
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 text-xs"
            onClick={() => getRoiPlugin()?.editRoi()}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit ROI
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 text-xs"
            onClick={() => getRoiPlugin()?.redefine()}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Redefine ROI
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 text-xs text-destructive hover:text-destructive"
            onClick={() => getRoiPlugin()?.clearRoi()}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear ROI
          </Button>
        </div>
      )}

      {phase === 'idle' && (
        <Button
          variant="default"
          size="sm"
          className="w-full gap-2 text-xs"
          onClick={enterRoiSelectionMode}
        >
          <BoxSelect className="h-3.5 w-3.5" />
          Define ROI
        </Button>
      )}
    </div>
  );
}
