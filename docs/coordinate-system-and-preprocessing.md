# Coordinate System & LiDAR Preprocessing

This document covers how CLAP's coordinate system works, how to correctly convert
raw LAS/LAZ files for use in the viewer, and how the HD map overlay aligns with
point cloud data.

---

## Coordinate Conventions

### Raw LAS files (UTM Zone 18N)

LAS files from the KCity SLAM scanner use standard UTM axes:

| LAS axis | Meaning        | Example range (KCity) |
|----------|---------------|----------------------|
| X        | Easting (m)   | 378,631 – 379,238    |
| Y        | Northing (m)  | 4,901,776 – 4,902,554 |
| Z        | Elevation ASL (m) | -8.7 – 147.1     |

### Three.js scene (CLAP viewer)

The viewer uses a **Y-up, local ENU** coordinate system. All data must be
transformed before loading:

| Three.js axis | Meaning            | Formula from UTM LAS         |
|---------------|--------------------|------------------------------|
| X             | East offset (m)    | `LAS_X − origin_easting`     |
| Y             | Elevation (m, up)  | `LAS_Z` (no centering)       |
| Z             | North offset (m)   | `LAS_Y − origin_northing`    |

The critical axis swap is **Y ↔ Z**: Three.js Y is elevation (up), Three.js Z is
northing. Skipping this swap — e.g. by running PotreeConverter directly on a raw
LAS — produces a cloud that is rotated 90° with elevation going sideways.

### KCity UTM origin

All KCity datasets share a fixed local origin that must be used consistently
across the point cloud, DEM, and HD map:

```
Easting:   378923.0495  m  (UTM Zone 18N)
Northing:  4902337.3695 m  (UTM Zone 18N)
EPSG:      32618
Ref point: lat 44.2642083°, lon -76.5169180°
```

This origin is hard-coded in:
- `src/features/viewer/plugins/hd-map/projection.ts` — `UTM_ORIGIN_E`, `UTM_ORIGIN_N`
- `public/pointclouds/*/crs.json` — written by `preprocess.py`

If the point cloud and HD map use different origins they will drift apart.
For KCity the observed drift from using an auto-detected centroid instead of the
fixed origin was **~40 m East, ~130 m North**.

---

## The `preprocess.py` Pipeline

`scripts/preprocess.py` is the required conversion tool. Never run PotreeConverter
directly on a raw LAS file.

### What it does

1. **Merge** — optional, if multiple input tiles
2. **Pre-transform** — axis swap + centering to Three.js Y-up local ENU; writes
   a temporary transformed LAS
3. **Trajectory extraction** — pulls pose points (if `is_pose` / `scan_id`
   extra dims are present)
4. **DEM generation** — CSF ground filter → raster elevation grid → `dem.json`
5. **Potree conversion** — runs PotreeConverter on the transformed LAS
6. **crs.json** — written only when a UTM CRS is confirmed (via VLR or `--utm-zone`)
7. **origin.json** — always written; records the easting/northing origin used
8. **stats.json** — full verification summary (see below)

### Basic usage

```bash
cd C:\dev\CLAP

python scripts/preprocess.py <input.las> <output_name> \
  --origin-easting  378923.0495 \
  --origin-northing 4902337.3695 \
  --potree-converter "C:\dev\PotreeConverter\build\Release\PotreeConverter.exe"
```

Output is placed in `public/pointclouds/<output_name>/`.

### When the LAS file has no embedded CRS (no VLRs)

Some files (e.g. `kcity_world.las`, LAS 1.2 exported from SLAM) contain raw UTM
coordinates but have no OGC WKT VLR. Without VLRs, `preprocess.py` cannot detect
the UTM zone and will not write `crs.json`, causing HD map misalignment.

Use `--utm-zone` to force the zone:

```bash
python scripts/preprocess.py kcity_world.las kcity_world \
  --utm-zone 18 --utm-hemisphere N \
  --origin-easting  378923.0495 \
  --origin-northing 4902337.3695 \
  --potree-converter "C:\dev\PotreeConverter\build\Release\PotreeConverter.exe"
```

### KCity reference commands

