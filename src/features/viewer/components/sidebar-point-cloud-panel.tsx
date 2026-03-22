import { FolderOpen, Eye } from 'lucide-react';
import { Button } from '@clap/design-system';
import { useViewerStore } from '@/app/stores';
import { formatNumber } from '../utils/format';

export function SidebarPointCloudPanel() {
  const loadedFile = useViewerStore((s) => s.loadedFile);
  const numVisiblePoints = useViewerStore((s) => s.numVisiblePoints);
  const setLoadedFile = useViewerStore((s) => s.setLoadedFile);

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
          onClick={handleOpenFolder}
        >
          <FolderOpen className="h-4 w-4" />
          Open Folder
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
