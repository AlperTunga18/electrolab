import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import { bounceSequence, enSat, ldSat, lamSat, satKnee, Sim, solveDCOnce, runTransient } from './mna';
import { measureImpedance } from './ac';
import { checkStress } from './stress';
import { evaluateDamage } from './damage';

const close = (a: number, b: number, rel = 1e-3, abs = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(abs + rel * Math.abs(b));

// ---------------------------------------------------------------- relay contact bounce
/** 5 V coil, 12 V load switched by COM-NO; rl = load resistor, relay params via `extra` */
const relayCircuit = (extra: Record<string, number | string | boolean> = {}, rl = 100) => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 5 }, 0, 0, 0, 'VC'); b.add('dc_supply', { v: 12 }, 0, 0, 0, 'VL');
  b.add('relay_5v', extra, 0, 0, 0, 'K1'); b.add('resistor', { r: rl }, 0, 0, 0, 'RL'); b.add('ground');
  b.chain('VC.P', 'K1.C1'); b.chain('K1.C2', 'GND1.G'); b.chain('VC.N', 'GND1.G');
  b.chain('VL.P', 'K1.COM'); b.chain('K1.NO', 'RL.1'); b.chain('RL.2', 'GND1.G'); b.chain('VL.N', 'GND1.G');
  return b.circuit;
};

/** run the 5 V coil step and sample the NO contact state / load current on a fixed grid */
function closeTransient(extra: Record<string, number | string | boolean>, rl = 100, dt = 1e-5, stop = 0.03) {
  const sim = new Sim(relayCircuit(extra, rl), { init: 'ic', method: 'trap' });
  sim.init();
  const t: number[] = [], st: number[] = [], i: number[] = [];
  const n = Math.round(stop / dt);
  for (let k = 0; k <= n; k++) {
    const r = sim.results();
    t.push(sim.t); st.push(r.K1.vals.noClosed); i.push(r.RL.i);
    if (k < n) sim.step(dt);
  }
  return { t, st, i, sim, final: sim.results().K1.vals };
}
const toggles = (st: number[]) => { const out: number[] = []; for (let k = 1; k < st.length; k++) if (st[k] !== st[k - 1]) out.push(k); return out; };

