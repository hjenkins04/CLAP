# HD Map Feature Extraction — Research & Architecture

> **Context**: Post-SLAM static aligned LiDAR maps. Not real-time. Full map already georeferenced.  
> **Goal**: Extract road boundaries, curb lines, lane markings (solid/dashed lines, arrows, crosswalks, stop bars).  
> **Export target**: Lanelet2 OSM XML (primary), OpenLABEL JSON (secondary).  
> **Platform**: Electron desktop app (CLAP), TypeScript/React, Three.js + potree-core.

---

## Core Architecture Decision: BEV-First

The dominant industry approach (Apollo, Autoware, Orbit GT, Mosaic) is **Bird's Eye View (BEV) rasterization**:

1. Project ground-classified points to a 2D top-down intensity image
2. Do feature extraction in 2D (image processing)
3. Back-project results to 3D world coordinates

This works because:
- Road markings have dramatically higher LiDAR intensity than pavement (~150–255 DN vs ~30–60 DN)
- 2D algorithms (Otsu, connected components, Dijkstra) are fast and battle-tested
- 5 cm resolution BEV of 500×500 m = 10k×10k Float32 image = 400 MB — manageable

---

## Full Pipeline

```
Post-SLAM LiDAR Map
       │
       ▼
┌─────────────────────────────────────────┐
│  Stage 1: Preprocessing (one-time batch)│  ← Electron IPC → Python/PDAL
│  SMRF ground classification             │
│  HAG (Height Above Ground) per point    │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  Stage 2: BEV Image (per ROI)           │  ← Pure TypeScript
│  Filter: HAG ∈ [−0.05, 0.08 m]         │
│  Rasterize max-intensity → Float32 image│
└────────┬────────┴──────────────────────┘
         │                │
         ▼                ▼
┌────────────────┐  ┌─────────────────────┐
│  Road Markings │  │  Road Boundaries    │
│  (BEV-based)   │  │  (3D cross-section) │
├────────────────┤  ├─────────────────────┤
│• Otsu thresh   │  │• HAG [0.05–0.35 m]  │
│• Connected     │  │• Cross-section scan │
│  components    │  │• Height discontin.  │
│• MBR classify  │  │• DBSCAN cluster     │
│• Live Wire     │  │• Douglas-Peucker    │
│  (assisted)    │  │  polyline           │
└───────┬────────┘  └──────────┬──────────┘
        │                      │
        ▼                      ▼
┌─────────────────────────────────────────┐
│  ShapeEditor Polylines / Polygons       │
│  (existing CLAP annotation layer)       │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  Export                                  │
│  • Lanelet2 OSM XML (primary)            │
│  • OpenLABEL JSON (secondary)            │
└─────────────────────────────────────────┘
```

---

## Stage 1: Ground Classification via PDAL

Run **once per tile**, outputs a new LAZ with Classification=2 (ground) and HeightAboveGround per point.

### Electron IPC Bridge

```typescript
// electron/main.ts
import { spawn } from 'child_process';

ipcMain.handle('run-pdal', async (_e, pipelineJson: string) => {
  return new Promise((resolve, reject) => {
    const proc = spawn('pdal', ['pipeline', '--stdin'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    proc.stdin.write(pipelineJson);
    proc.stdin.end();
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => webContents.send('pdal-progress', d.toString()));
    proc.on('close', code => code === 0 ? resolve(out) : reject(out));
  });
});
```

For large files use file paths rather than stdin piping.  
For long-running ops use `utilityProcess.fork()` so it doesn't block main process.

### PDAL Pipeline JSON

```json
{
  "pipeline": [
    { "type": "readers.las", "filename": "input.las" },
    { "type": "filters.smrf", "cell": 1.0, "slope": 0.15, "window": 18.0, "threshold": 0.5 },
    { "type": "filters.hag_nn", "count": 1 },
    { "type": "writers.las", "filename": "ground_classified.las" }
  ]
}
```

### SMRF Parameters

| Parameter | Default | Notes |
|---|---|---|
| `cell` | 1.0 m | Raster cell size for DSM; should match road_width / 10 |
| `slope` | 0.15 | Slope threshold in m/m; raise for hilly terrain |
| `window` | 18.0 m | Max object size — buildings/trees below this won't be misclassified as ground |
| `scalar` | 1.25 | Aggressiveness of non-ground identification |
| `threshold` | 0.5 m | Final height cutoff |

