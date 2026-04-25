import { useMemo, useState } from 'react';
import { Eye, EyeOff, X, ChevronLeft, ChevronRight, Target, BoxSelect, LassoSelect, ChevronDown } from 'lucide-react';
import {
  Button,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@clap/design-system';
import { useViewerModeStore } from '@/app/stores';
import { useAnnotateStore } from './annotate-store';
import { useReclassifyStore } from '../reclassify/reclassify-store';
import {
  useClassificationLegendStore,
  parseColor,
  type LegendClass,
  type LegendGroup,
} from '../../services/classification-legend';

interface GroupBundle {
  group: LegendGroup;
  classes: LegendClass[];
  classIds: string[];
}

export function AnnotatePanel() {
  const mode = useViewerModeStore((s) => s.mode);
  const exitMode = useViewerModeStore((s) => s.exitMode);

  const classVisibility = useAnnotateStore((s) => s.classVisibility);
  const classActive = useAnnotateStore((s) => s.classActive);
  const toggleClassVisibility = useAnnotateStore((s) => s.toggleClassVisibility);
  const toggleClassActive = useAnnotateStore((s) => s.toggleClassActive);
  const setGroupVisibility = useAnnotateStore((s) => s.setGroupVisibility);
  const setGroupActive = useAnnotateStore((s) => s.setGroupActive);
  const activateAll = useAnnotateStore((s) => s.activateAll);
  const showAll = useAnnotateStore((s) => s.showAll);
  const hideAll = useAnnotateStore((s) => s.hideAll);

  const legend = useClassificationLegendStore((s) => s.legend);
  const expanded = useClassificationLegendStore((s) => s.expanded);
  const toggleGroup = useClassificationLegendStore((s) => s.toggleGroup);

  const [collapsed, setCollapsed] = useState(false);

  const isReclassify = mode === 'reclassify';
  const activeTool = useReclassifyStore((s) => s.activeTool);
  const setActiveTool = useReclassifyStore((s) => s.setActiveTool);

  const bundles = useMemo<GroupBundle[]>(() => {
    const map = new Map<string, LegendClass[]>();
    for (const cls of legend.classes) {
      const arr = map.get(cls.groupId) ?? [];
      arr.push(cls);
      map.set(cls.groupId, arr);
    }
    const out: GroupBundle[] = [];
    for (const group of legend.groups) {
      const classes = map.get(group.id) ?? [];
      if (classes.length === 0) continue;
      out.push({
        group,
        classes,
        classIds: classes.map((c) => String(c.id)),
      });
      map.delete(group.id);
    }
    // Any classes pointing at groups that don't exist → "Ungrouped" bucket
    const leftovers: LegendClass[] = [];
    for (const arr of map.values()) leftovers.push(...arr);
    if (leftovers.length) {
      out.push({
        group: { id: 'ungrouped', name: 'Ungrouped' },
        classes: leftovers,
        classIds: leftovers.map((c) => String(c.id)),
      });
    }
    return out;
  }, [legend]);

  if (mode !== 'annotate' && mode !== 'reclassify') return null;

  if (collapsed) {
    return (
      <div className="absolute right-0 top-56 z-10">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex items-center rounded-l-md border border-r-0 border-border bg-card/95 px-1 py-3 shadow-lg backdrop-blur-sm transition-colors hover:bg-muted"
          title="Open classification panel"
        >
          <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
    );
  }

  // For group-level toggle state: consider group "visible" if any class inside it is visible
  const isGroupVisible = (b: GroupBundle) =>
    b.classIds.some((id) => classVisibility[id] ?? true);
  const isGroupActive = (b: GroupBundle) =>
    b.classIds.some((id) => classActive[id] ?? true);

  return (
    <TooltipProvider delayDuration={400}>
      <div className="absolute right-3 top-56 z-10 w-80 overflow-hidden rounded-lg border border-border bg-card/95 shadow-lg backdrop-blur-sm">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
            <div className="flex min-w-0 items-center gap-1.5">
              {isReclassify && (
                <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
              )}
              <span className="truncate text-xs font-medium" title={legend.name}>
                {isReclassify ? 'Active Classes' : 'Classification'}
              </span>
            </div>
            <div className="flex shrink-0 gap-0.5">
              {isReclassify && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-5 w-5" onClick={activateAll}>
                      <Target className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Activate all</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-5 w-5" onClick={showAll}>
                    <Eye className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Show all</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-5 w-5" onClick={hideAll}>
                    <EyeOff className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Hide all</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setCollapsed(true)}>
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Minimize</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-5 w-5" onClick={exitMode}>
                    <X className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Close</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Grouped class list */}
          <ScrollArea className="max-h-[calc(100vh-22rem)] w-full overflow-y-auto">
            <div className="w-full min-w-0 p-1.5 pr-3">
              {bundles.map((bundle) => {
                const groupExpanded = expanded[bundle.group.id] ?? true;
                const groupVisible = isGroupVisible(bundle);
                const groupActive = isGroupActive(bundle);
                return (
                  <div key={bundle.group.id} className="mb-0.5 w-full min-w-0">
                    {/* Group header */}
                    <div className="flex w-full min-w-0 items-center gap-1 rounded px-1.5 py-1 hover:bg-muted/60">
                      <button
                        type="button"
                        onClick={() => toggleGroup(bundle.group.id)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ChevronDown
                          className={`h-3 w-3 transition-transform ${groupExpanded ? '' : '-rotate-90'}`}
                        />
                      </button>
                      <span
                        className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                        title={bundle.group.name}
                      >
                        {bundle.group.name}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70">
                        {bundle.classes.length}
                      </span>

                      {isReclassify && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 shrink-0"
                              onClick={() => setGroupActive(bundle.classIds, !groupActive)}
                            >
                              <Target
                                className={`h-3 w-3 ${groupActive ? 'text-cyan-400' : 'text-muted-foreground'}`}
                              />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            {groupActive ? 'Deactivate group' : 'Activate group'}
                          </TooltipContent>
                        </Tooltip>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-5 w-5 shrink-0"
                            onClick={() => setGroupVisibility(bundle.classIds, !groupVisible)}
                          >
                            {groupVisible ? (
                              <Eye className="h-3 w-3" />
                            ) : (
                              <EyeOff className="h-3 w-3 text-muted-foreground" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          {groupVisible ? 'Hide group' : 'Show group'}
                        </TooltipContent>
                      </Tooltip>
                    </div>

                    {/* Group members */}
                    {groupExpanded &&
                      bundle.classes.map((cls) => {
                        const key = String(cls.id);
                        const visible = classVisibility[key] ?? (cls.enabledByDefault ?? true);
                        const active = classActive[key] ?? true;
                        const [r, g, b] = parseColor(cls.color);
                        const dimmed = !visible || (isReclassify && !active);

                        return (
                          <Tooltip key={cls.id}>
                            <TooltipTrigger asChild>
                              <div
                                className={`flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 pl-4 text-xs transition-colors hover:bg-muted ${
                                  dimmed ? 'opacity-40' : ''
                                }`}
                              >
                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10"
                                  style={{
                                    backgroundColor: `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`,
                                  }}
                                />
                                <span className="min-w-0 flex-1 truncate">{cls.name}</span>
                                <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                                  {cls.id}
                                </span>

                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className={`h-5 w-5 shrink-0 ${!isReclassify ? 'opacity-25' : ''}`}
                                  onClick={() => toggleClassActive(key)}
                                >
                                  <Target
                                    className={`h-3 w-3 ${active ? 'text-cyan-400' : 'text-muted-foreground'}`}
                                  />
                                </Button>

                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-5 w-5 shrink-0"
                                  onClick={() => toggleClassVisibility(key)}
                                >
                                  {visible ? (
                                    <Eye className="h-3 w-3" />
                                  ) : (
                                    <EyeOff className="h-3 w-3 text-muted-foreground" />
                                  )}
                                </Button>
                              </div>
                            </TooltipTrigger>
                            {cls.description && (
                              <TooltipContent side="left" className="max-w-xs">
                                {cls.description}
                              </TooltipContent>
                            )}
                          </Tooltip>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          {/* Reclassify tool selector */}
          {isReclassify && (
            <div className="border-t border-border/50 px-2 py-1.5">
              <p className="mb-1 text-[10px] text-muted-foreground">Selection tool</p>
              <div className="flex gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant={activeTool === 'drag-select' ? 'secondary' : 'ghost'}
                      className="h-7 flex-1 gap-1.5 text-xs"
                      onClick={() => setActiveTool('drag-select')}
                    >
                      <BoxSelect className="h-3.5 w-3.5" />
                      Box
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Drag to draw a selection rectangle</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant={activeTool === 'polygon' ? 'secondary' : 'ghost'}
                      className="h-7 flex-1 gap-1.5 text-xs"
                      onClick={() => setActiveTool('polygon')}
                    >
                      <LassoSelect className="h-3.5 w-3.5" />
                      Polygon
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Click to draw a polygon selection</TooltipContent>
                </Tooltip>
              </div>
            </div>
          )}

          {/* Reclassify hint */}
          {isReclassify && (
            <div className="border-t border-border/50 px-2.5 py-1.5">
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                <Target className="mr-1 inline h-2.5 w-2.5 text-cyan-400" />
                Active classes only are selectable
              </p>
            </div>
          )}
      </div>
    </TooltipProvider>
  );
}
