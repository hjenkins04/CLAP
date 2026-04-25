export interface LegendGroup {
  id: string;
  name: string;
  /** Hex color for the group badge in the UI (optional). */
  color?: string;
  /** Whether the group is expanded by default in the legend panel. */
  defaultExpanded?: boolean;
}

export interface LegendClass {
  id: number;
  name: string;
  /** ID of the group this class belongs to. Classes without a matching group
   *  fall into an implicit "Ungrouped" bucket. */
  groupId: string;
  /** Hex ("#RRGGBB" / "#RGB") or "rgb(r,g,b)" string. */
  color: string;
  description?: string;
  /** Initial visibility when the legend is loaded. Defaults to true. */
  enabledByDefault?: boolean;
}

/** Maps a range of classification IDs (inclusive) onto a single class for
 *  display. Used when raw LAS files encode attributes (e.g. voltage level)
 *  by splitting what is logically one class across many class IDs. */
export interface LegendRange {
  from: number;
  to: number;
  /** Target class id. The target must exist in `classes`. */
  mapsTo: number;
  description?: string;
}

export interface ClassificationLegend {
  version: number;
  name: string;
  /** Hex fallback color for class IDs that have neither an explicit class nor
   *  a range mapping. Defaults to a muted gray. */
  defaultColor?: string;
  groups: LegendGroup[];
  classes: LegendClass[];
  ranges?: LegendRange[];
}
