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
  --skip-trajectory        Skip trajectory.json extraction
  --potree-encoding        BROTLI or UNCOMPRESSED (default: UNCOMPRESSED)
  --potree-converter PATH  Path to PotreeConverter executable
                           (overrides CLAP_POTREE_CONVERTER env var and default)
  --origin-easting FLOAT   Fix UTM easting origin (use value from origin.json of existing run)
  --origin-northing FLOAT  Fix UTM northing origin (use value from origin.json of existing run)

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
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ProcessPoolExecutor

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
                     fixed_origin: tuple[float, float] | None = None,
                     forced_utm: tuple[int, str] | None = None,
                     quiet: bool = False) -> tuple[dict | None, tuple[float, float]]:
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

    Args:
        forced_utm: (zone, hemisphere) to use when the LAS file has no embedded
                    CRS but you know it is UTM (e.g. kcity_world.las has raw
                    UTM18N coords but no VLRs). Overrides VLR detection.

    Returns (crs_info dict or None, (origin_x, origin_y)).
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

        # If the caller explicitly specified a UTM zone (for LAS files that have
        # raw UTM coords but no embedded CRS VLRs), use that instead.
        if utm_info is None and forced_utm is not None:
            zone, hemisphere = forced_utm
            epsg = 32600 + zone if hemisphere.upper() == 'N' else 32700 + zone
            utm_info = (zone, hemisphere.upper(), epsg)
            if not quiet:
                tqdm.write(f"  [crs] UTM zone forced via --utm-zone/--utm-hemisphere")

        crs_info = None

        if utm_info:
            zone, hemisphere, epsg = utm_info
            if fixed_origin:
                origin_x, origin_y = fixed_origin
                if not quiet:
                    tqdm.write(f"  [crs] UTM Zone {zone}{hemisphere} (EPSG:{epsg})")
                    tqdm.write(f"  [crs] Origin (fixed): easting={origin_x:.3f}, northing={origin_y:.3f}")
            else:
                origin_x = (hdr.mins[0] + hdr.maxs[0]) / 2.0
                origin_y = (hdr.mins[1] + hdr.maxs[1]) / 2.0
                if not quiet:
                    tqdm.write(f"  [crs] UTM Zone {zone}{hemisphere} (EPSG:{epsg})")
                    tqdm.write(f"  [crs] Origin: easting={origin_x:.1f}, northing={origin_y:.1f}")
            ref_lng, ref_lat = utm_to_lnglat(origin_x, origin_y, zone, hemisphere)
            if not quiet:
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
            if not quiet:
                if wkt:
                    tqdm.write(f"  [crs] CRS present but not UTM - using local coordinates")
                else:
                    tqdm.write(f"  [crs] No CRS found - using local coordinates")
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
        with tqdm(total=total, desc="  Pre-transform", disable=quiet, **_BAR_OPTS) as bar:
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

        if not quiet:
            tqdm.write(f"  [crs] Pre-transformed LAS written: {output_path}")
        return crs_info, (origin_x, origin_y)


# ---------------------------------------------------------------------------
# Batch mode helpers — shared-origin planning and parallel per-tile pretransform
# ---------------------------------------------------------------------------

def plan_shared_origin(
    files: list[str],
    forced_utm: tuple[int, str] | None,
    fixed_origin: tuple[float, float] | None = None,
) -> tuple[dict | None, tuple[float, float]]:
    """Scan headers of all tiles, compute a shared UTM origin and CRS info.

    The shared origin is the center of the union bbox across all tiles, so
    every tile — pretransformed against this origin — ends up in a single
    consistent local ENU frame. CRS is taken from the first tile that has a
    WKT VLR, or from forced_utm if none does.

    When fixed_origin is given, that is used instead of the computed centroid
    (still pairs it with the detected CRS).

    Returns (crs_info or None, (origin_easting, origin_northing)).
    """
    # CRS detection: first tile with a WKT VLR wins
    wkt = None
    for path in files:
        with laspy.open(path) as f:
            for vlr in f.header.vlrs:
                if hasattr(vlr, 'string') and vlr.record_id == 2112:
                    wkt = vlr.string
                    break
        if wkt:
            break

    utm_info = parse_utm_crs(wkt) if wkt else None
    if utm_info is None and forced_utm is not None:
        zone, hemisphere = forced_utm
        epsg = 32600 + zone if hemisphere.upper() == 'N' else 32700 + zone
        utm_info = (zone, hemisphere.upper(), epsg)

    # Compute union bbox across all headers
    x_min = math.inf
    y_min = math.inf
    x_max = -math.inf
    y_max = -math.inf
    with tqdm(total=len(files), desc="  Scanning headers", unit=" file",
              file=sys.stdout, dynamic_ncols=True) as bar:
        for path in files:
            with laspy.open(path) as f:
                hdr = f.header
                if hdr.point_count <= 0:
                    bar.update(1)
                    continue
                x_min = min(x_min, float(hdr.mins[0]))
                y_min = min(y_min, float(hdr.mins[1]))
                x_max = max(x_max, float(hdr.maxs[0]))
                y_max = max(y_max, float(hdr.maxs[1]))
            bar.update(1)

    if fixed_origin is not None:
        origin_x, origin_y = fixed_origin
    else:
        origin_x = (x_min + x_max) / 2.0
        origin_y = (y_min + y_max) / 2.0

    crs_info = None
    if utm_info:
        zone, hemisphere, epsg = utm_info
        ref_lng, ref_lat = utm_to_lnglat(origin_x, origin_y, zone, hemisphere)
        crs_info = {
            'type': 'utm',
            'zone': zone,
            'hemisphere': hemisphere,
            'epsg': epsg,
            'origin': {'easting': origin_x, 'northing': origin_y, 'elevation': 0.0},
            'refLngLat': {'lng': ref_lng, 'lat': ref_lat},
        }
    return crs_info, (origin_x, origin_y)


