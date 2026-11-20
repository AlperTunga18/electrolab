import { describe, expect, it, vi } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import type { Circuit, Fault } from '../circuit/types';
import { Sim, runTransient } from './mna';
import { effectiveCircuit, esrNominal, faultOptions } from './faults';
import { REVERSE_DWELL_S, evaluateDamage, thermalStates } from './damage';
import { insulationTest } from './ac';
import { looseContactR, LOOSE_RMIN, LOOSE_R_OPEN } from './loose';
import { LiveRunner, type LiveSnapshot } from './runner';
import { EXAMPLES } from '../../examples/examples';
import { getDef } from '../../library/components';
import type { FailureReport } from './damage';

const solve = (c: Circuit, faults: Record<string, Fault> = {}) => {
  const eff = effectiveCircuit(c, faults);
  const sim = new Sim(eff, { faults });
  sim.solveDC();
  return { sim, r: sim.results(), eff };
};

/** drives the real LiveRunner with a fake animation clock */
function harness(circuit: Circuit, speed: number) {
  const g = globalThis as unknown as { requestAnimationFrame: (f: (t: number) => void) => number; cancelAnimationFrame: (n: number) => void };
  const raf: { cb: ((t: number) => void) | null } = { cb: null };
  g.requestAnimationFrame = (f) => { raf.cb = f; return 1; };
  g.cancelAnimationFrame = () => { raf.cb = null; };
  const snaps: LiveSnapshot[] = [];
  const serial: string[] = [];
  const reports: FailureReport[] = [];
  const logs: string[] = [];
  const run = new LiveRunner((s) => snaps.push(s), (e) => { throw e; }, () => {}, (r) => reports.push(r), { serial: (_c, t) => serial.push(t), log: (_c, _l, t) => logs.push(t) });
  run.speed = speed; run.damageEnabled = true;
  run.start(circuit);
  let now = performance.now();
  const frames = (seconds: number, each?: () => void) => { for (let t = 0; t < seconds; t += 0.016) { now += 16; raf.cb?.(now); each?.(); } };
  return { run, snaps, serial, reports, logs, frames, last: () => snaps[snaps.length - 1] };
}

// ---------------------------------------------------------------- reverseVoltage
/** 3 V - 1k - X - 1k - GND, electrolytic across the lower 1k: X sits at 1.5 V */
function capDivider(reversed: boolean): Circuit {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 3 }); b.add('resistor', { r: 1000 }); b.add('resistor', { r: 1000 }); b.add('capacitor_el', { c: 1e-6 }); b.add('ground');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'R2.1'); b.chain('R2.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  if (reversed) { b.chain('R1.2', 'C1.2'); b.chain('C1.1', 'GND1.G'); } else { b.chain('R1.2', 'C1.1'); b.chain('C1.2', 'GND1.G'); }
  return b.circuit;
}

