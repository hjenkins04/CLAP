#!/usr/bin/env python3
"""
CLAP Preprocessing Pipeline
============================
Converts .las/.laz files into the Potree format consumed by the CLAP viewer.

Pipeline steps:
  1. Merge multiple input LAS/LAZ files (if needed)
  2. Run CSF ground classification to generate a DEM (DTM)
     - Does NOT modify the point cloud's classification field
  3. Convert the point cloud to Potree 2.0 octree format
     - Preserves all standard + extra dimensions (ring, reflectivity, scan_id, etc.)
  4. Generate dem.json co-located with the Potree output

Usage:
  python preprocess.py <input_path> <output_name> [options]

  <input_path>  A single .las/.laz file, or a directory containing them
  <output_name> Name for the output (placed under public/pointclouds/<output_name>/)

Options:
  --cell-size FLOAT    DEM cell size in meters (default: 1.0)
  --skip-dem           Skip DEM generation
  --skip-potree        Skip Potree conversion (DEM only)
  --potree-encoding    BROTLI or UNCOMPRESSED (default: UNCOMPRESSED)

Examples:
  python preprocess.py /data/scan.laz my_scan
  python preprocess.py /data/tiles/ merged_tiles --cell-size 0.5
"""

import argparse
import glob
import json
import os
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
POTREE_CONVERTER = os.path.join(APP_DIR, "..", "PotreeConverter", "build", "PotreeConverter")
OUTPUT_BASE = os.path.join(APP_DIR, "public", "pointclouds")


def find_las_files(input_path: str) -> list[str]:
    """Find all .las/.laz files from the input path."""
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


# ---------------------------------------------------------------------------
# Step 1 — Merge
# ---------------------------------------------------------------------------

def merge_las_files(files: list[str], output_path: str) -> str:
    """Merge multiple LAS/LAZ files into a single LAS file.

    Returns the path to the (possibly merged) LAS file ready for processing.
    If there's only one input file, returns it directly (no copy).
    """
    if len(files) == 1:
        print(f"[1/3] Single input file — no merge needed")
        print(f"      {files[0]}")
        return files[0]

    print(f"[1/3] Merging {len(files)} files...")
    for f in files:
        print(f"      {os.path.basename(f)}")

    # Read the first file to get header info
    first = laspy.read(files[0])
    header = laspy.LasHeader(
        point_format=first.header.point_format,
        version=first.header.version,
    )
    # Copy extra dims from the first file
    for dim in first.point_format.extra_dimensions:
        header.add_extra_dim(laspy.ExtraBytesParams(
            name=dim.name,
            type=dim.dtype,
            description=dim.description or "",
        ))
    header.offsets = first.header.offsets
    header.scales = first.header.scales

    # Merge all points
    all_points = [first]
    for path in files[1:]:
        las = laspy.read(path)
        all_points.append(las)

    total = sum(len(f.points) for f in all_points)
    print(f"      Total points: {total:,}")

    # Write merged file
    writer = laspy.LasData(header)
    # Concatenate each dimension
    for dim_name in first.point_format.dimension_names:
        arrays = [f[dim_name] for f in all_points]
        writer[dim_name] = np.concatenate(arrays)

    writer.write(output_path)
    print(f"      Merged file: {output_path}")
    return output_path


# ---------------------------------------------------------------------------
# Step 2 — DEM via CSF ground classification
# ---------------------------------------------------------------------------

def generate_dem(las_path: str, output_path: str, cell_size: float = 1.0) -> None:
    """Generate a DEM JSON from the point cloud using CSF ground classification.

    The classification is used ONLY for DEM generation — the point cloud's
    classification attribute is not modified.
    """
    import CSF as csf_module

    print(f"[2/3] Generating DEM (cell_size={cell_size}m)...")
    t0 = time.time()

    # Read points
    las = laspy.read(las_path)
    points = np.column_stack((las.x, las.y, las.z)).astype(np.float64)
    print(f"      {len(points):,} points loaded")
    print(f"      XYZ range: [{points[:,0].min():.1f}, {points[:,1].min():.1f}, {points[:,2].min():.1f}]"
          f" to [{points[:,0].max():.1f}, {points[:,1].max():.1f}, {points[:,2].max():.1f}]")

    # CSF ground classification
    print(f"      Running CSF ground filter...")
    csf = csf_module.CSF()
    csf.params.bSloopSmooth = False
    csf.params.cloth_resolution = max(cell_size, 2.0)
    csf.params.rigidness = 1      # 1=mountain/complex, 2=relief, 3=flat
    csf.params.time_step = 0.65
    csf.params.class_threshold = 0.5
    csf.params.interations = 500

    csf.setPointCloud(points)
    ground_indices = csf_module.VecInt()
    non_ground_indices = csf_module.VecInt()
    csf.do_filtering(ground_indices, non_ground_indices)

    ground_idx = np.array(ground_indices)
    print(f"      Ground points: {len(ground_idx):,} ({100*len(ground_idx)/len(points):.1f}%)")

    # Build DEM grid
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
    dem = griddata(
        ground[:, :2], ground[:, 2],
        (grid_x, grid_y),
        method="linear",
        fill_value=np.nan,
    )

    nan_mask = np.isnan(dem)
    if nan_mask.any():
        print(f"      Filling {nan_mask.sum()} NaN cells (nearest-neighbor)...")
        dem_nn = griddata(
            ground[:, :2], ground[:, 2],
            (grid_x, grid_y),
            method="nearest",
        )
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