def _pretransform_worker(job: tuple[str, str, tuple[float, float], tuple[int, str] | None]) -> tuple[str, int]:
    """Worker for parallel pretransform. Returns (input_path, point_count)."""
    in_path, out_path, origin, forced_utm = job
    pretransform_las(
        in_path, out_path,
        fixed_origin=origin,
        forced_utm=forced_utm,
        quiet=True,
    )
    # Point count from the output header — cheap, just a header read
    with laspy.open(out_path) as f:
        pts = int(f.header.point_count)
    return in_path, pts


def parallel_pretransform(
    files: list[str],
    out_dir: str,
    shared_origin: tuple[float, float],
    forced_utm: tuple[int, str] | None,
    max_workers: int | None = None,
) -> list[str]:
    """Pretransform every tile in parallel against a shared origin.

    Writes `<out_dir>/<basename>.las` per input tile. LAZ inputs are written
    as LAS (pretransform_las always writes LAS). Returns the list of output
    paths in input order.
    """
    os.makedirs(out_dir, exist_ok=True)

    jobs: list[tuple[str, str, tuple[float, float], tuple[int, str] | None]] = []
    out_paths: list[str] = []
    for path in files:
        base = os.path.basename(path)
        stem, ext = os.path.splitext(base)
        out_name = stem + '.las'  # always LAS output
        out_path = os.path.join(out_dir, out_name)
        jobs.append((path, out_path, shared_origin, forced_utm))
        out_paths.append(out_path)

    n_workers = max_workers if max_workers is not None else min(os.cpu_count() or 4, 8)

    with tqdm(total=len(jobs), desc="  Pre-transform tiles", unit=" tile",
              file=sys.stdout, dynamic_ncols=True,
              bar_format="{l_bar}{bar}| {n_fmt}/{total_fmt}  [{elapsed}<{remaining}]") as bar:
        with ProcessPoolExecutor(max_workers=n_workers) as pool:
            for in_path, pts in pool.map(_pretransform_worker, jobs):
                bar.set_postfix(file=os.path.basename(in_path), pts=f"{pts:,}", refresh=False)
                bar.update(1)

    return out_paths


# ---------------------------------------------------------------------------
# Step 0b — Extract trajectory.json from pretransformed LAS
# ---------------------------------------------------------------------------

