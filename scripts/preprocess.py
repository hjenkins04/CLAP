#!/usr/bin/env python3
"""
CLAP Preprocessing Pipeline
============================
Converts .las/.laz files into the Potree format consumed by the CLAP viewer.

Pipeline steps:
  1. Merge multiple input LAS/LAZ files (if needed)
  2. Pre-transform coordinates to Three.js Y-up local ENU
     - UTM CRS: centers at UTM centroid, writes crs.json for geo world-frame auto-setup
     - Any other / no CRS: centers at point-cloud centroid, local coordinates only
  3. Run CSF ground classification to generate a DEM (DTM)
  4. Convert the point cloud to Potree 2.0 octree format

Usage:
  python preprocess.py <input_path> <output_name> [options]

  <input_path>  A single .las/.laz file, or a directory containing them
  <output_name> Name for the output (placed under public/pointclouds/<output_name>/)

Options:
  --cell-size FLOAT        DEM cell size in meters (default: 1.0)
  --skip-dem               Skip DEM generation
  --skip-potree            Skip Potree conversion (DEM only)
  --potree-encoding        BROTLI or UNCOMPRESSED (default: UNCOMPRESSED)
  --potree-converter PATH  Path to PotreeConverter executable
                           (overrides CLAP_POTREE_CONVERTER env var and default)

Examples:
  python preprocess.py /data/scan.laz my_scan
  python preprocess.py /data/tiles/ merged_tiles --cell-size 0.5
  python preprocess.py scan.las out --potree-converter /opt/PotreeConverter/PotreeConverter
"""

import argparse
import glob
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time

import laspy
import numpy as np
from scipy.interpolate import griddata

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(SCRIPT_DIR)
OUTPUT_BASE = os.path.join(APP_DIR, "public", "pointclouds")

# PotreeConverter resolution order:
#   1. --potree-converter CLI arg  (resolved in main)
#   2. CLAP_POTREE_CONVERTER env var
#   3. Sibling repo default (Windows build)
_DEFAULT_POTREE_CONVERTER = os.path.join(
    APP_DIR, "..", "PotreeConverter", "build", "Release", "PotreeConverter.exe"
)
POTREE_CONVERTER = os.environ.get("CLAP_POTREE_CONVERTER", _DEFAULT_POTREE_CONVERTER)


# ---------------------------------------------------------------------------
# UTM CRS detection
# ---------------------------------------------------------------------------

def parse_utm_crs(wkt: str) -> tuple[int, str, int] | None:
    """Parse UTM zone, hemisphere, EPSG from a WKT CRS string.

    Returns (zone, hemisphere, epsg) or None if not a UTM CRS.
    """
    # Primary: EPSG authority tag
    m = re.search(r'AUTHORITY\["EPSG","(32[67]\d{2})"\]', wkt)
    if m:
        epsg = int(m.group(1))
        if 32601 <= epsg <= 32660:
            return epsg - 32600, 'N', epsg
        if 32701 <= epsg <= 32760:
            return epsg - 32700, 'S', epsg
    # Fallback: text match
    m = re.search(r'UTM\s+zone\s+(\d+)([NS])', wkt, re.IGNORECASE)
    if m:
        zone = int(m.group(1))
        hemi = m.group(2).upper()
        epsg = 32600 + zone if hemi == 'N' else 32700 + zone
        return zone, hemi, epsg
    return None


def utm_to_lnglat(easting: float, northing: float, zone: int, hemisphere: str) -> tuple[float, float]:
    """Convert UTM easting/northing to WGS84 (longitude, latitude) in degrees."""
    k0 = 0.9996
    a = 6378137.0
    e2 = 0.00669437999014
    e_prime2 = e2 / (1.0 - e2)

    x = easting - 500000.0
    y = northing - (10_000_000.0 if hemisphere.upper() == 'S' else 0.0)

    m = y / k0
    mu = m / (a * (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256))

    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    phi1 = (mu
            + (3 * e1 / 2 - 27 * e1**3 / 32) * math.sin(2 * mu)
            + (21 * e1**2 / 16 - 55 * e1**4 / 32) * math.sin(4 * mu)
            + (151 * e1**3 / 96) * math.sin(6 * mu)
            + (1097 * e1**4 / 512) * math.sin(8 * mu))

    n1 = a / math.sqrt(1 - e2 * math.sin(phi1)**2)
    t1 = math.tan(phi1)**2
    c1 = e_prime2 * math.cos(phi1)**2
    r1 = a * (1 - e2) / (1 - e2 * math.sin(phi1)**2) ** 1.5
    d = x / (n1 * k0)

    lat_rad = phi1 - (n1 * math.tan(phi1) / r1) * (
        d**2 / 2
        - (5 + 3 * t1 + 10 * c1 - 4 * c1**2 - 9 * e_prime2) * d**4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1**2 - 252 * e_prime2 - 3 * c1**2) * d**6 / 720
    )
    lng_rad = (
        d
        - (1 + 2 * t1 + c1) * d**3 / 6
        + (5 - 2 * c1 + 28 * t1 - 3 * c1**2 + 8 * e_prime2 + 24 * t1**2) * d**5 / 120
    ) / math.cos(phi1)

    central_meridian = math.radians((zone - 1) * 6 - 180 + 3)
    return math.degrees(central_meridian + lng_rad), math.degrees(lat_rad)


