# CLAP Codebase Architecture Reference

> Quick reference for key systems relevant to HD map feature extraction.  
> Based on codebase exploration as of 2026-04-05.

---

## Plugin System

**Files**: `src/features/viewer/types/plugin.types.ts`, `src/features/viewer/services/viewer-engine.ts`

```typescript
interface ViewerPlugin {
  readonly id: string;
  readonly name: string;
  readonly order?: number;           // execution order (default 999)

  onInit(ctx: ViewerPluginContext): void;
  onUpdate?(delta: number): void;
  onAfterRender?(): void;
  onResize?(width: number, height: number): void;
  onPointCloudLoaded?(pco: PointCloudOctree): void;
  onPointCloudsUnloaded?(): void;
  dispose(): void;

  SidebarPanel?: ComponentType;      // React sidebar component
  sidebarTitle?: string;
  sidebarDefaultOpen?: boolean;
}

interface ViewerPluginContext {
  scene: Scene;
  worldRoot: Group;
  getActiveCamera: () => Camera;
  renderer: WebGLRenderer;
  controls: OrbitControls;
  getPointClouds: () => PointCloudOctree[];
  getEditor: () => PointCloudEditor;
  getDem: () => DemTerrain | null;
  domElement: HTMLElement;
  container: HTMLElement;
  host: PluginHost;
}
```

**Current plugins** (14): AxisPlugin, GridPlugin, PoiPlugin, TransformPlugin, ViewCubePlugin,
VirtualTilesPlugin, RoiSelectionPlugin, PointSelectPlugin, AnnotatePlugin, WorldFramePlugin,
BaseMapPlugin, OsmFeaturesPlugin, CustomMapPlugin, StaticObstaclePlugin, ReclassifyPlugin

---

## Point Cloud Data Access

```typescript
const pcos = ctx.getPointClouds();  // PointCloudOctree[]
for (const pco of pcos) {
  for (const node of pco.visibleNodes) {  // only loaded/visible nodes (LOD)
    const geom = node.sceneNode?.geometry as BufferGeometry;
    if (!geom) continue;

    // XYZ positions
    const posAttr = geom.getAttribute('position');
    const positions = posAttr.array as Float32Array;  // [x,y,z, x,y,z, ...]
    const count = posAttr.count;

    // Intensity (optional)
    const intAttr = geom.getAttribute('intensity');
    const intensities = intAttr?.array as Float32Array | undefined;

    // Classification (optional)
    const clsAttr = geom.getAttribute('classification');
    const classifications = clsAttr?.array as Uint8Array | undefined;

    // Color (optional)
    const colorAttr = geom.getAttribute('color');

    // World transform
    const worldMat = node.sceneNode.matrixWorld;
  }
}
```

**Intensity range**: `pco.material.intensityRange: [min, max]` — auto-detected per cloud.

---

## Classification Color IDs

File: `src/features/viewer/services/viewer-engine.ts` lines 33–53

| ID | Class |
|---|---|
| 1 | Other |
| 2 | Roads |
| 3 | Sidewalks |
| 4 | OtherGround |
| 5 | TrafficIslands |
| 6 | Buildings |
| 7 | Trees |
| 8 | OtherVegetation |
| 9 | TrafficLights |
| 10 | TrafficSigns |
| 11 | Wires |
| 12 | Masts |
| 13 | Pedestrians |
| 15 | TwoWheel |
| 16 | MobFourWheel |
| 17 | StaFourWheel |
| 18 | Noise |
| 40 | TreeTrunks |

---

## PointCloudEditor

File: `src/features/viewer/services/point-cloud-editor/`

```typescript
// Per-point operations
type EditOperationType =
  | 'GlobalTransform'    // 4x4 matrix to all points
  | 'SetClassification'  // Set classification for point IDs
  | 'SetIntensity'       // Set intensity for point IDs
  | 'DeletePoints'
  | 'RestorePoints'
  | 'AxisFlip'

// Point ID format: `${nodeName}:${pointIndex}`
type PointId = string & { readonly __brand: 'PointId' }
```

`VisualUpdater` patches Three.js geometry buffers in real-time each frame.

---

## ShapeEditorEngine

File: `src/features/viewer/modules/shape-editor/`

**Shape types**: OBB (3D box), Polygon (footprint + extrusion), Polyline (3D points)