def extract_trajectory(las_path: str, output_dir: str) -> None:
    """Extract pose/trajectory points from a pretransformed (Y-up) LAS file.

    Looks for points where the 'is_pose' extra dimension equals 1. Each pose
    point must also have a 'scan_id' extra dimension and a standard 'gps_time'
    field. Results are written to <output_dir>/trajectory.json.

    The output coordinates are already in Three.js Y-up local space (the same
    as the pretransformed LAS), so the viewer can use them directly.
    """
    required_dims = {'is_pose', 'scan_id'}

    print("Extracting trajectory points...")

    with laspy.LasReader(open(las_path, 'rb')) as reader:
        extra_names = {d.name for d in _safe_extra_dims(reader.header.point_format)}
        missing = required_dims - extra_names
        if missing:
            tqdm.write(f"  [trajectory] Skipping - missing extra dimensions: {', '.join(missing)}")
            return

        _CHUNK = 5_000_000
        pose_x: list[np.ndarray] = []
        pose_y: list[np.ndarray] = []
        pose_z: list[np.ndarray] = []
        pose_scan_id: list[np.ndarray] = []
        pose_gps_time: list[np.ndarray] = []

        total = reader.header.point_count
        with tqdm(total=total, desc="  Scan trajectory", **_BAR_OPTS) as bar:
            for chunk in reader.chunk_iterator(_CHUNK):
                mask = np.asarray(chunk['is_pose'], dtype=np.uint8) == 1
                if mask.any():
                    pose_x.append(np.asarray(chunk.x, dtype=np.float64)[mask])
                    pose_y.append(np.asarray(chunk.y, dtype=np.float64)[mask])
                    pose_z.append(np.asarray(chunk.z, dtype=np.float64)[mask])
                    pose_scan_id.append(np.asarray(chunk['scan_id'], dtype=np.int32)[mask])
                    # gps_time is a standard field in LAS; fall back to zeros if absent
                    try:
                        pose_gps_time.append(np.asarray(chunk.gps_time, dtype=np.float64)[mask])
                    except Exception:
                        pose_gps_time.append(np.zeros(int(mask.sum()), dtype=np.float64))
                bar.update(len(chunk))

    if not pose_x:
        tqdm.write("  [trajectory] No pose points found (is_pose == 1) - skipping trajectory.json")
        return

    xs  = np.concatenate(pose_x)
    ys  = np.concatenate(pose_y)
    zs  = np.concatenate(pose_z)
    ids = np.concatenate(pose_scan_id)
    gps = np.concatenate(pose_gps_time)

    # Sort by scan_id for deterministic ordering
    order = np.argsort(ids, kind='stable')
    xs, ys, zs, ids, gps = xs[order], ys[order], zs[order], ids[order], gps[order]

    points = [
        {
            "x": float(xs[i]),
            "y": float(ys[i]),
            "z": float(zs[i]),
            "scanId": int(ids[i]),
            "gpsTime": float(gps[i]),
        }
        for i in range(len(xs))
    ]

    traj_data = {
        "version": 1,
        "count": len(points),
        "scanIdRange": [int(ids.min()), int(ids.max())],
        "gpsTimeRange": [float(gps.min()), float(gps.max())],
        "points": points,
    }

    out_path = os.path.join(output_dir, "trajectory.json")
    with open(out_path, "w") as f:
        json.dump(traj_data, f, separators=(',', ':'))

    size_kb = os.path.getsize(out_path) / 1024
    tqdm.write(f"  [trajectory] {len(points)} pose points extracted, scan IDs {ids.min()}-{ids.max()}")
    tqdm.write(f"  [trajectory] Written: {out_path} ({size_kb:.1f} KB)")


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
        print(f"[1/3] Single input file - no merge needed")
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
        tqdm.write(f"      Subsampled {step}x -> {len(east):,} points for CSF")

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

def convert_tiles_to_potree(
    tile_paths: list[str],
    output_dir: str,
    encoding: str = "UNCOMPRESSED",
) -> list[dict]:
    """Convert each pretransformed LAS into its own Potree octree.

    Produces one octree per input under `output_dir/<stem>/` and returns a list
    of per-tile records usable for a top-level manifest.json. Each record has:
        {
            "id":   <stem>,
            "path": "<stem>/metadata.json",    # relative to output_dir
            "points": int,
            "bounds": {                         # three.js local coords
                "min": [x, y, z],
                "max": [x, y, z],
            },
        }
    """
    if not os.path.isfile(POTREE_CONVERTER):
        print(f"Error: PotreeConverter not found at {POTREE_CONVERTER}")
        sys.exit(1)

    # Sanity: first tile attribute list so we can verify extras survive per-tile
    with laspy.LasReader(open(tile_paths[0], 'rb')) as reader:
        expected_extras = [dim.name for dim in _safe_extra_dims(reader.header.point_format)]

    records: list[dict] = []

    with tqdm(total=len(tile_paths), desc="  PotreeConverter per tile", unit=" tile",
              file=sys.stdout, dynamic_ncols=True,
              bar_format="{l_bar}{bar}| {n_fmt}/{total_fmt}  [{elapsed}<{remaining}]") as bar:
        for tile_path in tile_paths:
            stem = os.path.splitext(os.path.basename(tile_path))[0]
            tile_out_dir = os.path.join(output_dir, stem)
            os.makedirs(tile_out_dir, exist_ok=True)
            bar.set_postfix(tile=stem, refresh=False)

            cmd = [POTREE_CONVERTER, tile_path, "-o", tile_out_dir, "--encoding", encoding]
            proc = subprocess.run(cmd, capture_output=True, text=True)
            if proc.returncode != 0:
                tqdm.write(f"    stdout: {proc.stdout}")
                tqdm.write(f"    stderr: {proc.stderr}")
                print(f"Error: PotreeConverter failed on {stem} (exit {proc.returncode})")
                sys.exit(1)

            meta_path = os.path.join(tile_out_dir, "metadata.json")
            if not os.path.isfile(meta_path):
                print(f"Error: metadata.json missing for tile {stem}")
                sys.exit(1)
            with open(meta_path) as f:
                meta = json.load(f)

            # Verify extras round-tripped
            attrs = [a["name"] for a in meta.get("attributes", [])]
            missing_extras = [d for d in expected_extras if d not in attrs]
            if missing_extras:
                print(f"Error: tile {stem} dropped extra dims: {', '.join(missing_extras)}")
                sys.exit(1)

            # Pull actual data bounds from the position attribute (not cubic octree bbox)
            pos_attr = next((a for a in meta.get("attributes", []) if a["name"] == "position"), None)
            if pos_attr and pos_attr.get("min") and pos_attr.get("max"):
                mn = [float(v) for v in pos_attr["min"]]
                mx = [float(v) for v in pos_attr["max"]]
            else:
                bb = meta.get("boundingBox", {})
                mn = [float(v) for v in bb.get("min", [0, 0, 0])]
                mx = [float(v) for v in bb.get("max", [0, 0, 0])]

            records.append({
                "id": stem,
                "path": f"{stem}/metadata.json",
                "points": int(meta.get("points", 0)),
                "bounds": {"min": mn, "max": mx},
            })
            bar.update(1)

    return records


