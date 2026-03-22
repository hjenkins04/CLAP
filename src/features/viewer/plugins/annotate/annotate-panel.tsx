import { useState } from 'react';
import { Eye, EyeOff, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, ScrollArea } from '@clap/design-system';
import { useViewerModeStore } from '@/app/stores';
import { useAnnotateStore } from './annotate-store';
import { CLASSIFICATION_CLASSES } from './classification-classes';

export function AnnotatePanel() {
  const mode = useViewerModeStore((s) => s.mode);
  const exitMode = useViewerModeStore((s) => s.exitMode);
  const classVisibility = useAnnotateStore((s) => s.classVisibility);
  const toggleClassVisibility = useAnnotateStore(
    (s) => s.toggleClassVisibility,
  );
  const showAll = useAnnotateStore((s) => s.showAll);
  const hideAll = useAnnotateStore((s) => s.hideAll);
  const [collapsed, setCollapsed] = useState(false);

  if (mode !== 'annotate') return null;

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
    <div className="absolute right-3 top-56 z-10 w-56">
      <div className="rounded-lg border border-border bg-card/95 shadow-lg backdrop-blur-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <span className="text-xs font-medium">Classification</span>
          <div className="flex gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              onClick={showAll}
              title="Show all"
            >
              <Eye className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              onClick={hideAll}
              title="Hide all"
            >
              <EyeOff className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              onClick={() => setCollapsed(true)}
              title="Minimize"
            >
              <ChevronRight className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              onClick={exitMode}
              title="Close"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Class list */}
        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-0.5 p-1.5">
            {CLASSIFICATION_CLASSES.map((cls) => {
              const visible = classVisibility[String(cls.id)] ?? true;
              const [r, g, b] = cls.color;
              return (
                <button
                  key={cls.id}
                  type="button"
                  onClick={() => toggleClassVisibility(String(cls.id))}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-xs transition-colors hover:bg-muted ${
                    !visible ? 'opacity-40' : ''
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`,
                    }}
                  />
                  <span className="flex-1 truncate text-left">
                    {cls.name}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    [{cls.id}]
                  </span>
                  {visible ? (
                    <Eye className="h-3 w-3 shrink-0" />
                  ) : (
                    <EyeOff className="h-3 w-3 shrink-0 text-muted-foreground" />
                  )}
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