describe('relay contact bounce', () => {
  it('5 V -> load transient: contact toggles open/closed 3 times inside the 2 ms window, final state closed', () => {
    const dt = 1e-5;
    const { t, st, final } = closeTransient({}, 100, dt);
    const tg = toggles(st);
    // first touch (0 -> 1), then 3 x (open, closed): 1 + 6 toggles
    expect(tg.length).toBe(7);
    const t0 = t[tg[0]];
    expect(t0).toBeGreaterThan(0.01); expect(t0).toBeLessThan(0.02); // pull-in delay unchanged (~13 ms)
    expect(t[tg[tg.length - 1]] - t0).toBeLessThanOrEqual(2e-3 + 2 * dt); // all toggles inside the window
    const states = tg.map((k) => st[k]);
    expect(states).toEqual([1, 0, 1, 0, 1, 0, 1]); // alternating
    expect(st[st.length - 1]).toBe(1);
    expect(final.bounces).toBe(3);
    expect(st.slice(0, tg[0]).every((s) => s === 0)).toBe(true); // open before the first touch
  });

  it('bounce = 0 (and nbounce = 0) is the old behaviour: single clean closure, identical waveforms', () => {
    const a = closeTransient({ bounce: 0 });
    const b = closeTransient({ nbounce: 0 });
    expect(toggles(a.st).length).toBe(1);
    expect(a.final.bounces).toBe(0);
    expect(a.i).toEqual(b.i);
    // old test expectations (devices.test.ts): open at 11 ms, closed at 25 ms with 12 V / 100.05 ohm
    const at = (s: number) => Math.round(s / 1e-5);
    expect(Math.abs(a.i[at(0.011)])).toBeLessThan(1e-3);
    close(a.i[at(0.025)], 12 / 100.05, 1e-3);
    // closure time = pull-in + operate delay, with and without bounce the FIRST touch is at the same time
    const withB = closeTransient({});
    expect(withB.t[toggles(withB.st)[0]]).toBe(a.t[toggles(a.st)[0]]);
  });

  it('is deterministic (seeded from the component id), different ids give different sequences, segments sum to the window', () => {
    const r1 = closeTransient({}), r2 = closeTransient({});
    expect(r1.i).toEqual(r2.i);
    const s1 = bounceSequence(123, 2e-3, 3), s2 = bounceSequence(456, 2e-3, 3), s1b = bounceSequence(123, 2e-3, 3);
    expect(s1).toEqual(s1b);
    expect(s1).not.toEqual(s2);
    expect(s1.length).toBe(6);
    close(s1[5], 2e-3, 1e-12);
    for (let k = 1; k < s1.length; k++) expect(s1[k]).toBeGreaterThan(s1[k - 1]);
    expect(bounceSequence(1, 0, 3)).toEqual([]);
    // the open segments shrink (bounce energy decays) on average: first open > last open
    expect(s1[1] - s1[0]).toBeGreaterThan(s1[5] - s1[4]);
  });

  it('result does not depend on the time step: 4 bounces and the same toggle times (to one step) for dt = 1e-5 and 4e-5', () => {
    const fine = closeTransient({ nbounce: 4 }, 100, 1e-5), coarse = closeTransient({ nbounce: 4 }, 100, 4e-5);
    expect(fine.final.bounces).toBe(4);
    expect(coarse.final.bounces).toBe(4);
    const tf = toggles(fine.st).map((k) => fine.t[k]), tc = toggles(coarse.st).map((k) => coarse.t[k]);
    expect(tf.length).toBe(9);
    expect(tc.length).toBe(9);
    // the grid can only resolve an edge to its own step size (the first edge also depends on the pull-in quantisation)
    for (let k = 1; k < tf.length; k++) expect(Math.abs((tf[k] - tf[0]) - (tc[k] - tc[0]))).toBeLessThanOrEqual(5e-5);
  });

  it('closed segments carry the constriction resistance: first touch conducts less than the settled contact', () => {
    const { st, i } = closeTransient({}, 10);
    const k0 = toggles(st)[0];
    const settled = i[i.length - 1];
    expect(i[k0]).toBeGreaterThan(0);
    expect(i[k0]).toBeLessThan(settled * 0.995); // R = 0.05 + ~0.5 ohm vs 10 ohm load
    close(settled, 12 / 10.05, 1e-3);
  });
});

// ---------------------------------------------------------------- relay arcing
/** 12 V -> relay NO -> L (10 mH) + R (5 ohm) load; coil released at t = 0.02 s. fly: flyback diode across the load */
function openInductive(extra: Record<string, number | string | boolean>, fly: boolean, tStop = 0.045, dt = 1e-5) {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 5 }, 0, 0, 0, 'VC'); b.add('dc_supply', { v: 12 }, 0, 0, 0, 'VL');
  b.add('relay_5v', extra, 0, 0, 0, 'K1'); b.add('inductor', { l: 10e-3 }, 0, 0, 0, 'L1'); b.add('resistor', { r: 5 }, 0, 0, 0, 'RL'); b.add('ground');
  b.chain('VC.P', 'K1.C1'); b.chain('K1.C2', 'GND1.G'); b.chain('VC.N', 'GND1.G');
  b.chain('VL.P', 'K1.COM'); b.chain('K1.NO', 'L1.1'); b.chain('L1.2', 'RL.1'); b.chain('RL.2', 'GND1.G'); b.chain('VL.N', 'GND1.G');
  if (fly) { b.add('diode', {}, 0, 0, 0, 'D1'); b.chain('D1.A', 'GND1.G'); b.chain('D1.K', 'K1.NO'); }
  // flyback across L1+RL: node NO is the load's high side
  const circuit = b.circuit;
  const sim = new Sim(circuit, { init: 'ic', method: 'trap' });
  sim.init();
  const vc = sim.elems.find((e) => e.k === 'V' && e.owner === 'VC');
  if (!vc || vc.k !== 'V') throw new Error('VC missing');
  let peak = 0, peakT = 0, minI = 1e9, maxI = 0;
  const n = Math.round(tStop / dt);
  let results = sim.results();
  for (let k = 0; k < n; k++) {
    if (sim.t >= 0.02) vc.v = 0;
    sim.step(dt);
    results = sim.results();
    const v = Math.abs(results.K1.vals.vno);
    if (sim.t > 0.02 && v > peak) { peak = v; peakT = sim.t; }
    if (sim.t > 0.02) { minI = Math.min(minI, Math.abs(results.L1.i)); maxI = Math.max(maxI, Math.abs(results.L1.i)); }
  }
  return { sim, circuit, results, peak, peakT, minI, maxI };
}

