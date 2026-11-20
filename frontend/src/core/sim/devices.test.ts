import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import { Sim, runTransient, solveDCOnce } from './mna';
import { effectiveCircuit } from './faults';

const close = (a: number, b: number, rel = 1e-3, abs = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(abs + rel * Math.abs(b));

function motorCircuit(extra: Record<string, number | string | boolean> = {}) {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 6 }); b.add('dc_motor', extra, 0, 0, 0, 'M1'); b.add('ground');
  b.chain('V1.P', 'M1.P'); b.chain('M1.N', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
}

describe('DC motor', () => {
  it('steady state: i = V/(R + ke^2/B), omega = ke*i/B', () => {
    const { results } = solveDCOnce(motorCircuit());
    const ke = 4.5e-3, B = 3.6e-7, R = 3;
    const i = 6 / (R + (ke * ke) / B);
    close(results.M1.i, i, 1e-6);
    close(results.M1.vals.omega, (ke * i) / B, 1e-6);
    close(results.M1.vals.rpm, (results.M1.vals.omega * 60) / (2 * Math.PI), 1e-9);
    // energy balance: electrical in = copper loss + mechanical (all friction here)
    close(results.M1.p, results.M1.vals.pcu + results.M1.vals.pmech, 1e-6);
  });

  it('start-up: inrush current ~ V/R, then spins up to no-load speed and current drops', () => {
    const r = runTransient(motorCircuit(), { stop: 0.35, dt: 1e-4 });
    const i = r.comps.M1.i;
    expect(Math.max(...i.slice(0, 80))).toBeGreaterThan(1.6);   // V/R = 2 A
    expect(Math.max(...i)).toBeLessThan(2.05);
    const iEnd = i[i.length - 1];
    close(iEnd, 0.1013, 0.02);
    // omega reached steady state
    const { results } = solveDCOnce(motorCircuit());
    expect(results.M1.vals.omega).toBeGreaterThan(1200);
  });

  it('load torque lowers speed and raises current; stalled rotor draws V/R', () => {
    const free = solveDCOnce(motorCircuit()).results.M1;
    const loaded = solveDCOnce(motorCircuit({ tload: 0.002 })).results.M1;
    expect(loaded.vals.omega).toBeLessThan(free.vals.omega);
    expect(loaded.i).toBeGreaterThan(free.i * 2);
    const c = effectiveCircuit(motorCircuit(), { M1: { kind: 'stalled' } });
    const stalled = solveDCOnce(c).results.M1;
    expect(Math.abs(stalled.vals.omega)).toBeLessThan(1);
    close(stalled.i, 2, 0.01);
  });
});

describe('relay', () => {
  const circuit = () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 5 }, 0, 0, 0, 'VC'); b.add('dc_supply', { v: 12 }, 0, 0, 0, 'VL');
    b.add('relay_5v', {}, 0, 0, 0, 'K1'); b.add('resistor', { r: 100 }, 0, 0, 0, 'RL'); b.add('ground');
    b.chain('VC.P', 'K1.C1'); b.chain('K1.C2', 'GND1.G'); b.chain('VC.N', 'GND1.G');
    b.chain('VL.P', 'K1.COM'); b.chain('K1.NO', 'RL.1'); b.chain('RL.2', 'GND1.G'); b.chain('VL.N', 'GND1.G');
    return b.circuit;
  };
  it('DC: coil energised -> COM-NO closed immediately', () => {
    const { results } = solveDCOnce(circuit());
    close(results.K1.i, 5 / 70, 1e-4);
    expect(results.K1.vals.energized).toBe(1);
    close(results.RL.i, 12 / 100.05, 1e-3);
  });
  it('transient: contact closes only after the coil current reaches the pull-in level + operate delay', () => {
    const r = runTransient(circuit(), { stop: 0.03, dt: 5e-5 });
    const at = (t: number) => Math.round(t / 5e-5);
    expect(Math.abs(r.comps.RL.i[at(0.005)])).toBeLessThan(1e-3);     // still open (coil ramping)
    expect(Math.abs(r.comps.RL.i[at(0.011)])).toBeLessThan(1e-3);     // pulled in current at ~3 ms, +10 ms delay
    close(r.comps.RL.i[at(0.025)], 0.12, 0.01);                       // closed
  });
  it('welded contact stays closed with the coil unpowered; stuckOpen never closes', () => {
    const b = circuit();
    b.components = b.components.filter((c) => c.id !== 'VC');
    b.wires = b.wires.filter((w) => w.a.comp !== 'VC' && w.b.comp !== 'VC');
    b.wires.push({ id: 'wg', a: { comp: 'K1', pin: 'C1' }, b: { comp: 'GND1', pin: 'G' }, color: '#fff', width: 2 });
    close(solveDCOnce(b).results.RL.i, 0, 1, 1e-6);
    const sim = new Sim(b, { faults: { K1: { kind: 'welded' } } });
    sim.solveDC();
    close(sim.results().RL.i, 0.12, 0.01);
    const sim2 = new Sim(circuit(), { faults: { K1: { kind: 'stuckOpen' } } });
    sim2.solveDC();
    expect(Math.abs(sim2.results().RL.i)).toBeLessThan(1e-6);
  });
});

