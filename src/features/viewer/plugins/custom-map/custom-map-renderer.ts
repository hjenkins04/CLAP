import {
  Group,
  Line,
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
} from 'three';
import type { WorldFrameTransform } from '../world-frame/geo-utils';
import { geoToLocal } from '../world-frame/geo-utils';
import type { ParsedWay, CustomMapCategory } from './custom-map-store';
import { categorizeWay } from './lanelet2-parser';

export type ElevationFn = (x: number, z: number) => number;

const ELEV_OFFSET = 0.25;

const CATEGORY_COLORS: Record<CustomMapCategory, number> = {
  lane_boundaries: 0xffffff,
  stop_lines: 0xff2222,
  virtual: 0x666688,
  areas: 0xffaa33,
  other: 0xffff44,
};

/**
 * Build one Three.js Group per category from parsed Lanelet2 ways.
 * Each group contains Line objects draped on the DEM surface.
 */
export function buildCustomMapGroups(
  ways: ParsedWay[],
  transform: WorldFrameTransform,
  opacity: number,
  getElev: ElevationFn,
): Map<CustomMapCategory, Group> {
  const groups = new Map<CustomMapCategory, Group>();

  for (const [cat, color] of Object.entries(CATEGORY_COLORS) as [CustomMapCategory, number][]) {
    const g = new Group();
    g.name = `custom-map-${cat}`;
    groups.set(cat, g);

    const mat = new LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
    });

    const categoryWays = ways.filter((w) => categorizeWay(w.type) === cat);
    for (const way of categoryWays) {
      const line = buildWayLine(way, transform, mat, getElev);
      if (line) g.add(line);
    }
  }

  return groups;
}

function buildWayLine(
  way: ParsedWay,
  transform: WorldFrameTransform,
  mat: LineBasicMaterial,
  getElev: ElevationFn,
): Line | null {
  if (way.coords.length < 2) return null;

  const positions: number[] = [];
  for (const coord of way.coords) {
    const local = geoToLocal({ lat: coord.lat, lng: coord.lng }, transform);
    const elev = getElev(local.x, local.z) + ELEV_OFFSET;
    positions.push(local.x, elev, local.z);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(positions), 3));
  const line = new Line(geo, mat);
  line.renderOrder = 850;
  return line;
}
