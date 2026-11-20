import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import type { Circuit } from '../circuit/types';
import { LiveRunner, type LiveSnapshot } from '../sim/runner';
import { TEMPLATES } from './templates';
import { createBusDevice, EEPROM_TWR, type DevEnv } from './busdevices';
import type { I2CDevice, SpiDevice } from './bus';
import { getDef } from '../../library/components';

/** Drives the real LiveRunner with a fake animation clock (same approach as mcu.e2e.test.ts). */
function harness(circuit: Circuit, speed = 1) {
  const g = globalThis as unknown as { requestAnimationFrame: (f: (t: number) => void) => number; cancelAnimationFrame: (n: number) => void };
  const raf: { cb: ((t: number) => void) | null } = { cb: null };
  g.requestAnimationFrame = (f) => { raf.cb = f; return 1; };
  g.cancelAnimationFrame = () => { raf.cb = null; };
  const snaps: LiveSnapshot[] = [];
  const serial: string[] = [];
  const logs: string[] = [];
  const run = new LiveRunner((s) => snaps.push(s), (e) => { throw e; }, () => {}, () => {}, {
    serial: (_c, t) => serial.push(t), log: (_c, _l, t) => logs.push(t),
  });
  run.speed = speed;
  run.damageEnabled = false;
  run.start(circuit);
  let now = performance.now();
  const frames = (seconds: number) => { for (let t = 0; t < seconds; t += 0.016) { now += 16; raf.cb?.(now); } };
  return { run, serial, logs, frames, text: () => serial.join('') };
}

const sketch = (id: string): string => TEMPLATES.find((t) => t.id === id)!.code;

interface I2cOpts { pullups?: 'both' | 'sda' | 'none'; temp?: number; addr?: number; rpull?: number }
/** Uno + TMP102 on A4/A5, optional 4.7k pull-ups to 5V */
function i2cCircuit(src: string, o: I2cOpts = {}): Circuit {
  const b = new CircuitBuilder();
  b.add('mod_arduino_uno_r3', {}, 0, 0, 0, 'U1');
  b.add('busdev_tmp102', { temp: o.temp ?? 25, addr: o.addr ?? 0x48 }, 4, 0, 0, 'S1');
  b.add('ground');
  b.chain('U1.GND', 'GND1.G');
  b.wire('U1.5V', 'S1.VCC'); b.wire('U1.GND', 'S1.GND');
  b.wire('U1.A4/SDA', 'S1.SDA'); b.wire('U1.A5/SCL', 'S1.SCL');
  const pu = o.pullups ?? 'both';
  if (pu !== 'none') { b.add('resistor', { r: o.rpull ?? 4700 }, 0, 0, 0, 'R1'); b.wire('U1.5V', 'R1.1'); b.wire('R1.2', 'S1.SDA'); }
  if (pu === 'both') { b.add('resistor', { r: o.rpull ?? 4700 }, 0, 0, 0, 'R2'); b.wire('U1.5V', 'R2.1'); b.wire('R2.2', 'S1.SCL'); }
  b.circuit.firmware = { U1: { kind: 'sketch', source: src } };
  return b.circuit;
}

