/**
 * HdMapLoader — fetches and parses DMP tiles described by an HdMapProject.
 *
 * Tile naming: <tilesDir>/<region>_<i>.lxsx  /  <region>_<i>.rsgx
 * tilesDir can be an absolute filesystem path or a URL route; electronFetch
 * handles both transparently.
 */

import { electronFetch } from '../../services/electron-fetch';
import { parseLxsx, type LxsxFile } from './parsers/lxsx-parser';
import { parseRsgx, type RsgxFile } from './parsers/rsgx-parser';
import type { HdMapProject } from './hd-map-project';

export interface HdMapTileData {
  lxsx: LxsxFile[];
  rsgx: RsgxFile[];
  /** Raw XML text per tile — used by the XML patcher for save operations. */
  lxsxTexts: string[];
  rsgxTexts: string[];
}

async function fetchText(url: string): Promise<string> {
  const resp = await electronFetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.statusText}`);
  return resp.text();
}

/** Load and parse all LXSX + RSGX tiles defined by the project. */
export async function loadHdMapTiles(
  project: HdMapProject,
  onProgress?: (loaded: number, total: number) => void,
): Promise<HdMapTileData> {
  const { tilesDir, region, numTiles } = project;
  const base = tilesDir.endsWith('/') ? tilesDir : tilesDir + '/';
  const indices = Array.from({ length: numTiles }, (_, i) => i);
  const total = numTiles * 2;
  let loaded = 0;

  const notify = () => onProgress?.(loaded, total);

  const lxsxTexts: string[] = new Array(numTiles);
  const rsgxTexts: string[] = new Array(numTiles);

  const lxsxPromises = indices.map(async (i) => {
    const text = await fetchText(`${base}${region}_${i}.lxsx`);
    lxsxTexts[i] = text;
    loaded++; notify();
    return parseLxsx(text);
  });

  const rsgxPromises = indices.map(async (i) => {
    const text = await fetchText(`${base}${region}_${i}.rsgx`);
    rsgxTexts[i] = text;
    loaded++; notify();
    return parseRsgx(text);
  });

  const [lxsx, rsgx] = await Promise.all([
    Promise.all(lxsxPromises),
    Promise.all(rsgxPromises),
  ]);

  return { lxsx, rsgx, lxsxTexts, rsgxTexts };
}