### Alternative: CSF (Cloth Simulation Filter)

Better for rough terrain. Python: `pip install cloth-simulation-filter`  
PDAL stage: `filters.csf`  
Key params: `cloth_resolution` (0.5 m), `class_threshold` (0.5 m), `bSloopSmooth` (true for urban)  
Source: https://github.com/jianboqi/CSF

### HAG Normalization

After SMRF, `filters.hag_nn` adds `HeightAboveGround` dimension:
- HAG = 0.0 → road surface
- HAG = 0.0–0.05 m → road markings
- HAG = 0.05–0.35 m → curbs
- HAG > 0.5 m → buildings, vehicles, vegetation

---

## Stage 2: BEV Image Builder

Pure TypeScript. User sets ROI first (existing ROI plugin), then clicks "Generate BEV."

```typescript
interface BEVImage {
  data: Float32Array;   // max-intensity per pixel
  w: number;
  h: number;
  originX: number;
  originZ: number;
  resolution: number;   // meters per pixel
}

function buildBEV(
  groundPoints: Float32Array,  // interleaved x, y, z, intensity (HAG-filtered)
  originX: number, originZ: number,
  widthM: number, heightM: number,
  resolution: number            // e.g. 0.05 for 5 cm
): BEVImage {
  const w = Math.ceil(widthM / resolution);
  const h = Math.ceil(heightM / resolution);
  const data = new Float32Array(w * h);
  for (let i = 0; i < groundPoints.length; i += 4) {
    const px = Math.floor((groundPoints[i]     - originX) / resolution);
    const py = Math.floor((groundPoints[i + 2] - originZ) / resolution);
    if (px < 0 || px >= w || py < 0 || py >= h) continue;
    const idx = py * w + px;
    if (groundPoints[i + 3] > data[idx]) data[idx] = groundPoints[i + 3];
  }
  return { data, w, h, originX, originZ, resolution };
}

// Back-project pixel to world coords (elevation from DEM)
function pixelToWorld(px: number, py: number, bev: BEVImage, dem: DemTerrain): Vector3 {
  const worldX = bev.originX + px * bev.resolution;
  const worldZ = bev.originZ + py * bev.resolution;
  const worldY = dem.getElevationClamped(worldX, worldZ);
  return new Vector3(worldX, worldY, worldZ);
}
```

**Sizes**:
- 500×500 m at 5 cm = 10k×10k = 400 MB Float32 — tile at 200 m × 200 m with 20 m overlap
- 200×200 m at 2 cm = 10k×10k = 400 MB Float32 — good for high-detail areas

**Plan View**: Render the BEV as a WebGL texture in a second canvas panel (sidebar or floating overlay). This IS the "plan view" that HD map tools use.

---

## Road Marking Extraction

### Step 1 — Otsu Thresholding (~20 lines TS)

```typescript
function otsu(histogram: number[]): number {
  const total = histogram.reduce((a, b) => a + b, 0);
  let sum = histogram.reduce((acc, v, i) => acc + i * v, 0);
  let sumB = 0, wB = 0, max = 0, threshold = 0;
  for (let t = 0; t < 256; t++) {
    wB += histogram[t]; if (wB === 0) continue;
    const wF = total - wB; if (wF === 0) break;
    sumB += t * histogram[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > max) { max = between; threshold = t; }
  }
  return threshold;
}
```

Run per-tile (sliding window) for intensity variations across the map.

### Step 2 — Connected Component Labeling

Union-find (disjoint sets) on the binary mask, 8-connected.  
~100 lines of TypeScript. Alternatively use `opencv-wasm`: `cv.connectedComponentsWithStats()`.

### Step 3 — MBR Shape Classification

Compute minimum bounding rectangle (rotating calipers, ~50 lines TS) per component:

| Marking Type | Aspect Ratio | Typical Size | Identifying Feature |
|---|---|---|---|
| Solid lane line | > 15:1 | > 3 m long | Single elongated blob |
| Dashed lane line | > 8:1 | 1–3 m per dash | Multiple blobs, regular spacing |
| Stop bar | > 10:1 | > 2 m wide | Wide, perpendicular to lane |
| Arrow | 1:1–3:1 | 1–3 m | Complex shape, low convexity |
| Crosswalk stripe | > 5:1 | 0.5×2 m | Multiple parallel blobs, regular spacing |

