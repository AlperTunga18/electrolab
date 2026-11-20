import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import type { Circuit, Fault } from '../circuit/types';
import { Sim, runTransient } from './mna';
import { effectiveCircuit } from './faults';
import { buildReport, evaluateDamage, thermalStates } from './damage';
import { checkStress } from './stress';
import { HEATSINKS, effectiveRth, etaToLimit, stepThermal, thermalClass, thermalSpec, thermalColor } from '../thermal/thermal';
import { getDef } from '../../library/components';
import { LiveRunner } from './runner';

const solve = (c: Circuit, faults: Record<string, Fault> = {}) => {
  const eff = effectiveCircuit(c, faults);
  const sim = new Sim(eff, { faults });
  sim.solveDC();
  return { sim, r: sim.results(), eff };
};

function divider(): CircuitBuilder {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 10 }); b.add('resistor', { r: 1000 }); b.add('resistor', { r: 2000 }); b.add('ground');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'R2.1'); b.chain('R2.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b;
}
const vout = (s: Sim) => s.nodeVoltage(s.netOf('R1', '2'));

describe('fault injection', () => {
  it('baseline divider 6.667 V', () => { close(vout(solve(divider().circuit).sim), 20 / 3); });
  it('open R1: output pulled to 0 V, no current', () => {
    const { sim, r } = solve(divider().circuit, { R1: { kind: 'open' } });
    expect(Math.abs(vout(sim))).toBeLessThan(1e-6);
    expect(r.R1.i).toBe(0);
  });
  it('shorted R1: output ~10 V', () => {
    const { sim } = solve(divider().circuit, { R1: { kind: 'short' } });
    close(vout(sim), 10 * 2000 / (2000 + 0.001), 1e-5);
  });
  it('drift +50 % on R2 changes the divider ratio', () => {
    const { sim } = solve(divider().circuit, { R2: { kind: 'drift', amount: 50 } });
    close(vout(sim), 10 * 3000 / 4000, 1e-6);
  });
  it('broken wire removes the connection', () => {
    const b = divider();
    b.circuit.wires.find((w) => w.a.comp === 'R1' && w.b.comp === 'R2')!.broken = true;
    const { sim } = solve(b.circuit);
    close(sim.nodeVoltage(sim.netOf('R1', '2')), 10, 1e-6); // R1 side floats up to the source via R1 only
  });
  it('capacitor leakage lets DC current flow; capLoss reduces capacitance', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 10 }); b.add('resistor', { r: 1000 }); b.add('capacitor', { c: 1e-6 }); b.add('ground');
    b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'C1.1'); b.chain('C1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    close(solve(b.circuit).r.C1.v, 10, 1e-6);
    close(solve(b.circuit, { C1: { kind: 'leak', amount: 1000 } }).r.C1.v, 5, 1e-4);
    const eff = effectiveCircuit(b.circuit, { C1: { kind: 'capLoss', amount: 50 } });
    close(Number(eff.components.find((c) => c.id === 'C1')!.params.c), 0.5e-6);
  });
  it('MOSFET gate failure shorts gate to source and kills conduction', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 12 }, 0, 0, 0, 'V1'); b.add('dc_supply', { v: 5 }, 0, 0, 0, 'VG'); b.add('resistor', { r: 100 }, 0, 0, 0, 'RG'); b.add('resistor', { r: 12 }); b.add('nmos_logic'); b.add('ground');
    b.wire('V1.P', 'R1.1'); b.wire('R1.2', 'Q1.D'); b.wire('VG.P', 'RG.1'); b.wire('RG.2', 'Q1.G'); b.wire('Q1.S', 'GND1.G'); b.wire('V1.N', 'GND1.G'); b.wire('VG.N', 'GND1.G');
    expect(solve(b.circuit).r.Q1.vals.vds).toBeLessThan(0.2);
    const f = solve(b.circuit, { Q1: { kind: 'gateShort' } });
    expect(f.r.Q1.vals.vds).toBeGreaterThan(11.9);
    close(f.sim.nodeVoltage(f.sim.netOf('Q1', 'G')), 5 * 0.001 / (100.001), 1e-3, 1e-3);
  });
  it('welded / stuck-open switch overrides state', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 5 }); b.add('switch', { closed: false }); b.add('resistor', { r: 100 }); b.add('ground');
    b.chain('V1.P', 'SW1.1'); b.chain('SW1.2', 'R1.1'); b.chain('R1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    expect(Math.abs(solve(b.circuit).r.R1.i)).toBeLessThan(1e-6);
    close(solve(b.circuit, { SW1: { kind: 'welded' } }).r.R1.i, 0.05, 1e-3);
    b.circuit.components.find((c) => c.id === 'SW1')!.params.closed = true;
    expect(Math.abs(solve(b.circuit, { SW1: { kind: 'stuckOpen' } }).r.R1.i)).toBeLessThan(1e-6);
  });
  it('intermittent resistor: current flows only in the "on" half of each period', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 5 }); b.add('resistor', { r: 100 }); b.add('ground');
    b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    const faults: Record<string, Fault> = { R1: { kind: 'intermittent', amount: 100 } };
    const r = runTransient(effectiveCircuit(b.circuit, faults), { stop: 0.02, dt: 1e-4, faults });
    const on = r.comps.R1.i[Math.round(0.002 / 1e-4)], off = r.comps.R1.i[Math.round(0.007 / 1e-4)];
    close(on, 0.05, 1e-3);
    expect(Math.abs(off)).toBeLessThan(1e-6);
  });
});

