import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import { Sim, bldcShapes, trapezoid } from './mna';
import { effectiveCircuit, faultOptions } from './faults';
import { getDef } from '../../library/components';
import type { Fault } from '../circuit/types';

// ------------------------------------------------------------------ BLDC
/** 12 V -> ESC (analog throttle `thr` volts on SIG) -> BLDC motor */
const bldc = (motor: Record<string, number | string | boolean> = {}, thr = 2.5, vbus = 12, esc: Record<string, number | string | boolean> = {}) => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: vbus }, 0, 0, 0, 'VS'); b.add('dc_supply', { v: thr }, 0, 0, 0, 'VT');
  b.add('bldc_driver_6step', esc, 0, 0, 0, 'U1'); b.add('bldc_3ph', motor, 0, 0, 0, 'M1'); b.add('ground');
  b.chain('VS.P', 'U1.VCC'); b.chain('VS.N', 'GND1.G'); b.chain('U1.GND', 'GND1.G');
  b.chain('VT.P', 'U1.SIG'); b.chain('VT.N', 'GND1.G');
  b.chain('U1.U', 'M1.U'); b.chain('U1.V', 'M1.V'); b.chain('U1.W', 'M1.W');
  return b.circuit;
};

function runBldc(motor: Record<string, number | string | boolean>, thr: number, stop: number, opts: { faults?: Record<string, Fault>; dt?: number } = {}) {
  let c = bldc(motor, thr);
  if (opts.faults) c = effectiveCircuit(c, opts.faults);
  const sim = new Sim(c, { faults: opts.faults });
  sim.init();
  const dt = opts.dt ?? 2e-5;
  const n = Math.round(stop / dt);
  let wSum = 0, iSum = 0, cnt = 0;
  for (let k = 0; k < n; k++) {
    sim.step(dt);
    if (k > n * 0.8) { const m = sim.results().M1; wSum += m.vals.omega; iSum += Math.abs(m.vals.iU) + Math.abs(m.vals.iV) + Math.abs(m.vals.iW); cnt++; }
  }
  return { sim, res: sim.results(), w: wSum / cnt, iAbsSum: iSum / cnt };
}

describe('BLDC motor + 6-step ESC', () => {
  it('trapezoid shape: +-1 flat tops of 120 deg, 60 deg ramps, three phases sum to zero-ish pattern', () => {
    const d = Math.PI / 180;
    expect(trapezoid(90 * d)).toBe(1);
    expect(trapezoid(270 * d)).toBe(-1);
    expect(trapezoid(0)).toBeCloseTo(0, 12);
    expect(trapezoid(15 * d)).toBeCloseTo(0.5, 9);
    const s = bldcShapes(60 * d); // U = 1, V = -1, W = 0 (sector 0: U high, V low)
    expect(s[0]).toBe(1); expect(s[1]).toBe(-1); expect(s[2]).toBeCloseTo(0, 9);
  });

  it('50 % throttle at 12 V: speed settles near w = D*Vbus*2Ke / ((2Ke)^2 + 2R*B) (within 15 %)', () => {
    // two phases conduct: D*Vbus = 2R*I + 2Ke*w and, at no load, 2Ke*I = B*w  ->  w = D*Vbus*2Ke / ((2Ke)^2 + 2R*B)
    const R = 2, Ke = 0.01, B = 2e-6, D = 0.5, V = 12;
    const analytic = (D * V * 2 * Ke) / ((2 * Ke) ** 2 + 2 * R * B);
    const { w, res } = runBldc({}, 2.5, 0.5);
    expect(Math.abs(w - analytic) / analytic).toBeLessThan(0.15);
    expect(res.M1.vals.omega).toBeGreaterThan(0);
    // no load: small current, torque ~ friction
    expect(res.M1.vals.pcu).toBeLessThan(0.5);
  });

  it('power is consistent: supply power - quiescent = copper loss + mechanical power (+-10 %, no energy created)', () => {
    const { sim } = runBldc({}, 2.5, 0.4);
    const r = sim.results();
    const pq = (12 * 12 * 0.01) / 5; // ESC quiescent draw is a resistor: iq = 10 mA at 5 V
    const pin = r.VS.p * -1 - pq; // vsource p = v*i with i delivered: power absorbed (negative = delivering)
    const pout = r.M1.vals.pmech + r.M1.vals.pcu;
    expect(r.U1.i).toBeGreaterThan(0);
    expect(pin).toBeGreaterThan(0);
    expect(Math.abs(pout - pin)).toBeLessThan(0.1 * pin + 0.01);
  });

  it('stalled rotor: current ~ D*Vbus/(2R); overload torque lowers the speed', () => {
    const stall = runBldc({ tload: 1e6 }, 5, 0.1);
    const iPh = stall.iAbsSum / 2; // two phases carry the current (ESC at 100 %: 12 V across 2R = 4 ohm)
    expect(Math.abs(stall.w)).toBeLessThan(0.5);
    expect(Math.abs(iPh - 12 / 4) / (12 / 4)).toBeLessThan(0.1);
    const free = runBldc({}, 2.5, 0.4);
    const loaded = runBldc({ tload: 0.01 }, 2.5, 0.4);
    expect(loaded.w).toBeLessThan(0.85 * free.w);
    expect(loaded.w).toBeGreaterThan(0);
  });

  it('open phase fault: that winding carries no current and the motor still turns (weaker)', () => {
    const faults: Record<string, Fault> = { M1: { kind: 'openPhase', amount: 3 } };
    const r = runBldc({}, 2.5, 0.4, { faults });
    expect(Math.abs(r.res.M1.vals.iW)).toBeLessThan(1e-9);
    for (const v of Object.values(r.res.M1.vals)) expect(Number.isFinite(v)).toBe(true);
    const ok = runBldc({}, 2.5, 0.4);
    expect(r.w).toBeLessThan(ok.w * 1.05);
  });

  it('fault options exist for the new parts (open phase, stall, short)', () => {
    const k = faultOptions(getDef('bldc_3ph')).map((o) => o.kind);
    expect(k).toEqual(expect.arrayContaining(['open', 'short', 'openPhase', 'stalled']));
    expect(faultOptions(getDef('solenoid')).map((o) => o.kind)).toEqual(expect.arrayContaining(['open', 'short', 'stalled']));
    expect(faultOptions(getDef('bldc_driver_6step')).map((o) => o.kind)).toEqual(expect.arrayContaining(['open', 'short']));
  });
});