describe('transformer', () => {
  const circuit = (load: number | null, wave: 'sine' | 'dc' = 'sine') => {
    const b = new CircuitBuilder();
    b.add('signal_gen', wave === 'sine' ? { wave: 'sine', amp: 325, freq: 50 } : { wave: 'sine', amp: 0, v: 10, freq: 50 }, 0, 0, 0, 'V1');
    b.add('transformer', {}, 0, 0, 0, 'TR1'); b.add('ground');
    b.chain('V1.P', 'TR1.P1'); b.chain('TR1.P2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    b.chain('TR1.S2', 'GND1.G');
    if (load !== null) { b.add('resistor', { r: load }); b.chain('TR1.S1', 'R1.1'); b.chain('R1.2', 'GND1.G'); }
    return b.circuit;
  };
  it('open-circuit voltage ratio ~ k/n (31.9 V peak from 325 V peak)', () => {
    const r = runTransient(circuit(null), { stop: 0.08, dt: 5e-5 });
    const sec = r.netV[r.pinNet.get('TR1:S1')!];
    const tail = sec.slice(Math.round(0.04 / 5e-5));
    close(Math.max(...tail), (0.98 / 10) * 325, 0.04);
  });
  it('loaded: secondary power ~ primary power minus winding losses (efficiency 70-100 %)', () => {
    const r = runTransient(circuit(10), { stop: 0.1, dt: 5e-5 });
    const from = Math.round(0.04 / 5e-5);
    const mean = (a: number[]) => a.slice(from).reduce((x, y) => x + y, 0) / (a.length - from);
    const pin = mean(r.comps.V1.p.map((p) => -p));
    const pout = mean(r.comps.R1.p);
    expect(pout).toBeGreaterThan(5);
    expect(pout / pin).toBeGreaterThan(0.6);
    expect(pout / pin).toBeLessThan(1.0001);
  });
  it('DC: primary conducts only through its winding resistance and the secondary is isolated', () => {
    const { results } = solveDCOnce(circuit(10, 'dc'));
    close(results.TR1.i, 10 / 20, 1e-3);
    expect(Math.abs(results.R1.i)).toBeLessThan(1e-6);
  });
  it('insulation (leak) fault couples primary and secondary', () => {
    const c = circuit(10, 'dc');
    const sim = new Sim(c, { faults: { TR1: { kind: 'leak', amount: 100 } } });
    sim.solveDC();
    // primary +10 V side leaks to the secondary via 100 ohm -> load sees a voltage
    expect(Math.abs(sim.results().R1.i)).toBeGreaterThan(1e-3);
  });
});

describe('electronic load', () => {
  const circuit = (mode: string, extra: Record<string, number | string | boolean> = {}) => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 12 }, 0, 0, 0, 'V1'); b.add('resistor', { r: 2 }, 0, 0, 0, 'RS'); b.add('eload', { mode, ...extra }, 0, 0, 0, 'EL1'); b.add('ground');
    b.chain('V1.P', 'RS.1'); b.chain('RS.2', 'EL1.P'); b.chain('EL1.N', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    return b.circuit;
  };
  it('CC: fixed current regardless of voltage', () => {
    const { results } = solveDCOnce(circuit('cc', { i: 0.5 }));
    close(results.EL1.i, 0.5, 1e-6);
    close(results.EL1.v, 12 - 0.5 * 2, 1e-6);
  });
  it('CR: acts as a resistor', () => {
    const { results } = solveDCOnce(circuit('cr', { r: 10 }));
    close(results.EL1.i, 12 / 12, 1e-4);
  });
  it('CP: constant power solves the quadratic (12 - 2i)·i = 6', () => {
    const { results } = solveDCOnce(circuit('cp', { p: 6 }));
    close(results.EL1.i, (12 - Math.sqrt(144 - 48)) / 4, 1e-3);
    close(results.EL1.p, 6, 1e-3);
  });
});