### Step 4 — Back-projection to 3D

```typescript
// Each component centroid pixel → world Vector3
const worldPt = pixelToWorld(cx, cy, bev, ctx.getDem());
// Create ShapeEditor polygon shape from component boundary pixels
```

---

## Interactive Tools

### Live Wire / Intelligent Scissors (highest value tool)

User clicks a **start** point on a lane line; tool shows optimal path to mouse position in real-time along the intensity ridge. Click to commit segment → becomes new start.

**Algorithm**: Dijkstra on the pixel graph.  
Edge cost = `1 - normalizedIntensity(neighbor)`  
Pre-compute shortest-path tree from seed (once, ~100–200 ms for 1000×1000 tile).  
Trace path to mouse in O(path length) on each mousemove.

**Cost function**:
```typescript
function edgeCost(bev: BEVImage, px: number, py: number, qx: number, qy: number): number {
  const normIntensity = bev.data[qy * bev.w + qx] / 255;
  const gradient = Math.abs(bev.data[qy * bev.w + qx] - bev.data[py * bev.w + px]) / 255;
  return 0.5 * (1 - normIntensity) + 0.4 * (1 - gradient) + 0.1 * directionPenalty;
}
```

**npm**: `tinyqueue` (1.5 kB min-heap for priority queue).

**Paper**: Mortensen & Barrett (1995) "Intelligent Scissors for Image Composition" — applies directly to BEV intensity image.

### Snap-to-Intensity on Vertex Placement

Augment existing `polyline-draw-controller.ts`:  
When user places a vertex, sample a 1 m radius in BEV and snap to local intensity maximum.  
Sub-pixel precision for free, zero extra clicks.

### Flood Fill (one-click blobs)

User clicks inside a marking blob → flood fill from pixel at local Otsu threshold → one polygon annotation.

```typescript
function floodFill(bev: BEVImage, startX: number, startY: number, threshold: number): number[] {
  const visited = new Uint8Array(bev.w * bev.h);
  const result: number[] = [];
  const queue = [startY * bev.w + startX];
  while (queue.length) {
    const idx = queue.pop()!;
    if (visited[idx]) continue;
    visited[idx] = 1;
    if (bev.data[idx] < threshold) continue;
    result.push(idx);
    const x = idx % bev.w, y = Math.floor(idx / bev.w);
    if (x > 0)        queue.push(idx - 1);
    if (x < bev.w-1)  queue.push(idx + 1);
    if (y > 0)        queue.push(idx - bev.w);
    if (y < bev.h-1)  queue.push(idx + bev.w);
  }
  return result;
}
```

### Region Growing (3D seed point)

For curbs or non-flat features where BEV is insufficient:
1. User clicks a 3D point (existing point-select plugin provides ray)
2. PCA normal estimation over 20 nearest neighbors
3. BFS: accept neighbor if normal angle < θ (10°) AND distance < r (1 m)
4. Result: cluster of 3D points forming a continuous surface

---

## Curb / Road Boundary Detection

Runs on points with HAG ∈ [0.05, 0.35 m].

### Pipeline

1. **Cross-section sampling**: For road direction vector (user draws rough centerline), sample 0.2 m-wide perpendicular slabs every 1 m
2. **Height discontinuity**: Sort slab by lateral position, compute `dZ` between adjacent points. Flag where `0.05 < dZ < 0.35 m`
3. **Normal filter**: Keep candidates where surface normal elevation angle is 20°–70° (curb face = sideways normal). PCA over 15 nearest neighbors.
4. **DBSCAN clustering**: `density-clustering` npm, ε = 0.5 m, minPts = 5 → one cluster per continuous curb segment
5. **Douglas-Peucker**: Simplify each cluster to clean polyline at tolerance ε = 0.05 m

For a 1 km road segment with ~5 M road-area points: runs in under 5 seconds in JS.

### Normal Estimation (PCA, ~60 lines TS)

```typescript
function estimateNormal(points: Vector3[], k = 15): Vector3 {
  // 1. Compute centroid
  // 2. Build 3x3 covariance matrix
  // 3. Power iteration for smallest eigenvector (surface normal)
  // Returns unit normal vector
}
```

---

## Plan View / Overhead 2D Panel

