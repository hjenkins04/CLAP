// ── Classification ────────────────────────────────────────────────────────────

export type PolygonClass =
  | 'road'
  | 'crosswalk'
  | 'lane-marking'
  | 'parking'
  | 'sidewalk'
  | 'intersection'
  | 'other';

export const POLYGON_CLASS_LABELS: Record<PolygonClass, string> = {
  'road':         'Road Surface',
  'crosswalk':    'Crosswalk',
  'lane-marking': 'Lane Marking',
  'parking':      'Parking',
  'sidewalk':     'Sidewalk',
  'intersection': 'Intersection',
  'other':        'Other',
};

export const POLYGON_CLASS_COLORS: Record<PolygonClass, string> = {
  'road':         '#6b7280',
  'crosswalk':    '#fbbf24',
  'lane-marking': '#ffffff',
  'parking':      '#60a5fa',
  'sidewalk':     '#a3e635',
  'intersection': '#f97316',
  'other':        '#c084fc',
};

// ── Layer ─────────────────────────────────────────────────────────────────────

export interface PolygonLayer {
  id: string;
  name: string;
  visible: boolean;
  color: string; // CSS hex
}

// ── Annotation ────────────────────────────────────────────────────────────────

export interface PolygonAnnotation {
  id: string;
  layerId: string;
  /** Short label: "PL-001" */
  label: string;
  visible: boolean;
  /** Vertices in Three.js world space (Y-up: x=east, y=elevation, z=north) */
  vertices: Array<{ x: number; y: number; z: number }>;
  classification: PolygonClass;
  /** Free-form user attributes */
  attributes: Record<string, string | number | boolean>;
  /** WGS-84 centroid — set if world frame is confirmed at creation */
  geoCentroid?: { lat: number; lng: number; elevation: number };
}

// ── Phase state machine ───────────────────────────────────────────────────────

/**
 * idle         – plugin not active
 * drawing      – user clicks to place vertices; clicking near first vertex closes
 * classifying  – polygon closed; overlay collects type + attributes
 * editing      – editing an existing polygon's vertices / inserting edge points
 */
export type PolyAnnotPhase = 'idle' | 'drawing' | 'classifying' | 'editing';