function close(a: number, b: number, rel = 1e-6, abs = 1e-9) { expect(Math.abs(a - b)).toBeLessThanOrEqual(abs + rel * Math.abs(b)); }

describe('thermal model', () => {
  const mk = (type: string, params = {}, thermal?: { heatsink: 'none' | 'small' | 'medium' | 'large'; fan: boolean }) => {
    const b = new CircuitBuilder();
    const id = b.add(type, params);
    const c = b.circuit.components.find((x) => x.id === id)!;
    if (thermal) c.thermal = thermal;
    return { def: getDef(type), c };
  };
  it('exact RC step: reaches 63.2 % of the rise after one time constant', () => {
    const rth = 50, cth = 2, tau = rth * cth;
    close(stepThermal(25, 2, 25, rth, cth, tau), 25 + 2 * 50 * (1 - Math.exp(-1)), 1e-9);
    close(stepThermal(25, 2, 25, rth, cth, 1e6), 125, 1e-9);
  });
  it('resistor Rθ follows (Tmax−25)/Pnom', () => {
    const { def, c } = mk('resistor', { pmax: 0.25 });
    close(thermalSpec(def, c)!.rthJAfree, (155 - 25) / 0.25);
  });
  it('heatsink and fan lower the MOSFET junction temperature at equal power', () => {
    const P = 5;
    const T = (hs: 'none' | 'small' | 'medium' | 'large', fan: boolean) => {
      const { def, c } = mk('nmos_logic', {}, { heatsink: hs, fan });
      const spec = thermalSpec(def, c)!;
      const { rth } = effectiveRth(spec, c);
      return 25 + P * rth;
    };
    const free = T('none', false), small = T('small', false), large = T('large', false), smallFan = T('small', true);
    expect(free).toBeGreaterThan(300);   // 62 K/W × 5 W: way above 175 °C
    expect(small).toBeLessThan(free * 0.5);
    expect(large).toBeLessThan(small);
    expect(smallFan).toBeLessThan(small);
    expect(HEATSINKS.large.rsa).toBeLessThan(HEATSINKS.small.rsa);
  });
  it('sources and capacitors are not thermally modelled', () => {
    expect(thermalSpec(getDef('dc_supply'), mk('dc_supply').c)).toBeNull();
    expect(thermalSpec(getDef('capacitor'), mk('capacitor').c)).toBeNull();
  });
  it('classes, colours and ETA range', () => {
    expect(thermalClass(26, 25, 150)).toBe('cold');
    expect(thermalClass(60, 25, 150)).toBe('normal');
    expect(thermalClass(110, 25, 150)).toBe('high');
    expect(thermalClass(145, 25, 150)).toBe('critical');
    expect(thermalClass(151, 25, 150)).toBe('damage');
    expect(thermalColor(200, 25, 150)).toBe('#ffffff');
    const eta = etaToLimit(25, 5, 25, 62, 1, 175)!;
    expect(eta.high).toBeCloseTo(eta.low * 4, 6);
    expect(etaToLimit(25, 1, 25, 62, 1, 175)).toBeNull(); // would settle at 87 °C
  });
});

