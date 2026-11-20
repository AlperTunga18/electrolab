import type { McuBoardSpec } from '../core/mcu/types';

export type Category =
  | 'passive'
  | 'semiconductor'
  | 'source'
  | 'io'
  | 'reference'
  | 'ic'
  | 'mcu'
  | 'power'
  | 'sensor'
  | 'display'
  | 'motor'
  | 'comm'
  | 'connector';

export type ModelKind =
  | 'resistor'
  | 'capacitor'
  | 'inductor'
  | 'diode'
  | 'led'
  | 'zener'
  | 'vsource'
  | 'isource'
  | 'ground'
  | 'switch'
  | 'pot'
  | 'npn'
  | 'pnp'
  | 'nmos'
  | 'pmos'
  | 'bridge'
  /** microcontroller board: GPIO = Thevenin sources driven by a firmware runtime */
  | 'mcu'
  /** brushed DC motor: R, L, back-EMF and rotor mechanics */
  | 'motor'
  /** bipolar 2-phase stepper: two R+L coils, sin/cos back-EMF with rotor angle, rotor mechanics */
  | 'stepper'
  /** hobby servo: behavioural model (pulse-width -> target angle, slew-limited, resistive supply load) */
  | 'servo'
  /** 3-phase brushless DC motor: star winding (floating neutral), trapezoidal back-EMF, rotor mechanics */
  | 'bldc'
  /** behavioural 6-step BLDC driver (ESC): analog throttle, commutation from the motor's electrical angle, average-value outputs */
  | 'bldc_esc'
  /** solenoid actuator: coil R + position-dependent L(x), reluctance force, return spring, stroke stops */
  | 'solenoid'
  /** electromechanical relay: coil R+L, contact with pull-in/drop-out delay */
  | 'relay'
  /** two coupled inductors with winding resistances */
  | 'transformer'
  /** programmable electronic load: CC / CR / CP */
  | 'eload'
  /** I2C/SPI chip: high-impedance pins, behaviour comes from the MCU bus layer (core/mcu/bus.ts), transaction-level only */
  | 'busdev'
  /** library-only: no electrical model, treated as open circuit and reported */
  | 'none';

/** Behavioural bus device (model === 'busdev'). `pins` maps a role (vcc, gnd, sda, scl, cs, clk, mosi, miso, vref, agnd, ch0..ch7) to a pin id. */
export interface BusDevSpec {
  kind: 'tmp102' | 'eeprom24c02' | 'mcp3008';
  bus: 'i2c' | 'spi';
  pins: Record<string, string>;
}

export interface PinDef {
  id: string;
  label: string;
  /** local offset in cm (x right, z toward viewer) */
  x: number;
  z: number;
  /** pin tip height in cm */
  y: number;
}

export interface ParamDef {
  key: string;
  label: string;
  unit: string;
  type: 'number' | 'select' | 'boolean';
  default: number | string | boolean;
  options?: { value: string | number; label: string }[];
  min?: number;
  max?: number;
  /** show using SI prefixes */
  si?: boolean;
}

export interface Rating {
  key: string; // param key holding the limit, or literal via value
  label: string;
  unit: string;
  /** what electrical quantity is compared */
  quantity: 'power' | 'voltage' | 'current' | 'reverseVoltage' | 'vds' | 'vce';
  value?: number;
  paramKey?: string;
}

export interface ComponentDef {
  type: string;
  name: string;
  nameEn: string;
  category: Category;
  prefix: string;
  model: ModelKind;
  pins: PinDef[];
  params: ParamDef[];
  ratings: Rating[];
  description: string;
  datasheet?: string;
  /** provenance of the numbers: generic textbook model vs. specific part */
  dataSource: 'generic-model' | 'manufacturer';
  /** fields we do not have yet; shown explicitly as missing */
  missing: string[];
  /** bounding box cm, for selection/footprint */
  size: { w: number; d: number; h: number };
  manufacturer?: string;
  mpn?: string;
  package?: string;
  /** human-readable datasheet-style figures, shown as-is (strings, with units) */
  specs?: Record<string, string>;
  tags?: string[];
  /** how much of this part the solver really models */
  simModel?: 'full' | 'partial' | 'none';
  simNote?: string;
  /** link target for datasheet (search page by part number, never a guessed PDF URL) */
  datasheetUrl?: string;
  /** all catalog numbers are typed in by hand and NOT yet checked against the datasheet */
  verified?: false | 'datasheet';
  userMade?: boolean;
  /** user-uploaded GLB/glTF (local, IndexedDB id in core/model3d/store.ts); replaces the parametric visual */
  model3d?: { id: string; fileName: string };
  visual?: {
    /** reuse an existing parametric model, e.g. 'resistor', 'led', 'npn', 'nmos_logic' */
    like?: string;
    kind?: 'ic' | 'board' | 'box' | 'cyl' | 'to220' | 'to92' | 'smd';
    color?: string;
    h?: number;
  };
  /** bus behaviour when model === 'busdev' */
  busdev?: BusDevSpec;
  /** electrical/firmware spec when model === 'mcu' */
  mcu?: McuBoardSpec;
}
