import { useState } from 'react';
import { Layers, Settings } from 'lucide-react';

export type SidebarTab = 'layers' | 'settings';

interface SidebarTabsProps {
  children: (tab: SidebarTab) => React.ReactNode;
}

export function SidebarTabs({ children }: SidebarTabsProps) {
  const [tab, setTab] = useState<SidebarTab>('layers');

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-border">
        <button
          className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
            tab === 'layers'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('layers')}
        >
          <Layers className="h-3.5 w-3.5" />
          Layers
        </button>
        <button
          className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
            tab === 'settings'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('settings')}
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {children(tab)}
      </div>
    </div>
  );
}
