/**
 * Protocol decoders (UART, I2C, SPI) for the logic analyzer / protocol decoder tab.
 *
 * Input is a DigitalTrace: sample times and boolean levels (use `toTrace` to threshold an analog net with hysteresis).
 * The trace is interpreted as a step function: the level at time t is v[i] for the last i with t[i] <= t, so a trace
 * may be a dense sample stream or just a list of transitions. A transition is timed at the first sample showing the
 * new level, i.e. edge timing resolution = the sample spacing (for simulator buffers: the transient time step).
 */
import { digitize } from './readings';

export interface DigitalTrace { t: number[]; v: boolean[] }

export type FrameType = 'uart' | 'start' | 'stop' | 'addr' | 'data' | 'spi' | 'error';

export interface Frame {
  t0: number;
  t1: number;
  type: FrameType;
  value: number;
  text: string;
  /** error flag, e.g. 'frame', 'parity', 'nack', 'incomplete' */
  error?: string;
  /** second value for full-duplex frames (SPI MISO) */
  aux?: number;
}

/** threshold an analog trace with hysteresis (Schmitt trigger) */
export function toTrace(t: number[], volts: number[], threshold: number, hyst = 0.15): DigitalTrace {
  return { t: t.slice(0, volts.length), v: digitize(volts, threshold, hyst) };
}

interface Edge { t: number; level: boolean }

/** transitions of a trace (the first sample defines the initial level, it is not an edge) */
export function edgesOf(tr: DigitalTrace): Edge[] {
  const out: Edge[] = [];
  for (let i = 1; i < tr.v.length; i++) if (tr.v[i] !== tr.v[i - 1]) out.push({ t: tr.t[i], level: tr.v[i] });
  return out;
}

const initial = (tr: DigitalTrace): boolean => tr.v[0] ?? true;

/** level of the step function described by (initial level, edges) at time t; binary search */
function levelAt(init: boolean, edges: Edge[], t: number): boolean {
  let lo = 0, hi = edges.length; // count of edges with edge.t <= t
  while (lo < hi) { const mid = (lo + hi) >> 1; if (edges[mid].t <= t) lo = mid + 1; else hi = mid; }
  return lo === 0 ? init : edges[lo - 1].level;
}

const hex = (n: number, digits = 2): string => `0x${n.toString(16).toUpperCase().padStart(digits, '0')}`;
const printable = (n: number): string => (n >= 32 && n < 127 ? ` '${String.fromCharCode(n)}'` : '');

// ---------------------------------------------------------------- UART

export const STANDARD_BAUDS = [300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 38400, 57600, 76800, 115200, 230400, 250000, 460800, 500000, 921600, 1000000];

export interface UartOptions {
  /** baud rate; omitted/0 = auto-detect from the shortest pulse */
  baud?: number;
  dataBits?: 5 | 6 | 7 | 8 | 9;
  parity?: 'none' | 'even' | 'odd';
  stopBits?: 1 | 2;
  /** UART sends the least significant bit first (default true) */
  lsbFirst?: boolean;
  /** inverted line (idle low, RS-232 style levels after the transceiver) */
  invert?: boolean;
}

/**
 * baud estimate: start from the shortest interval between edges, then refine by fitting all short intervals
 * as integer multiples of the bit time (bit = sum(d) / sum(round(d / bit)), 3 iterations) so that sample-grid
 * quantisation averages out; snap to a standard rate when within 5 %.
 */
export function detectBaud(tr: DigitalTrace): number | null {
  const e = edgesOf(tr);
  if (e.length < 2) return null;
  const d: number[] = [];
  let min = Infinity;
  for (let i = 1; i < e.length; i++) { const x = e[i].t - e[i - 1].t; if (x > 0) { d.push(x); if (x < min) min = x; } }
  if (!Number.isFinite(min)) return null;
  let bit = min;
  for (let it = 0; it < 3; it++) {
    let sum = 0, cnt = 0;
    for (const x of d) { if (x > 8 * min) continue; const n = Math.max(1, Math.round(x / bit)); sum += x; cnt += n; }
    if (cnt) bit = sum / cnt;
  }
  const raw = 1 / bit;
  const near = STANDARD_BAUDS.find((b) => Math.abs(b - raw) / b < 0.05);
  return near ?? raw;
}

/**
 * UART decoder. Looks for the falling edge of a start bit while idle (high), samples every bit at its centre
 * (start + (k + 0.5) / baud), checks the stop bit(s) (framing error if low) and parity (parity error if wrong).
 * After a frame the search for the next start bit resumes in the middle of the last stop bit.
 */
