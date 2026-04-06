import {
  Undo2,
  Redo2,
  Save,
  Loader2,
  Move,
  RotateCw,
  Crosshair,
  Trash2,
  Hand,
  MousePointer2,
  Tags,
  PenLine,
  Route,
  ScanSearch,
  BoxSelect,
} from 'lucide-react';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Separator,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@clap/design-system';
import { useViewerModeStore } from '@/app/stores';
import { usePoiStore } from '../plugins/poi';
import { usePointSelectStore, PointSelectPlugin } from '../plugins/point-select';
import { useScanFilterStore } from '../plugins/scan-filter';
import { usePointInfoStore } from '../plugins/point-info';
import { useBaseMapStore } from '../plugins/base-map';
import { useRoiStore } from '../plugins/roi-selection';
import type { ViewerEngine } from '../services/viewer-engine';
import { useEditorState } from '../hooks/use-editor-state';

interface ViewerToolbarProps {
  engine: ViewerEngine | null;
}

export function ViewerToolbar({ engine }: ViewerToolbarProps) {
  const { canUndo, canRedo, dirty, saving, undo, redo, save } =
    useEditorState(engine);

  const { mode, transformSubMode, enterTransformMode, enterPoiMode, enterPointSelectMode, enterAnnotateMode, enterReclassifyMode, enterRoiSelectionMode, enterScanFilterMode, enterPointInfoMode, exitMode } =
    useViewerModeStore();

  const poiPosition = usePoiStore((s) => s.position);
  const clearPoi = usePoiStore((s) => s.clearPosition);
  const selectedCount = usePointSelectStore((s) => s.selectedCount);

  const isRoi = mode === 'roi-selection';
  const roiPhase = useRoiStore((s) => s.phase);
  const roiActive = isRoi || roiPhase === 'applied';

  const isGrab = mode === 'idle';
  const isPointSelect = mode === 'point-select';
  const isAnnotate = mode === 'annotate';
  const isReclassify = mode === 'reclassify';
  const isScanFilter = mode === 'scan-filter';
  const scanFilterPhase = useScanFilterStore((s) => s.phase);
  const scanFilterHasData = useScanFilterStore((s) => s.trajectoryData !== null);
  const scanFilterActive = scanFilterPhase === 'applied' || isScanFilter;
  const isPointInfo = mode === 'point-info';
  const hasPickedPoint = usePointInfoStore((s) => s.pickedPoint !== null);
  const isTranslate = mode === 'transform' && transformSubMode === 'translate';
  const isRotate = mode === 'transform' && transformSubMode === 'rotate';
  const poiPhase = usePoiStore((s) => s.phase);
  const isPoi = mode === 'poi';
  const hasPoi = poiPosition !== null;
  const isPoiActive = isPoi && (poiPhase === 'selecting' || poiPhase === 'confirming');
  const baseMapEditing = useBaseMapStore((s) => s.editing);

  const handleTranslate = () => {
    if (isTranslate) {
      exitMode();
    } else {
      enterTransformMode('translate');
    }
  };

  const handleRotate = () => {
    if (isRotate) {
      exitMode();
    } else {
      enterTransformMode('rotate');
    }
  };

  const handlePoiClick = () => {
    if (isPoi) {
      exitMode();
    } else {
      enterPoiMode();
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="absolute left-1/2 top-2 z-10 -translate-x-1/2">
        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card/90 px-1 py-0.5 shadow-sm backdrop-blur-sm">
          {/* Cursor mode: Grab / Select */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isGrab ? 'default' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={() => { if (!isGrab) exitMode(); }}
              >
                <Hand className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Grab (Navigate)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isPointSelect ? 'default' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                disabled={baseMapEditing}
                onClick={() => {
                  if (isPointSelect) {
                    exitMode();
                  } else {
                    enterPointSelectMode();
                  }
                }}
              >
                <MousePointer2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {isPointSelect && selectedCount > 0
                ? `Select Points (${selectedCount.toLocaleString()} selected)`
                : 'Select Points'}
            </TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="mx-0.5 h-4" />

          {/* Undo / Redo / Save */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={!canUndo}
                onClick={undo}
              >
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Undo</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={!canRedo}
                onClick={redo}
              >
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Redo</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={dirty ? 'default' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                disabled={!dirty || saving}
                onClick={save}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {saving ? 'Saving...' : 'Save'}
            </TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="mx-0.5 h-4" />

          {/* Transform tools */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isTranslate ? 'default' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                disabled={baseMapEditing}
                onClick={handleTranslate}
              >
                <Move className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Translate</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isRotate ? 'default' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                disabled={baseMapEditing}
                onClick={handleRotate}
              >
                <RotateCw className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Rotate</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="mx-0.5 h-4" />

          {/* POI / Target */}
          {hasPoi ? (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-red-500"
                    >
                      <Crosshair className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">Target POI</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="center" side="bottom">
                <DropdownMenuItem onClick={handlePoiClick}>
                  <Crosshair className="h-3.5 w-3.5" />
                  Move POI
                </DropdownMenuItem>
                <DropdownMenuItem onClick={clearPoi}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete POI
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={isPoiActive ? 'default' : 'ghost'}
                  size="icon"
                  className="h-7 w-7"
                  disabled={baseMapEditing}
                  onClick={handlePoiClick}
                >
                  <Crosshair className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {isPoi ? 'Click point cloud to set target' : 'Set Target POI'}
              </TooltipContent>
            </Tooltip>
          )}

          <Separator orientation="vertical" className="mx-0.5 h-4" />

          {/* Annotate */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isAnnotate ? 'default' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                disabled={baseMapEditing}
                onClick={() => isAnnotate ? exitMode() : enterAnnotateMode()}
              >
                <Tags className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Annotate</TooltipContent>
          </Tooltip>

          {/* Reclassify */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isReclassify ? 'default' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                disabled={baseMapEditing}
                onClick={() => isReclassify ? exitMode() : enterReclassifyMode()}
              >
                <PenLine className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Reclassify Points</TooltipContent>
          </Tooltip>

          {/* ROI Selection */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={roiActive ? 'default' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                disabled={baseMapEditing}
                onClick={() => isRoi ? exitMode() : enterRoiSelectionMode()}
              >
                <BoxSelect className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {roiPhase === 'applied' ? 'Edit ROI (active)' : 'Edit ROI'}
            </TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="mx-0.5 h-4" />

          {/* Scan Filter */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={scanFilterActive ? 'default' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                disabled={baseMapEditing || !scanFilterHasData}
                onClick={() => isScanFilter ? exitMode() : enterScanFilterMode()}
              >
                <Route className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {scanFilterPhase === 'applied' ? 'Scan Filter (active)' : 'Scan Filter'}
            </TooltipContent>
          </Tooltip>

          {/* Point Info */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={(isPointInfo || hasPickedPoint) ? 'default' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                disabled={baseMapEditing}
                onClick={() => isPointInfo ? exitMode() : enterPointInfoMode()}
              >
                <ScanSearch className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Point Info</TooltipContent>
          </Tooltip>

        </div>
      </div>
    </TooltipProvider>
  );
}
