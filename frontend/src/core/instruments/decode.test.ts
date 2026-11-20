import { describe, expect, it } from 'vitest';
import { decodeI2c, decodeSpi, decodeUart, detectBaud, toTrace, type DigitalTrace } from './decode';

/** step trace builder: transitions only (initial level at t=0) */
class Wave {
  t: number[] = [0]; v: boolean[];
  constructor(init: boolean) { this.v = [init]; }
  set(t: number, level: boolean) { if (this.v[this.v.length - 1] !== level) { this.t.push(t); this.v.push(level); } }
  end(t: number): DigitalTrace { this.t.push(t); this.v.push(this.v[this.v.length - 1]); return { t: this.t, v: this.v }; }
}

function uartWave(bytes: number[], baud: number, o: { parity?: 'none' | 'even' | 'odd'; badParity?: boolean; badStop?: boolean; nd?: number; stop?: number } = {}): DigitalTrace {
  const w = new Wave(true), bit = 1 / baud, nd = o.nd ?? 8;
  let t = 100e-6;
  for (const b of bytes) {
    const bits: boolean[] = [false];
    let ones = 0;
    for (let k = 0; k < nd; k++) { const x = (b >> k) & 1; ones += x; bits.push(x === 1); }
    if (o.parity && o.parity !== 'none') { let p = o.parity === 'even' ? ones & 1 : (ones & 1) ^ 1; if (o.badParity) p ^= 1; bits.push(p === 1); }
    for (let s = 0; s < (o.stop ?? 1); s++) bits.push(!o.badStop);
    bits.forEach((lv, i) => w.set(t + i * bit, lv));
    t += bits.length * bit;
    if (o.badStop) w.set(t, true); // line recovers after the bad stop bit
    t += 2 * bit; // idle gap
  }
  return w.end(t + 5 * bit);
}

describe('UART', () => {
  it("9600 8N1 'Hi' with explicit and auto baud", () => {
    const tr = uartWave([0x48, 0x69], 9600);
    for (const baud of [9600, undefined]) {
      const r = decodeUart(tr, { baud });
      expect(r.baud).toBe(9600);
      expect(r.frames.map((f) => f.value)).toEqual([0x48, 0x69]);
      expect(r.frames.every((f) => !f.error)).toBe(true);
      expect(r.frames[0].text).toBe("0x48 'H'");
      expect(r.frames[0].t0).toBeCloseTo(100e-6, 9);
      expect(r.frames[0].t1 - r.frames[0].t0).toBeCloseTo(10 / 9600, 9);
    }
  });

  it('auto-detects 115200 and decodes dense sampled data', () => {
    const w = uartWave([0xA5, 0x00, 0xFF, 0x0F], 115200);
    const t: number[] = [], v: boolean[] = [];
    let j = 0;
    for (let x = 0; x < w.t[w.t.length - 1]; x += 1e-6) { while (j + 1 < w.t.length && w.t[j + 1] <= x) j++; t.push(x); v.push(w.v[j]); }
    const r = decodeUart({ t, v });
    expect(r.baud).toBe(115200);
    expect(r.frames.map((f) => f.value)).toEqual([0xA5, 0x00, 0xFF, 0x0F]);
  });

  it('7E1 even parity ok; bad parity flagged', () => {
    const good = decodeUart(uartWave([0x41, 0x7F], 4800, { parity: 'even', nd: 7 }), { baud: 4800, dataBits: 7, parity: 'even' });
    expect(good.frames.map((f) => f.value)).toEqual([0x41, 0x7F]);
    expect(good.frames.every((f) => !f.error)).toBe(true);
    const bad = decodeUart(uartWave([0x41, 0x7F], 4800, { parity: 'even', nd: 7, badParity: true }), { baud: 4800, dataBits: 7, parity: 'even' });
    expect(bad.frames.map((f) => f.error)).toEqual(['parity', 'parity']);
    const odd = decodeUart(uartWave([0x55], 4800, { parity: 'odd' }), { baud: 4800, parity: 'odd' });
    expect(odd.frames[0].error).toBeUndefined();
  });

  it('framing error when the stop bit is low; 2 stop bits; MSB first', () => {
    const f = decodeUart(uartWave([0x31], 9600, { badStop: true }), { baud: 9600 });
    expect(f.frames[0].value).toBe(0x31);
    expect(f.frames[0].error).toBe('frame');
    const two = decodeUart(uartWave([0x12, 0x34], 9600, { stop: 2 }), { baud: 9600, stopBits: 2 });
    expect(two.frames.map((x) => x.value)).toEqual([0x12, 0x34]);
    expect(two.frames.every((x) => !x.error)).toBe(true);
    const msb = decodeUart(uartWave([0x01], 9600), { baud: 9600, lsbFirst: false });
    expect(msb.frames[0].value).toBe(0x80);
  });

  it('inverted line and detectBaud on a non-standard rate', () => {
    const tr = uartWave([0x48], 9600);
    const inv = { t: tr.t, v: tr.v.map((x) => !x) };
    expect(decodeUart(inv, { baud: 9600, invert: true }).frames[0].value).toBe(0x48);
    expect(detectBaud(uartWave([0x55], 12345))).toBeCloseTo(12345, 0);
  });

  it('idle trace yields no frames', () => {
    expect(decodeUart({ t: [0, 1], v: [true, true] }).frames).toEqual([]);
  });

  it('toTrace thresholds with hysteresis', () => {
    const tr = toTrace([0, 1, 2, 3, 4], [0, 3.3, 1.7, 1.5, 0], 1.65, 0.3);
    expect(tr.v).toEqual([false, true, true, true, false]);
  });
});

