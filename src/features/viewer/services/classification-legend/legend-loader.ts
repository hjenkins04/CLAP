import { Vector4 } from 'three';
import { electronFetch } from '../electron-fetch';
import { DEFAULT_CLASSIFICATION_LEGEND } from './default-legend';
import type {
  ClassificationLegend,
  LegendClass,
  LegendGroup,
  LegendRange,
} from './types';

/**
 * Parse a color string ("#RRGGBB", "#RGB", or "rgb(r,g,b)") into [r, g, b]
 * components in 0..1 range. Falls back to mid-gray for unparseable input.
 */
export function parseColor(input: string | undefined | null): [number, number, number] {
  if (!input) return [0.5, 0.5, 0.5];
  const s = input.trim();

  // #RRGGBB
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
  }
  // #RGB
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m) {
    return [
      parseInt(m[1] + m[1], 16) / 255,
      parseInt(m[2] + m[2], 16) / 255,
      parseInt(m[3] + m[3], 16) / 255,
    ];
  }
  // rgb(r,g,b)
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(s);
  if (m) {
    return [Math.min(1, Number(m[1]) / 255), Math.min(1, Number(m[2]) / 255), Math.min(1, Number(m[3]) / 255)];
  }
  return [0.5, 0.5, 0.5];
}

/**
 * Validate and normalise a parsed JSON object into a ClassificationLegend.
 * Throws on structurally invalid input so callers fall back to the default.
 */
export function validateLegend(raw: unknown): ClassificationLegend {
  if (!raw || typeof raw !== 'object') throw new Error('legend must be an object');
  const obj = raw as Record<string, unknown>;

  const version = typeof obj.version === 'number' ? obj.version : 1;
  const name = typeof obj.name === 'string' ? obj.name : 'Unnamed Legend';
  const defaultColor = typeof obj.defaultColor === 'string' ? obj.defaultColor : undefined;

  if (!Array.isArray(obj.groups)) throw new Error('legend.groups must be an array');
  if (!Array.isArray(obj.classes)) throw new Error('legend.classes must be an array');

  const groups: LegendGroup[] = obj.groups.map((g, i) => {
    if (!g || typeof g !== 'object') throw new Error(`legend.groups[${i}] invalid`);
    const gg = g as Record<string, unknown>;
    if (typeof gg.id !== 'string' || typeof gg.name !== 'string') {
      throw new Error(`legend.groups[${i}] needs id + name`);
    }
    return {
      id: gg.id,
      name: gg.name,
      color: typeof gg.color === 'string' ? gg.color : undefined,
      defaultExpanded: typeof gg.defaultExpanded === 'boolean' ? gg.defaultExpanded : undefined,
    };
  });

  const classes: LegendClass[] = obj.classes.map((c, i) => {
    if (!c || typeof c !== 'object') throw new Error(`legend.classes[${i}] invalid`);
    const cc = c as Record<string, unknown>;
    if (typeof cc.id !== 'number' || typeof cc.name !== 'string' || typeof cc.color !== 'string') {
      throw new Error(`legend.classes[${i}] needs id(number) + name + color`);
    }
    return {
      id: cc.id,
      name: cc.name,
      groupId: typeof cc.groupId === 'string' ? cc.groupId : 'ungrouped',
      color: cc.color,
      description: typeof cc.description === 'string' ? cc.description : undefined,
      enabledByDefault: typeof cc.enabledByDefault === 'boolean' ? cc.enabledByDefault : undefined,
    };
  });

  const ranges: LegendRange[] | undefined = Array.isArray(obj.ranges)
    ? obj.ranges.map((r, i) => {
        if (!r || typeof r !== 'object') throw new Error(`legend.ranges[${i}] invalid`);
        const rr = r as Record<string, unknown>;
        if (
          typeof rr.from !== 'number' ||
          typeof rr.to !== 'number' ||
          typeof rr.mapsTo !== 'number'
        ) {
          throw new Error(`legend.ranges[${i}] needs from/to/mapsTo numbers`);
        }
        return {
          from: rr.from,
          to: rr.to,
          mapsTo: rr.mapsTo,
          description: typeof rr.description === 'string' ? rr.description : undefined,
        };
      })
    : undefined;

  return { version, name, defaultColor, groups, classes, ranges };
}