describe('I2C scanner template (real LiveRunner, real netlist)', () => {
  it('finds the TMP102 at 0x48 and nothing else when SDA and SCL have pull-ups', () => {
    const h = harness(i2cCircuit(sketch('i2c-scanner')));
    h.frames(0.5);
    const t = h.text();
    expect(t).toContain('Cihaz bulundu: 0x48');
    expect(t).toContain('Toplam: 1');
    expect(t.match(/Cihaz bulundu/g)).toHaveLength(1);
    expect(h.logs.some((l) => l.includes('pull-up yok'))).toBe(false);
    h.run.stop();
  });
  it('follows the address parameter (0x4A)', () => {
    const h = harness(i2cCircuit(sketch('i2c-scanner'), { addr: 0x4a }));
    h.frames(0.5);
    expect(h.text()).toContain('Cihaz bulundu: 0x4A');
    expect(h.text()).toContain('Toplam: 1');
    h.run.stop();
  });
  it('finds NOTHING without pull-ups and reports "SDA/SCL pull-up yok"', () => {
    const h = harness(i2cCircuit(sketch('i2c-scanner'), { pullups: 'none' }));
    h.frames(0.5);
    expect(h.text()).toContain('Toplam: 0');
    expect(h.text()).not.toContain('Cihaz bulundu');
    expect(h.logs.some((l) => l.includes('SDA/SCL pull-up yok'))).toBe(true);
    h.run.stop();
  });
  it('a pull-up on SDA alone is not enough (SCL needs one too)', () => {
    const h = harness(i2cCircuit(sketch('i2c-scanner'), { pullups: 'sda' }));
    h.frames(0.5);
    expect(h.text()).toContain('Toplam: 0');
    expect(h.logs.some((l) => l.includes('SDA/SCL pull-up yok'))).toBe(true);
    h.run.stop();
  });
  it('rejects absurd pull-ups (100 ohm too strong, 1 Mohm too weak)', () => {
    for (const r of [100, 1e6]) {
      const h = harness(i2cCircuit(sketch('i2c-scanner'), { rpull: r }));
      h.frames(0.5);
      expect(h.text(), `r=${r}`).toContain('Toplam: 0');
      h.run.stop();
    }
  });
  it('a pull-up to ground (not VCC) does not count', () => {
    const c = i2cCircuit(sketch('i2c-scanner'), { pullups: 'none' });
    const b = new CircuitBuilder();
    b.circuit = c;
    b.add('resistor', { r: 4700 }, 0, 0, 0, 'R1'); b.wire('U1.GND', 'R1.1'); b.wire('R1.2', 'S1.SDA');
    b.add('resistor', { r: 4700 }, 0, 0, 0, 'R2'); b.wire('U1.GND', 'R2.1'); b.wire('R2.2', 'S1.SCL');
    const h = harness(c);
    h.frames(0.5);
    expect(h.text()).toContain('Toplam: 0');
    h.run.stop();
  });
  it('an unpowered device does not answer', () => {
    const c = i2cCircuit(sketch('i2c-scanner'));
    c.wires = c.wires.filter((w) => !(w.a.comp === 'U1' && w.a.pin === '5V' && w.b.comp === 'S1'));
    const h = harness(c);
    h.frames(0.5);
    expect(h.text()).toContain('Toplam: 0');
    h.run.stop();
  });
});

describe('TMP102 read template', () => {
  it('prints the temperature from the component parameter, incl. negative values', () => {
    const h = harness(i2cCircuit(sketch('i2c-tmp102'), { temp: 36.5 }));
    h.frames(1.2);
    expect(h.text()).toContain('Sicaklik: 36.50 C');
    h.run.stop();
    const n = harness(i2cCircuit(sketch('i2c-tmp102'), { temp: -12.25 }));
    n.frames(1.2);
    expect(n.text()).toContain('Sicaklik: -12.25 C');
    n.run.stop();
  });
  it('follows a parameter change while running (next conversion)', () => {
    const c = i2cCircuit(sketch('i2c-tmp102'), { temp: 20 });
    const h = harness(c);
    h.frames(1.2);
    expect(h.text()).toContain('Sicaklik: 20.00 C');
    h.run.update({ ...c, components: c.components.map((x) => (x.id === 'S1' ? { ...x, params: { ...x.params, temp: 41.0625 } } : x)) });
    h.frames(2);
    expect(h.text()).toContain('Sicaklik: 41.06 C');
    h.run.stop();
  });
  it('reports a missing device instead of printing garbage when pull-ups are absent', () => {
    const h = harness(i2cCircuit(sketch('i2c-tmp102'), { pullups: 'none' }));
    h.frames(1.2);
    expect(h.text()).toContain('TMP102 yanit vermedi');
    expect(h.logs.some((l) => l.includes('SDA/SCL pull-up yok'))).toBe(true);
    h.run.stop();
  });
});

describe('24C02 EEPROM through a sketch', () => {
  const src = `#include <Wire.h>
const int EE = 0x50;
void setup() {
  Serial.begin(9600);
  Wire.begin();
  Wire.beginTransmission(EE); Wire.write(0x10); Wire.write(0xDE); Wire.write(0xAD); Wire.write(0xBE);
  Serial.println(Wire.endTransmission());            // 0
  Wire.beginTransmission(EE);
  Serial.println(Wire.endTransmission());            // 2: still in the internal write cycle (ACK polling)
  delay(10);
  Wire.beginTransmission(EE);
  Serial.println(Wire.endTransmission());            // 0: ready again
  Wire.beginTransmission(EE); Wire.write(0x10); Wire.endTransmission(false);   // set address, repeated start
  Wire.requestFrom(EE, 3);
  while (Wire.available()) { Serial.println(Wire.read(), HEX); }
  Wire.beginTransmission(EE); Wire.write(0x00);
  Wire.endTransmission();
  Wire.requestFrom(EE, 1);
  Serial.println(Wire.read(), HEX);                  // erased: FF
}
void loop() {}`;
  function circuit(): Circuit {
    const c = i2cCircuit(src);
    c.components = c.components.map((x) => (x.id === 'S1' ? { ...x, type: 'busdev_24c02', params: { addr: 0x50 } } : x));
    return c;
  }
  it('write, ACK polling during tWR, then read back (repeated start) and erased bytes read FF', () => {
    const h = harness(circuit());
    h.frames(0.3);
    expect(h.serial.join('').split('\r\n').filter(Boolean)).toEqual(['0', '2', '0', 'DE', 'AD', 'BE', 'FF']);
    h.run.stop();
  });
});

