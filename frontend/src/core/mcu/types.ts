/**
 * MCU layer contract. A runtime executes firmware against SIMULATED time and talks to the electrical
 * solver only through pin drives (out) and pin voltages (in). Nothing here may pretend hardware that is not simulated.
 */

import type { McuBusLink } from './bus';

export type PinMode = 'in' | 'out' | 'pullup';

/** What the firmware is currently doing on a physical pin. */
export interface PinDrive {
  mode: PinMode;
  /** output level (only meaningful for mode 'out'); PWM/tone are represented by this level changing over time */
  high: boolean;
}

export interface McuBoardSpec {
  family: 'avr' | 'esp32' | 'rp2040';
  /** logic high level / VDD in volts */
  vcc: number;
  /** size of C `int` in bits (AVR: 16, ESP32/RP2040: 32) */
  intBits: 16 | 32;
  cpuHz: number;
  adcBits: number;
  adcVref: number;
  /** Arduino pin number -> board pin id (the ids used in ComponentDef.pins) */
  pinMap: Record<number, string>;
  /** named constants visible to sketches: A0, LED_BUILTIN, SDA, SCL, ... */
  constants: Record<string, number>;
  /** Arduino pin numbers that can do analogWrite */
  pwmPins: number[];
  pwmHz: number;
  /** Arduino pin numbers usable with analogRead */
  adcPins: number[];
  /** pins that cannot be outputs */
  inputOnly: number[];
  /** electrical model of one GPIO */
  rOutHigh: number;
  rOutLow: number;
  rPullup: number;
  /** absolute-maximum numbers used for stress/damage checks */
  imaxPin: number;
  vInMargin: number;
  /** brown-out reset threshold (V) on the logic rail; below it the MCU is held in reset. Typical values, NOT verified ('typical, doğrulanmadı'). Absent = no brown-out model. */
  brownoutV?: number;
  /** supply pins: board pin id -> source description */
  supplies: { pin: string; v: number; rout: number; imax: number; label: string }[];
  /** board pin ids that are ground (internally tied together) */
  gnd: string[];
  /** external-interrupt pins (Arduino numbers) in AVR interrupt-number order (INT0, INT1, ...); absent = every GPIO can interrupt (ESP32/RP2040) */
  intPins?: number[];
  /** default hardware SPI pins (Arduino numbers) */
  spi?: { mosi: number; miso: number; sck: number; ss: number };
  /** human notes: boot pins, restricted pins, ... shown in the MCU lab */
  notes: string[];
}

export interface McuHost {
  /** voltage of a board pin relative to the board's own ground, from the last electrical solution */
  readVoltage(pinId: string): number;
}

export interface Diagnostic {
  line: number;
  col?: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface GpioInfo {
  pin: string;
  /** Arduino-style number if any */
  num?: number;
  mode: PinMode | 'unconfigured' | 'pwm';
  high: boolean;
  /** PWM duty 0..1 when analogWrite is active */
  duty?: number;
}

export interface McuRuntime {
  readonly kind: 'sketch' | 'avr' | 'rp2040';
  /** compile/parse the firmware; never throws */
  load(source: string): { ok: boolean; diagnostics: Diagnostic[] };
  /** restart program from the beginning (keeps loaded program) */
  reset(): void;
  /** reset and make the program start at simulated time `t` (no catch-up of the elapsed time); used after a brown-out */
  restartAt(t: number): void;
  /** run the program until simulated time `simTime` (seconds), reading inputs via host */
  advance(simTime: number, host: McuHost): void;
  /** current pin drives at sim time (only pins the firmware has configured). PWM is evaluated at simTime. */
  drives(simTime: number): Map<string, PinDrive>;
  /** serial output sink, set by the owner */
  onSerial: (text: string) => void;
  /** text typed into the serial monitor */
  serialWrite(text: string): void;
  /** pin table for the GPIO monitor */
  gpio(simTime: number): GpioInfo[];
  /** runtime warnings (unsupported peripherals etc.), deduplicated */
  warnings(): string[];
  /** connect the simulated I2C/SPI bus layer (see bus.ts); optional, a runtime without it sees an empty bus */
  setBus?(link: McuBusLink | null): void;
  /** set when the program stopped (error, fault) */
  halted(): string | null;
}
