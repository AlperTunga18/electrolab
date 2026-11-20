import { describe, expect, it } from 'vitest';
import { EXAMPLES, relayFlyback } from './examples';
import type { Circuit } from '../core/circuit/types';
import { acSweep, analyzeResponse } from '../core/sim/ac';
import { runTransient, solveDCOnce } from '../core/sim/mna';
import { checkStress } from '../core/sim/stress';
import { thermalSpec, effectiveRth } from '../core/thermal/thermal';
import { getDef } from '../library/components';
import { bomCsv, parseProjectFile, toProjectFile } from '../store/persist';

describe('example circuits', () => {
  for (const e of EXAMPLES) {
    it(`${e.id}: DC + transient solve without error`, () => {
      const c = e.build();
      const { results } = solveDCOnce(c);
      expect(Object.keys(results).length).toBe(c.components.length);
      if (e.heavy) return; // switching/long circuits: dedicated numeric test below
      const r = runTransient(c, { stop: 2e-3, dt: 2e-6 });
      expect(r.t.length).toBeGreaterThan(100);
      for (const arr of r.netV) for (const v of arr) expect(Number.isFinite(v)).toBe(true);
    });
  }

  it('led example matches expected ~20 mA with no overstress', () => {
    const c = EXAMPLES.find((x) => x.id === 'led')!.build();
    const { results } = solveDCOnce(c);
    expect(results.R1.i).toBeGreaterThan(0.018);
    expect(checkStress(c, results)).toHaveLength(0);
  });

  it('led with 47 ohm exceeds LED limit and is flagged', () => {
    const c = EXAMPLES.find((x) => x.id === 'led')!.build();
    c.components.find((x) => x.id === 'R1')!.params.r = 47;
    const s = checkStress(c, solveDCOnce(c).results);
    expect(s.some((x) => x.ref === 'D1')).toBe(true);
  });

  it('mosfet PWM example: gate high -> low VDS, gate low -> VDS = 12 V', () => {
    const c = EXAMPLES.find((x) => x.id === 'mosfet')!.build();
    const r = runTransient(c, { stop: 2e-3, dt: 1e-6 });
    const vds = r.comps.Q1.v;
    const k = (t: number) => Math.round(t / 1e-6);
    expect(vds[k(0.15e-3)]).toBeLessThan(0.5);   // on (first 0.3 ms)
    expect(vds[k(0.6e-3)]).toBeGreaterThan(11.9); // off
  });

  it('rectifier example: DC output reaches ~Vp - Vf with 100 uF filter', () => {
    const c = EXAMPLES.find((x) => x.id === 'rectifier')!.build();
    const r = runTransient(c, { stop: 0.1, dt: 5e-5 });
    const v = r.comps.R1.v.slice(Math.round(0.06 / 5e-5));
    expect(Math.max(...v)).toBeGreaterThan(8.8);
    expect(Math.min(...v)).toBeGreaterThan(5);
  });

  it('mosfet_heat example: weak gate drive makes Q1 dissipate several watts; heatsink brings Tj far down', () => {
    const c = EXAMPLES.find((x) => x.id === 'mosfet_heat')!.build();
    const { results } = solveDCOnce(c);
    const q = c.components.find((x) => x.id === 'Q1')!;
    expect(results.Q1.p).toBeGreaterThan(4);
    expect(results.Q1.p).toBeLessThan(8);
    const spec = thermalSpec(getDef(q.type), q)!;
    const free = 25 + results.Q1.p * effectiveRth(spec, q).rth;
    q.thermal = { heatsink: 'large', fan: true };
    const sunk = 25 + results.Q1.p * effectiveRth(spec, q).rth;
    expect(free).toBeGreaterThan(175);
    expect(sunk).toBeLessThan(80);
  });

  it('project file round-trip and BOM', () => {
    const c = EXAMPLES[0].build();
    const p = parseProjectFile(toProjectFile('x', c));
    expect(p.circuit.components).toHaveLength(c.components.length);
    expect(bomCsv(c)).toContain('EKSİK');
  });
});