// ------------------------------------------------------------------------------------------ SPI ADC
const adcSketch = `#include <SPI.h>
const int CS = 10;
int readAdc(int ch) {
  digitalWrite(CS, LOW);
  SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
  SPI.transfer(1);
  byte hi = SPI.transfer((8 + ch) << 4);
  byte lo = SPI.transfer(0);
  SPI.endTransaction();
  digitalWrite(CS, HIGH);
  return ((hi & 3) << 8) | lo;
}
void setup() { Serial.begin(9600); pinMode(CS, OUTPUT); digitalWrite(CS, HIGH); SPI.begin(); }
void loop() {
  Serial.print("CH0="); Serial.print(readAdc(0));
  Serial.print(" CH1="); Serial.println(readAdc(1));
  delay(100);
}`;
/** Uno + MCP3008: CH0 and CH1 are dividers from 5 V; VREF = 5 V */
function adcCircuit(o: { top0?: number; bot0?: number; top1?: number; bot1?: number; cs?: 'mcu' | 'gnd' | 'float'; vref?: 'vcc' | 'gnd' } = {}): Circuit {
  const b = new CircuitBuilder();
  b.add('mod_arduino_uno_r3', {}, 0, 0, 0, 'U1');
  b.add('busdev_mcp3008', {}, 4, 0, 0, 'A1');
  b.add('ground');
  b.chain('U1.GND', 'GND1.G');
  b.wire('U1.5V', 'A1.VDD'); b.wire(o.vref === 'gnd' ? 'U1.GND' : 'U1.5V', 'A1.VREF');
  b.wire('U1.GND', 'A1.DGND'); b.wire('U1.GND', 'A1.AGND');
  b.wire('U1.D13/SCK', 'A1.CLK'); b.wire('U1.D12/MISO', 'A1.DOUT'); b.wire('U1.D11/MOSI', 'A1.DIN');
  const cs = o.cs ?? 'mcu';
  if (cs === 'mcu') b.wire('U1.D10/SS', 'A1.CS'); else if (cs === 'gnd') b.wire('U1.GND', 'A1.CS');
  const div = (n: number, ch: string, top: number, bot: number) => {
    b.add('resistor', { r: top }, 0, 0, 0, `RT${n}`); b.add('resistor', { r: bot }, 0, 0, 0, `RB${n}`);
    b.wire('U1.5V', `RT${n}.1`); b.wire(`RT${n}.2`, `A1.${ch}`); b.wire(`RT${n}.2`, `RB${n}.1`); b.wire(`RB${n}.2`, 'U1.GND');
  };
  div(0, 'CH0', o.top0 ?? 1000, o.bot0 ?? 3000);
  div(1, 'CH1', o.top1 ?? 3000, o.bot1 ?? 1000);
  b.circuit.firmware = { U1: { kind: 'sketch', source: adcSketch } };
  return b.circuit;
}
const lastReading = (text: string): [number, number] => {
  const m = [...text.matchAll(/CH0=(\d+) CH1=(\d+)/g)].pop();
  if (!m) throw new Error('no reading in: ' + text);
  return [Number(m[1]), Number(m[2])];
};