**kcity_segmented** (GlobalMap_utm18n.las — classified scan, has CRS VLR):
```bash
python scripts/preprocess.py \
  "public/pointclouds/kcity_segmented/GlobalMap_utm18n.las" kcity_segmented \
  --origin-easting 378923.0495 --origin-northing 4902337.3695 \
  --potree-converter "C:\dev\PotreeConverter\build\Release\PotreeConverter.exe"
```

**kcity_world** (kcity_world.las — full unclassified world scan, no CRS VLR):
```bash
python scripts/preprocess.py \
  "C:\autodrive\LiDAR-Data\kcity\kcity_world.las" kcity_world \
  --utm-zone 18 --utm-hemisphere N \
  --origin-easting 378923.0495 --origin-northing 4902337.3695 \
  --potree-converter "C:\dev\PotreeConverter\build\Release\PotreeConverter.exe"
```

---

## Output Files

| File              | Purpose |
|-------------------|---------|
| `metadata.json`   | Potree octree descriptor; `boundingBox` is the *cubic padded* bbox, use the `position` attribute `min`/`max` for real data bounds |
| `octree.bin`      | Potree point data |
| `hierarchy.bin`   | Potree node hierarchy |
| `dem.json`        | Raster elevation grid; X=East, Y (field name) = North (Three.js Z), elevation = Three.js Y |
| `crs.json`        | UTM origin, EPSG code, ref lat/lon; consumed by the world-frame plugin and HD map plugin |
| `origin.json`     | `{ originX, originY }` — the easting/northing used for centering; pass to `--origin-easting/northing` to re-run any pipeline step consistently |
| `stats.json`      | Full verification summary (see below) |
| `trajectory.json` | Sensor pose trajectory (only if scan has `is_pose`/`scan_id` extra dims) |

---

## Verification — `stats.json`

Every run writes `stats.json` to the output directory. Key sections:

```jsonc
{
  "input": {
    "points": 9295215,
    "crs_vlr_present": true,          // false → --utm-zone required
    "raw_bounds": {
      "x": [378631.691, 379238.598],  // UTM Easting
      "y": [4901776.662, 4902554.913],// UTM Northing
      "z": [-8.711, 73.856]           // Elevation ASL
    }
  },
  "pretransform": {
    "origin_easting": 378923.0495,
    "origin_northing": 4902337.3695,
    "axis_mapping": {
      "three_js_X": "LAS_X - origin_easting  (East offset)",
      "three_js_Y": "LAS_Z                   (Elevation, up)",
      "three_js_Z": "LAS_Y - origin_northing (North offset)"
    }
  },
  "crs": {
    "written": true,
    "epsg": 32618,
    "zone": "18N"
  },
  "potree": {
    "three_js_bounds": {
      "X_east_m":  [-291.359, 315.548],
      "Y_elev_m":  [-8.711,   73.856],   // must be <500m range
      "Z_north_m": [-560.708, 217.543]
    },
    "sanity_checks": {
      "Y_is_elevation":         { "ok": true },  // FAIL = axes swapped
      "Z_is_northing":          { "ok": true },
      "offset_not_absolute_utm":{ "ok": true }   // FAIL = PotreeConverter ran on raw UTM
    }
  },
  "alignment_check": {
    "hd_map_alignment": {
      "aligned": true,                  // false = point cloud will drift from HD map
      "delta_easting_m":  0.0,
      "delta_northing_m": 0.0
    }
  }
}
```

All four sanity checks must be `"ok": true` and `"aligned": true` before loading
in CLAP.

---

## HD Map Plugin

The HD map overlay (`src/features/viewer/plugins/hd-map/`) renders GM DMP files
(LXSX lane cross-sections, RSGX road objects and signs) on top of the point cloud.

### Coordinate flow

```
DMP WGS84 (lat, lon, elevation_ASL)
        ↓ wgs84ToUtm18N()
UTM Zone 18N (easting, northing)
        ↓ subtract fixed origin
Three.js local (X = E − 378923.0495,
                Y = elevation − elevOffset,
                Z = N − 4902337.3695)
```

