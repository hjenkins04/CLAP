#!/usr/bin/env python3
"""
dmp_to_geojson.py — Convert GM DMP HD map files to GeoJSON for QGIS.

Supports all five DMP file types:
  .lxsx  — lane cross-sections  → lane_edges, lane_markers, lane_interior
  .rsgx  — road objects & signs → road_objects, signs
  .risx  — intersection index   → intersections
  .npsx  — nominal path (centerlines) → lane_centerlines  (if present)
  .fasx  — quality flags        → quality_flags.json (JSON table)

Usage:
  python dmp_to_geojson.py <dmp_dir> [output_dir]

Example:
  python dmp_to_geojson.py C:\\dev\\ldm_pkg\\lsm_maps\\gm_hd_maps\\CAN_ONTARIO output\\

Output files are named after the DMP region prefix (e.g. CAN_ONTARIO).
All GeoJSON files use WGS84 [lon, lat, elevation] coordinate order.
"""

import json
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path


# ── Namespace helpers ────────────────────────────────────────────────────────

def _detect_ns(root: ET.Element) -> str:
    """Return the namespace string (e.g. '{http://www.gm.ca/hdlm}') or ''."""
    tag = root.tag
    if tag.startswith("{"):
        return tag[:tag.index("}") + 1]
    return ""


def _tag(ns: str, local: str) -> str:
    return f"{ns}{local}"


# ── GeoJSON helpers ──────────────────────────────────────────────────────────

def _feature(geometry: dict, properties: dict) -> dict:
    return {"type": "Feature", "geometry": geometry, "properties": properties}


def _point(lon: float, lat: float, elev: float) -> dict:
    return {"type": "Point", "coordinates": [lon, lat, elev]}


def _linestring(coords: list) -> dict:
    return {"type": "LineString", "coordinates": coords}


def _polygon(rings: list) -> dict:
    return {"type": "Polygon", "coordinates": rings}


def _collection(features: list) -> dict:
    return {"type": "FeatureCollection", "features": features}


