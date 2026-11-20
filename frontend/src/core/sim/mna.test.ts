import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import { Sim, SimError, runTransient, solveDCOnce } from './mna';
import { buildNets } from '../circuit/nets';
import { formatSI, parseSI } from '../units';

const close = (a: number, b: number, rel = 1e-6, abs = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(abs + rel * Math.abs(b));

function divider() {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 10 }); b.add('resistor', { r: 1000 }); b.add('resistor', { r: 2000 }); b.add('ground');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'R2.1'); b.chain('R2.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b;
}

describe('nets', () => {
  it('merges wired pins and grounds', () => {
    const n = buildNets(divider().circuit);
    expect(n.hasGround).toBe(true);
    expect(n.pinNet.get('V1:N')).toBe(0);
    expect(n.pinNet.get('R2:2')).toBe(0);
    expect(n.pinNet.get('R1:2')).toBe(n.pinNet.get('R2:1'));
    expect(n.netCount).toBe(3);
  });
});

describe('DC', () => {
  it('voltage divider = 6.667 V, I = 3.333 mA, KCL, power balance', () => {
    const { sim, results } = solveDCOnce(divider().circuit);
    close(sim.nodeVoltage(sim.netOf('R1', '2')), 20 / 3);
    close(results.R1.i, 10 / 3000);
    close(results.R2.i, 10 / 3000);
    close(results.V1.i, 10 / 3000);
    const sum = Object.values(results).reduce((a, r) => a + r.p, 0);
    expect(Math.abs(sum)).toBeLessThan(1e-9); // residual = gmin leakage
  });

  it('parallel resistors', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 12 }); b.add('resistor', { r: 300 }); b.add('resistor', { r: 600 }); b.add('ground');
    b.chain('V1.P', 'R1.1', 'R2.1'); b.chain('R1.2', 'GND1.G'); b.chain('R2.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    const { results } = solveDCOnce(b.circuit);
    close(results.V1.i, 12 / 300 + 12 / 600);
  });

  it('potentiometer divider follows wiper position', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 5 }); b.add('pot', { r: 10000, pos: 0.25 }); b.add('ground');
    b.wire('V1.P', 'RV1.A'); b.wire('RV1.B', 'GND1.G'); b.wire('V1.N', 'GND1.G');
    const { sim } = solveDCOnce(b.circuit);
    close(sim.nodeVoltage(sim.netOf('RV1', 'W')), 5 * 0.75, 1e-6);
  });

  it('LED + resistor: current consistent with Shockley, ~20 mA near Vf', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 5 }); b.add('resistor', { r: 150 }); b.add('led', { color: 'red' }); b.add('ground');
    b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'D1.A'); b.chain('D1.K', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    const { results } = solveDCOnce(b.circuit);
    close(results.D1.i, (5 - results.D1.v) / 150, 1e-5);
    expect(results.D1.v).toBeGreaterThan(1.8);
    expect(results.D1.v).toBeLessThan(2.0);
    expect(results.D1.i).toBeGreaterThan(0.018);
    expect(results.D1.i).toBeLessThan(0.022);
  });

  it('reverse diode blocks, forward diode drops ~0.55-0.85 V', () => {
    const mk = (rev: boolean) => {
      const b = new CircuitBuilder();
      b.add('dc_supply', { v: 5 }); b.add('resistor', { r: 1000 }); b.add('diode'); b.add('ground');
      b.chain('V1.P', 'R1.1'); b.wire('R1.2', rev ? 'D1.K' : 'D1.A'); b.wire(rev ? 'D1.A' : 'D1.K', 'GND1.G'); b.wire('V1.N', 'GND1.G');
      return solveDCOnce(b.circuit).results;
    };
    const f = mk(false), r = mk(true);
    expect(f.D1.v).toBeGreaterThan(0.55); expect(f.D1.v).toBeLessThan(0.85);
    expect(Math.abs(r.D1.i)).toBeLessThan(1e-7);
  });

  it('zener regulator clamps near Vz', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 12 }); b.add('resistor', { r: 470 }); b.add('zener', { vz: 5.1 }); b.add('ground');
    b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'D1.K'); b.chain('D1.A', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    const { sim } = solveDCOnce(b.circuit);
    const vout = sim.nodeVoltage(sim.netOf('D1', 'K'));
    expect(vout).toBeGreaterThan(5.1); expect(vout).toBeLessThan(5.4);
  });

  it('NPN switch saturates with enough base current, stays off with none', () => {
    const mk = (rb: number) => {
      const b = new CircuitBuilder();
      b.add('dc_supply', { v: 5 }, 0, 0, 0, 'V1'); b.add('resistor', { r: rb }, 0, 0, 0, 'RB'); b.add('resistor', { r: 470 }, 0, 0, 0, 'RC');
      b.add('npn'); b.add('ground');
      b.wire('V1.P', 'RB.1'); b.wire('RB.2', 'Q1.B'); b.wire('V1.P', 'RC.1'); b.wire('RC.2', 'Q1.C'); b.wire('Q1.E', 'GND1.G'); b.wire('V1.N', 'GND1.G');
      return solveDCOnce(b.circuit);
    };
    const on = mk(10000).results.Q1;
    expect(on.vals.vce).toBeLessThan(0.3);
    expect(on.vals.ic).toBeGreaterThan(0.009);
    const off = mk(1e9).results.Q1;
    expect(off.vals.vce).toBeGreaterThan(4.9);
  });

  it('NMOS: off at Vgs=0, low Rds at 5 V logic-level, high-Vth part stays resistive', () => {
    const mk = (type: string, vg: number) => {
      const b = new CircuitBuilder();
      b.add('dc_supply', { v: 12 }, 0, 0, 0, 'V1'); b.add('dc_supply', { v: vg }, 0, 0, 0, 'VG');
      b.add('resistor', { r: 12 }); b.add(type); b.add('ground');
      b.wire('V1.P', 'R1.1'); b.wire('R1.2', 'Q1.D'); b.wire('VG.P', 'Q1.G'); b.wire('Q1.S', 'GND1.G'); b.wire('V1.N', 'GND1.G'); b.wire('VG.N', 'GND1.G');
      return solveDCOnce(b.circuit).results.Q1;
    };
    expect(mk('nmos_logic', 0).vals.id).toBeLessThan(1e-6);
    const logic = mk('nmos_logic', 5);
    expect(logic.vals.vds).toBeLessThan(0.1);
    const std = mk('nmos_std', 5);
    expect(std.vals.vds).toBeGreaterThan(logic.vals.vds * 3);
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 10 }, 0, 0, 0, 'V1'); b.add('dc_supply', { v: 3 }, 0, 0, 0, 'VG'); b.add('nmos_logic', { vth: 1, k: 0.5, lambda: 0 }); b.add('ground');
    b.wire('V1.P', 'Q1.D'); b.wire('VG.P', 'Q1.G'); b.wire('Q1.S', 'GND1.G'); b.wire('V1.N', 'GND1.G'); b.wire('VG.N', 'GND1.G');
    close(solveDCOnce(b.circuit).results.Q1.vals.id, 0.5 * 4, 1e-4);
  });

  it('PMOS high-side switch conducts when gate pulled low', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 12 }, 0, 0, 0, 'V1'); b.add('dc_supply', { v: 0 }, 0, 0, 0, 'VG'); b.add('pmos'); b.add('resistor', { r: 100 }); b.add('ground');
    b.wire('V1.P', 'Q1.S'); b.wire('VG.P', 'Q1.G'); b.wire('Q1.D', 'R1.1'); b.wire('R1.2', 'GND1.G'); b.wire('V1.N', 'GND1.G'); b.wire('VG.N', 'GND1.G');
    const { sim } = solveDCOnce(b.circuit);
    expect(sim.nodeVoltage(sim.netOf('R1', '1'))).toBeGreaterThan(11.5);
  });
});

