import { MapPin } from 'lucide-react';
import { Button } from '@clap/design-system';
import { useViewerModeStore } from '@/app/stores';
import { useWorldFrameStore } from './world-frame-store';

export function WorldFramePanel() {
  const phase = useWorldFrameStore((s) => s.phase);
  const anchor1 = useWorldFrameStore((s) => s.anchor1);
  const enterWorldFrameMode = useViewerModeStore((s) => s.enterWorldFrameMode);

  const isConfirmed = phase === 'confirmed' && anchor1 !== null;
  const isActive = phase !== 'idle' && phase !== 'confirmed';

  return (
    <div className="space-y-3">
      {isConfirmed ? (
        <>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 text-green-500" />
            <span>World frame set</span>
          </div>
          <div className="space-y-1 text-xs text-muted-foreground">
            <div>
              Anchor: {anchor1.geo.lat.toFixed(6)}, {anchor1.geo.lng.toFixed(6)}
            </div>
          </div>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs"
              onClick={() => {
                // Redefine is handled by overlay — just enter the mode
                enterWorldFrameMode();
              }}
            >
              Redefine
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs"
              onClick={() => useWorldFrameStore.getState().resetWorldFrame()}
            >
              Clear
            </Button>
          </div>
        </>
      ) : isActive ? (
        <div className="text-xs text-muted-foreground">
          Setting world frame...
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-full gap-1.5 text-xs"
          onClick={enterWorldFrameMode}
        >
          <MapPin className="h-3.5 w-3.5" />
          Set World Frame
        </Button>
      )}
    </div>
  );
}
