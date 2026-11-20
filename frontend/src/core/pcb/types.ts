/**
 * PCB data model. Units: millimetres, y grows downwards (screen convention), rotation in degrees clockwise.
 * Connectivity is DERIVED from geometry (pads, tracks, vias, zones touching each other); the schematic/3D circuit stays the
 * single source of truth for what SHOULD be connected, so the DRC can report unrouted nets and shorts.
 */

export type CopperLayer = 'top' | 'bottom';
export type ZoneLayer = 'top' | 'bottom' | 'in1' | 'in2';

/** Net class: routing width, clearance and via size for the nets assigned to it. The class named 'Default' always mirrors the global rules. */
export interface NetClass {
  name: string;
  /** routing track width, mm (also the minimum track width the DRC accepts for nets of this class) */
  width: number;
  /** copper clearance for this class, mm (DRC uses the larger of the two classes involved) */
  clearance: number;
  viaDia: number;
  viaDrill: number;
  /** differential pair gap (edge to edge), mm. Used by the autorouter's differential pair derivation (diffpair.ts); also exported */
  diffGap?: number;
  /** target copper length, mm, for nets of this class (length.ts / DRC 'LENGTH' warning); a per-net target overrides it */
  targetLength?: number;
  /** allowed deviation from the target, mm (default 1) */
  lengthTol?: number;
}

export interface PcbRules {
  /** minimum copper track width */
  minWidth: number;
  /** minimum copper-to-copper clearance (different nets) */
  minClearance: number;
  /** minimum finished hole size */
  minDrill: number;
  /** minimum annular ring (pad/via radius minus drill radius) */
  minAnnular: number;
  /** copper-to-board-edge clearance */
  edgeClearance: number;
  /** defaults used when routing */
  defaultWidth: number;
  viaDia: number;
  viaDrill: number;
  /** copper weight in oz/ft² (1 oz = 35 µm) */
  copperOz: number;
  /** working voltage (peak) used for the IPC-2221 clearance check */
  voltage: number;
  /** 2 = top+bottom, 4 = top+in1+in2+bottom (inner layers are planes) */
  layers: 2 | 4;
  /** board thickness mm and dielectric constant, used by the impedance calculators */
  thickness: number;
  er: number;
  /** optional net classes; 'Default' is implicit (global rules) */
  netClasses?: NetClass[];
}

export interface PcbPlacement {
  x: number;
  y: number;
  rot: 0 | 90 | 180 | 270;
  /** bottom side = footprint mirrored in x */
  side: CopperLayer;
  /** footprint override: generator key (e.g. 'SOIC-8', see landPatterns.ts) or a key of PcbDesign.customFootprints; absent = auto-generated */
  footprint?: string;
}

export interface Track {
  id: string;
  layer: CopperLayer;
  width: number;
  /** polyline vertices */
  pts: [number, number][];
}

export interface Via {
  id: string;
  x: number;
  y: number;
  dia: number;
  drill: number;
}

/**
 * Copper pour connected to the net of `anchor` (a component pin), cleared around other nets. Without `poly` it covers the whole
 * board (inset by the edge clearance); with `poly` only that polygon (it is NOT clipped to the board outline: keep it inside).
 */
export interface Zone {
  id: string;
  layer: ZoneLayer;
  anchor: { comp: string; pin: string };
  clearance: number;
  /** pour polygon, mm */
  poly?: [number, number][];
  /** fill order on one layer: a higher priority zone is poured over lower ones (default 0) */
  priority?: number;
  /** thermal relief on same-net pads: clearance ring `gap` with 4 spokes `spokeW` wide; absent = solid connection */
  thermal?: { gap: number; spokeW: number };
  /** minimum copper width of the pour, mm (stored/exported to KiCad only; not enforced in the Gerber fill) */
  minThickness?: number;
}

/** non-plated mounting hole */
export interface MountHole {
  x: number;
  y: number;
  drill: number;
}

export interface PcbDesign {
  /** board outline: w x h rectangle, or the polygon `poly` when present (then w/h must cover its max x / max y) */
  outline: { w: number; h: number; poly?: [number, number][] };
  /** NPTH mounting holes (optional) */
  holes?: MountHole[];
  placements: Record<string, PcbPlacement>;
  tracks: Track[];
  vias: Via[];
  zones: Zone[];
  rules: PcbRules;
  /** net class name per STABLE net key (smallest 'comp:pin' key of the net, see netclass.ts), not net index */
  netClassOf?: Record<string, string>;
  /** user net names per stable net key */
  netNames?: Record<string, string>;
  /** target copper length per STABLE net key (overrides the class target) */
  netLengthTargets?: Record<string, { mm: number; tol?: number }>;
  /** user selected differential pairs (stable net keys); pairs detected by the _P/_N name rule are added automatically */
  diffPairs?: { p: string; n: string }[];
  /** user defined footprints by key (take precedence over generator keys of the same name) */
  customFootprints?: Record<string, Footprint>;
}

export const DEFAULT_RULES: PcbRules = {
  minWidth: 0.2, minClearance: 0.2, minDrill: 0.3, minAnnular: 0.13, edgeClearance: 0.3,
  defaultWidth: 0.4, viaDia: 0.8, viaDrill: 0.4, copperOz: 1, voltage: 12, layers: 2, thickness: 1.6, er: 4.5,
};

export interface Pad {
  pin: string;
  /** local footprint coordinates, mm */
  x: number;
  y: number;
  shape: 'circle' | 'rect' | 'oval';
  w: number;
  h: number;
  /** 0 = SMD pad (top only), >0 = plated through hole */
  drill: number;
}

export interface Footprint {
  name: string;
  pads: Pad[];
  /** courtyard bounding box, mm (centred on the footprint origin) */
  width: number;
  height: number;
  smd: boolean;
  /** silkscreen outline segments, local mm */
  silk: { x1: number; y1: number; x2: number; y2: number }[];
}