describe('Stage-7 examples', () => {
  const ex = (id: string) => EXAMPLES.find((x) => x.id === id)!.build();
  const net = (r: ReturnType<typeof runTransient>, pin: string) => r.netV[r.pinNet.get(pin)!];
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

  it('rlc-rezonans: f0 = 1.59 kHz, Q ~ 10, unity gain at resonance', () => {
    const r = acSweep(ex('rlc-rezonans'), { source: 'V1', probes: [{ comp: 'R1', pin: '1' }], fStart: 100, fStop: 20000, ppd: 200 });
    const info = analyzeResponse(r.f, r.mag[0]);
    expect(info.kind).toBe('bandpass');
    expect(Math.abs(info.peakF / 1592 - 1)).toBeLessThan(0.02);
    expect(Math.abs(info.peakGain - 1)).toBeLessThan(0.02);
    expect(Math.abs(info.q! / 10 - 1)).toBeLessThan(0.06);
  });

  it('ce-yukselec: |vc/vb| = gm*RC (AC), inverted', () => {
    const c = ex('ce-yukselec');
    const { results } = solveDCOnce(c);
    const gm = results.Q1.vals.ic / 0.025852;
    expect(results.Q1.vals.ic).toBeGreaterThan(0.5e-3);
    const r = acSweep(c, { source: 'VS', probes: [{ comp: 'Q1', pin: 'C' }, { comp: 'Q1', pin: 'B' }], fStart: 1000, fStop: 5000, ppd: 2 });
    const gain = r.mag[0][0] / r.mag[1][0];
    expect(Math.abs(gain / (gm * 2200) - 1)).toBeLessThan(0.06);
    expect(gain).toBeGreaterThan(80);
    expect(Math.abs(Math.abs(r.phase[0][0] - r.phase[1][0]) - 180)).toBeLessThan(6);
  });

  it('dc-motor-kalkis: inrush ~2 A then ~0.1 A', () => {
    const r = runTransient(ex('dc-motor-kalkis'), { stop: 0.35, dt: 1e-4 });
    const i = r.comps.M1.i;
    expect(Math.max(...i)).toBeGreaterThan(1.6);
    expect(Math.max(...i)).toBeLessThan(2.05);
    expect(Math.abs(i[i.length - 1] - 0.1)).toBeLessThan(0.01);
  });

  it('role-flyback: with diode drain peak < 7 V; without it the inductive kick is >> 10 V', () => {
    const peak = (c: Circuit) => {
      const r = runTransient(c, { stop: 0.3, dt: 5e-5 });
      return Math.max(...net(r, 'Q1:D'));
    };
    const c = ex('role-flyback');
    expect(peak(c)).toBeLessThan(7);
    const bare = relayFlyback(false);
    expect(bare.components.some((x) => x.id === 'D1')).toBe(false);
    expect(peak(bare)).toBeGreaterThan(20);
  });

  it('h-kopru-motor: motor voltage and current reverse between the two phases', () => {
    const dt = 1e-4;
    const r = runTransient(ex('h-kopru-motor'), { stop: 0.5, dt });
    const k = (t: number) => Math.round(t / dt);
    const seg = (a: number[], t0: number, t1: number) => mean(a.slice(k(t0), k(t1)));
    const vFwd = seg(r.comps.M1.v, 0.2, 0.24), vRev = seg(r.comps.M1.v, 0.45, 0.49);
    const iFwd = seg(r.comps.M1.i, 0.2, 0.24), iRev = seg(r.comps.M1.i, 0.45, 0.49);
    expect(vFwd).toBeGreaterThan(4); expect(vRev).toBeLessThan(-4);
    expect(iFwd).toBeGreaterThan(0.05); expect(iRev).toBeLessThan(-0.05);
  });

  it('boost-donusturucu: mean Vout 8-11 V after settling', () => {
    const dt = 1e-6;
    const r = runTransient(ex('boost-donusturucu'), { stop: 0.03, dt });
    const v = r.comps.RL.v.slice(Math.round(0.02 / dt));
    const m = mean(v);
    expect(m).toBeGreaterThan(8); expect(m).toBeLessThan(11);
  });

  it('ac-dc-adaptor: DC 24-32 V, ripple < 6 V pp, secondary ~23 V rms', () => {
    const dt = 2e-4;
    const r = runTransient(ex('ac-dc-adaptor'), { stop: 0.5, dt });
    const v = r.comps.RL.v.slice(Math.round(0.4 / dt));
    const m = mean(v);
    expect(m).toBeGreaterThan(24); expect(m).toBeLessThan(32);
    expect(Math.max(...v) - Math.min(...v)).toBeLessThan(6);
    // open secondary (no bridge): rms of S1-S2
    const c = ex('ac-dc-adaptor');
    c.components = c.components.filter((x) => !['BR1', 'C1', 'RL'].includes(x.id));
    c.wires = c.wires.filter((w) => !['BR1', 'C1', 'RL'].includes(w.a.comp) && !['BR1', 'C1', 'RL'].includes(w.b.comp));
    c.wires.push({ id: 'wo', a: { comp: 'TR1', pin: 'S2' }, b: { comp: 'GND1', pin: 'G' }, color: '#fff', width: 2 });
    const o = runTransient(c, { stop: 0.5, dt });
    const s = net(o, 'TR1:S1').slice(Math.round(0.3 / dt));
    const rms = Math.sqrt(mean(s.map((x) => x * x)));
    expect(rms).toBeGreaterThan(21); expect(rms).toBeLessThan(24);
  });
});