describe('relay contact arc', () => {
  it('inductive load opened: contact voltage is clamped near the arc voltage (tens of V), not a kilovolt spike', () => {
    const r = openInductive({}, false);
    expect(r.results.K1.vals.arcCount).toBeGreaterThanOrEqual(1);
    expect(r.peak).toBeGreaterThan(13); // the arc voltage is reached
    expect(r.peak).toBeLessThan(40);
    // the inductor current is carried through the arc and has died away afterwards
    expect(r.results.K1.vals.arc).toBe(0);
    expect(Math.abs(r.results.L1.i)).toBeLessThan(5e-3);
  });

  it('same circuit with the arc model off: current chopped into an open contact -> unlimited-class voltage spike', () => {
    const arc = openInductive({}, false), noArc = openInductive({ arc: false }, false);
    expect(noArc.peak).toBeGreaterThan(200);
    expect(noArc.peak).toBeGreaterThan(10 * arc.peak);
    expect(noArc.results.K1.vals.arcCount).toBe(0);
  });

  it('with a flyback diode there is no arc: contact stays near supply + Vf and the arc energy stays 0', () => {
    const r = openInductive({}, true);
    expect(r.peak).toBeLessThan(14); // 12 V + diode drop, below the arc voltage
    expect(r.results.K1.vals.arcCount).toBe(0);
    expect(r.results.K1.vals.arcEnergy).toBeLessThan(1e-6);
  });

  it('arc energy is accumulated as a wear indicator, of the order of the load energy (mJ..100 mJ)', () => {
    const r = openInductive({}, false);
    const e = r.results.K1.vals.arcEnergy;
    expect(e).toBeGreaterThan(5e-3);
    expect(e).toBeLessThan(0.5);
  });

  it('wear above the limit raises a "kontak aşınması" failure (welded contact); default limit does not trigger', () => {
    const lowLimit = openInductive({ warc: 0.005 }, false);
    const stress = checkStress(lowLimit.circuit, lowLimit.results);
    const wear = stress.find((s) => s.key.endsWith('|wear'));
    expect(wear).toBeDefined();
    const cands = evaluateDamage(lowLimit.circuit, lowLimit.results, {}, {}, stress);
    const hit = cands.find((c) => c.cause === 'wear');
    expect(hit?.fault.kind).toBe('welded');
    const normal = openInductive({}, false);
    expect(checkStress(normal.circuit, normal.results).some((s) => s.key.endsWith('|wear'))).toBe(false);
    // an already welded contact is not reported again
    expect(evaluateDamage(lowLimit.circuit, lowLimit.results, {}, { K1: { kind: 'welded' } }, stress).some((c) => c.cause === 'wear')).toBe(false);
  });

  it('a resistive 12 V load never arcs (supply below the arc voltage)', () => {
    const { sim } = closeTransient({}, 10);
    // release the coil
    const vc = sim.elems.find((e) => e.k === 'V' && e.owner === 'VC');
    if (!vc || vc.k !== 'V') throw new Error('VC missing');
    vc.v = 0;
    for (let k = 0; k < 3000; k++) sim.step(1e-5);
    expect(sim.results().K1.vals.noClosed).toBe(0);
    expect(sim.results().K1.vals.arcCount).toBe(0);
  });
});

