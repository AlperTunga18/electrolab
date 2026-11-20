/**
 * Behavioural models of bus devices. TRANSACTION-LEVEL: register maps and protocols are modelled, bit timing is not.
 * Numbers are typed from the datasheets of the named part class and are NOT verified against a real chip.
 */
import type { I2CDevice, SpiDevice } from './bus';

export type BusDevice = I2CDevice | SpiDevice;

export interface DevEnv {
  /** simulated time of the current bus access (seconds), set by the bus layer */
  clock: { t: number };
  /** current component parameter */
  param(key: string): number | string | boolean | undefined;
  /** VCC - GND of the chip in volts (0 when a supply pin is not connected) */
  supply(): number;
  /** voltage of a role pin relative to the chip's ground net */
  volt(role: string): number;
}

const numParam = (env: DevEnv, key: string, d: number): number => {
  const v = env.param(key);
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : d;
};

// ---------------------------------------------------------------------------------------------- TMP102 class
/**
 * TMP102 register map: pointer 0 = temperature (12-bit two's complement, 0.0625 C/LSB, left-justified in 16 bit),
 * 1 = configuration (reset 0x60A0), 2 = T_LOW (0x4B00), 3 = T_HIGH (0x5000).
 * The temperature comes from the `temp` component parameter and is sampled at the conversion rate (config CR bits,
 * default 4 Hz); shutdown (SD) freezes it until a one-shot (OS) request. ALERT pin and extended-mode are not modelled.
 */
export function tmp102(env: DevEnv): I2CDevice {
  let ptr = 0;
  let cfg = 0x60a0;
  let tlow = 0x4b00;
  let thigh = 0x5000;
  let raw = 0;
  let nextConv = 0;
  let sampled = false;
  let wIdx = 0;
  let rIdx = 0;
  let msb = 0;
  const sample = (): void => {
    const t = Math.max(-55, Math.min(127.9375, numParam(env, 'temp', 25)));
    raw = Math.round(t / 0.0625);
    sampled = true;
  };
  const convert = (): void => {
    const now = env.clock.t;
    const sd = (cfg & 0x0100) !== 0;
    if (!sampled) { sample(); nextConv = now; }
    if (sd) return;
    const hz = [0.25, 1, 4, 8][(cfg >> 6) & 3];
    if (now >= nextConv) { sample(); nextConv = now + 1 / hz; }
  };
  const reg = (): number => {
    if (ptr === 0) { convert(); return (raw & 0xfff) << 4; }
    return ptr === 1 ? cfg : ptr === 2 ? tlow : thigh;
  };
  return {
    get addr() { return [0x48, 0x49, 0x4a, 0x4b].includes(numParam(env, 'addr', 0x48)) ? numParam(env, 'addr', 0x48) : 0x48; },
    online: () => env.supply() >= 1.4,
    begin(write) { if (write) wIdx = 0; else rIdx = 0; },
    write(bytes) {
      for (const b of bytes) {
        if (wIdx === 0) ptr = b & 3;
        else if (wIdx === 1) msb = b & 255;
        else if (wIdx === 2) {
          const v = (msb << 8) | (b & 255);
          if (ptr === 1) {
            // R1R0 read back 11, AL is read-only, OS (bit 15) is a one-shot request that reads back 0 here (conversion is instant)
            cfg = (v & 0x1fdf) | 0x6000 | (cfg & 0x20);
            if ((v & 0x8000) && (cfg & 0x0100)) { sample(); nextConv = env.clock.t; }
          } else if (ptr === 2) tlow = v;
          else if (ptr === 3) thigh = v;
        }
        wIdx++;
      }
    },
    read(n) {
      const out: number[] = [];
      const r = reg();
      for (let i = 0; i < n; i++, rIdx++) out.push(rIdx === 0 ? r >> 8 : rIdx === 1 ? r & 255 : 0xff);
      return out;
    },
  };
}