def convert_to_potree(las_path, output_dir: str, encoding: str = "UNCOMPRESSED") -> None:
    """Convert LAS input to Potree format.

    `las_path` may be:
      - a single .las file path (legacy single-file flow)
      - a directory containing .las files (batch flow, resolved to a file list)
      - an explicit list of .las file paths (batch flow)

    PotreeConverter 2.x builds one octree from all provided files.
    """
    print(f"[3/3] Converting to Potree format...")

    if not os.path.isfile(POTREE_CONVERTER):
        print(f"Error: PotreeConverter not found at {POTREE_CONVERTER}")
        print("Options:")
        print("  1. Set CLAP_POTREE_CONVERTER env var to the executable path")
        print("  2. Pass --potree-converter <path> on the command line")
        print("  3. Build it: cd ../PotreeConverter && mkdir build && cd build && cmake .. && cmake --build . --config Release")
        sys.exit(1)

    # Resolve input into an explicit list of file paths
    if isinstance(las_path, (list, tuple)):
        file_list = list(las_path)
    elif os.path.isdir(las_path):
        file_list = sorted(glob.glob(os.path.join(las_path, "*.las")))
        if not file_list:
            print(f"Error: no .las files found in directory {las_path}")
            sys.exit(1)
    else:
        file_list = [las_path]

    if len(file_list) > 1:
        tqdm.write(f"      Source: {len(file_list)} LAS files")
    sample_path = file_list[0]

    with laspy.LasReader(open(sample_path, 'rb')) as reader:
        extra_dims = [dim.name for dim in _safe_extra_dims(reader.header.point_format)]
        all_dims = list(reader.header.point_format.dimension_names)
    tqdm.write(f"      Input attributes: {len(all_dims)} dimensions")
    if extra_dims:
        tqdm.write(f"      Extra dimensions: {', '.join(extra_dims)}")

    cmd = [POTREE_CONVERTER, *file_list, "-o", output_dir, "--encoding", encoding]
    if len(file_list) == 1:
        tqdm.write(f"      Running: {' '.join(cmd)}")
    else:
        tqdm.write(f"      Running: {POTREE_CONVERTER} <{len(file_list)} files> -o {output_dir} --encoding {encoding}")
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
# Stats summary
# ---------------------------------------------------------------------------

