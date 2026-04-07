import { Map, GitCommit, Pencil, RotateCcw, X, ArrowLeftRight, ArrowLeft, ArrowRight } from 'lucide-react';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Separator,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@clap/design-system';
import { usePlanProfileStore } from './plan-profile-store';

export function PlanProfileToolbar() {
  const phase     = usePlanProfileStore((s) => s.phase);
  const viewType  = usePlanProfileStore((s) => s.viewType);
  const activate  = usePlanProfileStore((s) => s.activate);
  const startEdit = usePlanProfileStore((s) => s.startEdit);
  const stopEdit  = usePlanProfileStore((s) => s.stopEdit);
  const close     = usePlanProfileStore((s) => s.close);

  const viewFlipped    = usePlanProfileStore((s) => s.viewFlipped);
  const setViewFlipped = usePlanProfileStore((s) => s.setViewFlipped);

  const isPlanActive    = phase !== 'idle' && viewType === 'plan';
  const isProfileActive = phase !== 'idle' && viewType === 'profile';
  const isEditing       = phase === 'editing';
  const hasActiveCut    = phase === 'active' || phase === 'editing';

  function renderButton(type: 'plan' | 'profile', icon: React.ReactNode, label: string) {
    const isActive = type === 'plan' ? isPlanActive : isProfileActive;

    // When a cut of this type is active, wrap in a dropdown for options.
    if (isActive && hasActiveCut) {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="default"
              size="icon"
              className="h-7 w-7"
            >
              {icon}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" className="w-48">
            {isEditing ? (
              <DropdownMenuItem onClick={stopEdit}>
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Finish Editing
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={startEdit}>
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Edit Box
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="py-1 text-[10px] text-muted-foreground">
              View from face
            </DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => setViewFlipped(false)}
              className={!viewFlipped ? 'bg-accent' : ''}
            >
              <ArrowLeft className="mr-2 h-3.5 w-3.5" />
              Side A
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setViewFlipped(true)}
              className={viewFlipped ? 'bg-accent' : ''}
            >
              <ArrowRight className="mr-2 h-3.5 w-3.5" />
              Side B
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => activate(type)}>
              <RotateCcw className="mr-2 h-3.5 w-3.5" />
              Redraw
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={close} className="text-destructive focus:text-destructive">
              <X className="mr-2 h-3.5 w-3.5" />
              Close View
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={isActive ? 'default' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={() => activate(type)}
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="absolute left-3 top-2 z-10">
        <div className="flex flex-row items-center gap-0.5 rounded-lg border border-border bg-card/90 px-0.5 py-0.5 shadow-sm backdrop-blur-sm">
          {renderButton('plan',    <Map className="h-3.5 w-3.5" />,       'Plan View (Top-down)')}
          <Separator orientation="vertical" className="h-4" />
          {renderButton('profile', <GitCommit className="h-3.5 w-3.5" />, 'Profile View (Cross-section)')}
        </div>
      </div>
    </TooltipProvider>
  );
}