/** I2C waveform builder, half clock 5 us */
function i2cWaves(script: { start?: boolean; stop?: boolean; byte?: number; ack?: boolean }[]) {
  const sda = new Wave(true), scl = new Wave(true);
  const h = 5e-6;
  let t = 20e-6;
  for (const s of script) {
    if (s.start) {
      sda.set(t, true); scl.set(t, true); t += h;
      sda.set(t, false); t += h; scl.set(t, false); t += h;
    } else if (s.stop) {
      sda.set(t, false); t += h; scl.set(t, true); t += h; sda.set(t, true); t += 2 * h;
    } else {
      const bits: boolean[] = [];
      for (let k = 7; k >= 0; k--) bits.push((((s.byte ?? 0) >> k) & 1) === 1);
      bits.push(s.ack === false); // ACK = SDA low; NACK = SDA high
      for (const b of bits) { sda.set(t, b); t += h; scl.set(t, true); t += h; scl.set(t, false); t += h; }
    }
  }
  const end = t + 10 * h;
  return { sda: sda.end(end), scl: scl.end(end) };
}

describe('I2C', () => {
  it('write 0x48 reg 0x00, repeated start, read two bytes', () => {
    const { sda, scl } = i2cWaves([
      { start: true }, { byte: 0x48 << 1 }, { byte: 0x00 },
      { start: true }, { byte: (0x48 << 1) | 1 }, { byte: 0x1A }, { byte: 0x80, ack: false }, { stop: true },
    ]);
    const f = decodeI2c(sda, scl);
    expect(f.map((x) => x.type)).toEqual(['start', 'addr', 'data', 'start', 'addr', 'data', 'data', 'stop']);
    expect(f[0].text).toBe('START');
    expect(f[1].value).toBe(0x48); expect(f[1].aux).toBe(0); expect(f[1].text).toBe('Adres 0x48 Y ACK');
    expect(f[2].value).toBe(0x00);
    expect(f[3].text).toBe('Tekrarlı START');
    expect(f[4].value).toBe(0x48); expect(f[4].aux).toBe(1); expect(f[4].text).toBe('Adres 0x48 O ACK');
    expect([f[5].value, f[6].value]).toEqual([0x1A, 0x80]);
    expect(f[6].text).toBe('0x80 NACK');
    expect(f.every((x) => !x.error)).toBe(true); // master NACK after the last read byte is normal
    expect(f[1].t0).toBeLessThan(f[1].t1);
    expect(f[1].t1).toBeLessThan(f[2].t0);
  });

  it('missing ACK on the address and on a written data byte are errors', () => {
    const a = i2cWaves([{ start: true }, { byte: 0x50 << 1, ack: false }, { stop: true }]);
    const fa = decodeI2c(a.sda, a.scl);
    expect(fa[1].type).toBe('addr'); expect(fa[1].error).toBe('nack'); expect(fa[1].value).toBe(0x50);
    const d = i2cWaves([{ start: true }, { byte: 0x48 << 1 }, { byte: 0x55, ack: false }, { stop: true }]);
    const fd = decodeI2c(d.sda, d.scl);
    expect(fd[2].value).toBe(0x55); expect(fd[2].error).toBe('nack');
    expect(fd[1].error).toBeUndefined();
  });

  it('truncated byte at STOP is flagged', () => {
    const sda = new Wave(true), scl = new Wave(true);
    sda.set(10e-6, false); scl.set(15e-6, false);
    [true, false, true].forEach((b, i) => { sda.set(20e-6 + i * 10e-6, b); scl.set(25e-6 + i * 10e-6, true); scl.set(30e-6 + i * 10e-6, false); });
    sda.set(52e-6, false); scl.set(60e-6, true); sda.set(65e-6, true);
    const f = decodeI2c(sda.end(100e-6), scl.end(100e-6));
    expect(f.map((x) => x.type)).toEqual(['start', 'error', 'stop']);
    expect(f[1].error).toBe('incomplete');
  });
});

