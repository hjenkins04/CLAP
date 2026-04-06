import { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { Button, ScrollArea, Separator } from '@clap/design-system';
import { useReclassifyStore } from './reclassify-store';
import { CLASSIFICATION_CLASSES } from '../annotate/classification-classes';

export function ReclassifyGizmo() {
  const phase = useReclassifyStore((s) => s.phase);
  const gizmoScreenPos = useReclassifyStore((s) => s.gizmoScreenPos);
  const selectedCount = useReclassifyStore((s) => s.selectedCount);
  const applyFn = useReclassifyStore((s) => s._applyReclassification);
  const recentClassIds = useReclassifyStore((s) => s.recentClassIds);
  const addRecentClass = useReclassifyStore((s) => s.addRecentClass);

  const [search, setSearch] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset and focus when gizmo opens
  useEffect(() => {
    if (phase === 'selected' && gizmoScreenPos) {
      setSearch('');
      setActiveIdx(0);
      const id = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(id);
    }
  }, [phase, gizmoScreenPos]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const isSearching = search.trim().length > 0;
  const recentClasses = recentClassIds
    .map((id) => CLASSIFICATION_CLASSES.find((c) => c.id === id))
    .filter((c): c is (typeof CLASSIFICATION_CLASSES)[number] => c !== undefined);
  const remainingClasses = CLASSIFICATION_CLASSES.filter((c) => !recentClassIds.includes(c.id));

  const filtered = isSearching
    ? CLASSIFICATION_CLASSES.filter((cls) => {
        const q = search.toLowerCase().trim();
        return cls.name.toLowerCase().includes(q) || String(cls.id).includes(q);
      })
    : [...recentClasses, ...remainingClasses];

  const recentCount = isSearching ? 0 : recentClasses.length;

  function handleApply(id: number) {
    addRecentClass(id);
    applyFn?.(id);
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[activeIdx]) handleApply(filtered[activeIdx].id);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    }
  };

  if (phase !== 'selected' || !gizmoScreenPos) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: gizmoScreenPos.x,
        top: gizmoScreenPos.y,
        zIndex: 200,
        width: 232,
      }}
      className="overflow-hidden rounded-lg border border-border bg-card shadow-2xl backdrop-blur-sm"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
        <div className="h-2 w-2 shrink-0 rounded-full bg-cyan-400" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {selectedCount.toLocaleString()} point{selectedCount !== 1 ? 's' : ''} — reclassify
        </span>
      </div>

      <Separator />

      {/* Search input styled to match design system */}
      <div className="flex items-center gap-2 px-3 py-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setActiveIdx(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search class…"
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {search && (
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5 shrink-0"
            onClick={() => { setSearch(''); setActiveIdx(0); inputRef.current?.focus(); }}
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      <Separator />

      {/* Class list */}
      <ScrollArea className="max-h-52">
        <div className="p-1">
          {recentCount > 0 && (
            <p className="px-2 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Recent
            </p>
          )}
          <div ref={listRef} className="space-y-px">
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">No results</p>
          ) : (
            <>
              {filtered.map((cls, i) => {
                const [r, g, b] = cls.color;
                const isActive = i === activeIdx;
                return (
                  <div key={cls.id}>
                    {i === recentCount && recentCount > 0 && (
                      <div className="-mx-1 my-1">
                        <Separator />
                      </div>
                    )}
                    <button
                      type="button"
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => handleApply(cls.id)}
                      className={`flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors ${
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted'
                      }`}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10"
                        style={{
                          backgroundColor: `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`,
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate text-left">{cls.name}</span>
                      <span
                        className={`shrink-0 font-mono text-[10px] tabular-nums ${
                          isActive ? 'text-primary-foreground/70' : 'text-muted-foreground'
                        }`}
                      >
                        {cls.id}
                      </span>
                    </button>
                  </div>
                );
              })}
            </>
          )}
          </div>
        </div>
      </ScrollArea>

      <Separator />

      {/* Keyboard hint */}
      <div className="px-3 py-1.5">
        <p className="text-[10px] text-muted-foreground">
          ↑↓ navigate &middot; ↵ apply &middot; Alt+drag to deselect
        </p>
      </div>
    </div>
  );
}