Second `<canvas>` element (sidebar or floating PiP):
- Renders BEV Float32Array as WebGL texture — instant pan/zoom
- Mouse clicks in 2D panel fire same annotation tools as 3D view
- Toggle overlays: raw intensity | Otsu mask | detected components | final annotations
- Shows cross-section indicator line when using curb detection
- Synchronized cursor between 2D and 3D views

This is how Orbit GT, Mosaic, and commercial MLS annotation tools present road data.

---

## Plugin Architecture

New plugin `HdMapPlugin` following the `StaticObstaclePlugin` pattern:

```
src/features/viewer/plugins/hd-map/
├── hd-map-plugin.ts            # ViewerPlugin implementation
├── hd-map-store.ts             # Zustand state (tool mode, BEV data, detections)
├── hd-map-types.ts             # RoadMarking, CurbLine, LaneAnnotation types
├── services/
│   ├── bev-builder.ts          # BEV rasterization (pure TS)
│   ├── otsu-segmenter.ts       # Otsu + connected components
│   ├── live-wire.ts            # Dijkstra on BEV pixel graph
│   ├── curb-detector.ts        # Cross-section + DBSCAN pipeline
│   └── marking-classifier.ts  # MBR aspect-ratio → type classification
├── export/
│   ├── lanelet2-writer.ts      # OSM XML output (complements existing parser)
│   └── openlabel-writer.ts     # ASAM OpenLABEL JSON
└── components/
    ├── HdMapPanel.tsx           # Sidebar: tool buttons, layer list, parameters
    ├── BevCanvas.tsx            # 2D plan view canvas (WebGL texture)
    └── MarkingReviewTable.tsx   # Review auto-detected markings before commit
```

### Mode State Machine

```
idle → generating-bev → auto-detecting → reviewing-markings → committed
idle → live-wire-active → tracing → committed
idle → flood-fill-active → previewing → committed
idle → drawing-centerline → detecting-curbs → reviewing-curbs → committed
```

---

## Lanelet2 Export Format

CLAP already has a Lanelet2 parser. The writer produces OSM XML:

```xml
<osm version="0.6">
  <!-- Points (one <node> per vertex) -->
  <node id="1" lat="0.0" lon="0.0"><tag k="ele" v="0.0"/></node>

  <!-- Left curb linestring -->
  <way id="100">
    <nd ref="1"/><nd ref="2"/>...<nd ref="N"/>
    <tag k="type" v="curbstone"/>
    <tag k="subtype" v="high"/>
  </way>

  <!-- Lane marking -->
  <way id="200">
    <nd ref="10"/><nd ref="11"/>...
    <tag k="type" v="line_thin"/>
    <tag k="subtype" v="dashed"/>
    <tag k="color" v="white"/>
  </way>

  <!-- Lanelet (road section) -->
  <relation id="1000">
    <member type="way" ref="100" role="left"/>
    <member type="way" ref="101" role="right"/>
    <tag k="type" v="lanelet"/>
    <tag k="subtype" v="road"/>
    <tag k="speed_limit" v="50"/>
  </relation>
</osm>
```

### Standard Linestring type/subtype Values

| type | subtype | Meaning |
|---|---|---|
| `line_thin` | `solid` | Solid lane line |
| `line_thin` | `dashed` | Dashed lane line |
| `line_thick` | `solid` | Stop bar / wide solid |
| `curbstone` | `high` | Impassable curb |
| `curbstone` | `low` | Passable curb (mountable) |
| `road_border` | — | Road edge (no physical curb) |
| `virtual` | — | Logical boundary (no marking) |
| `pedestrian_marking` | `zebra` | Crosswalk |

---

## OpenLABEL Export Format (ASAM Standard)

```json
{
  "objects": {
    "lane_001": {
      "name": "left_lane_boundary",
      "type": "lane_marking",
      "object_data": {
        "poly3d": [{
          "name": "boundary",
          "val": [x1,y1,z1, x2,y2,z2],
          "closed": false,
          "attributes": {
            "text": [{"name": "lane_edge", "val": "left"}]
          }
        }]
      }
    }
  }
}
```

`poly3d.val` is a flat `[x,y,z, x,y,z, ...]` array — trivially produced from ShapeEditor polylines.

---

## JavaScript/TypeScript Implementation Inventory

### npm Packages

