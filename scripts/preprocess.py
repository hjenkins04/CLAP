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
import itertools
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import threading
import time

import laspy
import numpy as np
from scipy.ndimage import distance_transform_edt
from tqdm import tqdm

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

def _safe_extra_dims(point_format) -> list:
    """Return extra dimensions as a finite list.

    LasHeader.point_format.extra_dimensions from LasReader returns an infinite
    cycling generator — it never raises StopIteration. Guard by stopping as
    soon as we see a repeated name.
    """
    seen, dims = set(), []
    for dim in point_format.extra_dimensions:
        if dim.name in seen:
            break
        seen.add(dim.name)
        dims.append(dim)
    return dims


_BAR_OPTS = dict(
    unit=" pts",
    unit_scale=True,       # auto SI prefix: k, M, G (divisor=1000 by default)
    file=sys.stdout,       # stdout for consistent behaviour on Windows PowerShell
    dynamic_ncols=True,
    bar_format="{l_bar}{bar}| {n_fmt}/{total_fmt}  [{elapsed}<{remaining}, {rate_fmt}]",
)


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
    _CHUNK = 5_000_000  # points per streaming chunk (~180 MB at 36 bytes/pt)

    with laspy.LasReader(open(las_path, 'rb')) as reader:
        hdr = reader.header

        # ── Detect CRS ──────────────────────────────────────────────────
        wkt = None
        for vlr in hdr.vlrs:
            if hasattr(vlr, 'string') and vlr.record_id == 2112:
                wkt = vlr.string
                break

        utm_info = parse_utm_crs(wkt) if wkt else None
        crs_info = None

        if utm_info:
            zone, hemisphere, epsg = utm_info
            if fixed_origin:
                origin_x, origin_y = fixed_origin
                tqdm.write(f"  [crs] UTM Zone {zone}{hemisphere} (EPSG:{epsg})")
                tqdm.write(f"  [crs] Origin (fixed): easting={origin_x:.3f}, northing={origin_y:.3f}")
            else:
                origin_x = (hdr.mins[0] + hdr.maxs[0]) / 2.0
                origin_y = (hdr.mins[1] + hdr.maxs[1]) / 2.0
                tqdm.write(f"  [crs] UTM Zone {zone}{hemisphere} (EPSG:{epsg})")
                tqdm.write(f"  [crs] Origin: easting={origin_x:.1f}, northing={origin_y:.1f}")
            ref_lng, ref_lat = utm_to_lnglat(origin_x, origin_y, zone, hemisphere)
            tqdm.write(f"  [crs] Ref lat/lng: ({ref_lat:.7f}, {ref_lng:.7f})")
            crs_info = {
                'type': 'utm',
                'zone': zone,
                'hemisphere': hemisphere,
                'epsg': epsg,
                'origin': {'easting': origin_x, 'northing': origin_y, 'elevation': 0.0},
                'refLngLat': {'lng': ref_lng, 'lat': ref_lat},
            }
        else:
            if fixed_origin:
                origin_x, origin_y = fixed_origin
            else:
                origin_x = (hdr.mins[0] + hdr.maxs[0]) / 2.0
                origin_y = (hdr.mins[1] + hdr.maxs[1]) / 2.0
            if wkt:
                tqdm.write(f"  [crs] CRS present but not UTM — using local coordinates")
            else:
                tqdm.write(f"  [crs] No CRS found — using local coordinates")
            tqdm.write(f"  [crs] Centering at ({origin_x:.1f}, {origin_y:.1f})")

        # ── Build output header ──────────────────────────────────────────
        out_header = laspy.LasHeader(
            point_format=hdr.point_format.id,
            version=hdr.version,
        )
        for dim in _safe_extra_dims(hdr.point_format):
            out_header.add_extra_dim(laspy.ExtraBytesParams(
                name=dim.name, type=dim.dtype,
                description=dim.description or "",
            ))
        out_header.offsets = np.array([0.0, 0.0, 0.0])
        out_header.scales = hdr.scales

        total = hdr.point_count

        # ── Stream-transform in chunks (avoids loading full file into RAM) ──
        # Bar is created before LasWriter so it appears immediately
        with tqdm(total=total, desc="  Pre-transform", **_BAR_OPTS) as bar:
            with laspy.LasWriter(open(output_path, 'wb'), header=out_header) as writer:
                for chunk in reader.chunk_iterator(_CHUNK):
                    # Use decoded float coordinates (laspy lowercase accessors respect the
                    # input header's scale/offset). Using raw integer fields (chunk['X'] etc.)
                    # produces incorrect output when the output header has a different offset.
                    raw_x = np.asarray(chunk.x, dtype=np.float64)  # LAS X = Easting
                    raw_y = np.asarray(chunk.y, dtype=np.float64)  # LAS Y = Northing
                    raw_z = np.asarray(chunk.z, dtype=np.float64)  # LAS Z = Elevation

                    # Create output points using the output header's encoding.
                    # Axis swap + centering:
                    #   new X = East offset  → Three.js X
                    #   new Y = Elevation    → Three.js Y (up)
                    #   new Z = North offset → Three.js Z
                    out_pts = laspy.LasData(header=out_header)
                    out_pts.x = raw_x - origin_x
                    out_pts.y = raw_z
                    out_pts.z = raw_y - origin_y

                    # Copy every non-XYZ attribute from the input chunk
                    for dim_name in chunk.point_format.dimension_names:
                        if dim_name in ('X', 'Y', 'Z'):
                            continue
                        try:
                            out_pts[dim_name] = chunk[dim_name]
                        except Exception:
                            pass

                    writer.write_points(out_pts.points)
                    bar.update(len(chunk))

        tqdm.write(f"  [crs] Pre-transformed LAS written: {output_path}")
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

    _CHUNK = 5_000_000

    # Read first file header to establish output format
    with laspy.LasReader(open(files[0], 'rb')) as r0:
        hdr0 = r0.header
    out_header = laspy.LasHeader(
        point_format=hdr0.point_format.id,
        version=hdr0.version,
    )
    for dim in _safe_extra_dims(hdr0.point_format):
        out_header.add_extra_dim(laspy.ExtraBytesParams(
            name=dim.name, type=dim.dtype,
            description=dim.description or "",
        ))
    out_header.offsets = hdr0.offsets
    out_header.scales = hdr0.scales

    total = sum(laspy.LasReader(open(p, 'rb')).header.point_count for p in files)
    tqdm.write(f"      Total points: {total:,}")

    with tqdm(total=total, desc="  Merging", **_BAR_OPTS) as bar:
        with laspy.LasWriter(open(output_path, 'wb'), header=out_header) as writer:
            for path in files:
                bar.set_postfix(file=os.path.basename(path), refresh=False)
                with laspy.LasReader(open(path, 'rb')) as reader:
                    for chunk in reader.chunk_iterator(_CHUNK):
                        writer.write_points(chunk)
                        bar.update(len(chunk))

    tqdm.write(f"      Merged file: {output_path}")
    return output_path


