// ── Classification ──────────────────────────────────────────────────────────

export type TrafficLightSubtype =
  | 'ThreeBulb' | 'FourBulb' | 'DogHouse'
  | 'RailRoad'  | 'Crosswalk' | 'Triangle';

export type SignSubtype =
  | 'Stop' | 'Yield' | 'NoLeft' | 'NoRight'
  | 'OneWayRight' | 'OneWayLeft' | 'DoNotEnter'
  | 'NoTurn' | 'SpeedLimit';

export interface TrafficLightClass {
  kind: 'TrafficLight';
  subtype: TrafficLightSubtype;
}

export interface SignClass {
  kind: 'Sign';
  subtype: SignSubtype;
  speed?: number;
  unit?: 'mph' | 'kph';
}

export type ObstacleClass = TrafficLightClass | SignClass;

// ── Face Normal ─────────────────────────────────────────────────────────────

/** Which face of the bounding box is the "front" (where the object faces) */
export type NormalFace = 'PosX' | 'NegX' | 'PosY' | 'NegY' | 'PosZ' | 'NegZ';

// ── Annotation ──────────────────────────────────────────────────────────────

export interface Annotation3D {
  id: string;
  layerId: string;
  /** Short display label: "TL-001", "SG-003" */
  label: string;
  visible: boolean;
  /** Box centre in Three.js world space (Y-up: x=east, y=elevation, z=north) */
  center: { x: number; y: number; z: number };
  /** Half-extents in metres */
  halfExtents: { x: number; y: number; z: number };
  /** Front-facing direction */
  frontFace: NormalFace;
  classification: ObstacleClass;
  /** Free-form user attributes */
  attributes: Record<string, string | number | boolean>;
  /** WGS-84 centre — set only when world frame is confirmed at creation time */
  geoCenter?: { lat: number; lng: number; elevation: number };
}

export interface AnnotationLayer3D {
  id: string;
  name: string;
  visible: boolean;
  color: string; // CSS hex e.g. '#f97316'
}

// ── Phase state machine ─────────────────────────────────────────────────────

/**
 * idle           – plugin not active
 * drawing-base   – user drags out XZ footprint on ground plane
 * extruding      – user drags vertically to set height
 * picking-face   – user clicks a face to designate front normal
 * classifying    – overlay collects type + attributes
 */
export type Annotate3DPhase =
  | 'idle'
  | 'drawing-base'
  | 'extruding'
  | 'picking-face'
  | 'classifying';
