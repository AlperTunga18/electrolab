import type { PcbDesign } from '../pcb/types';
/** Central circuit data model. Both the 3D view and (later) the 2D schematic edit this single model. */

export type ParamValue = number | string | boolean;
export type ParamMap = Record<string, ParamValue>;

export interface PinRef {
  comp: string;
  pin: string;
}

export type FaultKind =
  | 'open' | 'short' | 'drift' | 'capLoss' | 'leak' | 'gateShort' | 'welded' | 'stuckOpen' | 'intermittent' | 'stalled'
  | 'reverseVoltage' | 'lowVoltage' | 'esrRise' | 'insulationFault' | 'looseConnector' | 'openPhase';

export interface Fault {
  kind: FaultKind;
  /** drift/capLoss/esrRise: percent; leak/insulationFault: ohms; intermittent: Hz; lowVoltage: supply sag in percent; looseConnector: max contact resistance in ohms */
  amount?: number;
  /** insulationFault: the component pin the leakage starts at (default: first main pin) */
  pin?: string;
  /** insulationFault: any pin on the target net (default: ground) */
  to?: PinRef;
  /** set when the fault was produced by the damage model (not injected by the user) */
  auto?: boolean;
  t?: number;
}

export type HeatsinkSize = 'none' | 'small' | 'medium' | 'large';

export interface PlacedComponent {
  id: string;
  type: string;
  ref: string; // R1, C2, ...
  x: number; // cm, board plane
  z: number;
  rot: 0 | 1 | 2 | 3; // quarter turns around Y
  params: ParamMap;
  thermal?: { heatsink: HeatsinkSize; fan: boolean };
  /** schematic placement (grid px, quarter turns clockwise); auto-laid-out when absent */
  sch?: { x: number; y: number; rot: 0 | 1 | 2 | 3 };
}

export interface Wire {
  id: string;
  a: PinRef;
  b: PinRef;
  color: string;
  width: number; // px-ish thickness for rendering
  broken?: boolean; // cut wire: conducts nothing
  /** loose connector / bad crimp: time-varying contact resistance (0.05 ohm .. rmax, occasional open), see core/sim/loose.ts */
  loose?: { rmax?: number };
  /**
   * T-junction (schematic): this wire starts at pin `a` and ends in the MIDDLE of wire `tap.wire` at schematic point (x, y).
   * Electrically it is a plain pin-to-pin wire: `b` is one end pin of the host wire (so nets.ts, 3D and the solver stay unchanged);
   * the schematic draws it to the host wire and puts a junction dot there instead of going to `b`.
   */
  tap?: { wire: string; x: number; y: number };
}

export interface Firmware {
  /** 'sketch': Arduino-style source run by the built-in interpreter; 'hex': compiled Intel HEX run by the AVR emulator; 'uf2': compiled RP2040 UF2 (base64) run by the rp2040js emulator */
  kind: 'sketch' | 'hex' | 'uf2';
  source: string;
}

export interface Circuit {
  components: PlacedComponent[];
  wires: Wire[];
  /** user-injected faults, keyed by component id */
  faults?: Record<string, Fault>;
  /** ambient temperature in degC (default 25) */
  ambient?: number;
  /** firmware per MCU component id */
  firmware?: Record<string, Firmware>;
  /** PCB design (mm) derived from and linked to this circuit */
  pcb?: PcbDesign;
}

export const emptyCircuit = (): Circuit => ({ components: [], wires: [] });

export const pinKey = (p: PinRef): string => `${p.comp}:${p.pin}`;