// ---------------------------------------------------------------------------------------------- 24C02
/**
 * 24C02-style serial EEPROM: 256 bytes (erased = 0xFF), 8-byte pages, internal write cycle tWR = 5 ms started at
 * STOP (the chip NACKs its address during the cycle: ACK polling works), sequential read wraps at 256.
 * Write protect (WP) is not modelled (always writable). Contents survive MCU reset, not a simulation restart.
 */
export const EEPROM_SIZE = 256;
export const EEPROM_PAGE = 8;
export const EEPROM_TWR = 5e-3;
export function eeprom24c02(env: DevEnv): I2CDevice {
  const mem = new Uint8Array(EEPROM_SIZE).fill(0xff);
  let ptr = 0;
  let wIdx = 0;
  let pend: [number, number][] = [];
  let busyUntil = -1;
  return {
    get addr() { const a = numParam(env, 'addr', 0x50); return a >= 0x50 && a <= 0x57 ? a : 0x50; },
    online: () => env.supply() >= 1.7 && env.clock.t >= busyUntil,
    begin(write) { wIdx = 0; pend = []; void write; },
    write(bytes) {
      for (const b of bytes) {
        if (wIdx === 0) ptr = b & 255;
        else {
          pend.push([ptr, b & 255]);
          ptr = (ptr & ~(EEPROM_PAGE - 1)) | ((ptr + 1) & (EEPROM_PAGE - 1)); // page roll-over
        }
        wIdx++;
      }
    },
    read(n) {
      const out: number[] = [];
      for (let i = 0; i < n; i++) { out.push(mem[ptr]); ptr = (ptr + 1) & (EEPROM_SIZE - 1); }
      return out;
    },
    stop() {
      if (pend.length) {
        for (const [a, v] of pend) mem[a] = v;
        busyUntil = env.clock.t + EEPROM_TWR;
      }
      pend = [];
    },
  };
}

// ---------------------------------------------------------------------------------------------- MCP3008
/**
 * MCP3008 8-channel 10-bit SAR ADC (SPI mode 0/3, 3-byte frame): tx {0x01, SGL/DIFF|D2 D1 D0 <<4, x},
 * rx {x, 0b00000 null B9 B8, B7..B0}; code = floor(1024 * Vin / Vref) clamped to 0..1023, Vin referenced to AGND,
 * Vref = VREF pin voltage (relative to AGND). Differential pairs CH0/1, 2/3, 4/5, 6/7 (negative results clamp to 0).
 * Only the standard 3-byte frame (start bit in the LSB of byte 0) is modelled, not unaligned 17-clock frames.
 * Sample-and-hold time, input leakage/source-impedance error, DNL/INL and clock-rate limits are not modelled.
 */
export function mcp3008(env: DevEnv): SpiDevice {
  let stage = 0;
  let code = 0;
  const convert = (cfg: number): number => {
    const single = (cfg & 0x80) !== 0;
    const ch = (cfg >> 4) & 7;
    const vref = env.volt('vref') - env.volt('agnd');
    if (!(vref > 0.1)) return 0;
    const chv = (i: number): number => env.volt(`ch${i}`) - env.volt('agnd');
    let v: number;
    if (single) v = chv(ch);
    else {
      const p = ch & ~1;
      v = ch & 1 ? chv(p + 1) - chv(p) : chv(p) - chv(p + 1);
    }
    return Math.max(0, Math.min(1023, Math.floor((1024 * v) / vref)));
  };
  return {
    online: () => env.supply() >= 2.7,
    select(on) { stage = 0; void on; },
    transfer(b) {
      if (stage === 0) {
        if (b & 1) stage = 1;
        return 0;
      }
      if (stage === 1) {
        code = convert(b);
        stage = 2;
        return (code >> 8) & 3;
      }
      if (stage === 2) { stage = 3; return code & 255; }
      return 0;
    },
  };
}

export function createBusDevice(kind: 'tmp102' | 'eeprom24c02' | 'mcp3008', env: DevEnv): BusDevice {
  switch (kind) {
    case 'tmp102': return tmp102(env);
    case 'eeprom24c02': return eeprom24c02(env);
    case 'mcp3008': return mcp3008(env);
  }
}
