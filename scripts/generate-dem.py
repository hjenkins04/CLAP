#!/usr/bin/env python3
"""
Generate a DEM (Digital Elevation Model) from a LAS point cloud.

1. Reads the LAS file
2. Classifies ground points using Cloth Simulation Filter (CSF)
3. Creates a gridded DEM by interpolating ground points
4. Outputs a JSON file with the DEM grid data for use in the viewer
"""

import sys
import json
import numpy as np
import laspy
import CSF
from scipy.interpolate import griddata

def classify_ground(las_path: str, cloth_resolution: float = 2.0):
    """Classify ground points using CSF algorithm."""
    print(f"Reading LAS file: {las_path}")
    las = laspy.read(las_path)
    points = np.column_stack((las.x, las.y, las.z))
    print(f"  {len(points)} points loaded")
    print(f"  XYZ range: [{points[:,0].min():.1f}, {points[:,1].min():.1f}, {points[:,2].min():.1f}] to [{points[:,0].max():.1f}, {points[:,1].max():.1f}, {points[:,2].max():.1f}]")

    print(f"Running CSF ground classification (resolution={cloth_resolution}m)...")
    csf = CSF.CSF()
    csf.params.bSloopSmooth = False
    csf.params.cloth_resolution = cloth_resolution
    csf.params.rigidness = 1  # 1=mountain, 2=relief, 3=flat
    csf.params.time_step = 0.65
    csf.params.class_threshold = 0.5
    csf.params.interations = 500

    csf.setPointCloud(points)
    ground_indices = CSF.VecInt()
    non_ground_indices = CSF.VecInt()
    csf.do_filtering(ground_indices, non_ground_indices)

    ground_idx = np.array(ground_indices)
    print(f"  Ground points: {len(ground_idx)} ({100*len(ground_idx)/len(points):.1f}%)")

    return points, ground_idx


def create_dem(points: np.ndarray, ground_idx: np.ndarray, cell_size: float = 1.0):
    """Create a gridded DEM from ground points using linear interpolation."""
    ground = points[ground_idx]

    # Use full point cloud extent so DEM covers entire area
    x_min, y_min = points[:, 0].min(), points[:, 1].min()
    x_max, y_max = points[:, 0].max(), points[:, 1].max()

    cols = int(np.ceil((x_max - x_min) / cell_size))
    rows = int(np.ceil((y_max - y_min) / cell_size))

    print(f"Creating DEM grid: {cols}x{rows} cells @ {cell_size}m resolution")
    print(f"  Extent: [{x_min:.1f}, {y_min:.1f}] to [{x_max:.1f}, {y_max:.1f}]")

    # Create grid coordinates (cell centers)
    xi = np.linspace(x_min + cell_size / 2, x_min + (cols - 0.5) * cell_size, cols)
    yi = np.linspace(y_min + cell_size / 2, y_min + (rows - 0.5) * cell_size, rows)
    grid_x, grid_y = np.meshgrid(xi, yi)

    # Interpolate ground elevations onto grid
    print("  Interpolating elevations (linear)...")
    dem = griddata(
        ground[:, :2],
        ground[:, 2],
        (grid_x, grid_y),
        method='linear',
        fill_value=np.nan,
    )

    # Fill NaN holes with nearest-neighbor
    nan_mask = np.isnan(dem)
    if nan_mask.any():
        print(f"  Filling {nan_mask.sum()} NaN cells with nearest-neighbor...")
        dem_nn = griddata(
            ground[:, :2],
            ground[:, 2],
            (grid_x, grid_y),
            method='nearest',
        )
        dem[nan_mask] = dem_nn[nan_mask]

    print(f"  DEM elevation range: {np.nanmin(dem):.2f} to {np.nanmax(dem):.2f}")

    return {
        'xMin': float(x_min),
        'yMin': float(y_min),
        'xMax': float(x_max),
        'yMax': float(y_max),
        'cellSize': float(cell_size),
        'cols': int(cols),
        'rows': int(rows),
        'elevation': dem.tolist(),  # row-major: elevation[row][col]
    }


def main():
    if len(sys.argv) < 3:
        print("Usage: generate-dem.py <input.las> <output.json> [cell_size]")
        sys.exit(1)

    las_path = sys.argv[1]
    out_path = sys.argv[2]
    cell_size = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0

    points, ground_idx = classify_ground(las_path, cloth_resolution=max(cell_size, 2.0))
    dem = create_dem(points, ground_idx, cell_size=cell_size)

    print(f"Writing DEM to {out_path}...")
    with open(out_path, 'w') as f:
        json.dump(dem, f)

    # Print file size
    import os
    size_mb = os.path.getsize(out_path) / 1024 / 1024
    print(f"  Output size: {size_mb:.1f} MB")
    print("Done!")


if __name__ == '__main__':
    main()
