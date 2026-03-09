import { FolderOpen, Monitor, Eye } from 'lucide-react';
import { Button } from '@clap/design-system';
import { useViewerStore } from '@/app/stores';
import { formatNumber } from '../utils/format';

export function SidebarPointCloudPanel() {
  const loadedFile = useViewerStore((s) => s.loadedFile);
  const numVisiblePoints = useViewerStore((s) => s.numVisiblePoints);
  const setLoadedFile = useViewerStore((s) => s.setLoadedFile);

  const handleOpenFile = async () => {
    if (window.electron) {
      const filePath = await window.electron.invoke<string | null>(
        'open-file-dialog'
      );
      if (filePath) {
        setLoadedFile(filePath);
      }
    }
  };

  const handleLoadDemo = () => {
    setLoadedFile('/pointclouds/test/');
  };

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
        Point Cloud
      </h3>
      <div className="flex flex-col gap-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={handleOpenFile}
        >
          <FolderOpen className="h-4 w-4" />
          Open File
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={handleLoadDemo}
        >
          <Monitor className="h-4 w-4" />
          Load Demo Data
        </Button>
      </div>
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