describe('damage model', () => {
  it('overloaded LED fails open with a report (thermal or overcurrent), small LED current is only a warning', () => {
    const mk = (r: number) => {
      const b = new CircuitBuilder();
      b.add('dc_supply', { v: 5 }); b.add('resistor', { r }); b.add('led', { color: 'red' }); b.add('ground');
      b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'D1.A'); b.chain('D1.K', 'GND1.G'); b.chain('V1.N', 'GND1.G');
      return b.circuit;
    };
    const eval_ = (c: Circuit, T: Record<string, number> = {}) => {
      const { sim, r, eff } = solve(c);
      const power = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.p]));
      const th = thermalStates(eff, power, T, 25);
      return { cands: evaluateDamage(eff, r, th, {}), th, r, sim, eff };
    };
    // 150 ohm: ~20 mA, healthy
    expect(eval_(mk(150)).cands).toHaveLength(0);
    // 47 ohm: ~60 mA = 2x rating -> warning only (stress), no hard failure
    const mid = eval_(mk(47));
    expect(checkStress(mid.eff, mid.r).some((s) => s.ref === 'D1')).toBe(true);
    expect(mid.cands).toHaveLength(0);
    // 10 ohm: ~280 mA (>3x rating) -> hard overcurrent -> open, with report
    const hard = eval_(mk(10));
    expect(hard.cands).toHaveLength(1);
    const cand = hard.cands[0];
    expect(cand.cause).toBe('overcurrent');
    expect(cand.fault.kind).toBe('open');
    const rep = buildReport(1, hard.eff, cand, hard.r, hard.th, hard.sim.nets.pinNet, hard.sim.nets.names, 0, 25);
    expect(rep.ref).toBe('D1');
    expect(rep.sameCurrent).toContain('R1');
    expect(rep.fix.join(' ')).toMatch(/Seri direnç/);
    expect(rep.uncertainty).toMatch(/kesin süre değildir/);
    // thermal path: steady-state Tj above 100 degC fails regardless of current class
    const hot = eval_(mk(47), { D1: 120 });
    expect(hot.cands[0].cause).toBe('thermal');
  });

  it('MOSFET with 30 V on a 20 V gate is a hard overvoltage (gate failure); 12 V is fine', () => {
    const mk = (vg: number) => {
      const b = new CircuitBuilder();
      b.add('dc_supply', { v: 12 }, 0, 0, 0, 'V1'); b.add('dc_supply', { v: vg }, 0, 0, 0, 'VG'); b.add('resistor', { r: 12 }); b.add('nmos_std'); b.add('ground');
      b.wire('V1.P', 'R1.1'); b.wire('R1.2', 'Q1.D'); b.wire('VG.P', 'Q1.G'); b.wire('Q1.S', 'GND1.G'); b.wire('V1.N', 'GND1.G'); b.wire('VG.N', 'GND1.G');
      return b.circuit;
    };
    const run = (vg: number) => { const { r, eff } = solve(mk(vg)); return evaluateDamage(eff, r, thermalStates(eff, {}, {}, 25), {}); };
    expect(run(12)).toHaveLength(0);
    const c = run(32);
    expect(c[0]?.fault.kind).toBe('gateShort');
    expect(c[0]?.cause).toBe('overvoltage');
  });

  it('reversed electrolytic capacitor is flagged reverse-polarity failure', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 5 }); b.add('resistor', { r: 100 }); b.add('capacitor_el'); b.add('ground');
    b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'C1.2'); b.chain('C1.1', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    const { r, eff } = solve(b.circuit);
    const c = evaluateDamage(eff, r, {}, {});
    expect(c[0]?.cause).toBe('reverse');
  });

  it('live runner: overloaded resistor heats, fails open, and the circuit changes', async () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 12 }); b.add('resistor', { r: 10, pmax: 0.25 }); b.add('ground');
    b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    const reports: string[] = [];
    let snap: unknown;
    const g = globalThis as unknown as { requestAnimationFrame?: (f: (t: number) => void) => number; cancelAnimationFrame?: (n: number) => void; performance: Performance };
    const raf: { cb: ((t: number) => void) | null } = { cb: null };
    g.requestAnimationFrame = (f) => { raf.cb = f; return 1; };
    g.cancelAnimationFrame = () => { raf.cb = null; };
    const run = new LiveRunner((s) => { snap = s; }, (e) => { throw e; }, () => {}, (r) => reports.push(`${r.ref}:${r.mode}:${r.cause}`));
    run.speed = 0.01; run.thermalSpeed = 5000;
    run.start(b.circuit);
    let now = performance.now();
    for (let i = 0; i < 400 && reports.length === 0; i++) { now += 16; raf.cb?.(now); }
    expect(reports[0]).toBe('R1:open:thermal');
    run.publish();
    const s = snap as { comps: Record<string, { i: number }> };
    expect(Math.abs(s.comps.R1.i)).toBeLessThan(1e-6);
    run.stop();
  });
});