export function decodeUart(tr: DigitalTrace, o: UartOptions = {}): { frames: Frame[]; baud: number | null } {
  const baud = o.baud && o.baud > 0 ? o.baud : detectBaud(tr);
  if (!baud) return { frames: [], baud: null };
  const nd = o.dataBits ?? 8, par = o.parity ?? 'none', ns = o.stopBits ?? 1, lsb = o.lsbFirst ?? true, inv = o.invert ?? false;
  const bit = 1 / baud;
  const idle = true; // after optional inversion the idle level is high
  const eRaw = edgesOf(tr);
  const e = inv ? eRaw.map((x) => ({ t: x.t, level: !x.level })) : eRaw;
  const init = inv ? !initial(tr) : initial(tr);
  const tEnd = tr.t[tr.t.length - 1] ?? 0;
  const frames: Frame[] = [];
  let from = -Infinity;
  for (const edge of e) {
    if (edge.t < from || edge.level === idle) continue;
    // start bit begins here
    const t0 = edge.t;
    const frameBits = 1 + nd + (par === 'none' ? 0 : 1) + ns;
    if (t0 + (frameBits - 0.25) * bit > tEnd + bit * 0.01) break; // truncated at end of capture
    // start bit validation at its centre
    if (levelAt(init, e, t0 + 0.5 * bit) === idle) { from = t0 + 0.5 * bit; continue; } // glitch
    let value = 0, ones = 0;
    for (let k = 0; k < nd; k++) {
      const b = levelAt(init, e, t0 + (1.5 + k) * bit) ? 1 : 0;
      ones += b;
      value |= b << (lsb ? k : nd - 1 - k);
    }
    let error: string | undefined;
    let pos = 1 + nd;
    if (par !== 'none') {
      const pb = levelAt(init, e, t0 + (pos + 0.5) * bit) ? 1 : 0;
      const expect = par === 'even' ? ones & 1 : (ones & 1) ^ 1;
      if (pb !== expect) error = 'parity';
      pos++;
    }
    for (let s = 0; s < ns; s++) {
      if (levelAt(init, e, t0 + (pos + 0.5 + s) * bit) !== idle) { error = error ? `${error}+frame` : 'frame'; break; }
    }
    const t1 = t0 + (pos + ns) * bit;
    const label = nd <= 8 ? `${hex(value)}${printable(value)}` : hex(value, 3);
    frames.push({ t0, t1, type: 'uart', value, text: error ? `${label}  [${error === 'parity' ? 'eşlik hatası' : error === 'frame' ? 'çerçeve hatası' : 'eşlik+çerçeve hatası'}]` : label, error });
    from = t0 + (pos + ns - 0.5) * bit;
  }
  return { frames, baud };
}

// ---------------------------------------------------------------- I2C

interface Ev { t: number; line: 'sda' | 'scl'; level: boolean }

/**
 * I2C decoder (7-bit addressing; 10-bit addressing and clock stretching analysis are not implemented).
 * START = SDA falling while SCL high (a second START before STOP is a repeated start), STOP = SDA rising while SCL high.
 * Data bits are sampled on SCL rising edges, MSB first, 9 clocks per byte (8 data + ACK, ACK = SDA low).
 * First byte after START = address (7 bits) + R/W. Errors: address NACK (no device), data NACK while writing
 * (a NACK after the last byte the master reads is normal and not an error), truncated byte at START/STOP.
 * A single pending bit at START/STOP is the set-up clock pulse of that condition and is not reported.
 */
export function decodeI2c(sda: DigitalTrace, scl: DigitalTrace): Frame[] {
  const ev: Ev[] = [];
  for (const x of edgesOf(sda)) ev.push({ t: x.t, line: 'sda', level: x.level });
  for (const x of edgesOf(scl)) ev.push({ t: x.t, line: 'scl', level: x.level });
  // ties: SCL falling, then SDA change, then SCL rising
  const rank = (x: Ev) => (x.line === 'scl' ? (x.level ? 2 : 0) : 1);
  ev.sort((a, b) => a.t - b.t || rank(a) - rank(b));
  let vSda = initial(sda), vScl = initial(scl);
  const frames: Frame[] = [];
  let inFrame = false;
  let bits: number[] = [];
  let tBit0 = 0;
  let byteIdx = 0;
  let read = false;
  const finishByte = (tAck: number, ack: boolean) => {
    const v = bits.slice(0, 8).reduce((a, b) => (a << 1) | b, 0);
    if (byteIdx === 0) {
      read = (v & 1) === 1;
      const addr = v >> 1;
      frames.push({ t0: tBit0, t1: tAck, type: 'addr', value: addr, text: `Adres ${hex(addr)} ${read ? 'O' : 'Y'} ${ack ? 'ACK' : 'NACK'}`, error: ack ? undefined : 'nack', aux: v & 1 });
    } else {
      const err = !ack && !read;
      frames.push({ t0: tBit0, t1: tAck, type: 'data', value: v, text: `${hex(v)} ${ack ? 'ACK' : 'NACK'}`, error: err ? 'nack' : undefined });
    }
    byteIdx++;
    bits = [];
  };
  for (const x of ev) {
    if (x.line === 'sda') {
      const was = vSda; vSda = x.level;
      if (vScl && was !== x.level) {
        if (!x.level) { // START
          if (inFrame && bits.length > 1) frames.push({ t0: tBit0, t1: x.t, type: 'error', value: 0, text: `Eksik bayt (${bits.length} bit)`, error: 'incomplete' });
          frames.push({ t0: x.t, t1: x.t, type: 'start', value: 0, text: inFrame ? 'Tekrarlı START' : 'START' });
          inFrame = true; bits = []; byteIdx = 0;
        } else if (inFrame) { // STOP
          if (bits.length > 1) frames.push({ t0: tBit0, t1: x.t, type: 'error', value: 0, text: `Eksik bayt (${bits.length} bit)`, error: 'incomplete' });
          frames.push({ t0: x.t, t1: x.t, type: 'stop', value: 0, text: 'STOP' });
          inFrame = false; bits = [];
        }
      }
    } else {
      const was = vScl; vScl = x.level;
      if (inFrame && !was && x.level) { // rising SCL: sample
        if (bits.length === 0) tBit0 = x.t;
        bits.push(vSda ? 1 : 0);
        if (bits.length === 9) { const ack = bits[8] === 0; finishByte(x.t, ack); }
      }
    }
  }
  return frames;
}

