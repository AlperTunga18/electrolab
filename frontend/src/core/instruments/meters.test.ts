import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import { LiveRunner } from '../sim/runner';
import type { MeterSpec } from '../sim/mna';
import { mean } from './readings';

function harness(circuit: Parameters<LiveRunner['start']>[0], meters: MeterSpec[]) {
  const g = globalThis as unknown as { requestAnimationFrame: (f: (t: number) => void) => number; cancelAnimationFrame: (n: number) => void };
  const raf: { cb: ((t: number) => void) | null } = { cb: null };
  g.requestAnimationFrame = (f) => { raf.cb = f; return 1; };
  g.cancelAnimationFrame = () => { raf.cb = null; };
  const logs: string[] = [];
  const run = new LiveRunner(() => {}, (e) => { throw e; }, () => {}, () => {}, { serial: () => {}, log: (_c, _l, t) => logs.push(t) });
  run.speed = 0.01; run.damageEnabled = false; run.meters = meters;
  run.start(circuit);
  let now = performance.now();
  const frames = (n: number) => { for (let k = 0; k < n; k++) { now += 16; raf.cb?.(now); } };
  return { run, frames, logs };
}

const divider = () => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 10 }); b.add('resistor', { r: 1e7 }); b.add('resistor', { r: 1e7 }); b.add('ground');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'R2.1'); b.chain('R2.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

describe('virtual meters load the circuit like real ones', () => {
  it('10 MΩ voltmeter across a 10 MΩ resistor pulls the reading down to 3.33 V (true value 5 V)', () => {
    const c = divider();
    const h = harness(c, [{ id: 'm1', a: { comp: 'R2', pin: '1' }, b: { comp: 'R2', pin: '2' }, r: 10e6, kind: 'v' }]);
    h.frames(10);
    const net = h.run.sim!.netOf('R2', '1');
    expect(h.run.sim!.nodeVoltage(net)).toBeCloseTo(10 / 3, 2);
    h.run.stop();
    // without the meter the true node voltage is 5 V
    const h2 = harness(c, []);
    h2.frames(10);
    expect(h2.run.sim!.nodeVoltage(h2.run.sim!.netOf('R2', '1'))).toBeCloseTo(5, 3);
    h2.run.stop();
  });

  it('ammeter inserted in series (wire removed) reads the loop current through its 10 mΩ shunt', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 5 }); b.add('resistor', { r: 1000 }); b.add('ground');
    b.chain('R1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G'); // no wire V1.P -> R1.1: that is where the meter goes
    const h = harness(b.circuit, [{ id: 'm1', a: { comp: 'V1', pin: 'P' }, b: { comp: 'R1', pin: '1' }, r: 0.01, kind: 'a' }]);
    h.frames(10);
    expect(mean(h.run.meterBuf.m1.slice(-200))).toBeCloseTo(0.005, 4);
    expect(h.run.fuseBlown).toBe(false);
    h.run.stop();
  });

  it('ammeter wrongly placed across a voltage source blows the 10 A fuse and becomes an open circuit', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 5 }); b.add('resistor', { r: 1000 }); b.add('ground');
    b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    const h = harness(b.circuit, [{ id: 'm1', a: { comp: 'V1', pin: 'P' }, b: { comp: 'V1', pin: 'N' }, r: 0.01, kind: 'a' }]);
    h.frames(10);
    expect(h.run.fuseBlown).toBe(true);
    expect(h.logs.join(' ')).toMatch(/sigortası attı/);
    // after the fuse the meter no longer shorts the source
    const i = h.run.meterBuf.m1.slice(-50);
    expect(Math.max(...i.map(Math.abs))).toBeLessThan(1e-3);
    h.run.stop();
  });

  it('power analyzer series (watched component) records v and i', () => {
    const b = new CircuitBuilder();
    b.add('signal_gen', { wave: 'sine', amp: 10, freq: 50 }); b.add('resistor', { r: 100 }); b.add('ground');
    b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    const g = globalThis as unknown as { requestAnimationFrame: (f: (t: number) => void) => number; cancelAnimationFrame: (n: number) => void };
    const raf: { cb: ((t: number) => void) | null } = { cb: null };
    g.requestAnimationFrame = (f) => { raf.cb = f; return 1; };
    g.cancelAnimationFrame = () => { raf.cb = null; };
    const run = new LiveRunner(() => {}, (e) => { throw e; }, () => {}, () => {});
    run.speed = 0.02; run.damageEnabled = false; run.watch = new Set(['R1']);
    run.start(b.circuit);
    let now = performance.now();
    for (let k = 0; k < 40; k++) { now += 16; raf.cb?.(now); }
    const buf = run.compBuf.R1;
    expect(buf.v.length).toBeGreaterThan(100);
    expect(Math.max(...buf.v)).toBeGreaterThan(5);
    expect(Math.max(...buf.i)).toBeCloseTo(Math.max(...buf.v) / 100, 3);
    run.stop();
  });
});