// ------------------------------------------------------------------ solenoid
/** square-wave 0..12 V source straight on the coil (no diode needed: the source is stiff) */
const sol = (extra: Record<string, number | string | boolean> = {}, freq = 10, duty = 50) => {
  const b = new CircuitBuilder();
  b.add('signal_gen', { wave: 'square', v: 6, amp: 6, freq, duty }, 0, 0, 0, 'V1');
  b.add('solenoid', extra, 0, 0, 0, 'S1'); b.add('ground');
  b.chain('V1.P', 'S1.P'); b.chain('S1.N', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

function runSol(c: ReturnType<typeof sol>, stop: number, dt = 2e-5, faults?: Record<string, Fault>) {
  const sim = new Sim(faults ? effectiveCircuit(c, faults) : c, { faults });
  sim.init();
  const n = Math.round(stop / dt);
  const t: number[] = [], i: number[] = [], x: number[] = [];
  for (let k = 0; k < n; k++) {
    sim.step(dt);
    const r = sim.results().S1;
    t.push(sim.t); i.push(r.i); x.push(r.vals.position);
  }
  return { t, i, x, sim };
}

describe('solenoid', () => {
  const R = 20, L0 = 0.01;

  it('step: initial coil current follows V/R*(1-exp(-tR/L0)) while the plunger has not moved yet', () => {
    const { t, i } = runSol(sol(), 0.02);
    for (const tt of [0.1e-3, 0.2e-3]) {
      const k = t.findIndex((q) => q >= tt);
      const analytic = (12 / R) * (1 - Math.exp(-(t[k] * R) / L0));
      expect(Math.abs(i[k] - analytic) / analytic).toBeLessThan(0.06);
    }
  });

  it('plunger pulls in to the full stroke and the current shows a dip (local minimum) while it moves', () => {
    const { i, x } = runSol(sol(), 0.045);
    expect(Math.max(...x)).toBeGreaterThan(4.9);
    expect(Math.max(...x)).toBeLessThanOrEqual(5.0 + 1e-9);
    const iPeak = Math.max(...i.slice(0, Math.round(i.length * 0.3)));
    const kPeak = i.indexOf(iPeak);
    let kMin = kPeak;
    for (let k = kPeak; k < i.length; k++) if (i[k] < i[kMin]) kMin = k;
    expect(kMin).toBeGreaterThan(kPeak);
    expect(i[kMin]).toBeLessThan(iPeak * 0.97);                     // dip below the pre-motion plateau
    expect(i[i.length - 1]).toBeGreaterThan(i[kMin] * 1.02);        // then rises towards V/R again
    expect(i[i.length - 1]).toBeLessThanOrEqual(12 / R * 1.001);
  });

  it('after the voltage is removed the return spring releases the plunger', () => {
    const { x, t } = runSol(sol(), 0.1);
    const kOn = t.findIndex((q) => q >= 0.045), kOff = t.findIndex((q) => q >= 0.1) - 1;
    expect(x[kOn]).toBeGreaterThan(4.9);
    expect(x[kOff]).toBeLessThan(0.1);
    expect(Math.min(...x)).toBeGreaterThanOrEqual(0);
  });

  it('jammed plunger: no motion, no current dip, current -> V/R', () => {
    const { i, x } = runSol(sol({ jam: true }, 10, 90), 0.04);
    expect(Math.max(...x)).toBe(0);
    for (let k = 1; k < i.length; k++) expect(i[k]).toBeGreaterThanOrEqual(i[k - 1] - 1e-9);
  });

  it('flyback diode + low-side MOSFET switch: runs without NaN and still releases', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 12 }, 0, 0, 0, 'VS');
    b.add('signal_gen', { wave: 'square', v: 2.5, amp: 2.5, freq: 10, duty: 50 }, 0, 0, 0, 'VG');
    b.add('solenoid', {}, 0, 0, 0, 'S1'); b.add('nmos_logic', {}, 0, 0, 0, 'Q1'); b.add('diode', {}, 0, 0, 0, 'D1'); b.add('ground');
    b.chain('VS.P', 'S1.P'); b.chain('S1.N', 'Q1.D'); b.chain('Q1.S', 'GND1.G'); b.chain('VS.N', 'GND1.G');
    b.chain('VG.P', 'Q1.G'); b.chain('VG.N', 'GND1.G');
    b.chain('D1.A', 'Q1.D'); b.chain('D1.K', 'VS.P');
    const { i, x } = runSol(b.circuit, 0.1, 2e-5);
    for (const v of [...i, ...x]) expect(Number.isFinite(v)).toBe(true);
    expect(Math.max(...x)).toBeGreaterThan(4.9);
    expect(x[x.length - 1]).toBeLessThan(0.5);
  });
});
