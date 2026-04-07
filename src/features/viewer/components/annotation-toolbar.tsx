import { Box, ChevronRight, Loader2, Magnet, Pentagon, Save } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@clap/design-system';
import { useState } from 'react';
import { useViewerModeStore } from '@/app/stores';
import { saveGeometryAnnotations } from '../services/geometry-annotations-io';
import { useSnapStore } from '../modules/snap/snap-store';
import { SNAP_MODE_LABELS } from '../modules/snap/snap-types';
import type { SnapMode } from '../modules/snap/snap-types';
import type { ViewerEngine } from '../services/viewer-engine';

interface AnnotationToolbarProps {
  engine: ViewerEngine | null;
}

const SNAP_MODES: SnapMode[] = ['vertex', 'edge', 'face', 'pointcloud', 'dem'];

export function AnnotationToolbar({ engine }: AnnotationToolbarProps) {
  const [saving, setSaving] = useState(false);

  const { mode, enterPolygonAnnotationMode, enterStaticObstacleMode, exitMode } =
    useViewerModeStore();

  const snapEnabled = useSnapStore((s) => s.enabled);
  const snapModes   = useSnapStore((s) => s.modes);
  const setEnabled  = useSnapStore((s) => s.setEnabled);
  const setMode     = useSnapStore((s) => s.setMode);

  const isPolyAnnot     = mode === 'polygon-annotation';
  const isStaticObstacle = mode === 'static-obstacle';

  const handleSave = async () => {
    if (!engine) return;
    const basePath = engine.getEditor().getBasePath();
    if (!basePath) return;
    setSaving(true);
    try { await saveGeometryAnnotations(basePath); }
    catch (err) { console.error('[CLAP] Failed to save geometry annotations:', err); }
    finally { setSaving(false); }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col items-center gap-0.5 rounded-lg border border-border bg-card/90 p-1 shadow-sm backdrop-blur-sm">

        {/* Polygon annotation mode */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isPolyAnnot ? 'default' : 'ghost'}
              size="icon"
              className="h-7 w-7"
              onClick={() => isPolyAnnot ? exitMode() : enterPolygonAnnotationMode()}
            >
              <Pentagon className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Polygon Annotations</TooltipContent>
        </Tooltip>

        {/* Static obstacle / bounding box annotation mode */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isStaticObstacle ? 'default' : 'ghost'}
              size="icon"
              className="h-7 w-7"
              onClick={() => isStaticObstacle ? exitMode() : enterStaticObstacleMode()}
            >
              <Box className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Static Obstacle Annotations</TooltipContent>
        </Tooltip>

        <div className="my-0.5 h-px w-full bg-border" />

        {/* Snap button + dropdown to configure modes */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={snapEnabled ? 'default' : 'ghost'}
                  size="icon"
                  className="h-7 w-7 relative"
                >
                  <Magnet className="h-3.5 w-3.5" />
                  <ChevronRight className="absolute bottom-0.5 right-0.5 h-2 w-2 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">Snap Settings</TooltipContent>
          </Tooltip>

          <DropdownMenuContent side="right" align="start" className="w-44">
            <DropdownMenuLabel className="text-xs">Snapping</DropdownMenuLabel>
            <DropdownMenuSeparator />

            {/* Master toggle */}
            <DropdownMenuCheckboxItem
              checked={snapEnabled}
              onCheckedChange={(v) => setEnabled(v)}
              onSelect={(e) => e.preventDefault()}
              className="text-xs font-medium"
            >
              Enable Snap
            </DropdownMenuCheckboxItem>

            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Modes</DropdownMenuLabel>

            {SNAP_MODES.map((snapMode) => (
              <DropdownMenuCheckboxItem
                key={snapMode}
                checked={snapModes[snapMode]}
                disabled={!snapEnabled}
                onCheckedChange={(v) => setMode(snapMode, v)}
                onSelect={(e) => e.preventDefault()}
                className="text-xs"
              >
                {SNAP_MODE_LABELS[snapMode]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="my-0.5 h-px w-full bg-border" />

        {/* Save geometry annotations */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={saving || !engine?.getEditor()?.getBasePath()}
              onClick={handleSave}
            >
              {saving
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Save className="h-3.5 w-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Save Annotation File</TooltipContent>
        </Tooltip>

      </div>
    </TooltipProvider>
  );
}