def convert_to_potree(
    las_path: str,
    output_dir: str,
    encoding: str = "UNCOMPRESSED",
) -> None:
    """Convert a LAS file to Potree 2.0 format, preserving all attributes."""
    print(f"[3/3] Converting to Potree format...")

    if not os.path.isfile(POTREE_CONVERTER):
        print(f"Error: PotreeConverter not found at {POTREE_CONVERTER}")
        print("Build it first: cd PotreeConverter && mkdir -p build && cd build && cmake .. && make -j")
        sys.exit(1)

    # Discover all attributes in the input file to pass to PotreeConverter
    las = laspy.read(las_path)
    # Standard LAS dimensions that PotreeConverter knows about
    known_standard = {
        "x", "y", "z", "intensity", "return_number", "number_of_returns",
        "classification", "scan_angle_rank", "scan_angle", "user_data",
        "point_source_id", "gps_time", "red", "green", "blue",
        "synthetic_key_point", "withheld", "overlap", "scanner_channel",
        "scan_direction_flag", "edge_of_flight_line", "infrared",
        "bit_byte_0", "bit_byte_1", "bit_byte_2",
    }

    extra_dims = []
    for dim in las.point_format.extra_dimensions:
        extra_dims.append(dim.name)

    all_dims = list(las.point_format.dimension_names)
    print(f"      Input attributes: {len(all_dims)} dimensions")
    if extra_dims:
        print(f"      Extra dimensions: {', '.join(extra_dims)}")

    las = None  # Free memory

    # Build PotreeConverter command
    cmd = [
        POTREE_CONVERTER,
        las_path,
        "-o", output_dir,
        "--encoding", encoding,
    ]

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

    # Print converter output
    if result.stdout:
        for line in result.stdout.strip().split("\n"):
            print(f"      {line}")

    elapsed = time.time() - t0
    print(f"      Potree conversion took {elapsed:.1f}s")

    # Verify output
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
    )
    parser.add_argument("input_path", help="Single .las/.laz file or directory containing them")
    parser.add_argument("output_name", help="Output name (placed under public/pointclouds/<name>/)")
    parser.add_argument("--cell-size", type=float, default=1.0, help="DEM cell size in meters (default: 1.0)")
    parser.add_argument("--skip-dem", action="store_true", help="Skip DEM generation")
    parser.add_argument("--skip-potree", action="store_true", help="Skip Potree conversion")
    parser.add_argument("--potree-encoding", default="UNCOMPRESSED", choices=["BROTLI", "UNCOMPRESSED"],
                        help="Potree encoding (default: UNCOMPRESSED)")

    args = parser.parse_args()

    output_dir = os.path.join(OUTPUT_BASE, args.output_name)
    os.makedirs(output_dir, exist_ok=True)

    print("=" * 60)
    print("CLAP Preprocessing Pipeline")
    print("=" * 60)
    print(f"Input:   {args.input_path}")
    print(f"Output:  {output_dir}")
    print()

    t_start = time.time()

    # Find input files
    las_files = find_las_files(args.input_path)

    # Step 1 — Merge if needed
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

    try:
        # Step 2 — DEM
        if not args.skip_dem:
            dem_path = os.path.join(output_dir, "dem.json")
            generate_dem(merged_path, dem_path, cell_size=args.cell_size)
        else:
            print("[2/3] Skipping DEM generation")
        print()

        # Step 3 — Potree conversion
        if not args.skip_potree:
            convert_to_potree(merged_path, output_dir, encoding=args.potree_encoding)
        else:
            print("[3/3] Skipping Potree conversion")
        print()

    finally:
        # Clean up temp merged file
        if cleanup_merged and merged_path and os.path.isfile(merged_path):
            os.remove(merged_path)
            print(f"Cleaned up temp file: {merged_path}")

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