| Package | Algorithm | Notes |
|---|---|---|
| `tinyqueue` | Binary min-heap | Used for Dijkstra (Live Wire). 1.5 kB. |
| `density-clustering` | DBSCAN, OPTICS, K-means | TypeScript types via `@types/density-clustering` |
| `kd-tree-javascript` | KD-tree for kNN | 3D nearest-neighbor for normal estimation |
| `opencv-wasm` | Full OpenCV 4.3 as WASM | `connectedComponentsWithStats`, `floodFill`, `threshold`. ~5 MB. Works in Electron. |

### Pure TypeScript Implementations (~100–300 lines each)

- **Otsu thresholding**: 20 lines, O(256) after histogram
- **BEV rasterization**: 30 lines on Float32Array
- **Connected component labeling** (union-find): 80 lines
- **Douglas-Peucker simplification**: 30 lines
- **Minimum bounding rectangle** (rotating calipers): 80 lines
- **Dijkstra on 2D pixel grid** (Live Wire): 100 lines + tinyqueue
- **PCA normal estimation** (3×3 eigen via power iteration): 60 lines
- **RANSAC plane fitting**: 50 lines
- **Flood fill on typed array**: 40 lines

---

## Decision Matrix

| Task | Algorithm | Where | User Input | Estimated Time |
|---|---|---|---|---|
| Ground classification | SMRF via PDAL | Python subprocess | None (batch) | ~30 s / 100 M pts |
| HAG normalization | `filters.hag_nn` | Python subprocess | None (batch) | included above |
| Road surface isolation | HAG filter | TypeScript | HAG threshold slider | instant |
| BEV generation | Max-intensity raster | TypeScript | Resolution (2–5 cm) | < 2 s |
| Road marking candidates | Otsu + connected components | TypeScript / opencv-wasm | Threshold adjust | < 1 s |
| Marking type classification | MBR aspect ratio | TypeScript | Review table | < 1 s |
| Curb detection | Height discontinuity + DBSCAN | TypeScript | Height threshold | < 5 s / km |
| Curb polyline output | Douglas-Peucker | TypeScript | Simplification ε | instant |
| Lane line tracing | Live Wire (Dijkstra on BEV) | TypeScript | Start + end clicks | ~200 ms / seed |
| Mark individual blobs | Flood fill on BEV | TypeScript | Single click | instant |
| Region growing (3D) | Normal-angle BFS | TypeScript | Seed click + θ, r | < 2 s |
| Export Lanelet2 | OSM XML writer | TypeScript | None | instant |
| Export OpenLABEL | JSON writer | TypeScript | None | instant |

---

## Recommended Build Order

| Phase | What | Key Value |
|---|---|---|
| 1 | PDAL IPC bridge (Electron → Python/PDAL) | Unlocks HAG for everything downstream |
| 2 | BEV builder + plan view canvas | Visual foundation; also useful standalone |
| 3 | Otsu + connected components auto-detect | One-click "find all markings" |
| 4 | MBR classifier + review table | Auto-labels detected blobs by type |
| 5 | Live Wire tool | Highest-value interactive tool |
| 6 | Curb detection pipeline | Road boundaries as polylines |
| 7 | Lanelet2 OSM XML writer | Full export round-trip |
| 8 | Flood fill tool | Single-click blob annotation |
| 9 | Plan view 2D panel | Better UX for all marking work |

Phases 1–4 = usable "auto-detect then review" workflow.  
Phases 5–6 = manual-assist tools for what auto-detect misses.

---

## Existing CLAP Architecture (Reference)

### Point Data Access Pattern

```typescript
const pcos = ctx.getPointClouds();  // PointCloudOctree[]
for (const pco of pcos) {
  for (const node of pco.visibleNodes) {
    const geom = node.sceneNode?.geometry;
    if (!geom) continue;

    const posAttr = geom.getAttribute('position');   // Float32Array [x,y,z,x,y,z,...]
    const intAttr  = geom.getAttribute('intensity'); // Float32Array [i,i,i,...]
    const clsAttr  = geom.getAttribute('classification'); // Uint8Array

    const worldMat = node.sceneNode.matrixWorld;     // local → world transform
  }
}
```

Only **visible/loaded nodes** are available (potree LOD). HAG is a custom attribute added by PDAL post-processing.

### Existing Classification IDs

| ID | Class |
|---|---|
| 2 | Roads |
| 3 | Sidewalks |
| 4 | OtherGround |
| 5 | TrafficIslands |