/**
 * Fetch `classification_legend.json` from a dataset's base URL. Returns the
 * parsed legend on success, or null if the file does not exist / is invalid.
 * Caller falls back to DEFAULT_CLASSIFICATION_LEGEND.
 */
export async function fetchProjectLegend(
  baseUrl: string,
): Promise<ClassificationLegend | null> {
  try {
    const resp = await electronFetch(`${baseUrl}classification_legend.json`);
    if (!resp.ok) return null;
    const raw = await resp.json();
    return validateLegend(raw);
  } catch (err) {
    console.warn('[CLAP] classification_legend.json load failed, using default:', err);
    return null;
  }
}

export function loadDefaultLegend(): ClassificationLegend {
  return DEFAULT_CLASSIFICATION_LEGEND;
}

/**
 * Build the material.classification map Potree expects. Keys are stringified
 * class IDs (or 'DEFAULT'); values are RGBA Vector4s where alpha is the
 * visibility channel — 0 hides that class's points, 1 renders normally.
 *
 * Ranges are expanded by cloning the target class's color into every ID in
 * [from, to]. Explicit class entries always win over range expansion.
 */
export function buildMaterialClassification(
  legend: ClassificationLegend,
  visibility: Record<string, boolean>,
): Record<string, Vector4> {
  const result: Record<string, Vector4> = {};

  // Explicit classes first — they win over range expansion
  for (const cls of legend.classes) {
    const [r, g, b] = parseColor(cls.color);
    const defaultVisible = cls.enabledByDefault ?? true;
    const visible = visibility[String(cls.id)] ?? defaultVisible;
    result[String(cls.id)] = new Vector4(r, g, b, visible ? 1 : 0);
  }

  // Range expansion
  for (const range of legend.ranges ?? []) {
    const target = result[String(range.mapsTo)];
    if (!target) continue;
    for (let i = range.from; i <= range.to; i++) {
      const key = String(i);
      if (!(key in result)) {
        result[key] = new Vector4(target.x, target.y, target.z, target.w);
      }
    }
  }

  const [dr, dg, db] = parseColor(legend.defaultColor ?? '#4d4d4d');
  result.DEFAULT = new Vector4(dr, dg, db, 1);

  return result;
}

/**
 * Build the initial visibility map from a legend, honouring each class's
 * `enabledByDefault` flag. Used when the legend first loads / changes; user
 * toggles are tracked separately in useAnnotateStore.
 */
export function deriveInitialVisibility(
  legend: ClassificationLegend,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const cls of legend.classes) {
    out[String(cls.id)] = cls.enabledByDefault ?? true;
  }
  return out;
}

export function deriveInitialActive(
  legend: ClassificationLegend,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const cls of legend.classes) {
    out[String(cls.id)] = true;
  }
  return out;
}

/**
 * Resolve a raw classification id to the LegendClass that actually drives its
 * rendering. Explicit class entries always win; otherwise ranges are checked,
 * and the target class is returned. Returns null if the id is unmapped.
 */
export function findLegendClass(
  classId: number | null | undefined,
  legend: ClassificationLegend,
): LegendClass | null {
  if (classId == null) return null;
  const direct = legend.classes.find((c) => c.id === classId);
  if (direct) return direct;
  const range = (legend.ranges ?? []).find((r) => classId >= r.from && classId <= r.to);
  if (!range) return null;
  return legend.classes.find((c) => c.id === range.mapsTo) ?? null;
}

/**
 * Returns true if a point with the given classification id should be visible
 * under the current legend + user-toggled visibility map. Used by picking /
 * hover tools so they don't "find" points that are hidden in the legend.
 */
export function isClassVisible(
  classId: number | null | undefined,
  legend: ClassificationLegend,
  visibility: Record<string, boolean>,
): boolean {
  if (classId == null) return true;

  const resolved = findLegendClass(classId, legend);
  const resolvedId = resolved?.id ?? classId;
  const key = String(resolvedId);

  if (key in visibility) return visibility[key];
  if (resolved) return resolved.enabledByDefault ?? true;
  return true; // unknown id — don't hide it
}