describe('reverseVoltage (ters polarite)', () => {
  it('damage rule: 1.5 V reverse fails only after the dwell time; correct polarity never fails', () => {
    const { r, eff } = solve(capDivider(true));
    // the ideal cap is open at DC, so charge it through the divider in a transient first
    const t = runTransient(capDivider(true), { stop: 0.02, dt: 1e-4 });
    const vEnd = t.comps.C1.v[t.comps.C1.v.length - 1];
    expect(vEnd).toBeCloseTo(-1.5, 2);
    const res = { ...r, C1: { ...r.C1, v: vEnd } };
    const th = thermalStates(eff, {}, {}, 25);
    expect(evaluateDamage(eff, res, th, {})).toHaveLength(0);                                    // brief spike: tolerated
    expect(evaluateDamage(eff, res, th, {}, undefined, { C1: REVERSE_DWELL_S / 2 })).toHaveLength(0);
    const c = evaluateDamage(eff, res, th, {}, undefined, { C1: REVERSE_DWELL_S });
    expect(c).toHaveLength(1);
    expect(c[0].cause).toBe('reverse');
    expect(c[0].fault.kind).toBe('reverseVoltage');
    const ok = solve(capDivider(false));
    const okRes = { ...ok.r, C1: { ...ok.r.C1, v: 1.5 } };
    expect(evaluateDamage(ok.eff, okRes, thermalStates(ok.eff, {}, {}, 25), {}, undefined, { C1: 10 })).toHaveLength(0);
  });

  it('live runner: reversed cap in a divider produces a "ters polarite" failure report; correct polarity does not', () => {
    const bad = harness(capDivider(true), 1);
    bad.frames(0.4);
    const rep = bad.reports.find((x) => x.ref === 'C1');
    expect(rep).toBeTruthy();
    expect(rep!.cause).toBe('reverse');
    expect(rep!.mode).toBe('reverseVoltage');
    expect(rep!.fix.join(' ')).toMatch(/polarite/i);
    bad.run.stop();
    const good = harness(capDivider(false), 1);
    good.frames(0.4);
    expect(good.reports).toHaveLength(0);
    good.run.stop();
  });

  it('solver: with the fault the reversed oxide conducts (clamps near -1 V); without it the ideal cap holds the full voltage', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 5 }); b.add('resistor', { r: 100 }); b.add('capacitor_el', { c: 1e-6 }); b.add('ground');
    b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'C1.2'); b.chain('C1.1', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    const run = (f?: Fault) => { const faults: Record<string, Fault> = f ? { C1: f } : {}; const t = runTransient(effectiveCircuit(b.circuit, faults), { stop: 5e-3, dt: 1e-5, faults }); return t.comps.C1; };
    const plain = run();
    expect(plain.v[plain.v.length - 1]).toBeLessThan(-4.9);
    const bad = run({ kind: 'reverseVoltage' });
    const v = bad.v[bad.v.length - 1], i = bad.i[bad.i.length - 1];
    expect(v).toBeLessThan(-0.9); expect(v).toBeGreaterThan(-1.3);
    expect(Math.abs(i)).toBeGreaterThan(0.035);               // (5 - ~1.1) / 100 ohm
    expect(bad.p[bad.p.length - 1]).toBeGreaterThan(0.03);    // dissipated in the cap
  });

  it('only polarized capacitors offer the fault', () => {
    expect(faultOptions(getDef('capacitor_el')).some((o) => o.kind === 'reverseVoltage')).toBe(true);
    expect(faultOptions(getDef('capacitor')).some((o) => o.kind === 'reverseVoltage')).toBe(false);
  });
});