Ground classification from SMRF will add Classification=2 to road points.

### Plugin Lifecycle Hooks

```typescript
interface ViewerPlugin {
  onInit(ctx: ViewerPluginContext): void;
  onUpdate?(delta: number): void;
  onAfterRender?(): void;
  onPointCloudLoaded?(pco: PointCloudOctree): void;
  onPointCloudsUnloaded?(): void;
  dispose(): void;
  SidebarPanel?: ComponentType;
}
```

### ShapeEditor Integration

All marking/boundary results should be created as ShapeEditor shapes:
- **Polyline**: Road boundaries, curb lines, lane markings
- **Polygon**: Arrow markings, crosswalk stripes, stop bars

ShapeEditor already supports OBB, polygon, polyline with full editing handles.

### DEM Elevation for Back-Projection

```typescript
const dem = ctx.getDem();
const elevation = dem?.getElevationClamped(worldX, worldZ) ?? 0;
```

### Coordinate System

Three.js Y-up: X = east, Y = elevation, Z = north (south-positive in world frame).  
BEV rasterizes X (east) and Z (north) axes; Y (elevation) comes from DEM on back-projection.

---

## Open Source References

### Tools & Libraries

| Tool | Purpose | Link |
|---|---|---|
| CSF | Ground filtering | https://github.com/jianboqi/CSF |
| PDAL | Point cloud processing pipeline | https://pdal.io |
| Open3D | RANSAC plane fitting, normal estimation | https://open3d.org |
| PCL | Segmentation, region growing | https://pointclouds.org |
| CloudCompare | Manual segmentation, CSF plugin | https://cloudcompare.org |
| CurbNet | Deep learning curb detector + dataset | https://github.com/guoyangzhao/CurbNet |
| Lanelet2 | HD map format (C++ library) | https://github.com/fzi-forschungszentrum-informatik/Lanelet2 |
| OpenHDMap | End-to-end HD map creation from LiDAR | https://github.com/daohu527/OpenHDMap |
| RandLA-Net | Large-scale point cloud semantic segmentation | https://github.com/QingyongHu/RandLA-Net |
| SemanticKITTI | Benchmark dataset (road class = 40) | https://semantic-kitti.org |
| VectorMapper | Autoware Lanelet2 map creation tool | (part of Autoware toolchain) |

### Key Papers

| Paper | Year | Relevance |
|---|---|---|
| Zhang et al. "Cloth Simulation Filter" | 2016 | CSF ground filtering algorithm |
| Mortensen & Barrett "Intelligent Scissors" | 1995/1998 | Live Wire algorithm basis |
| Hu et al. "RandLA-Net" (CVPR Oral) | 2020 | Large-scale semantic segmentation |
| Poggenhans et al. "Lanelet2" | 2018 | HD map format definition |
| "Scan Line Based Road Marking Extraction" | 2016 | Intensity-based marking detection |
| "CurbNet: Curb Detection Framework" | 2024 | arXiv:2403.16794 |
| "3D Road Boundary Extraction using ML" | 2024 | Sensors 24(2):503 |
| "LiDAR-based curb detection for annotation" | 2023 | arXiv:2312.00534, OpenLABEL output |
| "Road Markings Segmentation from LIDAR Reflectivity" | 2022 | arXiv:2211.01105 |
| "Intensity Thresholding and DL Lane Marking" | 2020 | MDPI Remote Sensing 12(9):1379 |

---

## ML/AI Notes (Future Phase)

For local inference in Electron:
- Use `onnxruntime-node` in a Node.js utility process
- Pre-trained models on **SemanticKITTI** classify: road (class 40), sidewalk (48), lane marking (49)
- **Caveat**: Post-SLAM static maps differ from moving-vehicle scan distribution — classical SMRF+HAG+intensity will likely outperform pre-trained ML for your data

If ML is pursued:
- **RandLA-Net**: Handles 1 M points per pass, CVPR 2020 Oral, ONNX-exportable
- **CurbNet**: Specific curb detector with released 3D-Curb dataset
- **InterPCSeg**: Interactive corrective-click segmentation refinement
- **Point-SAM**: SAM-style promptable 3D segmentation (research stage)

ONNX Runtime Node.js: https://onnxruntime.ai/docs/get-started/with-javascript/node.html
