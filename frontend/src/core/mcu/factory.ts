import type { McuBoardSpec, McuRuntime } from './types';
import { AvrRuntime } from './avr/AvrRuntime';
import { Rp2040Runtime } from './rp2040/Rp2040Runtime';
import { SketchRuntime } from './sketch';

/** Creates the firmware runtime for a board. `sketch` = built-in Arduino-subset interpreter, `hex` = AVR machine-code emulator (ATmega328P only), `uf2` = RP2040 machine-code emulator (rp2040js, Pico). */
export function createRuntime(kind: 'sketch' | 'hex' | 'uf2', spec: McuBoardSpec): McuRuntime | null {
  if (kind === 'uf2') return spec.family === 'rp2040' ? new Rp2040Runtime(spec) : null;
  if (kind === 'hex') return spec.family === 'avr' && spec.pinMap[19] === 'A5/SCL' ? new AvrRuntime(spec) : null;
  return new SketchRuntime(spec);
}