# ---------------------------------------------------------------------------
# Step 2 — DEM via CSF ground classification
# ---------------------------------------------------------------------------

def _run_csf_with_progress(csf_obj, ground_indices, non_ground_indices, n_iterations: int) -> None:
    """Run CSF do_filtering() with a live tqdm progress bar.

    CSF is a C extension that:
      - Blocks the Python thread for the entire simulation
      - Prints directly to C's stdout (fd 1), bypassing sys.stdout / tqdm

    Strategy:
      1. Duplicate fd 1 → terminal_fd  (so we can keep writing to the terminal)
      2. Redirect fd 1 to a pipe's write end  (CSF's printf → pipe)
      3. Reader thread: consume the pipe, parse "[N] Simulating" lines → iter counter
      4. CSF thread: run do_filtering()
      5. Main thread: drive a tqdm bar from the iter counter, writing to terminal_fd
      6. After CSF finishes: restore fd 1, join threads, print captured config lines
    """
    # 1. Duplicate fd 1 so we can keep a direct path to the terminal
    terminal_fd = os.dup(1)
    terminal_file = os.fdopen(os.dup(terminal_fd), 'w', buffering=1)

    # 2. Pipe: CSF printf → fd 1 → pipe write end → reader thread
    r_fd, w_fd = os.pipe()
    os.dup2(w_fd, 1)   # redirect C stdout → pipe
    os.close(w_fd)     # fd 1 is now the only writer; close our extra ref

    # Redirect Python's sys.stdout too so print() / tqdm.write() reach the terminal
    old_sys_stdout = sys.stdout
    sys.stdout = terminal_file

    # 3. Reader thread: parse progress and capture non-iteration lines
    iter_progress = [0]
    config_lines: list[str] = []

    def _reader() -> None:
        with os.fdopen(r_fd, 'r', buffering=1, errors='replace') as pipe:
            for raw in pipe:
                line = raw.rstrip()
                m = re.match(r'^\[(\d+)\]\s+Simulating', line)
                if m:
                    iter_progress[0] = int(m.group(1)) + 1  # 1-based progress
                else:
                    config_lines.append(line)

    reader_thread = threading.Thread(target=_reader, daemon=True)
    reader_thread.start()

    # 4. CSF thread
    csf_exc: list[BaseException | None] = [None]

    def _run_csf() -> None:
        try:
            csf_obj.do_filtering(ground_indices, non_ground_indices)
        except BaseException as exc:
            csf_exc[0] = exc
        finally:
            # Flush C's internal buffers, then restore fd 1 → terminal.
            # Closing fd 1's pipe reference causes the reader to see EOF.
            try:
                import ctypes
                ctypes.cdll.msvcrt.fflush(ctypes.c_void_p(0))  # fflush(NULL)
            except Exception:
                pass
            os.dup2(terminal_fd, 1)
            os.close(terminal_fd)

    csf_thread = threading.Thread(target=_run_csf, daemon=True)
    csf_thread.start()

    # 5. Main thread drives tqdm, reading iter_progress updated by the reader
    with tqdm(total=n_iterations, desc="  CSF ground filter", unit=" itr",
              file=terminal_file, dynamic_ncols=True) as bar:
        last = 0
        while csf_thread.is_alive():
            time.sleep(0.1)
            cur = min(iter_progress[0], n_iterations)
            if cur > last:
                bar.update(cur - last)
                last = cur
        # Ensure bar reaches 100 % even if CSF stops early
        if last < n_iterations:
            bar.update(n_iterations - last)

    csf_thread.join()
    reader_thread.join()

    # 6. Restore Python's stdout, print captured config lines cleanly
    sys.stdout = old_sys_stdout
    terminal_file.close()

    for line in config_lines:
        if line:
            tqdm.write(f"      {line}")

    if csf_exc[0] is not None:
        raise csf_exc[0]