def _build_stats(input_path: str, output_dir: str,
                 origin_x: float, origin_y: float,
                 crs_info: dict | None, elapsed: float) -> dict:
    """Collect verification stats from every pipeline artefact into one dict."""
    stats: dict = {"elapsed_s": round(elapsed, 1)}

    # ── Input LAS ──────────────────────────────────────────────────────────
    try:
        with laspy.open(input_path) as f:
            h = f.header
            stats["input"] = {
                "file": os.path.basename(input_path),
                "points": h.point_count,
                "las_version": str(h.version),
                "point_format": h.point_format.id,
                "crs_vlr_present": any(vlr.record_id == 2112 for vlr in h.vlrs),
                "raw_bounds": {
                    "x": [round(h.mins[0], 4), round(h.maxs[0], 4)],
                    "y": [round(h.mins[1], 4), round(h.maxs[1], 4)],
                    "z": [round(h.mins[2], 4), round(h.maxs[2], 4)],
                },
            }
    except Exception as e:
        stats["input"] = {"error": str(e)}

    # ── Pre-transform origin ────────────────────────────────────────────────
    stats["pretransform"] = {
        "origin_easting":  round(origin_x, 4),
        "origin_northing": round(origin_y, 4),
        "axis_mapping": {
            "three_js_X": "LAS_X - origin_easting  (East offset)",
            "three_js_Y": "LAS_Z                   (Elevation, up)",
            "three_js_Z": "LAS_Y - origin_northing (North offset)",
        },
    }

    # ── CRS ────────────────────────────────────────────────────────────────
    crs_path = os.path.join(output_dir, "crs.json")
    if crs_info:
        stats["crs"] = {
            "written": os.path.isfile(crs_path),
            "epsg": crs_info.get("epsg"),
            "zone": f"{crs_info.get('zone')}{crs_info.get('hemisphere')}",
            "origin_easting":  crs_info["origin"]["easting"],
            "origin_northing": crs_info["origin"]["northing"],
            "ref_lat_lng": crs_info.get("refLngLat"),
        }
    else:
        stats["crs"] = {"written": False, "note": "No UTM CRS detected - local coordinates only"}

    # ── Potree metadata.json ────────────────────────────────────────────────
    meta_path = os.path.join(output_dir, "metadata.json")
    if os.path.isfile(meta_path):
        try:
            with open(meta_path) as f:
                meta = json.load(f)
            # Use position attribute min/max for actual data bounds.
            # boundingBox is the padded *cubic* octree bbox (all axes == largest
            # extent) and must NOT be used for sanity checks.
            pos_attr = next((a for a in meta.get("attributes", []) if a["name"] == "position"), None)
            mn = pos_attr["min"] if pos_attr else [None, None, None]
            mx = pos_attr["max"] if pos_attr else [None, None, None]
            attrs = [a["name"] for a in meta.get("attributes", [])]
            stats["potree"] = {
                "points": meta.get("points"),
                "bounds_note": "Actual point data bounds (position attribute, not cubic octree bbox)",
                "three_js_bounds": {
                    "X_east_m":  [round(mn[0], 3), round(mx[0], 3)] if mn[0] is not None else None,
                    "Y_elev_m":  [round(mn[1], 3), round(mx[1], 3)] if mn[1] is not None else None,
                    "Z_north_m": [round(mn[2], 3), round(mx[2], 3)] if mn[2] is not None else None,
                },
                "offset": meta.get("offset"),
                "scale":  meta.get("scale"),
                "attributes": attrs,
            }
            # Sanity checks
            checks = {}
            if mn[1] is not None and mx[1] is not None:
                elev_range = mx[1] - mn[1]
                checks["Y_is_elevation"] = {
                    "range_m": round(elev_range, 1),
                    "ok": elev_range < 500,  # elevation span <500m; if Y=Northing it would be thousands
                    "note": "PASS - Y axis is elevation (Three.js up)" if elev_range < 500
                            else "FAIL - Y range too large; axes may be swapped (Y=Northing?)",
                }
            if mn[2] is not None and mx[2] is not None:
                north_range = mx[2] - mn[2]
                checks["Z_is_northing"] = {
                    "range_m": round(north_range, 1),
                    "ok": north_range < 50000,
                    "note": "PASS - Z axis is northing offset" if north_range < 50000
                            else "FAIL - Z range implausibly large",
                }
            # Check that potree offset is local, not raw UTM (hundreds of thousands)
            if meta.get("offset"):
                off = meta["offset"]
                checks["offset_not_absolute_utm"] = {
                    "offset": [round(v, 3) for v in off],
                    "ok": all(abs(v) < 10000 for v in off),
                    "note": "PASS - offset looks local (not raw UTM)" if all(abs(v) < 10000 for v in off)
                            else "FAIL - offset looks like raw UTM coords; preprocess.py may not have run",
                }
            stats["potree"]["sanity_checks"] = checks
        except Exception as e:
            stats["potree"] = {"error": str(e)}
    else:
        stats["potree"] = {"note": "metadata.json not found (--skip-potree?)"}

    # ── DEM ────────────────────────────────────────────────────────────────
    dem_path = os.path.join(output_dir, "dem.json")
    if os.path.isfile(dem_path):
        try:
            size_mb = os.path.getsize(dem_path) / 1024 / 1024
            with open(dem_path) as f:
                dem = json.load(f)
            elev = dem.get("elevation", [[]])
            flat = [v for row in elev for v in row if v is not None]
            stats["dem"] = {
                "file_mb": round(size_mb, 2),
                "cell_size_m": dem.get("cellSize"),
                "grid": f"{dem.get('cols')}x{dem.get('rows')}",
                "x_range_m": [dem.get("xMin"), dem.get("xMax")],
                "z_range_m": [dem.get("yMin"), dem.get("yMax")],   # DEM yMin/yMax = North axis
                "elevation_min_m": round(min(flat), 3) if flat else None,
                "elevation_max_m": round(max(flat), 3) if flat else None,
                "elevation_mean_m": round(sum(flat) / len(flat), 3) if flat else None,
                "note": "DEM X=East, DEM Y=North (Three.js Z), elevation=Three.js Y",
            }
        except Exception as e:
            stats["dem"] = {"error": str(e)}
    else:
        stats["dem"] = {"note": "dem.json not found (--skip-dem?)"}

    # ── Alignment cross-check ───────────────────────────────────────────────
    # Verify that the potree origin matches the crs.json origin. Mismatch here
    # is exactly what causes HD map / point cloud drift in the viewer.
    cross: dict = {}
    if crs_info and stats.get("potree", {}).get("offset"):
        off = stats["potree"]["offset"]
        crs_e = crs_info["origin"]["easting"]
        crs_n = crs_info["origin"]["northing"]
        cross["potree_offset_vs_crs_origin"] = {
            "potree_bbox_min_X": round(off[0], 4),
            "potree_bbox_min_Z": round(off[2], 4),
            "crs_origin_easting":  round(crs_e, 4),
            "crs_origin_northing": round(crs_n, 4),
            "note": "potree bbox min is local (centred) — not directly comparable to crs origin; "
                    "both must share the same subtracted origin to be aligned",
        }
    # HD map alignment check only applies to the KCity dataset (UTM18N). Other
    # datasets (different UTM zones / regions) would always show spurious
    # "DRIFT" against this hardcoded origin, so gate it on zone 18N.
    if crs_info and crs_info.get("zone") == 18 and crs_info.get("hemisphere") == 'N':
        hd_map_origin_e = 378923.0495
        hd_map_origin_n = 4902337.3695
        delta_e = abs(crs_info["origin"]["easting"]  - hd_map_origin_e)
        delta_n = abs(crs_info["origin"]["northing"] - hd_map_origin_n)
        cross["hd_map_alignment"] = {
            "hd_map_origin_easting":  hd_map_origin_e,
            "hd_map_origin_northing": hd_map_origin_n,
            "this_origin_easting":    round(crs_info["origin"]["easting"],  4),
            "this_origin_northing":   round(crs_info["origin"]["northing"], 4),
            "delta_easting_m":  round(delta_e, 4),
            "delta_northing_m": round(delta_n, 4),
            "aligned": delta_e < 0.01 and delta_n < 0.01,
            "note": "ALIGNED - HD map and point cloud share the same UTM origin" if (delta_e < 0.01 and delta_n < 0.01)
                    else f"DRIFT - {delta_e:.2f}m E, {delta_n:.2f}m N offset vs hd-map/projection.ts constants",
        }
    stats["alignment_check"] = cross

    return stats


