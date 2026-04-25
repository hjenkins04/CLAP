import {
  LayoutGrid,
  BoxSelect,
  Eye,
  EyeOff,
  Power,
  PowerOff,
  PenLine,
  Trash2,
  MapPin,
  Boxes,
} from 'lucide-react';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@clap/design-system';
import { useViewerModeStore } from '@/app/stores';
import { useVirtualTilesStore } from '../plugins/virtual-tiles';
import { useDatasetTilesStore } from '../plugins/dataset-tiles';
import { useRoiStore } from '../plugins/roi-selection';
import { RoiSelectionPlugin } from '../plugins/roi-selection';
import { useWorldFrameStore } from '../plugins/world-frame';
import type { WorldFramePlugin } from '../plugins/world-frame/world-frame-plugin';
import type { ViewerEngine } from '../services/viewer-engine';

interface ViewportToolbarProps {
  engine: ViewerEngine | null;
}

export function ViewportToolbar({ engine }: ViewportToolbarProps) {
  const { mode, enterVirtualTilesMode, enterRoiSelectionMode, enterWorldFrameMode, exitMode } =
    useViewerModeStore();

  const tilesPhase = useVirtualTilesStore((s) => s.phase);
  const isTiles = mode === 'virtual-tiles';
  const isTilesApplied = tilesPhase === 'applied';
  const isRoi = mode === 'roi-selection';

  // Dataset tile picker (only meaningful when a tiled manifest is loaded)
  const datasetManifest = useDatasetTilesStore((s) => s.manifest);
  const datasetPanelOpen = useDatasetTilesStore((s) => s.panelOpen);
  const toggleDatasetPanel = useDatasetTilesStore((s) => s.togglePanel);
  const loadedTileCount = useDatasetTilesStore((s) => s.loadedTileIds.size);
  const hasTiledDataset = !!datasetManifest?.tiles.length;

  // ROI applied state
  const roiClipEnabled = useRoiStore((s) => s.clipEnabled);
  const roiClipVisible = useRoiStore((s) => s.clipVisible);
  const roiShapeCount = useRoiStore((s) => s.shapeCount);
  const roiPhase = useRoiStore((s) => s.phase);
  const hasAppliedRoi = roiShapeCount > 0 && (roiPhase === 'applied' || roiClipEnabled);

  const roiPlugin = engine?.getPlugin<RoiSelectionPlugin>('roi-selection');
  const worldFramePlugin = engine?.getPlugin<WorldFramePlugin>('world-frame');

  // World Frame state
  const isWorldFrame = mode === 'world-frame';
  const worldFramePhase = useWorldFrameStore((s) => s.phase);
  const hasWorldFrame = worldFramePhase === 'confirmed';

  const handleWorldFrameClick = () => {
    if (isWorldFrame) {
      exitMode();
    } else {
      enterWorldFrameMode();
    }
  };

  const handleTilesClick = () => {
    if (isTiles) {
      exitMode();
    } else {
      enterVirtualTilesMode();
    }
  };

  const handleRoiClick = () => {
    if (isRoi) {
      exitMode();
    } else {
      enterRoiSelectionMode();
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col items-center gap-0.5 rounded-lg border border-border bg-card/90 p-1 shadow-sm backdrop-blur-sm">
          {hasTiledDataset && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={datasetPanelOpen || loadedTileCount > 0 ? 'default' : 'ghost'}
                  size="icon"
                  className="h-7 w-7"
                  onClick={toggleDatasetPanel}
                >
                  <Boxes className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                Dataset Tiles ({loadedTileCount}/{datasetManifest?.tiles.length ?? 0})
              </TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isTiles || isTilesApplied ? 'default' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={handleTilesClick}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Virtual Tiles</TooltipContent>
          </Tooltip>

          {hasAppliedRoi && !isRoi ? (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="default"
                      size="icon"
                      className="h-7 w-7"
                    >
                      <BoxSelect className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="right">ROI Selection</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" side="right">
                {roiClipEnabled ? (
                  <DropdownMenuItem onClick={() => roiPlugin?.disableClip()}>
                    <PowerOff className="h-3.5 w-3.5" />
                    Disable Crop
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => roiPlugin?.enableClip()}>
                    <Power className="h-3.5 w-3.5" />
                    Enable Crop
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => roiPlugin?.toggleClipVisible()}>
                  {roiClipVisible ? (
                    <>
                      <EyeOff className="h-3.5 w-3.5" />
                      Hide Outlines
                    </>
                  ) : (
                    <>
                      <Eye className="h-3.5 w-3.5" />
                      Show Outlines
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => roiPlugin?.redefine()}>
                  <PenLine className="h-3.5 w-3.5" />
                  Redefine ROI
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => roiPlugin?.clearRoi()}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear ROI
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={isRoi ? 'default' : 'ghost'}
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleRoiClick}
                >
                  <BoxSelect className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">ROI Selection</TooltipContent>
            </Tooltip>
          )}

          {hasWorldFrame && !isWorldFrame ? (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="default"
                      size="icon"
                      className="h-7 w-7"
                    >
                      <MapPin className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="right">World Frame</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" side="right">
                <DropdownMenuItem onClick={() => worldFramePlugin?.redefine()}>
                  <PenLine className="h-3.5 w-3.5" />
                  Redefine
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => useWorldFrameStore.getState().resetWorldFrame()}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={isWorldFrame ? 'default' : 'ghost'}
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleWorldFrameClick}
                >
                  <MapPin className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">World Frame</TooltipContent>
            </Tooltip>
          )}

      </div>
    </TooltipProvider>
  );
}