describe('MCP3008 over SPI through a sketch', () => {
  it('reads codes proportional to the input node voltage (3.75 V -> 768, 1.25 V -> 256)', () => {
    const h = harness(adcCircuit());
    h.frames(0.5);
    const [c0, c1] = lastReading(h.text());
    expect(Math.abs(c0 - 768)).toBeLessThanOrEqual(2);
    expect(Math.abs(c1 - 256)).toBeLessThanOrEqual(2);
    h.run.stop();
  });
  it('follows the divider ratio when the circuit changes (1:1 -> 512, 1:9 -> 102)', () => {
    const h = harness(adcCircuit({ top0: 5000, bot0: 5000, top1: 9000, bot1: 1000 }));
    h.frames(0.5);
    const [c0, c1] = lastReading(h.text());
    expect(Math.abs(c0 - 512)).toBeLessThanOrEqual(2);
    expect(Math.abs(c1 - 102)).toBeLessThanOrEqual(2);
    h.run.stop();
  });
  it('CS tied to GND = always selected; CS not connected to anything = never selected (reads 0)', () => {
    const g = harness(adcCircuit({ cs: 'gnd' }));
    g.frames(0.5);
    // a real MCP3008 needs CS to go high between conversions: with CS hard-wired low only the very first frame is aligned
    const first = g.text().match(/CH0=(\d+) CH1=(\d+)/)!;
    expect(Math.abs(Number(first[1]) - 768)).toBeLessThanOrEqual(2);
    expect(Number(first[2])).toBe(0);
    expect(lastReading(g.text())).toEqual([0, 0]);
    g.run.stop();
    const f = harness(adcCircuit({ cs: 'float' }));
    f.frames(0.5);
    expect(lastReading(f.text())).toEqual([0, 0]);
    f.run.stop();
  });
  it('VREF at 0 V -> converter outputs 0', () => {
    const h = harness(adcCircuit({ vref: 'gnd' }));
    h.frames(0.5);
    expect(lastReading(h.text())).toEqual([0, 0]);
    h.run.stop();
  });
});

// ------------------------------------------------------------------------------------------ device models
function envOf(over: Partial<DevEnv> & { params?: Record<string, number> } = {}): { env: DevEnv; clock: { t: number }; params: Record<string, number> } {
  const clock = { t: 0 };
  const params: Record<string, number> = { ...(over.params ?? {}) };
  const env: DevEnv = { clock, param: (k) => params[k], supply: () => 5, volt: () => 0, ...over };
  return { env, clock, params };
}
const i2c = (d: ReturnType<typeof createBusDevice>): I2CDevice => d as I2CDevice;
const spi = (d: ReturnType<typeof createBusDevice>): SpiDevice => d as SpiDevice;

