import { useState } from 'react';
import { Eye, EyeOff, X, ChevronLeft, ChevronRight, Target } from 'lucide-react';
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
import { CLASSIFICATION_CLASSES } from './classification-classes';

export function AnnotatePanel() {
  const mode = useViewerModeStore((s) => s.mode);
  const exitMode = useViewerModeStore((s) => s.exitMode);
  const classVisibility = useAnnotateStore((s) => s.classVisibility);
  const classActive = useAnnotateStore((s) => s.classActive);
  const toggleClassVisibility = useAnnotateStore((s) => s.toggleClassVisibility);
  const toggleClassActive = useAnnotateStore((s) => s.toggleClassActive);
  const activateAll = useAnnotateStore((s) => s.activateAll);
  const showAll = useAnnotateStore((s) => s.showAll);
  const hideAll = useAnnotateStore((s) => s.hideAll);
  const [collapsed, setCollapsed] = useState(false);

  const isReclassify = mode === 'reclassify';

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

  return (
    <TooltipProvider delayDuration={400}>
      <div className="absolute right-3 top-56 z-10 w-56">
        <div className="overflow-hidden rounded-lg border border-border bg-card/95 shadow-lg backdrop-blur-sm">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
            <div className="flex min-w-0 items-center gap-1.5">
              {isReclassify && (
                <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
              )}
              <span className="truncate text-xs font-medium">
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

          {/* Class list */}
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-px p-1.5">
              {CLASSIFICATION_CLASSES.map((cls) => {
                const visible = classVisibility[String(cls.id)] ?? true;
                const active = classActive[String(cls.id)] ?? true;
                const [r, g, b] = cls.color;
                const dimmed = !visible || (isReclassify && !active);

                return (
                  <div
                    key={cls.id}
                    className={`flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-xs transition-colors hover:bg-muted ${
                      dimmed ? 'opacity-40' : ''
                    }`}
                  >
                    {/* Color swatch */}
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10"
                      style={{
                        backgroundColor: `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`,
                      }}
                    />

                    {/* Class name — min-w-0 lets it actually shrink */}
                    <span className="min-w-0 flex-1 truncate">{cls.name}</span>

                    {/* ID badge */}
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {cls.id}
                    </span>

                    {/* Active toggle */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className={`h-5 w-5 shrink-0 ${!isReclassify ? 'opacity-25' : ''}`}
                          onClick={() => toggleClassActive(String(cls.id))}
                        >
                          <Target
                            className={`h-3 w-3 ${active ? 'text-cyan-400' : 'text-muted-foreground'}`}
                          />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        {active ? 'Deactivate (exclude from selection)' : 'Activate (include in selection)'}
                      </TooltipContent>
                    </Tooltip>

                    {/* Visibility toggle */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5 shrink-0"
                          onClick={() => toggleClassVisibility(String(cls.id))}
                        >
                          {visible ? (
                            <Eye className="h-3 w-3" />
                          ) : (
                            <EyeOff className="h-3 w-3 text-muted-foreground" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        {visible ? 'Hide class' : 'Show class'}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          {/* Reclassify hint */}
          {isReclassify && (
            <div className="border-t border-border/50 px-2.5 py-1.5">
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                <Target className="mr-1 inline h-2.5 w-2.5 text-cyan-400" />
                Active classes only are drag-selectable
              </p>
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