describe('errors', () => {
  it('no ground -> SimError', () => {
    const b = new CircuitBuilder(); b.add('dc_supply'); b.add('resistor'); b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'V1.N');
    expect(() => new Sim(b.circuit)).toThrowError(SimError);
  });
  it('source shorted by wire -> shorted-source', () => {
    const b = new CircuitBuilder(); b.add('dc_supply'); b.add('ground'); b.wire('V1.P', 'V1.N'); b.wire('V1.N', 'GND1.G');
    try { new Sim(b.circuit); throw new Error('no throw'); } catch (e) { expect((e as SimError).kind).toBe('shorted-source'); }
  });
  it('two ideal sources in parallel with different voltages -> singular', () => {
    const b = new CircuitBuilder(); b.add('dc_supply', { v: 5 }); b.add('dc_supply', { v: 3 }); b.add('ground');
    b.wire('V1.P', 'V2.P'); b.wire('V1.N', 'GND1.G'); b.wire('V2.N', 'GND1.G');
    expect(() => solveDCOnce(b.circuit)).toThrowError(/tekil/);
  });
});

describe('transient', () => {
  const rc = (method: 'trap' | 'be') => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 5 }); b.add('resistor', { r: 1000 }); b.add('capacitor', { c: 1e-6 }); b.add('ground');
    b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'C1.1'); b.chain('C1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    return runTransient(b.circuit, { stop: 5e-3, dt: 5e-6, method });
  };
  it('RC charge matches V(1-e^-t/RC) (trap, <0.2 %)', () => {
    const r = rc('trap');
    for (const frac of [0.5, 1, 2, 3, 5]) {
      const k = Math.round((frac * 1e-3) / 5e-6);
      close(r.comps.C1.v[k], 5 * (1 - Math.exp(-frac)), 2e-3, 2e-3);
    }
  });
  it('RC charge with backward Euler within 1 %', () => {
    const r = rc('be');
    const k = Math.round(1e-3 / 5e-6);
    close(r.comps.C1.v[k], 5 * (1 - Math.exp(-1)), 1e-2, 1e-2);
  });
  it('RC discharge from initial voltage v0', () => {
    const b = new CircuitBuilder();
    b.add('capacitor', { c: 10e-6, v0: 4 }); b.add('resistor', { r: 1000 }); b.add('ground');
    b.chain('C1.1', 'R1.1'); b.chain('R1.2', 'GND1.G'); b.chain('C1.2', 'GND1.G');
    const r = runTransient(b.circuit, { stop: 30e-3, dt: 3e-5 });
    const k = Math.round(10e-3 / 3e-5);
    close(r.comps.C1.v[k], 4 * Math.exp(-1), 3e-3, 3e-3);
    close(r.comps.C1.v[0], 4, 1e-9);
  });
  it('RL current rise i = V/R (1-e^-tR/L)', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 10 }); b.add('resistor', { r: 100 }); b.add('inductor', { l: 0.1 }); b.add('ground');
    b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'L1.1'); b.chain('L1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    const tau = 0.1 / 100;
    const r = runTransient(b.circuit, { stop: 5 * tau, dt: tau / 200 });
    for (const f of [1, 2, 3]) {
      const k = f * 200;
      close(r.comps.L1.i[k], 0.1 * (1 - Math.exp(-f)), 3e-3, 1e-5);
    }
  });
  it('RC low-pass gain at cutoff = 1/sqrt2 (steady-state sine)', () => {
    const b = new CircuitBuilder();
    b.add('signal_gen', { wave: 'sine', amp: 1, freq: 1000, v: 0 }); b.add('resistor', { r: 1000 }); b.add('capacitor', { c: 159.1549e-9 }); b.add('ground');
    b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'C1.1'); b.chain('C1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    const dt = 1e-6;
    const r = runTransient(b.circuit, { stop: 10e-3, dt });
    const tail = r.comps.C1.v.slice(Math.round(8e-3 / dt));
    close(Math.max(...tail), Math.SQRT1_2, 5e-3, 5e-3);
  });
  it('half-wave rectifier peak ~ Vp - Vf', () => {
    const b = new CircuitBuilder();
    b.add('signal_gen', { wave: 'sine', amp: 5, freq: 50 }); b.add('diode'); b.add('resistor', { r: 1000 }); b.add('ground');
    b.chain('V1.P', 'D1.A'); b.chain('D1.K', 'R1.1'); b.chain('R1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    const r = runTransient(b.circuit, { stop: 40e-3, dt: 5e-5 });
    const vout = r.comps.R1.v;
    expect(Math.max(...vout)).toBeGreaterThan(4.1);
    expect(Math.max(...vout)).toBeLessThan(4.6);
    expect(Math.min(...vout)).toBeGreaterThan(-1e-3);
  });
  it('energy conservation: charging through R dissipates equal energy to stored', () => {
    const r = rc('trap');
    const dt = 5e-6;
    const eR = r.comps.R1.p.reduce((a, p) => a + p * dt, 0);
    close(eR, 0.5 * 1e-6 * 25, 2e-2, 1e-9);
  });
});

describe('units', () => {
  it('formats and parses SI', () => {
    expect(formatSI(4700, 'Ω')).toBe('4.7 kΩ');
    expect(formatSI(1e-7, 'F')).toBe('100 nF');
    expect(formatSI(0.0033333, 'A')).toBe('3.33 mA');
    expect(parseSI('4.7k')).toBeCloseTo(4700);
    expect(parseSI('100n')).toBeCloseTo(1e-7, 15);
    expect(parseSI('abc')).toBeNull();
  });
});