describe('device models (unit)', () => {
  it('TMP102 register map: temp, config reset value, T_LOW/T_HIGH, pointer, shutdown + one-shot', () => {
    const { env, params, clock } = envOf({ params: { temp: 25 } });
    const d = i2c(createBusDevice('tmp102', env));
    const readReg = (p: number): number => { d.begin!(true); d.write([p]); d.begin!(false); const [a, b] = d.read(2); return (a << 8) | b; };
    expect(readReg(0)).toBe(0x190 << 4);                    // 25 C = 400 LSB
    expect(readReg(1)).toBe(0x60a0);
    expect(readReg(2)).toBe(0x4b00);
    expect(readReg(3)).toBe(0x5000);
    d.begin!(true); d.write([2, 0x1e, 0x00]);               // T_LOW = 30 C
    expect(readReg(2)).toBe(0x1e00);
    d.begin!(true); d.write([0, 0xaa, 0xbb]);               // temperature register is read-only
    expect(readReg(0)).toBe(0x190 << 4);
    d.begin!(false);
    expect(d.read(3)).toEqual([0x19, 0x00, 0xff]);
    // 4 Hz conversion: a change is picked up only after 250 ms
    params.temp = 30;
    clock.t = 0.1;
    expect(readReg(0)).toBe(0x190 << 4);
    clock.t = 0.3;
    expect(readReg(0)).toBe(0x1e0 << 4);
    // shutdown freezes, one-shot converts once
    d.begin!(true); d.write([1, 0x61, 0xa0]);               // SD = 1
    params.temp = 40;
    clock.t = 5;
    expect(readReg(0)).toBe(0x1e0 << 4);
    d.begin!(true); d.write([1, 0xe1, 0xa0]);               // SD + OS
    expect(readReg(0)).toBe(0x280 << 4);
    expect(d.addr).toBe(0x48);
  });
  it('TMP102 negative temperatures are two\'s complement and clamp at -55 C', () => {
    const { env, params } = envOf({ params: { temp: -25 } });
    const d = i2c(createBusDevice('tmp102', env));
    d.begin!(true); d.write([0]); d.begin!(false);
    const [a, b] = d.read(2);
    expect(((a << 8) | b) >> 4).toBe(0x1000 - 400);
    params.temp = -300;
    const e = i2c(createBusDevice('tmp102', envOf({ params: { temp: -300 } }).env));
    e.begin!(true); e.write([0]); e.begin!(false);
    const [x, y] = e.read(2);
    expect(((x << 8) | y) >> 4).toBe(0x1000 - 880);
  });
  it('24C02: write then read back, page roll-over, tWR busy window, sequential read wraps at 256', () => {
    const { env, clock } = envOf();
    const d = i2c(createBusDevice('eeprom24c02', env));
    expect(d.addr).toBe(0x50);
    expect(d.online!()).toBe(true);
    d.begin!(true); d.write([0x06, 1, 2, 3, 4, 5, 6, 7, 8, 9]); d.stop!();   // 9 data bytes from 0x06 in an 8-byte page: wraps
    expect(d.online!()).toBe(false);                                         // busy
    clock.t = EEPROM_TWR + 1e-6;
    expect(d.online!()).toBe(true);
    d.begin!(true); d.write([0x00]); d.begin!(false);
    // last writes win on the wrapped page: 0x06=1,0x07=2,0x00=3,0x01=4,0x02=5,0x03=6,0x04=7,0x05=8, then 0x06=9
    expect(d.read(8)).toEqual([3, 4, 5, 6, 7, 8, 9, 2]);
    d.begin!(true); d.write([0xfe]); d.begin!(false);
    expect(d.read(3)).toEqual([0xff, 0xff, 3]);                              // wraps 0xFF -> 0x00
    // an address-only transaction does not start a write cycle
    d.begin!(true); d.write([0x20]); d.stop!();
    expect(d.online!()).toBe(true);
    // data without STOP is never committed
    d.begin!(true); d.write([0x30, 0x55]); d.begin!(false);
    expect(d.read(1)).toEqual([0xff]);
    // unpowered chip is offline
    const dead = i2c(createBusDevice('eeprom24c02', envOf({ supply: () => 0 }).env));
    expect(dead.online!()).toBe(false);
  });
  it('MCP3008: single-ended, differential pairs, clamping, VREF scaling, frame reset on deselect', () => {
    const v: Record<string, number> = { vref: 5, agnd: 0, ch0: 2.5, ch1: 1.25, ch2: 5, ch3: 7 };
    const d = spi(createBusDevice('mcp3008', envOf({ volt: (r) => v[r] ?? 0 }).env));
    const conv = (cfg: number): number => { d.select!(true); d.transfer(1); const hi = d.transfer(cfg); const lo = d.transfer(0); d.select!(false); return ((hi & 3) << 8) | lo; };
    expect(conv(0x80)).toBe(512);                           // single CH0
    expect(conv(0x90)).toBe(256);                           // single CH1
    expect(conv(0xa0)).toBe(1023);                          // 5 V = full scale clamps at 1023
    expect(conv(0xb0)).toBe(1023);                          // 7 V > VREF
    expect(conv(0x00)).toBe(256);                           // diff CH0+ CH1-: 1.25 V -> 256
    expect(conv(0x10)).toBe(0);                             // diff CH0- CH1+: negative clamps to 0
    v.vref = 2.5;
    expect(conv(0x80)).toBe(1023);                          // 2.5 V at VREF 2.5 V -> full scale
    v.vref = 0;
    expect(conv(0x80)).toBe(0);                             // no reference
    // first byte without start bit is ignored (stays in stage 0)
    v.vref = 5;
    d.select!(true);
    expect(d.transfer(0)).toBe(0);
    d.transfer(1);
    expect(((d.transfer(0x80) & 3) << 8) | d.transfer(0)).toBe(512);
    // a frame aborted by CS going high restarts cleanly
    d.select!(true); d.transfer(1); d.select!(false);
    expect(conv(0x80)).toBe(512);
    expect(d.online!()).toBe(true);
  });
});

describe('library parts', () => {
  it('busdev parts are consistent: roles exist as pins, partial model with honest missing lists', () => {
    for (const t of ['busdev_tmp102', 'busdev_24c02', 'busdev_mcp3008']) {
      const def = getDef(t);
      expect(def.model).toBe('busdev');
      expect(def.simModel).toBe('partial');
      const ids = new Set(def.pins.map((p) => p.id));
      for (const [role, pin] of Object.entries(def.busdev!.pins)) expect(ids.has(pin), `${t}.${role}`).toBe(true);
      expect(def.missing.some((m) => m.includes('bit-seviyesi zamanlama'))).toBe(true);
      expect(def.simNote).toContain('Bit düzeyi zamanlama simüle edilmez');
    }
  });
});