// ---------------------------------------------------------------- lowVoltage
describe('lowVoltage (brownout)', () => {
  const blink = () => EXAMPLES.find((e) => e.id === 'mcu_blink')!.build();
  const withSag = (c: Circuit, pct: number | null): Circuit => ({ ...c, faults: pct === null ? {} : { U1: { kind: 'lowVoltage', amount: pct } } });

  it('supply sag below the BOD threshold holds the MCU in reset (outputs Hi-Z); above it the program runs', () => {
    const h = harness(withSag(blink(), 60), 1);          // 5 V * 0.4 = 2.0 V < 2.7 V
    let maxI = 0;
    h.frames(1.6, () => { const s = h.last(); if (s) maxI = Math.max(maxI, Math.abs(s.comps.D1.i)); });
    expect(maxI).toBeLessThan(1e-5);
    expect(h.serial.join('')).not.toContain('LED yandi');
    expect(h.logs.some((l) => l.includes('brownout'))).toBe(true);
    h.run.stop();

    const ok = harness(withSag(blink(), 20), 1);          // 4.0 V > 2.7 V
    let on = 0;
    ok.frames(1.6, () => { const s = ok.last(); if (s && s.comps.D1.i > 0.003) on++; });
    expect(on).toBeGreaterThan(5);                        // LED lit; logic-high is lower than 5 V
    expect(ok.serial.join('')).toContain('LED yandi');
    ok.run.stop();
  });

  it('ramping the supply down and back up resets (restarts) the program', () => {
    const c = blink();
    const h = harness(withSag(c, 0), 1);
    const rt = h.run.mcus.get('U1')!.rt;
    const spy = vi.spyOn(rt, 'restartAt');
    h.frames(0.8);
    expect(spy).not.toHaveBeenCalled();
    expect(h.serial.join('').length).toBeGreaterThan(0);
    h.run.update(withSag(c, 70)); h.frames(0.6);          // 1.5 V: reset held
    const during = h.serial.join('').length;
    h.frames(0.6);
    expect(h.serial.join('').length).toBe(during);        // nothing printed while in reset
    h.run.update(withSag(c, 0)); h.frames(0.4);
    expect(spy).toHaveBeenCalledTimes(1);                 // released once: program restarted
    expect(h.serial.join('').length).toBeGreaterThan(during);
    expect(h.logs.some((l) => l.includes('baştan başlatıldı'))).toBe(true);
    h.run.stop();
  });

  it('every simulated board carries a brownoutV and the fault is offered on MCU boards', () => {
    for (const id of ['mod_arduino_uno_r3', 'mod_esp32_devkit_v1', 'mod_raspberry_pi_pico']) {
      expect(getDef(id).mcu!.brownoutV).toBeGreaterThan(1);
      expect(faultOptions(getDef(id)).some((o) => o.kind === 'lowVoltage')).toBe(true);
    }
    expect(getDef('mod_esp32_devkit_v1').mcu!.brownoutV).toBe(2.43);
  });
});

