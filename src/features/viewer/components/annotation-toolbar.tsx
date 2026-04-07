import { useState } from 'react';
import { Loader2, Magnet, Pentagon, Save, Tag } from 'lucide-react';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@clap/design-system';
import { useViewerModeStore } from '@/app/stores';
import { usePolyAnnotStore } from '../plugins/polygon-annotation';
import { useStaticObstacleStore } from '../plugins/static-obstacle';
import { saveGeometryAnnotations } from '../services/geometry-annotations-io';
import type { ViewerEngine } from '../services/viewer-engine';

interface AnnotationToolbarProps {
  engine: ViewerEngine | null;
}

export function AnnotationToolbar({ engine }: AnnotationToolbarProps) {
  const [saving, setSaving] = useState(false);

  const { mode, enterPolygonAnnotationMode, enterStaticObstacleMode, exitMode } =
    useViewerModeStore();

  const polyAnnotPhase = usePolyAnnotStore((s) => s.phase);
  const snapEnabled    = usePolyAnnotStore((s) => s.snapEnabled);
  const setSnapEnabled = usePolyAnnotStore((s) => s.setSnapEnabled);

  const isPolyAnnot     = mode === 'polygon-annotation';
  const isStaticObstacle = mode === 'static-obstacle';
  const isPolyEditing   = isPolyAnnot && polyAnnotPhase === 'editing';

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
              <Tag className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Static Obstacle Annotations</TooltipContent>
        </Tooltip>

        <div className="my-0.5 h-px w-full bg-border" />

        {/* Vertex snap — always visible, active style when editing */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={snapEnabled && isPolyEditing ? 'default' : 'ghost'}
              size="icon"
              className="h-7 w-7"
              disabled={!isPolyEditing}
              onClick={() => setSnapEnabled(!snapEnabled)}
            >
              <Magnet className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {isPolyEditing
              ? snapEnabled ? 'Vertex Snap (on)' : 'Vertex Snap (off)'
              : 'Vertex Snap (edit mode only)'}
          </TooltipContent>
        </Tooltip>

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
