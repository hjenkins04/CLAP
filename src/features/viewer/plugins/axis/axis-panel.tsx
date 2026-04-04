import { useAxisStore } from './axis-store';

function AxisToggle({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-muted-foreground">
        Flip {label}-axis
      </span>
      <button
        onClick={onToggle}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          active ? 'bg-primary' : 'bg-muted'
        }`}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-background transition-transform ${
            active ? 'translate-x-5' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

export function AxisPanel() {
  const { flipX, flipY, flipZ, toggleFlipX, toggleFlipY, toggleFlipZ } =
    useAxisStore();

  return (
    <>
      <p className="mb-3 text-xs text-muted-foreground">
        Mirrors the entire scene along the selected axis — point cloud, base
        map, OSM features, obstacles, gizmos, and all other overlays.
      </p>
      <AxisToggle label="X" active={flipX} onToggle={toggleFlipX} />
      <AxisToggle label="Y" active={flipY} onToggle={toggleFlipY} />
      <AxisToggle label="Z" active={flipZ} onToggle={toggleFlipZ} />
    </>
  );
}