# ---------------------------------------------------------------------------
# Step 0 — Pre-transform to Three.js Y-up local ENU
# ---------------------------------------------------------------------------

def pretransform_las(las_path: str, output_path: str,
                     fixed_origin: tuple[float, float] | None = None) -> dict | None:
    """Center the point cloud and reorder axes to Three.js Y-up convention.

    Regardless of CRS, the output LAS always uses:
      new X = original X - origin_x   (east/local offset)
      new Y = original Z               (elevation → Three.js up)
      new Z = original Y - origin_y   (north/local offset → Three.js Z)

    For UTM CRS: origin is the UTM centroid, and a crs_info dict is returned
    so the viewer can auto-configure the geo world frame.

    For any other CRS (or none): origin is the point-cloud centroid in its
    native XY plane; no geo reference is available, so None is returned.
    The viewer will load the cloud in local coordinates without a world frame.

    Returns crs_info dict (UTM only) or None (local / unknown CRS).
    """
    las = laspy.read(las_path)

    # ── Detect CRS ──────────────────────────────────────────────────────
    wkt = None
    for vlr in las.vlrs:
        if hasattr(vlr, 'string') and vlr.record_id == 2112:
            wkt = vlr.string
            break

    utm_info = parse_utm_crs(wkt) if wkt else None
    crs_info = None

    if utm_info:
        zone, hemisphere, epsg = utm_info
        if fixed_origin:
            origin_x, origin_y = fixed_origin
            print(f"  [crs] UTM Zone {zone}{hemisphere} (EPSG:{epsg})")
            print(f"  [crs] Origin (fixed): easting={origin_x:.3f}, northing={origin_y:.3f}")
        else:
            origin_x = (las.header.mins[0] + las.header.maxs[0]) / 2.0
            origin_y = (las.header.mins[1] + las.header.maxs[1]) / 2.0
            print(f"  [crs] UTM Zone {zone}{hemisphere} (EPSG:{epsg})")
            print(f"  [crs] Origin: easting={origin_x:.1f}, northing={origin_y:.1f}")
        ref_lng, ref_lat = utm_to_lnglat(origin_x, origin_y, zone, hemisphere)
        print(f"  [crs] Ref lat/lng: ({ref_lat:.7f}, {ref_lng:.7f})")
        crs_info = {
            'type': 'utm',
            'zone': zone,
            'hemisphere': hemisphere,
            'epsg': epsg,
            'origin': {'easting': origin_x, 'northing': origin_y, 'elevation': 0.0},
            'refLngLat': {'lng': ref_lng, 'lat': ref_lat},
        }
    else:
        # No UTM — still center the cloud in its native XY frame
        if fixed_origin:
            origin_x, origin_y = fixed_origin
        else:
            origin_x = (las.header.mins[0] + las.header.maxs[0]) / 2.0
            origin_y = (las.header.mins[1] + las.header.maxs[1]) / 2.0
        if wkt:
            print(f"  [crs] CRS present but not UTM — using local coordinates")
        else:
            print(f"  [crs] No CRS found — using local coordinates")
        print(f"  [crs] Centering at ({origin_x:.1f}, {origin_y:.1f})")

    # ── Write pre-transformed LAS ────────────────────────────────────────
    header = laspy.LasHeader(
        point_format=las.header.point_format,
        version=las.header.version,
    )
    for dim in las.point_format.extra_dimensions:
        header.add_extra_dim(laspy.ExtraBytesParams(
            name=dim.name, type=dim.dtype,
            description=dim.description or "",
        ))
    header.offsets = np.array([0.0, 0.0, 0.0])
    header.scales = las.header.scales

    new_las = laspy.LasData(header)

    raw_x = np.asarray(las.x, dtype=np.float64)
    raw_y = np.asarray(las.y, dtype=np.float64)
    raw_z = np.asarray(las.z, dtype=np.float64)

    # X=east_offset, Y=elevation (up), Z=north_offset
    new_las.x = raw_x - origin_x
    new_las.y = raw_z
    new_las.z = raw_y - origin_y

    for dim_name in las.point_format.dimension_names:
        if dim_name.lower() in ('x', 'y', 'z'):
            continue
        new_las[dim_name] = las[dim_name]

    new_las.write(output_path)
    print(f"  [crs] Pre-transformed LAS written: {output_path}")

    return crs_info