def generate_dem(las_path: str, output_path: str, cell_size: float = 1.0) -> None:
    """Generate a DEM JSON from a pre-transformed (Y-up) point cloud.

    Expects Three.js Y-up convention: X=east_offset, Y=elevation, Z=north_offset.
    DEM output axes: xMin/xMax = east (Three.js X), yMin/yMax = north (Three.js Z).
    """
    import CSF as csf_module

    print(f"[2/3] Generating DEM (cell_size={cell_size}m)...")
    t0 = time.time()

    # Stream-read with subsampling — DEM at 1m resolution doesn't need full density.
    # Target ~5M points max; CSF is memory/time intensive at higher counts.
    _CHUNK = 5_000_000
    east_parts, north_parts, elev_parts = [], [], []

    with laspy.LasReader(open(las_path, 'rb')) as reader:
        total = reader.header.point_count
        step = max(1, round(total / 5_000_000))

        with tqdm(total=total, desc="  Loading pts", **_BAR_OPTS) as bar:
            for chunk in reader.chunk_iterator(_CHUNK):
                idx = np.arange(0, len(chunk), step)
                east_parts.append(np.asarray(chunk.x, dtype=np.float64)[idx])
                north_parts.append(np.asarray(chunk.z, dtype=np.float64)[idx])
                elev_parts.append(np.asarray(chunk.y, dtype=np.float64)[idx])
                bar.update(len(chunk))

    east  = np.concatenate(east_parts)
    north = np.concatenate(north_parts)
    elev  = np.concatenate(elev_parts)

    if step > 1:
        tqdm.write(f"      Subsampled {step}x → {len(east):,} points for CSF")

    tqdm.write(f"      East  range: [{east.min():.1f}, {east.max():.1f}]")
    tqdm.write(f"      North range: [{north.min():.1f}, {north.max():.1f}]")
    tqdm.write(f"      Elev  range: [{elev.min():.1f}, {elev.max():.1f}]")

    points = np.column_stack((east, north, elev))

    _N_ITER = 500
    csf = csf_module.CSF()
    csf.params.bSloopSmooth = False
    csf.params.cloth_resolution = max(cell_size, 2.0)
    csf.params.rigidness = 1
    csf.params.time_step = 0.65
    csf.params.class_threshold = 0.5
    csf.params.interations = _N_ITER

    csf.setPointCloud(points)
    ground_indices = csf_module.VecInt()
    non_ground_indices = csf_module.VecInt()

    _run_csf_with_progress(csf, ground_indices, non_ground_indices, _N_ITER)

    ground_idx = np.array(ground_indices)
    tqdm.write(f"      Ground points: {len(ground_idx):,} ({100*len(ground_idx)/len(points):.1f}%)")

    ground = points[ground_idx]
    x_min, y_min = points[:, 0].min(), points[:, 1].min()
    x_max, y_max = points[:, 0].max(), points[:, 1].max()

    cols = int(np.ceil((x_max - x_min) / cell_size))
    rows = int(np.ceil((y_max - y_min) / cell_size))
    tqdm.write(f"      DEM grid: {cols}x{rows} cells")

    # Fast DEM: bin ground points into cells (O(n)), fill gaps with distance
    # transform nearest-neighbour (O(rows*cols)).  Replaces scipy griddata which
    # required Delaunay triangulation over millions of points (very slow).
    with tqdm(total=2, desc="  Building DEM", unit=" step", file=sys.stdout,
              dynamic_ncols=True,
              bar_format="{l_bar}{bar}| {n_fmt}/{total_fmt} steps  [{elapsed}]") as bar:

        # Step 1 — bin: mean elevation per cell
        gx = np.clip(np.floor((ground[:, 0] - x_min) / cell_size).astype(np.int32), 0, cols - 1)
        gy = np.clip(np.floor((ground[:, 1] - y_min) / cell_size).astype(np.int32), 0, rows - 1)

        sums   = np.zeros((rows, cols), dtype=np.float64)
        counts = np.zeros((rows, cols), dtype=np.int32)
        np.add.at(sums,   (gy, gx), ground[:, 2])
        np.add.at(counts, (gy, gx), 1)

        dem = np.full((rows, cols), np.nan)
        filled = counts > 0
        dem[filled] = sums[filled] / counts[filled]
        bar.update(1)

        # Step 2 — fill empty cells via nearest-neighbour distance transform
        n_empty = int((~filled).sum())
        if n_empty:
            tqdm.write(f"      Filling {n_empty:,} empty cells (nearest-neighbour)...")
            _, idx = distance_transform_edt(~filled, return_indices=True)
            dem[~filled] = dem[idx[0][~filled], idx[1][~filled]]
        bar.update(1)

    tqdm.write(f"      Elevation range: {np.nanmin(dem):.2f} to {np.nanmax(dem):.2f}")

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
    tqdm.write(f"      DEM written: {output_path} ({size_mb:.1f} MB)")
    tqdm.write(f"      DEM generation took {time.time()-t0:.1f}s")


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

    with laspy.LasReader(open(las_path, 'rb')) as reader:
        extra_dims = [dim.name for dim in _safe_extra_dims(reader.header.point_format)]
        all_dims = list(reader.header.point_format.dimension_names)
    tqdm.write(f"      Input attributes: {len(all_dims)} dimensions")
    if extra_dims:
        tqdm.write(f"      Extra dimensions: {', '.join(extra_dims)}")

    cmd = [POTREE_CONVERTER, las_path, "-o", output_dir, "--encoding", encoding]
    tqdm.write(f"      Running: {' '.join(cmd)}")
    t0 = time.time()

    # Stream PotreeConverter output line-by-line so progress is visible in real time
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, bufsize=1)
    with tqdm(desc="  PotreeConverter", unit=" lines", file=sys.stdout,
              dynamic_ncols=True, bar_format="{l_bar}{bar}| {elapsed}") as bar:
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                tqdm.write(f"      {line}")
            bar.update(1)
    proc.wait()

    if proc.returncode != 0:
        print(f"Error: PotreeConverter failed (exit code {proc.returncode})")
        sys.exit(1)

    tqdm.write(f"      Potree conversion took {time.time()-t0:.1f}s")

    metadata_path = os.path.join(output_dir, "metadata.json")
    if not os.path.isfile(metadata_path):
        print(f"Error: metadata.json not found in {output_dir}")
        sys.exit(1)

    with open(metadata_path) as f:
        meta = json.load(f)

    attrs = [a["name"] for a in meta.get("attributes", [])]
    tqdm.write(f"      Output attributes: {', '.join(attrs)}")
    tqdm.write(f"      Points: {meta.get('points', '?'):,}")

    # Verify all extra dims made it through to the octree
    if extra_dims:
        missing = [d for d in extra_dims if d not in attrs]
        if missing:
            print(f"\nError: extra dimension(s) not preserved in Potree output: {', '.join(missing)}")
            print(f"       Expected in metadata.json attributes: {', '.join(extra_dims)}")
            print(f"       Found: {', '.join(attrs)}")
            sys.exit(1)
        tqdm.write(f"      Extra dimensions verified: {', '.join(extra_dims)}")


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
