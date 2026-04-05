# CLAP Research Notes

Research and architecture documents for planned features.

## Documents

| File | Contents |
|---|---|
| [hd-map-feature-extraction.md](./hd-map-feature-extraction.md) | Full research + architecture plan for HD map road feature extraction (road boundaries, curbs, lane markings). Includes algorithms, pipeline, plugin structure, export formats, implementation inventory. |
| [codebase-architecture.md](./codebase-architecture.md) | Quick reference for existing CLAP systems: plugin API, point cloud data access, ShapeEditorEngine, ROI plugin, coordinate system, key file paths. |

## HD Map Feature Extraction — Quick Summary

**Goal**: Label road boundaries, curb lines, lane markings (solid/dashed, arrows, crosswalks, stop bars) from post-SLAM static LiDAR maps. Export to Lanelet2.

**Core approach**: BEV (Bird's Eye View) rasterization → 2D image processing → back-project to 3D.

**Build order**:
1. PDAL IPC bridge (ground classification + HAG via Python/PDAL)
2. BEV builder + plan view canvas
3. Otsu + connected components auto-detect
4. MBR classifier + review table
5. Live Wire interactive tool (Dijkstra on BEV)
6. Curb detection (cross-section + DBSCAN)
7. Lanelet2 OSM XML writer
8. Flood fill tool