# ---------------------------------------------------------------------------
# Step 1 — Find / Merge
# ---------------------------------------------------------------------------

def find_las_files(input_path: str) -> list[str]:
    if os.path.isfile(input_path):
        ext = os.path.splitext(input_path)[1].lower()
        if ext not in (".las", ".laz"):
            print(f"Error: {input_path} is not a .las or .laz file")
            sys.exit(1)
        return [input_path]

    if os.path.isdir(input_path):
        files = sorted(
            glob.glob(os.path.join(input_path, "**", "*.las"), recursive=True)
            + glob.glob(os.path.join(input_path, "**", "*.laz"), recursive=True)
        )
        if not files:
            print(f"Error: no .las/.laz files found in {input_path}")
            sys.exit(1)
        return files

    print(f"Error: {input_path} does not exist")
    sys.exit(1)


def merge_las_files(files: list[str], output_path: str) -> str:
    if len(files) == 1:
        print(f"[1/3] Single input file — no merge needed")
        print(f"      {files[0]}")
        return files[0]

    print(f"[1/3] Merging {len(files)} files...")
    for f in files:
        print(f"      {os.path.basename(f)}")

    first = laspy.read(files[0])
    header = laspy.LasHeader(
        point_format=first.header.point_format,
        version=first.header.version,
    )
    for dim in first.point_format.extra_dimensions:
        header.add_extra_dim(laspy.ExtraBytesParams(
            name=dim.name, type=dim.dtype,
            description=dim.description or "",
        ))
    header.offsets = first.header.offsets
    header.scales = first.header.scales

    all_las = [first]
    for path in files[1:]:
        all_las.append(laspy.read(path))

    total = sum(len(f.points) for f in all_las)
    print(f"      Total points: {total:,}")

    writer = laspy.LasData(header)
    for dim_name in first.point_format.dimension_names:
        writer[dim_name] = np.concatenate([f[dim_name] for f in all_las])

    writer.write(output_path)
    print(f"      Merged file: {output_path}")
    return output_path


# ---------------------------------------------------------------------------
# Step 2 — DEM via CSF ground classification
# ---------------------------------------------------------------------------

