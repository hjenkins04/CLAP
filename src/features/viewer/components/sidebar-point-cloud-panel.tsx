import { useState, useEffect } from 'react';
import { FolderOpen, Eye } from 'lucide-react';
import { Button, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@clap/design-system';
import { useViewerStore } from '@/app/stores';
import { formatNumber } from '../utils/format';

interface CloudEntry {
  id: string;
  label: string;
}

export function SidebarPointCloudPanel() {
  const loadedFile = useViewerStore((s) => s.loadedFile);
  const numVisiblePoints = useViewerStore((s) => s.numVisiblePoints);
  const setLoadedFile = useViewerStore((s) => s.setLoadedFile);

  const isElectron = !!window.electron;

  // Browser-mode state
  const [clouds, setClouds] = useState<CloudEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');

  useEffect(() => {
    if (isElectron) return;
    fetch('/pointclouds/index.json')
      .then((r) => r.json())
      .then((data: CloudEntry[]) => {
        setClouds(data);
        if (data.length > 0) setSelectedId(data[0].id);
      })
      .catch(() => {});
  }, [isElectron]);

  const handleOpenFolder = async () => {
    if (!window.electron) return;
    const result = await window.electron.invoke<
      { path: string } | { error: string } | null
    >('open-pointcloud-dialog');
    if (!result) return;
    if ('error' in result) {
      console.error('[CLAP]', result.error);
      return;
    }
    setLoadedFile(result.path);
  };

  const handleBrowserOpen = () => {
    if (!selectedId) return;
    setLoadedFile(`/pointclouds/${selectedId}/`);
  };

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
        Point Cloud
      </h3>

      {isElectron ? (
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={handleOpenFolder}
          >
            <FolderOpen className="h-4 w-4" />
            Open Folder
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select point cloud…" />
            </SelectTrigger>
            <SelectContent>
              {clouds.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs">
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={handleBrowserOpen}
            disabled={!selectedId}
          >
            <FolderOpen className="h-4 w-4" />
            Open
          </Button>
        </div>
      )}

      {loadedFile && (
        <p className="mt-2 truncate text-xs text-muted-foreground">
          {loadedFile}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Eye className="h-3 w-3" />
        <span>Visible: {formatNumber(numVisiblePoints)} points</span>
      </div>
    </section>
  );
}
