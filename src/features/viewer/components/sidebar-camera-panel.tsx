import { useViewerStore } from '@/app/stores';
import type { CameraProjection } from '../types';

const PROJECTION_OPTIONS: { value: CameraProjection; label: string }[] = [
  { value: 'perspective', label: 'Perspective' },
  { value: 'orthographic', label: 'Orthographic' },
];

export function SidebarCameraPanel() {
  const cameraProjection = useViewerStore((s) => s.cameraProjection);
  const setCameraProjection = useViewerStore((s) => s.setCameraProjection);

  return (
    <div className="flex gap-1">
      {PROJECTION_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setCameraProjection(opt.value)}
          className={`flex-1 rounded-md px-2 py-1 text-xs transition-colors ${
            cameraProjection === opt.value
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