**Drawing shapes in 3D** — objects added to `ctx.scene` directly:
```typescript
// Invisible pick meshes for raycasting
mesh.userData = {
  _seHandle: true,
  kind: 'vertex' | 'edge-mid' | 'face-extrude' | 'edge-resize' | 'shape-body',
  shapeId: string,
  index: number,
}
```

**Raycasting utilities** (`raycast-utils.ts`):
```typescript
raycastHorizontalPlane(ndc, camera, planeY): Vector3 | null
raycastVerticalPlane(ndc, camera, planeNormal, planePoint): Vector3 | null
raycastObjects(ndc, camera, objects, recursive): Intersection | null
metersPerPixel(camera, distanceToPoint, screenHeight): number
```

**Mouse input**: LMB freed for tools. MMB = orbit. RMB = pan. Ctrl+Shift+LMB = orbit fallback.

---

## ROI Selection Plugin

File: `src/features/viewer/plugins/roi-selection/`

**State machine**: `idle → choosing-tool → drawing → applied`

**API**:
```typescript
plugin.startDrawingTool(tool: 'box' | 'polygon' | 'polyline')
plugin.applySelection()   // enables Potree clip regions
plugin.redefine()         // re-enter drawing mode
plugin.clearRoi()         // remove all shapes and clip regions
```

**Clip region types**:
```typescript
interface IClipBox {
  box: Box3;       // AABB for BVH culling
  matrix: Matrix4; // world → unit cube
  inverse: Matrix4;
  position: Vector3;
}
```

Uses `ClipMode.CLIP_OUTSIDE` — only points inside the ROI shape are rendered.

---

## Static Obstacle Plugin (Reference Implementation)

File: `src/features/viewer/plugins/static-obstacle/`

**Phase state machine**: `idle → drawing-base → extruding → picking-face → classifying → idle`

**GeoJSON export** (`annotation-export.ts`):
```typescript
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "geometry": { "type": "Point", "coordinates": [x, z, y] },
    "properties": {
      "id": string, "label": string, "layer": string,
      "kind": "TrafficLight" | "Sign",
      "center_local": { x, y, z },
      "halfExtents": { x, y, z },
      "coordinateSystem": "WGS84" | "local-metres",
      "attributes": { [key: string]: string | number | boolean }
    }
  }]
}
```

**Pattern to follow for HD Map plugin**:
- Zustand store for tool state
- `startListening()` / `stopListening()` for pointer events
- `raycastGround()` helper that hits point cloud or DEM
- Layer system with per-layer color/visibility
- GeoJSON export with semantic properties

---

## DEM Terrain

```typescript
const dem = ctx.getDem();
if (dem) {
  const elevation = dem.getElevationClamped(worldX, worldZ); // returns Y in Three.js coords
}
```

Used for: snapping annotations to ground, back-projecting 2D BEV pixels to 3D.

---

## Coordinate System

**Three.js Y-up**:
- X = East
- Y = Elevation (up)
- Z = North (south is positive Z in world space)

**BEV rasterization**: Uses X (east) and Z (north) axes. Elevation Y from DEM on back-projection.

**GeoJSON export**: Uses `[lon, lat, elevation]` (WGS84) or `[x, z, y]` (local metres).

---

## Key File Paths

| Purpose | Path |
|---|---|
| ViewerEngine (core) | `src/features/viewer/services/viewer-engine.ts` |
| Plugin types | `src/features/viewer/types/plugin.types.ts` |
| ShapeEditorEngine | `src/features/viewer/modules/shape-editor/shape-editor-engine.ts` |
| Raycast utilities | `src/features/viewer/modules/shape-editor/utils/raycast-utils.ts` |
| ROI plugin | `src/features/viewer/plugins/roi-selection/roi-plugin.ts` |
| ROI store | `src/features/viewer/plugins/roi-selection/roi-store.ts` |
| ROI clip adapter | `src/features/viewer/plugins/roi-selection/roi-clip-adapter.ts` |
| Static obstacle plugin | `src/features/viewer/plugins/static-obstacle/` |
| Annotation export | `src/features/viewer/plugins/static-obstacle/annotation-export.ts` |
| Viewer store | `src/app/stores/viewer-store.ts` |
| Electron main | `electron/main.ts` |
| Design system | `libs/design-system/` |