def generate_dem(las_path: str, output_path: str, cell_size: float = 1.0) -> None:
    """Generate a DEM JSON from a pre-transformed (Y-up) point cloud.

    Expects Three.js Y-up convention: X=east_offset, Y=elevation, Z=north_offset.
    DEM output axes: xMin/xMax = east (Three.js X), yMin/yMax = north (Three.js Z).
    """
    import CSF as csf_module

    print(f"[2/3] Generating DEM (cell_size={cell_size}m)...")
    t0 = time.time()

    las = laspy.read(las_path)
    # Y-up: X=east, Y=elevation, Z=north → CSF needs (east, north, elev)
    east  = np.asarray(las.x, dtype=np.float64)
    north = np.asarray(las.z, dtype=np.float64)
    elev  = np.asarray(las.y, dtype=np.float64)

    points = np.column_stack((east, north, elev))
    print(f"      {len(points):,} points loaded")
    print(f"      East  range: [{east.min():.1f}, {east.max():.1f}]")
    print(f"      North range: [{north.min():.1f}, {north.max():.1f}]")
    print(f"      Elev  range: [{elev.min():.1f}, {elev.max():.1f}]")

    print(f"      Running CSF ground filter...")
    csf = csf_module.CSF()
    csf.params.bSloopSmooth = False
    csf.params.cloth_resolution = max(cell_size, 2.0)
    csf.params.rigidness = 1
    csf.params.time_step = 0.65
    csf.params.class_threshold = 0.5
    csf.params.interations = 500

    csf.setPointCloud(points)
    ground_indices = csf_module.VecInt()
    non_ground_indices = csf_module.VecInt()
    csf.do_filtering(ground_indices, non_ground_indices)

    ground_idx = np.array(ground_indices)
    print(f"      Ground points: {len(ground_idx):,} ({100*len(ground_idx)/len(points):.1f}%)")

    ground = points[ground_idx]
    x_min, y_min = points[:, 0].min(), points[:, 1].min()
    x_max, y_max = points[:, 0].max(), points[:, 1].max()

    cols = int(np.ceil((x_max - x_min) / cell_size))
    rows = int(np.ceil((y_max - y_min) / cell_size))
    print(f"      DEM grid: {cols}x{rows} cells")

    xi = np.linspace(x_min + cell_size / 2, x_min + (cols - 0.5) * cell_size, cols)
    yi = np.linspace(y_min + cell_size / 2, y_min + (rows - 0.5) * cell_size, rows)
    grid_x, grid_y = np.meshgrid(xi, yi)

    print(f"      Interpolating elevations...")
    dem = griddata(ground[:, :2], ground[:, 2], (grid_x, grid_y), method="linear", fill_value=np.nan)

    nan_mask = np.isnan(dem)
    if nan_mask.any():
        print(f"      Filling {nan_mask.sum()} NaN cells (nearest-neighbor)...")
        dem_nn = griddata(ground[:, :2], ground[:, 2], (grid_x, grid_y), method="nearest")
        dem[nan_mask] = dem_nn[nan_mask]

    print(f"      Elevation range: {np.nanmin(dem):.2f} to {np.nanmax(dem):.2f}")

    dem_data = {
        "xMin": float(x_min),
        "yMin": float(y_min),
        "xMax": float(x_max),
        "yMax": float(y_max),
        "cellSize": float(cell_size),
        "cols": int(cols),
        "rows": int(rows),
        "elevation": dem.tolist(),
    }

    with open(output_path, "w") as f:
        json.dump(dem_data, f)

    size_mb = os.path.getsize(output_path) / 1024 / 1024
    print(f"      DEM written: {output_path} ({size_mb:.1f} MB)")
    print(f"      DEM generation took {time.time()-t0:.1f}s")


# ---------------------------------------------------------------------------
# Step 3 — Potree conversion
# ---------------------------------------------------------------------------