// ---------------------------------------------------------------- SPI

export interface SpiOptions {
  /** SPI mode 0..3: CPOL = mode >> 1, CPHA = mode & 1 */
  mode?: 0 | 1 | 2 | 3;
  bitOrder?: 'msb' | 'lsb';
  bits?: number;
  /** chip select active level (default low) */
  csActiveLow?: boolean;
}

/**
 * SPI decoder. Bits are sampled on the clock edge selected by the mode: mode 0 rising, 1 falling, 2 falling, 3 rising
 * (sampling edge is rising when CPOL == CPHA). With a CS trace only clocks inside an active CS window are used
 * and a window with a bit count that is not a multiple of `bits` yields an 'incomplete' error frame; without CS the
 * stream is cut into words continuously. MOSI/MISO are optional but at least one must be given.
 */
export function decodeSpi(sck: DigitalTrace, mosi: DigitalTrace | null, miso: DigitalTrace | null, cs: DigitalTrace | null, o: SpiOptions = {}): Frame[] {
  const mode = o.mode ?? 0, nb = o.bits ?? 8, msb = (o.bitOrder ?? 'msb') === 'msb', csLow = o.csActiveLow ?? true;
  const cpol = (mode >> 1) & 1, cpha = mode & 1;
  const sampleRising = cpol === cpha;
  const eSck = edgesOf(sck).filter((x) => x.level === sampleRising);
  const mo = mosi ? { init: initial(mosi), e: edgesOf(mosi) } : null;
  const mi = miso ? { init: initial(miso), e: edgesOf(miso) } : null;
  const csE = cs ? { init: initial(cs), e: edgesOf(cs) } : null;
  const active = (t: number): boolean => (csE ? levelAt(csE.init, csE.e, t) === !csLow : true);
  const frames: Frame[] = [];
  let a = 0, b = 0, n = 0, t0 = 0, tLast = 0, window = -1;
  // CS window id of a time = number of CS edges before it (so a new CS assertion starts a new word)
  const winId = (t: number): number => (csE ? csE.e.filter((x) => x.t <= t).length : 0);
  const flush = (incomplete: boolean) => {
    if (n === 0) return;
    if (incomplete) {
      frames.push({ t0, t1: tLast, type: 'error', value: 0, text: `Eksik kelime (${n}/${nb} bit)`, error: 'incomplete' });
    }
    a = 0; b = 0; n = 0;
  };
  for (const x of eSck) {
    if (!active(x.t)) continue;
    const id = winId(x.t);
    if (id !== window) { flush(true); window = id; }
    if (n === 0) t0 = x.t;
    const bm = mo && levelAt(mo.init, mo.e, x.t) ? 1 : 0, bi = mi && levelAt(mi.init, mi.e, x.t) ? 1 : 0;
    if (msb) { a = (a << 1) | bm; b = (b << 1) | bi; } else { a |= bm << n; b |= bi << n; }
    n++; tLast = x.t;
    if (n === nb) {
      const digits = Math.ceil(nb / 4);
      const parts: string[] = [];
      if (mo) parts.push(`MOSI ${hex(a >>> 0, digits)}`);
      if (mi) parts.push(`MISO ${hex(b >>> 0, digits)}`);
      frames.push({ t0, t1: x.t, type: 'spi', value: mo ? a >>> 0 : b >>> 0, aux: mo && mi ? b >>> 0 : undefined, text: parts.join('  ') });
      a = 0; b = 0; n = 0;
    }
  }
  flush(!!csE);
  return frames;
}