The elevation offset (`elevOffset`) is auto-detected at load time by:
1. Sampling 30 LXSX edge points
2. Querying `DemTerrain.getElevation(x, z)` at each XZ position
3. Computing `mean(dmp_elevation_ASL − dem_Y)` → offset ≈ 51.3 m for KCity
4. Falls back to 51.3 m if no DEM is loaded

### DMP source files

```
C:\dev\ldm_pkg\lsm_maps\gm_hd_maps\CAN_ONTARIO\
  CAN_ONTARIO_0..14.lxsx   — lane cross-sections
  CAN_ONTARIO_0..14.rsgx   — road objects + signs
  CAN_ONTARIO.risx          — intersection index
  CAN_ONTARIO_0..14.fasx   — quality flags
```

Files are copied to `public/hdmaps/kcity/` and fetched at runtime via
`electronFetch`.

### GeoJSON export (for QGIS)

```bash
python scripts/dmp_to_geojson.py \
  "C:\dev\ldm_pkg\lsm_maps\gm_hd_maps\CAN_ONTARIO" \
  "scripts/output/kcity_dmp"
```

Outputs (all WGS84 `[lon, lat, elevation]`):

| File | Features | Source |
|------|----------|--------|
| `CAN_ONTARIO_lane_edges.geojson`    | 178 LineStrings | LXSX left/right curbs |
| `CAN_ONTARIO_lane_markers.geojson`  | 188 LineStrings | LXSX lane markings    |
| `CAN_ONTARIO_lane_interior.geojson` |  99 LineStrings | LXSX per-lane centers |
| `CAN_ONTARIO_road_objects.geojson`  |  47 Polygons    | RSGX stop bars, crosswalks |
| `CAN_ONTARIO_signs.geojson`         |  18 Points      | RSGX traffic lights, stop signs |
| `CAN_ONTARIO_intersections.geojson` |   8 Points      | RISX intersection centroids |
| `CAN_ONTARIO_quality_flags.json`    |  89 records     | FASX (join by `segment_id`) |

---

## Known Issues & Pitfalls

### Absolute UTM LAS with no CRS VLRs

`kcity_world.las` (LAS 1.2) has raw UTM coordinates but zero VLRs. Without
`--utm-zone 18`, preprocess.py falls to the "no CRS" path: uses the bounding box
centroid as origin, writes no `crs.json`, and the HD map (which uses the hard-coded
origin) drifts ~40 m E / ~130 m N from the point cloud.

**Fix:** always pass `--utm-zone 18 --utm-hemisphere N` for this file.

### PotreeConverter cubic bounding box

PotreeConverter pads all three octree axes to equal length (the largest extent).
The `boundingBox` in `metadata.json` is this padded cubic box, **not** the actual
data bounds. The `position` attribute `min`/`max` inside `attributes[]` is the
real point data range and must be used for sanity checks.

For example, kcity_segmented has a true Y elevation range of 82 m (-8.7 to 73.9 m)
but `boundingBox.max[1]` shows 769.5 m (padded to match the 778 m E-W extent).

### Elevation datum differs between datasets

- `kcity_segmented` (GlobalMap_utm18n.las): Z range in original LAS is -8.7 to
  +73.9 m (elevation relative to a local datum), so Three.js Y ≈ 0 at road level.
- `kcity_world` (kcity_world.las): Z range 33.6 – 147.1 m (absolute ASL), so
  Three.js Y ≈ 80–90 m at road level.

Both are horizontally aligned (same XZ origin) but their vertical datums differ.
Load only one at a time, or adjust the point cloud transform in the viewer.

### SLAM drift vs DMP accuracy

| Dataset       | Horizontal accuracy | Notes |
|---------------|--------------------|-|
| GM DMP (Ushr) | ~5–10 cm           | GPS ground truth |
| KCity LiDAR   | ±0.5–2 m           | SLAM accumulation error |
| OSM           | ~0.5 m (eyeballed) | Registered to the drifted SLAM cloud |

The HD map is the authoritative ground truth. If the overlay looks slightly off
after alignment, the discrepancy is real SLAM drift in the point cloud, not a
coordinate system error.