function spiWaves(bytes: number[], o: { mode: 0 | 1 | 2 | 3; lsb?: boolean; miso?: number[]; cs?: boolean; truncate?: number }) {
  const cpol = (o.mode >> 1) & 1, cpha = o.mode & 1;
  const sck = new Wave(cpol === 1), mosi = new Wave(false), miso = new Wave(false), cs = new Wave(true);
  const h = 2e-6;
  let t = 10e-6;
  if (o.cs !== false) { cs.set(t, false); t += 2 * h; }
  bytes.forEach((byte, bi) => {
    for (let k = 0; k < 8; k++) {
      if (o.truncate !== undefined && bi * 8 + k >= o.truncate) break;
      const idx = o.lsb ? k : 7 - k;
      const mb = ((byte >> idx) & 1) === 1, ib = (((o.miso?.[bi] ?? 0) >> idx) & 1) === 1;
      if (cpha === 0) { // data valid before the leading edge
        mosi.set(t, mb); miso.set(t, ib); t += h; sck.set(t, cpol === 0); t += h; sck.set(t, cpol === 1); t += h;
      } else { // data changes at the leading edge, sampled on the trailing edge
        sck.set(t, cpol === 0); mosi.set(t, mb); miso.set(t, ib); t += h; sck.set(t, cpol === 1); t += h;
      }
    }
  });
  t += 2 * h;
  if (o.cs !== false) { cs.set(t, true); t += 2 * h; }
  const end = t + 10 * h;
  return { sck: sck.end(end), mosi: mosi.end(end), miso: miso.end(end), cs: cs.end(end) };
}

describe('SPI', () => {
  it('mode 0, MSB first: MOSI bytes and MISO bytes', () => {
    const w = spiWaves([0x9F, 0x00, 0xA5], { mode: 0, miso: [0x00, 0xEF, 0x12] });
    const f = decodeSpi(w.sck, w.mosi, w.miso, w.cs, { mode: 0 });
    expect(f.map((x) => x.value)).toEqual([0x9F, 0x00, 0xA5]);
    expect(f.map((x) => x.aux)).toEqual([0x00, 0xEF, 0x12]);
    expect(f[0].text).toBe('MOSI 0x9F  MISO 0x00');
  });

  it('all four modes decode the same payload when matched', () => {
    for (const mode of [0, 1, 2, 3] as const) {
      const w = spiWaves([0xC3, 0x5A], { mode });
      const f = decodeSpi(w.sck, w.mosi, null, w.cs, { mode });
      expect(f.map((x) => x.value), `mode ${mode}`).toEqual([0xC3, 0x5A]);
    }
  });

  it('LSB first order and no-CS continuous stream', () => {
    const w = spiWaves([0x01, 0x80], { mode: 0, lsb: true, cs: false });
    const f = decodeSpi(w.sck, w.mosi, null, null, { mode: 0, bitOrder: 'lsb' });
    expect(f.map((x) => x.value)).toEqual([0x01, 0x80]);
  });

  it('CS window with a partial word flags an error', () => {
    const w = spiWaves([0xFF, 0xFF], { mode: 0, truncate: 11 });
    const f = decodeSpi(w.sck, w.mosi, null, w.cs, { mode: 0 });
    expect(f.map((x) => x.type)).toEqual(['spi', 'error']);
    expect(f[1].error).toBe('incomplete');
  });
});