// ---------------------------------------------------------------- esrRise
/** square 12 V/0 V @ 20 kHz -> 1 mH -> node Vo with C(ESR) and 6 ohm load: ripple on Vo = dIL * ESR + small cap part */
function buck(esr: number): Circuit {
  const b = new CircuitBuilder();
  b.add('signal_gen', { wave: 'square', v: 6, amp: 6, freq: 20000, duty: 50 }); b.add('inductor', { l: 1e-3 }); b.add('capacitor_el', { c: 1e-3, esr, v0: 6 }); b.add('resistor', { r: 6 }); b.add('ground');
  b.chain('V1.P', 'L1.1'); b.chain('L1.2', 'C1.1'); b.chain('L1.2', 'R1.1'); b.chain('C1.2', 'GND1.G'); b.chain('R1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
}
function ripplePP(c: Circuit, faults: Record<string, Fault> = {}): number {
  const t = runTransient(effectiveCircuit(c, faults), { stop: 0.04, dt: 2e-6, faults });
  const net = t.pinNet.get('L1:2')!;
  const from = t.t.findIndex((x) => x >= 0.04 - 10 / 20000);
  const v = t.netV[net].slice(from);
  return Math.max(...v) - Math.min(...v);
}

describe('esrRise (ESR artışı)', () => {
  it('esrRise multiplies the nominal ESR and keeps C', () => {
    const c = buck(0.1);
    const eff = effectiveCircuit(c, { C1: { kind: 'esrRise', amount: 400 } });
    const p = eff.components.find((x) => x.id === 'C1')!.params;
    expect(p.esr as number).toBeCloseTo(0.5, 9);
    expect(p.c).toBe(1e-3);
    // no esr param -> generic estimate, 65 uOhm*F / C clamped
    expect(esrNominal({ c: 1e-3 })).toBeCloseTo(0.065, 6);
    expect(esrNominal({ c: 1e-9 })).toBe(10);
  });

  it('buck filter: ESR x5 raises the output ripple by dIL * dESR within 15 %', () => {
    const base = ripplePP(buck(0.1));
    const aged = ripplePP(buck(0.1), { C1: { kind: 'esrRise', amount: 400 } });   // 0.1 -> 0.5 ohm
    const dIL = 0.15;                                                              // (12 - 6) * 0.5 / (1 mH * 20 kHz)
    const expected = dIL * (0.5 - 0.1);
    expect(aged).toBeGreaterThan(base);
    expect(Math.abs(aged - base - expected) / expected).toBeLessThan(0.15);
  });

  it('half-wave rectifier + reservoir cap: ripple grows when ESR rises', () => {
    const b = new CircuitBuilder();
    b.add('signal_gen', { wave: 'sine', v: 0, amp: 10, freq: 50 }); b.add('diode'); b.add('capacitor_el', { c: 1e-3, esr: 0.1, v0: 8 }); b.add('resistor', { r: 100 }); b.add('ground');
    b.chain('V1.P', 'D1.A'); b.chain('D1.K', 'C1.1'); b.chain('D1.K', 'R1.1'); b.chain('C1.2', 'GND1.G'); b.chain('R1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    const pp = (faults: Record<string, Fault>) => {
      const t = runTransient(effectiveCircuit(b.circuit, faults), { stop: 0.3, dt: 1e-4, faults });
      const net = t.pinNet.get('D1:K')!;
      const v = t.netV[net].slice(t.t.findIndex((x) => x >= 0.2));
      return Math.max(...v) - Math.min(...v);
    };
    const a = pp({}), bb = pp({ C1: { kind: 'esrRise', amount: 900 } });
    expect(bb).toBeGreaterThan(a * 1.02);
  });

  it('AC: ESR limits the capacitor impedance floor (|Z| -> ESR at high frequency)', () => {
    const b = new CircuitBuilder();
    b.add('capacitor_el', { c: 1e-3, esr: 0.5 }); b.add('ground');
    b.chain('C1.2', 'GND1.G');
    const sim = new Sim(b.circuit);
    sim.solveDC();
    const n = sim.netOf('C1', '1');
    const sol = sim.acAt(1e5, { port: { a: n, b: 0 } });
    expect(Math.hypot(sol.re[n - 1], sol.im[n - 1])).toBeGreaterThan(0.499);
  });
});

// ---------------------------------------------------------------- insulationFault
describe('insulationFault (yalıtım hatası)', () => {
  function capCircuit(): Circuit {
    const b = new CircuitBuilder();
    b.add('capacitor', { c: 1e-6 }, 0, 0, 0, 'C1'); b.add('capacitor', { c: 1e-6 }, 0, 0, 0, 'C2'); b.add('ground');
    b.chain('C1.2', 'GND1.G'); b.chain('C2.2', 'GND1.G');
    return b.circuit;
  }
  it('megger reading to ground drops from ~open to the fault resistance', () => {
    const healthy = insulationTest(capCircuit(), { comp: 'C1', pin: '1' }, { comp: 'GND1', pin: 'G' }, 500);
    expect(healthy.ohms).toBeGreaterThan(1e10);
    const bad = { ...capCircuit(), faults: { C1: { kind: 'insulationFault', amount: 1e6, pin: '1' } } as Record<string, Fault> };
    const r = insulationTest(bad, { comp: 'C1', pin: '1' }, { comp: 'GND1', pin: 'G' }, 500);
    expect(r.ohms / 1e6).toBeGreaterThan(0.99); expect(r.ohms / 1e6).toBeLessThan(1.01);
    expect(r.amps).toBeCloseTo(500e-6, 6);
  });
  it('target net is selectable: leakage pin to another part pin, not to ground', () => {
    const c = { ...capCircuit(), faults: { C1: { kind: 'insulationFault', amount: 1e5, pin: '1', to: { comp: 'C2', pin: '1' } } } as Record<string, Fault> };
    const between = insulationTest(c, { comp: 'C1', pin: '1' }, { comp: 'C2', pin: '1' }, 500);
    expect(between.ohms / 1e5).toBeGreaterThan(0.99); expect(between.ohms / 1e5).toBeLessThan(1.01);
    const toGnd = insulationTest(c, { comp: 'C1', pin: '1' }, { comp: 'GND1', pin: 'G' }, 500);
    expect(toGnd.ohms).toBeGreaterThan(1e10);                       // no leak path to ground
  });
  it('is offered for windings and passives with a pin/target selector', () => {
    for (const t of ['dc_motor', 'relay_5v', 'capacitor_el', 'resistor']) expect(faultOptions(getDef(t)).some((o) => o.kind === 'insulationFault' && o.pinTarget)).toBe(true);
  });
});

// ---------------------------------------------------------------- looseConnector
describe('looseConnector (gevşek konnektör)', () => {
  function supplyLoad(rmax?: number): Circuit {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 10 }); b.add('resistor', { r: 100 }); b.add('ground');
    b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    const c = b.circuit;
    const w = c.wires.find((x) => (x.a.comp === 'V1' && x.a.pin === 'P') || (x.b.comp === 'V1' && x.b.pin === 'P'))!;
    w.loose = { rmax };
    return c;
  }
  const series = (c: Circuit) => {
    const t = runTransient(c, { stop: 0.2, dt: 1e-3 });
    return { t: t.t, v: t.comps.R1.v };
  };

  it('contact resistance is a reproducible seeded series within [0.05 ohm, rmax] with occasional opens', () => {
    const a = Array.from({ length: 500 }, (_, k) => looseContactR('W1', k * 2e-3, 1000));
    const b = Array.from({ length: 500 }, (_, k) => looseContactR('W1', k * 2e-3, 1000));
    expect(a).toEqual(b);
    expect(looseContactR('W2', 0.0123, 1000)).toBe(looseContactR('W2', 0.0123, 1000));
    expect(a).not.toEqual(Array.from({ length: 500 }, (_, k) => looseContactR('W9', k * 2e-3, 1000)));   // other connector, other series
    const finite = a.filter((x) => x < LOOSE_R_OPEN);
    expect(Math.min(...finite)).toBeGreaterThanOrEqual(LOOSE_RMIN);
    expect(Math.max(...finite)).toBeLessThanOrEqual(1000);
    expect(Math.max(...finite)).toBeGreaterThan(100);         // kOhm range reached
    expect(Math.min(...finite)).toBeLessThan(1);              // sub-ohm contact reached
    const opens = a.filter((x) => x >= LOOSE_R_OPEN).length;
    expect(opens).toBeGreaterThan(5); expect(opens).toBeLessThan(60);
  });

  it('solver: the wire carries the series resistance, load voltage dips, and two runs are identical', () => {
    const c = supplyLoad(1000);
    const wid = c.wires.find((w) => w.loose)!.id;
    const r1 = series(c), r2 = series(supplyLoad(1000));
    expect(r1.v).toEqual(r2.v);
    expect(Math.max(...r1.v)).toBeGreaterThan(9.5);           // good-contact moments
    expect(Math.min(...r1.v)).toBeLessThan(0.1);              // open / very high resistance dips
    let checked = 0;
    r1.t.forEach((t, k) => {
      if (k === 0) return;
      const rc = looseContactR(wid, t, 1000);
      if (rc < 1e6) { expect(r1.v[k]).toBeCloseTo(10 * 100 / (100 + rc), 2); checked++; }
    });
    expect(checked).toBeGreaterThan(50);
  });

  it('a healthy wire (no loose flag) and a broken wire behave as before', () => {
    const c = supplyLoad(1000);
    c.wires.forEach((w) => { delete w.loose; });
    const t = runTransient(c, { stop: 0.01, dt: 1e-3 });
    expect(Math.min(...t.comps.R1.v)).toBeCloseTo(10, 6);
    c.wires.find((w) => (w.a.comp === 'V1' && w.a.pin === 'P') || (w.b.comp === 'V1' && w.b.pin === 'P'))!.broken = true;
    expect(Math.abs(runTransient(c, { stop: 0.005, dt: 1e-3 }).comps.R1.v[3])).toBeLessThan(1e-6);
  });
});