def _write_geojson(path: Path, features: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(_collection(features), f, indent=2)
    print(f"  wrote {len(features):>5} features -> {path.name}")


# ── LXSX parser ─────────────────────────────────────────────────────────────

def parse_lxsx(xml_text: str) -> dict:
    """
    Parse a .lxsx file.

    Returns:
      {
        "edges":    list of (left|right) edge polylines,
        "markers":  list of marker polylines,
        "interior": list of per-lane interior polylines,
      }
    Each entry is a dict: { coords, properties }.
    coords = [[lon, lat, elev], ...]
    """
    root = ET.fromstring(xml_text)
    ns = _detect_ns(root)

    edges    = []  # left/right edge LineStrings
    markers  = []  # marker LineStrings
    interior = []  # lane interior LineStrings

    for seg in root.iter(_tag(ns, "segment")):
        seg_id = seg.get("id", "")

        # Collect all xSections into an ordered list
        xs_list = list(seg.iter(_tag(ns, "xSection")))

        # Build polylines per role.
        # Strategy: iterate xSections in order, accumulate runs.
        left_coords:  list = []
        right_coords: list = []

        # Per-lane interior: keyed by lane id
        lane_coords: dict[str, list] = defaultdict(list)

        # Per-marker interior: keyed by marker id
        marker_coords: dict[str, list] = defaultdict(list)

        for xs in xs_list:
            xs_id = xs.get("id", "")

            left_el  = xs.find(_tag(ns, "leftEdge"))
            right_el = xs.find(_tag(ns, "rightEdge"))

            if left_el is not None:
                lat  = float(left_el.get("lat",  0))
                lon  = float(left_el.get("long", 0))
                elev = float(left_el.get("elevation", 0))
                etype = left_el.get("type", "")
                left_coords.append([lon, lat, elev, etype])

            if right_el is not None:
                lat  = float(right_el.get("lat",  0))
                lon  = float(right_el.get("long", 0))
                elev = float(right_el.get("elevation", 0))
                etype = right_el.get("type", "")
                right_coords.append([lon, lat, elev, etype])

            # Points in this xSection (for lane & marker attachment)
            xs_points: dict[str, dict] = {}
            for pt in xs.findall(_tag(ns, "point")):
                pid = pt.get("id", "")
                xs_points[pid] = {
                    "heading":   float(pt.get("heading",   0)),
                    "curvature": float(pt.get("curvature", 0)),
                }

            # Lanes — NOTE: children named "lane", not "marker" (C++ bug avoided)
            for lane in xs.findall(_tag(ns, "lane")):
                lid   = lane.get("id", "")
                pid   = lane.get("pointId", "")
                lat   = float(lane.get("lat",       0))
                lon   = float(lane.get("long",      0))
                elev  = float(lane.get("elevation", 0))
                props = {
                    "segment_id": seg_id,
                    "lane_id":    lid,
                    "class":      lane.get("class", ""),
                    "width":      float(lane.get("width", 0)),
                    "point_id":   pid,
                    **xs_points.get(pid, {}),
                }
                lane_coords[lid].append((lon, lat, elev, props))

            # Markers
            for mkr in xs.findall(_tag(ns, "marker")):
                mid  = mkr.get("id", "")
                pid  = mkr.get("pointId", "")
                lat  = float(mkr.get("lat",       0))
                lon  = float(mkr.get("long",      0))
                elev = float(mkr.get("elevation", 0))
                props = {
                    "segment_id":  seg_id,
                    "marker_id":   mid,
                    "type":        mkr.get("type", ""),
                    "color":       mkr.get("color", ""),
                    "material":    mkr.get("material", ""),
                    "width":       float(mkr.get("width", 0)) if mkr.get("width") else None,
                }
                marker_coords[mid].append((lon, lat, elev, props))

        # Emit left edge polyline
        if len(left_coords) >= 2:
            types = list({c[3] for c in left_coords})
            edges.append({
                "coords": [[c[0], c[1], c[2]] for c in left_coords],
                "props":  {
                    "segment_id": seg_id,
                    "side":       "left",
                    "edge_type":  types[0] if len(types) == 1 else ",".join(types),
                },
            })

        # Emit right edge polyline
        if len(right_coords) >= 2:
            types = list({c[3] for c in right_coords})
            edges.append({
                "coords": [[c[0], c[1], c[2]] for c in right_coords],
                "props":  {
                    "segment_id": seg_id,
                    "side":       "right",
                    "edge_type":  types[0] if len(types) == 1 else ",".join(types),
                },
            })

        # Emit lane interior polylines
        for lid, pts in lane_coords.items():
            if len(pts) >= 2:
                first_props = pts[0][3]
                interior.append({
                    "coords": [[p[0], p[1], p[2]] for p in pts],
                    "props":  first_props,
                })

        # Emit marker polylines
        for mid, pts in marker_coords.items():
            if len(pts) >= 2:
                first_props = pts[0][3]
                markers.append({
                    "coords": [[p[0], p[1], p[2]] for p in pts],
                    "props":  first_props,
                })

    return {"edges": edges, "markers": markers, "interior": interior}


# ── RSGX parser ─────────────────────────────────────────────────────────────

def _read_lat_lon(el: ET.Element) -> tuple | None:
    """Read lat/long/elevation directly from element attributes."""
    lat_s  = el.get("lat")
    lon_s  = el.get("long")
    if lat_s is None or lon_s is None:
        return None
    try:
        lat  = float(lat_s)
        lon  = float(lon_s)
        elev = float(el.get("elevation", 0))
        return (lon, lat, elev)
    except (TypeError, ValueError):
        return None


def parse_rsgx(xml_text: str) -> dict:
    """
    Parse a .rsgx file.

    Structure: <region> → <road> → <segment> → <objects> → <object>
    object has lat/long/elevation attrs + <edge><point> children for polygon boundary.
    signs similarly have lat/long/elevation attrs.

    Returns { "objects": [...], "signs": [...] }
    """
    root = ET.fromstring(xml_text)
    ns = _detect_ns(root)

    objects = []
    signs   = []

    for road in root.iter(_tag(ns, "road")):
        road_id   = road.get("id", "")
        road_name = road.get("name", "")

        for seg in road.findall(_tag(ns, "segment")):
            seg_id = seg.get("id", "")

            # Road objects (stop bars, crosswalks, etc.)
            objects_el = seg.find(_tag(ns, "objects"))
            if objects_el is not None:
                for obj in objects_el.findall(_tag(ns, "object")):
                    obj_id   = obj.get("id", "")
                    obj_type = obj.get("type", "")

                    # Build polygon from <edge><point> children
                    edge_coords = []
                    for edge_el in obj.findall(_tag(ns, "edge")):
                        closed = edge_el.get("closed", "false").lower() == "true"
                        ring = []
                        for pt in edge_el.findall(_tag(ns, "point")):
                            gp = _read_lat_lon(pt)
                            if gp:
                                ring.append(list(gp))
                        if len(ring) >= 3 and closed:
                            ring.append(ring[0])  # close the ring
                            edge_coords = ring
                        elif len(ring) >= 2:
                            edge_coords = ring

                    if len(edge_coords) >= 4:  # closed polygon
                        geom = _polygon([edge_coords])
                    elif len(edge_coords) >= 2:
                        geom = _linestring(edge_coords)
                    else:
                        gp = _read_lat_lon(obj)
                        if gp:
                            geom = _point(gp[0], gp[1], gp[2])
                        else:
                            continue

                    props = {
                        "road_id":    road_id,
                        "road_name":  road_name,
                        "segment_id": seg_id,
                        "object_id":  obj_id,
                        "type":       obj_type,
                        "confidence": obj.get("confidence", ""),
                    }
                    objects.append(_feature(geom, props))

            # Signs (may not exist in all tiles)
            signs_el = seg.find(_tag(ns, "signs"))
            if signs_el is not None:
                for sign in signs_el.findall(_tag(ns, "sign")):
                    gp = _read_lat_lon(sign)
                    if not gp:
                        continue
                    props = {
                        "road_id":    road_id,
                        "road_name":  road_name,
                        "segment_id": seg_id,
                        "sign_id":    sign.get("id", ""),
                        "type":       sign.get("type", ""),
                        "sub_type":   sign.get("subType", ""),
                        "confidence": sign.get("confidence", ""),
                        "heading":    sign.get("heading", ""),
                    }
                    signs.append(_feature(_point(gp[0], gp[1], gp[2]), props))

    return {"objects": objects, "signs": signs}


# ── RISX parser ──────────────────────────────────────────────────────────────

def parse_risx(xml_text: str) -> list:
    """
    Parse a .risx file.

    Structure: <intersections> → <intersection> → <centroid lat=... long=... elevation=...>
               <roads> → <roadReference roadId=... name=...>
               <segments> → <segmentReference segmentId=...>

    Returns list of intersection point features.
    """
    root = ET.fromstring(xml_text)
    ns = _detect_ns(root)

    features = []

    for inter in root.iter(_tag(ns, "intersection")):
        inter_id = inter.get("id", "")

        # Centroid is a child element with lat/long/elevation attrs
        centroid = inter.find(_tag(ns, "centroid"))
        if centroid is None:
            continue
        gp = _read_lat_lon(centroid)
        if gp is None:
            continue

        # Road names
        road_names = [
            el.get("name", "") for el in inter.iter(_tag(ns, "roadReference"))
        ]
        # Segment ids
        seg_ids = [
            el.get("segmentId", "") for el in inter.iter(_tag(ns, "segmentReference"))
        ]

        props = {
            "intersection_id": inter_id,
            "roads":           ",".join(road_names),
            "segments":        ",".join(seg_ids),
        }
        features.append(_feature(_point(gp[0], gp[1], gp[2]), props))

    return features


# ── NPSX parser ──────────────────────────────────────────────────────────────

def parse_npsx(xml_text: str) -> list:
    """
    Parse a .npsx file. Returns list of centerline LineString features.
    Nominal path points have lat/long/elevation directly on <point> elements.
    """
    root = ET.fromstring(xml_text)
    ns = _detect_ns(root)

    features = []

    for path in root.iter(_tag(ns, "nominalPath")):
        path_id  = path.get("id", "")
        lane_ref = path.get("laneId", "")

        coords = []
        for pt in path.iter(_tag(ns, "point")):
            try:
                lat  = float(pt.get("lat",       0))
                lon  = float(pt.get("long",      0))
                elev = float(pt.get("elevation", 0))
                coords.append([lon, lat, elev])
            except (TypeError, ValueError):
                pass

        if len(coords) >= 2:
            props = {
                "path_id":  path_id,
                "lane_id":  lane_ref,
                "type":     path.get("type", ""),
            }
            features.append(_feature(_linestring(coords), props))

    return features


# ── FASX parser ──────────────────────────────────────────────────────────────

def parse_fasx(xml_text: str) -> list:
    """
    Parse a .fasx file. Returns list of quality flag records as dicts
    (not GeoJSON — written as a JSON table joinable by segment_id).
    """
    root = ET.fromstring(xml_text)
    ns = _detect_ns(root)

    records = []

    for section in root.iter(_tag(ns, "gmfaSection")):
        records.append({
            "segment_id":      section.get("segmentId",      ""),
            "lanes":           section.get("lanes",           ""),
            "type":            section.get("type",            ""),
            "start_xs_id":     section.get("startXsectionId",""),
            "end_xs_id":       section.get("endXsectionId",  ""),
            "flag":            section.get("flag",            ""),
            "confidence":      section.get("confidence",      ""),
            "description":     section.get("description",     ""),
        })

    return records


# ── Multi-file aggregator ────────────────────────────────────────────────────

def convert_directory(dmp_dir: Path, output_dir: Path) -> None:
    """
    Find all DMP files in dmp_dir, parse them, merge, and write GeoJSON.
    """
    # Detect region prefix from first file found
    all_files = list(dmp_dir.glob("*.lxsx")) + list(dmp_dir.glob("*.rsgx")) + \
                list(dmp_dir.glob("*.risx")) + list(dmp_dir.glob("*.npsx")) + \
                list(dmp_dir.glob("*.fasx"))

    if not all_files:
        print(f"No DMP files found in {dmp_dir}")
        return

    # Infer region prefix: longest common prefix of stem names
    stems = [f.stem for f in all_files]
    # e.g. CAN_ONTARIO_0, CAN_ONTARIO_1 → prefix = CAN_ONTARIO
    parts = stems[0].split("_")
    prefix = stems[0]
    for stem in stems[1:]:
        for i in range(len(parts), 0, -1):
            candidate = "_".join(parts[:i])
            if stem.startswith(candidate):
                prefix = candidate
                parts = parts[:i]
                break

    print(f"\nRegion prefix: {prefix}")
    print(f"Output dir:    {output_dir}\n")

    # ── LXSX ────────────────────────────────────────────────────────────────
    lxsx_files = sorted(dmp_dir.glob("*.lxsx"))
    if lxsx_files:
        all_edges    = []
        all_markers  = []
        all_interior = []

        for f in lxsx_files:
            print(f"  parsing {f.name} …")
            data = parse_lxsx(f.read_text(encoding="utf-8"))
            all_edges    += data["edges"]
            all_markers  += data["markers"]
            all_interior += data["interior"]

        _write_geojson(
            output_dir / f"{prefix}_lane_edges.geojson",
            [_feature(_linestring(e["coords"]), e["props"]) for e in all_edges],
        )
        _write_geojson(
            output_dir / f"{prefix}_lane_markers.geojson",
            [_feature(_linestring(m["coords"]), m["props"]) for m in all_markers],
        )
        _write_geojson(
            output_dir / f"{prefix}_lane_interior.geojson",
            [_feature(_linestring(i["coords"]), i["props"]) for i in all_interior],
        )

    # ── RSGX ────────────────────────────────────────────────────────────────
    rsgx_files = sorted(dmp_dir.glob("*.rsgx"))
    if rsgx_files:
        all_objects = []
        all_signs   = []

        for f in rsgx_files:
            print(f"  parsing {f.name} …")
            data = parse_rsgx(f.read_text(encoding="utf-8"))
            all_objects += data["objects"]
            all_signs   += data["signs"]

        _write_geojson(output_dir / f"{prefix}_road_objects.geojson", all_objects)
        _write_geojson(output_dir / f"{prefix}_signs.geojson",        all_signs)

    # ── RISX ────────────────────────────────────────────────────────────────
    risx_files = sorted(dmp_dir.glob("*.risx"))
    if risx_files:
        all_intersections = []
        for f in risx_files:
            print(f"  parsing {f.name} …")
            all_intersections += parse_risx(f.read_text(encoding="utf-8"))
        _write_geojson(output_dir / f"{prefix}_intersections.geojson", all_intersections)

    # ── NPSX ────────────────────────────────────────────────────────────────
    npsx_files = sorted(dmp_dir.glob("*.npsx"))
    if npsx_files:
        all_centerlines = []
        for f in npsx_files:
            print(f"  parsing {f.name} …")
            all_centerlines += parse_npsx(f.read_text(encoding="utf-8"))
        _write_geojson(output_dir / f"{prefix}_lane_centerlines.geojson", all_centerlines)
    else:
        print("  (no .npsx files found — skipping centerlines)")

    # ── FASX ────────────────────────────────────────────────────────────────
    fasx_files = sorted(dmp_dir.glob("*.fasx"))
    if fasx_files:
        all_flags = []
        for f in fasx_files:
            print(f"  parsing {f.name} …")
            all_flags += parse_fasx(f.read_text(encoding="utf-8"))

        out_path = output_dir / f"{prefix}_quality_flags.json"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(all_flags, fh, indent=2)
        print(f"  wrote {len(all_flags):>5} records   -> {out_path.name}")

    print("\nDone.")


# ── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    dmp_dir    = Path(sys.argv[1])
    output_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else dmp_dir / "geojson"

    if not dmp_dir.exists():
        print(f"ERROR: directory not found: {dmp_dir}")
        sys.exit(1)

    convert_directory(dmp_dir, output_dir)