def convert_to_potree(las_path: str, output_dir: str, encoding: str = "UNCOMPRESSED") -> None:
    print(f"[3/3] Converting to Potree format...")

    if not os.path.isfile(POTREE_CONVERTER):
        print(f"Error: PotreeConverter not found at {POTREE_CONVERTER}")
        print("Options:")
        print("  1. Set CLAP_POTREE_CONVERTER env var to the executable path")
        print("  2. Pass --potree-converter <path> on the command line")
        print("  3. Build it: cd ../PotreeConverter && mkdir build && cd build && cmake .. && cmake --build . --config Release")
        sys.exit(1)

    las = laspy.read(las_path)
    extra_dims = [dim.name for dim in las.point_format.extra_dimensions]
    all_dims = list(las.point_format.dimension_names)
    print(f"      Input attributes: {len(all_dims)} dimensions")
    if extra_dims:
        print(f"      Extra dimensions: {', '.join(extra_dims)}")
    las = None  # free memory

    cmd = [POTREE_CONVERTER, las_path, "-o", output_dir, "--encoding", encoding]
    print(f"      Running: {' '.join(cmd)}")
    t0 = time.time()

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error: PotreeConverter failed (exit code {result.returncode})")
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr)
        sys.exit(1)

    if result.stdout:
        for line in result.stdout.strip().split("\n"):
            print(f"      {line}")

    print(f"      Potree conversion took {time.time()-t0:.1f}s")

    metadata_path = os.path.join(output_dir, "metadata.json")
    if not os.path.isfile(metadata_path):
        print(f"Error: metadata.json not found in {output_dir}")
        sys.exit(1)

    with open(metadata_path) as f:
        meta = json.load(f)

    attrs = [a["name"] for a in meta.get("attributes", [])]
    print(f"      Output attributes: {', '.join(attrs)}")
    print(f"      Points: {meta.get('points', '?'):,}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="CLAP Preprocessing Pipeline — convert LAS/LAZ to Potree + DEM",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("input_path", help="Single .las/.laz file or directory containing them")
    parser.add_argument("output_name", help="Output name (placed under public/pointclouds/<name>/)")
    parser.add_argument("--cell-size", type=float, default=1.0, help="DEM cell size in meters (default: 1.0)")
    parser.add_argument("--skip-dem", action="store_true", help="Skip DEM generation")
    parser.add_argument("--skip-potree", action="store_true", help="Skip Potree conversion")
    parser.add_argument("--potree-encoding", default="UNCOMPRESSED", choices=["BROTLI", "UNCOMPRESSED"])
    parser.add_argument("--origin-easting", type=float, default=None,
                        help="Fix the UTM easting origin instead of using the cloud centroid")
    parser.add_argument("--origin-northing", type=float, default=None,
                        help="Fix the UTM northing origin instead of using the cloud centroid")
    parser.add_argument(
        "--potree-converter",
        default=None,
        help="Path to PotreeConverter executable (overrides CLAP_POTREE_CONVERTER env var)",
    )

    args = parser.parse_args()

    # Allow CLI arg to override env var / default
    if args.potree_converter:
        global POTREE_CONVERTER
        POTREE_CONVERTER = args.potree_converter

    output_dir = os.path.join(OUTPUT_BASE, args.output_name)
    os.makedirs(output_dir, exist_ok=True)

    print("=" * 60)
    print("CLAP Preprocessing Pipeline")
    print("=" * 60)
    print(f"Input:   {args.input_path}")
    print(f"Output:  {output_dir}")
    print()

    t_start = time.time()

    # Step 1 — Find / Merge
    las_files = find_las_files(args.input_path)

    merged_path = None
    cleanup_merged = False
    if len(las_files) > 1:
        merged_path = os.path.join(tempfile.gettempdir(), "clap_merged.las")
        merge_las_files(las_files, merged_path)
        cleanup_merged = True
    else:
        merged_path = las_files[0]
        print(f"[1/3] Single input file — no merge needed")
        print(f"      {merged_path}")
    print()

    # Pre-transform: always center and reorder axes to Three.js Y-up.
    # Returns crs_info dict if UTM CRS detected (enables geo world frame), else None.
    print("Pre-processing: transforming to Three.js Y-up local ENU...")
    pretransformed_path = os.path.join(tempfile.gettempdir(), "clap_pretransformed.las")
    fixed_origin = None
    if args.origin_easting is not None and args.origin_northing is not None:
        fixed_origin = (args.origin_easting, args.origin_northing)
    crs_info = pretransform_las(merged_path, pretransformed_path, fixed_origin=fixed_origin)
    work_path = pretransformed_path
    if crs_info:
        print(f"  UTM detected — crs.json will be written for geo world frame auto-setup")
    else:
        print(f"  No geo reference — cloud will load in local coordinates (world frame must be set manually)")
    print()

    try:
        # Step 2 — DEM
        if not args.skip_dem:
            dem_path = os.path.join(output_dir, "dem.json")
            generate_dem(work_path, dem_path, cell_size=args.cell_size)
        else:
            print("[2/3] Skipping DEM generation")
        print()

        # Step 3 — Potree conversion
        if not args.skip_potree:
            convert_to_potree(work_path, output_dir, encoding=args.potree_encoding)
        else:
            print("[3/3] Skipping Potree conversion")
        print()

        # Write crs.json for UTM files so the viewer auto-configures the world frame
        if crs_info:
            crs_path = os.path.join(output_dir, "crs.json")
            with open(crs_path, "w") as f:
                json.dump(crs_info, f, indent=2)
            print(f"CRS written:    {crs_path}")

    finally:
        if cleanup_merged and merged_path and os.path.isfile(merged_path):
            os.remove(merged_path)
        if os.path.isfile(pretransformed_path):
            os.remove(pretransformed_path)

    elapsed = time.time() - t_start
    print("=" * 60)
    print(f"Done! Total time: {elapsed:.1f}s")
    print(f"Output: {output_dir}")
    print()
    print(f"To load in CLAP viewer, set the point cloud path to:")
    print(f"  /pointclouds/{args.output_name}/")
    print("=" * 60)


if __name__ == "__main__":
    main()