def _print_stats(stats: dict) -> None:
    """Print a concise human-readable summary of the stats dict."""
    print()
    print("=" * 60)
    print("VERIFICATION SUMMARY")
    print("=" * 60)

    inp = stats.get("input", {})
    if "points" in inp:
        print(f"  Input:   {inp['file']}  ({inp['points']:,} pts, LAS {inp['las_version']})")
        rb = inp.get("raw_bounds", {})
        print(f"  Raw X:   {rb.get('x')}  (Easting)")
        print(f"  Raw Y:   {rb.get('y')}  (Northing)")
        print(f"  Raw Z:   {rb.get('z')}  (Elevation ASL)")
        print(f"  CRS VLR: {'YES' if inp.get('crs_vlr_present') else 'NO (--utm-zone required)'}")

    pt = stats.get("pretransform", {})
    print(f"  Origin:  E={pt.get('origin_easting')}  N={pt.get('origin_northing')}")

    crs = stats.get("crs", {})
    if crs.get("written"):
        print(f"  CRS:     EPSG:{crs.get('epsg')}  Zone {crs.get('zone')}  written=YES")
    else:
        print(f"  CRS:     {crs.get('note', 'not written')}")

    po = stats.get("potree", {})
    if "three_js_bounds" in po:
        b = po["three_js_bounds"]
        print(f"  Three.js X (East m):  {b.get('X_east_m')}")
        print(f"  Three.js Y (Elev m):  {b.get('Y_elev_m')}")
        print(f"  Three.js Z (North m): {b.get('Z_north_m')}")
        for name, chk in po.get("sanity_checks", {}).items():
            ok = "OK" if chk.get("ok") else "!!"
            print(f"  [{ok}] {chk.get('note', name)}")

    dem = stats.get("dem", {})
    if "elevation_mean_m" in dem:
        print(f"  DEM:     {dem['grid']} cells @ {dem['cell_size_m']}m  "
              f"elev {dem['elevation_min_m']}..{dem['elevation_max_m']}m "
              f"(mean {dem['elevation_mean_m']}m)")

    ac = stats.get("alignment_check", {})
    hd = ac.get("hd_map_alignment", {})
    if hd:
        tag = "OK" if hd.get("aligned") else "!!"
        print(f"  [{tag}] HD map alignment: {hd.get('note')}")

    print("=" * 60)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="CLAP Preprocessing Pipeline - convert LAS/LAZ to Potree + DEM",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("input_path", help="Single .las/.laz file or directory containing them")
    parser.add_argument("output_name", help="Output name (placed under public/pointclouds/<name>/)")
    parser.add_argument("--cell-size", type=float, default=1.0, help="DEM cell size in meters (default: 1.0)")
    parser.add_argument("--skip-dem", action="store_true", help="Skip DEM generation")
    parser.add_argument("--skip-potree", action="store_true", help="Skip Potree conversion")
    parser.add_argument("--skip-trajectory", action="store_true", help="Skip trajectory.json extraction")
    parser.add_argument("--potree-encoding", default="UNCOMPRESSED", choices=["BROTLI", "UNCOMPRESSED"])
    parser.add_argument("--origin-easting", type=float, default=None,
                        help="Fix the UTM easting origin instead of using the cloud centroid")
    parser.add_argument("--origin-northing", type=float, default=None,
                        help="Fix the UTM northing origin instead of using the cloud centroid")
    parser.add_argument("--utm-zone", type=int, default=None,
                        help="Force UTM zone number (e.g. 18) when the LAS file has no embedded CRS VLRs")
    parser.add_argument("--utm-hemisphere", choices=["N", "S"], default="N",
                        help="UTM hemisphere to use with --utm-zone (default: N)")
    parser.add_argument(
        "--batch", action="store_true",
        help="Multi-tile mode: skip the merge step, pretransform each tile in parallel "
             "against a shared UTM origin, then hand the directory to PotreeConverter. "
             "Implies --skip-dem and --skip-trajectory (not supported on multi-tile inputs yet).",
    )
    parser.add_argument(
        "--workers", type=int, default=None,
        help="Number of parallel workers for --batch pre-transform (default: min(cpu_count, 8))",
    )
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

    # Resolve common config values used by both batch and legacy flows
    fixed_origin = None
    if args.origin_easting is not None and args.origin_northing is not None:
        fixed_origin = (args.origin_easting, args.origin_northing)
    forced_utm = (args.utm_zone, args.utm_hemisphere) if args.utm_zone is not None else None

    # ── Batch flow: skip merge, parallel per-tile pretransform, dir → Potree ──
    if args.batch:
        if len(las_files) < 2:
            print("Error: --batch needs 2+ LAS files. For a single file, run without --batch.")
            sys.exit(1)

        # Batch mode is incompatible with DEM and trajectory (they are single-file).
        # Force-skip with a notice so the user knows.
        if not args.skip_dem:
            print("Note: --batch implies --skip-dem (multi-tile DEM is not supported).")
            args.skip_dem = True
        if not args.skip_trajectory:
            print("Note: --batch implies --skip-trajectory (multi-tile trajectory not supported).")
            args.skip_trajectory = True
        print()

        # Step 1 — Plan: scan headers, compute union bbox, shared origin, CRS
        print(f"[1/3] Planning shared origin from {len(las_files)} tiles...")
        crs_info, (origin_x, origin_y) = plan_shared_origin(
            las_files, forced_utm, fixed_origin=fixed_origin,
        )
        if crs_info:
            print(f"      UTM Zone {crs_info['zone']}{crs_info['hemisphere']} (EPSG:{crs_info['epsg']})")
            print(f"      Shared origin: E={origin_x:.3f}, N={origin_y:.3f}")
            print(f"      Ref lat/lng: ({crs_info['refLngLat']['lat']:.7f}, {crs_info['refLngLat']['lng']:.7f})")
        else:
            print(f"      No UTM CRS detected — local origin: ({origin_x:.1f}, {origin_y:.1f})")
            print(f"      (Pass --utm-zone to attach a geo reference if these LAS files are UTM without VLRs.)")
        print()

        # Step 2 — Parallel pre-transform
        pretransform_dir = tempfile.mkdtemp(prefix="clap_pretransformed_")
        n_workers = args.workers if args.workers else min(os.cpu_count() or 4, 8)
        print(f"[2/3] Parallel pre-transform ({len(las_files)} tiles, {n_workers} workers)")
        print(f"      Temp dir: {pretransform_dir}")
        try:
            pretransformed_paths = parallel_pretransform(
                las_files, pretransform_dir, (origin_x, origin_y),
                forced_utm, max_workers=n_workers,
            )
            print()

            # Step 3 — Per-tile PotreeConverter + manifest
            # Each tile becomes its own octree at output_dir/<stem>/; a top-level
            # manifest.json lists all tiles with their per-tile bounds so the
            # viewer can show a picker and load only selected tiles.
            tile_records: list[dict] = []
            if not args.skip_potree:
                print(f"[3/3] Converting {len(pretransformed_paths)} tiles (per-tile octrees)")
                tile_records = convert_tiles_to_potree(
                    pretransformed_paths, output_dir, encoding=args.potree_encoding,
                )
                print(f"      {len(tile_records)} per-tile octrees written under {output_dir}")
            else:
                print("[3/3] Skipping Potree conversion")
            print()

            # Union bbox across all tiles (three.js local coords) for dataset-level extent
            dataset_bounds = None
            if tile_records:
                mins = [r["bounds"]["min"] for r in tile_records]
                maxs = [r["bounds"]["max"] for r in tile_records]
                dataset_bounds = {
                    "min": [min(m[i] for m in mins) for i in range(3)],
                    "max": [max(m[i] for m in maxs) for i in range(3)],
                }

            # Write manifest.json — the new entry point for tiled datasets.
            # Legacy viewers can still read per-tile metadata.json files individually.
            if tile_records:
                manifest = {
                    "version": 1,
                    "type": "tiled",
                    "totalPoints": sum(r["points"] for r in tile_records),
                    "origin": {"originX": origin_x, "originY": origin_y},
                    "crs": crs_info,
                    "bounds": dataset_bounds,
                    "tiles": tile_records,
                }
                manifest_path = os.path.join(output_dir, "manifest.json")
                with open(manifest_path, "w") as f:
                    json.dump(manifest, f, indent=2)
                print(f"Manifest written: {manifest_path}  ({len(tile_records)} tiles)")

            # Write crs.json so the viewer auto-configures the geo world frame
            if crs_info:
                crs_path = os.path.join(output_dir, "crs.json")
                with open(crs_path, "w") as f:
                    json.dump(crs_info, f, indent=2)
                print(f"CRS written:    {crs_path}")

            # Always write origin.json so downstream tools (HD map projection,
            # re-runs with --origin-easting/northing) share the same origin.
            origin_path = os.path.join(output_dir, "origin.json")
            with open(origin_path, "w") as f:
                json.dump({"originX": origin_x, "originY": origin_y}, f, indent=2)
            print(f"Origin written: {origin_path}  (easting={origin_x:.3f}, northing={origin_y:.3f})")
        finally:
            shutil.rmtree(pretransform_dir, ignore_errors=True)

        elapsed = time.time() - t_start
        print("=" * 60)
        print(f"Done! Total time: {elapsed:.1f}s")
        print(f"Output: {output_dir}")
        print()
        print(f"To load in CLAP viewer, set the point cloud path to:")
        print(f"  /pointclouds/{args.output_name}/")
        print("=" * 60)
        return

    # ── Legacy flow: merge (if needed) + single pretransform ────────────────
    merged_path = None
    cleanup_merged = False
    if len(las_files) > 1:
        merged_path = os.path.join(tempfile.gettempdir(), "clap_merged.las")
        merge_las_files(las_files, merged_path)
        cleanup_merged = True
    else:
        merged_path = las_files[0]
        print(f"[1/3] Single input file - no merge needed")
        print(f"      {merged_path}")
    print()

    # Pre-transform: always center and reorder axes to Three.js Y-up.
    # Returns crs_info dict if UTM CRS detected (enables geo world frame), else None.
    print("Pre-processing: transforming to Three.js Y-up local ENU...")
    pretransformed_path = os.path.join(tempfile.gettempdir(), "clap_pretransformed.las")
    crs_info, (origin_x, origin_y) = pretransform_las(merged_path, pretransformed_path,
                                                       fixed_origin=fixed_origin, forced_utm=forced_utm)
    work_path = pretransformed_path
    if crs_info:
        print(f"  UTM detected - crs.json will be written for geo world frame auto-setup")
    else:
        print(f"  No geo reference - cloud will load in local coordinates (world frame must be set manually)")
    print()

    try:
        # Extract trajectory.json (pose points) from the pretransformed LAS
        if not args.skip_trajectory:
            extract_trajectory(work_path, output_dir)
        else:
            print("Skipping trajectory extraction")
        print()

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

        # Always write origin.json so all pipeline outputs (potree, trajectory, DEM)
        # can be verified as having the same centering origin. If trajectory.json is
        # ever regenerated separately, pass these values via --origin-easting /
        # --origin-northing to guarantee alignment.
        origin_path = os.path.join(output_dir, "origin.json")
        with open(origin_path, "w") as f:
            json.dump({"originX": origin_x, "originY": origin_y}, f, indent=2)
        print(f"Origin written: {origin_path}  (easting={origin_x:.3f}, northing={origin_y:.3f})")

        # Write stats.json — a human-readable verification summary covering every
        # stage of the pipeline so post-run alignment can be confirmed at a glance.
        elapsed_so_far = time.time() - t_start
        stats = _build_stats(
            input_path=merged_path,
            output_dir=output_dir,
            origin_x=origin_x,
            origin_y=origin_y,
            crs_info=crs_info,
            elapsed=elapsed_so_far,
        )
        stats_path = os.path.join(output_dir, "stats.json")
        with open(stats_path, "w") as f:
            json.dump(stats, f, indent=2)
        print(f"Stats written:  {stats_path}")
        _print_stats(stats)

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