// ---------------------------------------------------------------- inductor saturation
const stepCircuit = (extra: Record<string, number | string | boolean>, v = 5, r = 0.5) => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v }, 0, 0, 0, 'V1'); b.add('resistor', { r }, 0, 0, 0, 'R1'); b.add('inductor', { l: 100e-6, ...extra }, 0, 0, 0, 'L1'); b.add('ground');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'L1.1'); b.chain('L1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};
const L0 = 100e-6, V = 5, R = 0.5;

/** independent reference: RK4 on lambda, d(lambda)/dt = V - R*i(lambda), i = ik*tan(lambda/(L0*ik)) */
function refCurrent(ik: number, tEnd: number, steps = 20000): number {
  let lam = 0;
  const f = (l: number) => V - R * ik * Math.tan(l / (L0 * ik));
  const h = tEnd / steps;
  for (let k = 0; k < steps; k++) {
    const k1 = f(lam), k2 = f(lam + 0.5 * h * k1), k3 = f(lam + 0.5 * h * k2), k4 = f(lam + h * k3);
    lam += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
  }
  return ik * Math.tan(lam / (L0 * ik));
}

describe('inductor saturation', () => {
  it('Isat / droppct conversion: L_d(Isat) = (1 - drop) * L0, flux and energy are consistent with L_d', () => {
    for (const dp of [10, 20, 30, 50]) {
      const ik = satKnee(2, dp);
      close(ldSat(L0, ik, 2), L0 * (1 - dp / 100), 1e-12);
    }
    const ik = satKnee(1, 30);
    // L_d = dlambda/di and dW = i dlambda (finite-difference check)
    const i = 0.8, h = 1e-6;
    close((lamSat(L0, ik, i + h) - lamSat(L0, ik, i - h)) / (2 * h), ldSat(L0, ik, i), 1e-6);
    close((enSat(L0, ik, i + h) - enSat(L0, ik, i - h)) / (2 * h), i * ldSat(L0, ik, i), 1e-6);
    close(ldSat(L0, ik, 0), L0, 1e-12);
  });

  it('current ramp steepens past Isat (di/dt increases) while the linear inductor ramps at a constant rate', () => {
    const dt = 2e-7;
    const lin = runTransient(stepCircuit({}), { stop: 1.2e-4, dt });
    const sat = runTransient(stepCircuit({ isat: 2 }), { stop: 1.2e-4, dt });
    const iL = lin.comps.L1.i, iS = sat.comps.L1.i;
    const slope = (a: number[], k0: number, k1: number) => (a[k1] - a[k0]) / ((k1 - k0) * dt);
    const kEarly = Math.round(10e-6 / dt);
    // same slope while far below Isat
    close(slope(iS, 1, kEarly), slope(iL, 1, kEarly), 0.1);
    // the saturated current exceeds the linear one and its slope grows after it crosses Isat
    const kCross = iS.findIndex((x) => x > 2);
    expect(kCross).toBeGreaterThan(0);
    const w = Math.round(5e-6 / dt);
    const before = slope(iS, kCross - 2 * w, kCross - w), after = slope(iS, kCross + w, kCross + 2 * w);
    expect(after).toBeGreaterThan(1.1 * before);
    expect(iS[iS.length - 1]).toBeGreaterThan(1.5 * iL[iL.length - 1]);
  });

  it('peak current agrees with an independent fine-step RK4 flux reference within 3 % (also at a coarse step)', () => {
    const tEnd = 1e-4;
    const ik = satKnee(2, 30);
    const ref = refCurrent(ik, tEnd);
    const coarse = runTransient(stepCircuit({ isat: 2 }), { stop: tEnd, dt: 1e-6 });
    const fine = runTransient(stepCircuit({ isat: 2 }), { stop: tEnd, dt: 5e-8 });
    const peakC = coarse.comps.L1.i[coarse.comps.L1.i.length - 1], peakF = fine.comps.L1.i[fine.comps.L1.i.length - 1];
    expect(ref).toBeGreaterThan(3); // really deep into saturation
    close(peakF, ref, 0.01);
    close(peakC, ref, 0.03);
    close(peakC, peakF, 0.03);
    // linear would be far off: the check is meaningful
    const linPeak = (V / R) * (1 - Math.exp(-(R / L0) * tEnd));
    expect(Math.abs(linPeak - ref) / ref).toBeGreaterThan(0.3);
  });

  it('energy consistent: stored energy W(i) equals source work minus resistor loss', () => {
    const dt = 2e-7;
    const r = runTransient(stepCircuit({ isat: 2 }), { stop: 1e-4, dt });
    let eL = 0;
    for (let k = 1; k < r.t.length; k++) eL += 0.5 * (r.comps.L1.p[k] + r.comps.L1.p[k - 1]) * dt;
    const i = r.comps.L1.i[r.comps.L1.i.length - 1];
    close(eL, enSat(L0, satKnee(2, 30), i), 0.03);
  });

  it('isat = 0 is exactly the old linear inductor; a huge Isat converges to it', () => {
    const a = runTransient(stepCircuit({ isat: 0 }), { stop: 1e-4, dt: 1e-6 });
    const b = runTransient(stepCircuit({}), { stop: 1e-4, dt: 1e-6 });
    const c = runTransient(stepCircuit({ isat: 1e9 }), { stop: 1e-4, dt: 1e-6 });
    expect(a.comps.L1.i).toEqual(b.comps.L1.i);
    for (let k = 0; k < a.t.length; k++) close(c.comps.L1.i[k], a.comps.L1.i[k], 1e-6, 1e-9);
    // linear analytic RL (trapezoidal, 1 us step)
    const t = a.t[a.t.length - 1];
    close(a.comps.L1.i[a.t.length - 1], (V / R) * (1 - Math.exp(-(R / L0) * t)), 2e-3);
    const { results } = solveDCOnce(stepCircuit({ isat: 2 }));
    close(results.L1.i, V / R, 1e-6); // DC: shorted, independent of saturation
  });

  it('AC small-signal inductance at a high DC bias is lower than at zero bias (L_d at the operating point)', () => {
    const build = (ibias: number) => {
      const b = new CircuitBuilder();
      b.add('isource', { i: ibias }, 0, 0, 0, 'I1'); b.add('inductor', { l: 10e-3, isat: 1 }, 0, 0, 0, 'L1'); b.add('ground');
      b.chain('I1.P', 'L1.1'); b.chain('L1.2', 'GND1.G'); b.chain('I1.N', 'GND1.G');
      return b.circuit;
    };
    const z = (ib: number) => measureImpedance(build(ib), { comp: 'L1', pin: '1' }, { comp: 'L1', pin: '2' }, 1000, { powered: true });
    const z0 = z(0), z3 = z(3);
    expect(z0.ls).toBeDefined(); expect(z3.ls).toBeDefined();
    close(z0.ls!, 10e-3, 1e-3);
    close(z3.ls!, ldSat(10e-3, satKnee(1, 30), 3), 1e-3);
    expect(z3.ls!).toBeLessThan(0.3 * z0.ls!);
  });

  it('damage: current above Isat is a warning (stress), >= 3x Isat fails the winding ("doyma: akım > Isat")', () => {
    const run = (r: number) => {
      const c = stepCircuit({ isat: 1 }, 5, r);
      const { results } = solveDCOnce(c);
      const stress = checkStress(c, results);
      return { c, results, stress, cands: evaluateDamage(c, results, {}, {}, stress) };
    };
    const warn = run(2.5); // 2 A = 2 x Isat
    expect(warn.stress.some((s) => s.key.endsWith('|sat') && s.note === 'doyma: akım > Isat')).toBe(true);
    expect(warn.cands.some((c) => c.cause === 'saturation')).toBe(false);
    const fail = run(1.25); // 4 A
    const hit = fail.cands.find((c) => c.cause === 'saturation');
    expect(hit?.fault.kind).toBe('open');
    const ok = run(10); // 0.5 A
    expect(ok.stress.some((s) => s.key.endsWith('|sat'))).toBe(false);
    // Isat = 0 (unknown): never flagged
    const c0 = stepCircuit({}, 5, 1.25);
    expect(checkStress(c0, solveDCOnce(c0).results).some((s) => s.key.endsWith('|sat'))).toBe(false);
  });
});
