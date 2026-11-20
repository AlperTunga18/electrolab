import type { Circuit, Fault, PlacedComponent } from '../circuit/types';
import { Sim } from './mna';
import { effectiveCircuit } from './faults';
import { getDef } from '../../library/components';

/** AC small-signal analysis (frequency response) and powered-off component measurements (LCR / ohm / diode / insulation). */

export interface AcProbe { comp: string; pin: string }

export interface AcSweepOpts {
  /** component id of the voltage source used as 1 V stimulus */
  source: string;
  probes: AcProbe[];
  fStart: number;
  fStop: number;
  /** points per decade (default 40) */
  ppd?: number;
  faults?: Record<string, Fault>;
}

export interface AcResult {
  f: number[];
  /** per probe: |V| in volts for a 1 V stimulus (= gain) */
  mag: number[][];
  /** per probe: phase in degrees (-180..180) */
  phase: number[][];
}

const deg = (re: number, im: number) => (Math.atan2(im, re) * 180) / Math.PI;

export function acSweep(circuit: Circuit, o: AcSweepOpts): AcResult {
  const faults = { ...(circuit.faults ?? {}), ...(o.faults ?? {}) };
  const eff = effectiveCircuit(circuit, faults);
  const sim = new Sim(eff, { faults });
  sim.solveDC();
  const nets = o.probes.map((p) => sim.netOf(p.comp, p.pin));
  const ppd = o.ppd ?? 40;
  const decades = Math.log10(o.fStop / o.fStart);
  const n = Math.max(2, Math.ceil(decades * ppd) + 1);
  const res: AcResult = { f: [], mag: o.probes.map(() => []), phase: o.probes.map(() => []) };
  for (let k = 0; k < n; k++) {
    const f = o.fStart * Math.pow(10, (decades * k) / (n - 1));
    const sol = sim.acAt(f, { vsrc: o.source });
    res.f.push(f);
    nets.forEach((net, i) => {
      const re = net > 0 ? sol.re[net - 1] : 0, im = net > 0 ? sol.im[net - 1] : 0;
      res.mag[i].push(Math.hypot(re, im));
      res.phase[i].push(deg(re, im));
    });
  }
  return res;
}

export type ResponseKind = 'lowpass' | 'highpass' | 'bandpass' | 'flat';

export interface ResponseInfo {
  kind: ResponseKind;
  peakF: number;
  peakGain: number;
  /** -3 dB frequency (low/high-pass) */
  f3db?: number;
  /** band edges at peak/√2 (band-pass) */
  fLo?: number;
  fHi?: number;
  /** quality factor f0/BW (band-pass) */
  q?: number;
}

/** log-frequency interpolation of the first crossing of `level` between samples i-1 and i */
function cross(f: number[], m: number[], i: number, level: number): number {
  const a = m[i - 1], b = m[i];
  if (a === b) return f[i];
  const u = (level - a) / (b - a);
  return Math.exp(Math.log(f[i - 1]) + u * (Math.log(f[i]) - Math.log(f[i - 1])));
}

/** Classifies a magnitude response and extracts -3 dB points / resonance. */
export function analyzeResponse(f: number[], m: number[]): ResponseInfo {
  let p = 0;
  for (let i = 1; i < m.length; i++) if (m[i] > m[p]) p = i;
  const peak = m[p], last = m.length - 1;
  const info: ResponseInfo = { kind: 'flat', peakF: f[p], peakGain: peak };
  const lowFlat = m[0] >= 0.9 * peak, highFlat = m[last] >= 0.9 * peak;
  if (lowFlat && highFlat) return info;
  if (lowFlat) {
    const level = m[0] / Math.SQRT2;
    for (let i = p + 1; i <= last; i++) if (m[i] <= level) { info.kind = 'lowpass'; info.f3db = cross(f, m, i, level); break; }
    return info;
  }
  if (highFlat) {
    const level = m[last] / Math.SQRT2;
    for (let i = last - 1; i >= 0; i--) if (m[i] <= level) { info.kind = 'highpass'; info.f3db = cross(f, m, i + 1, level); break; }
    return info;
  }
  const level = peak / Math.SQRT2;
  let lo: number | undefined, hi: number | undefined;
  for (let i = p; i > 0; i--) if (m[i - 1] <= level) { lo = cross(f, m, i, level); break; }
  for (let i = p + 1; i <= last; i++) if (m[i] <= level) { hi = cross(f, m, i, level); break; }
  info.kind = 'bandpass'; info.fLo = lo; info.fHi = hi;
  if (lo && hi) info.q = f[p] / (hi - lo);
  return info;
}

// ------------------------------------------------------------------ powered-off measurements (LCR / ohm / diode / insulation)

/** Same circuit with every independent source zeroed (a DMM/LCR meter measures a de-energised circuit). */
export function deenergize(c: Circuit): Circuit {
  return {
    ...c,
    components: c.components.map((x): PlacedComponent => {
      const m = getDef(x.type).model;
      if (m === 'vsource') return { ...x, params: { ...x.params, v: 0, amp: 0 } };
      if (m === 'isource') return { ...x, params: { ...x.params, i: 0 } };
      return x;
    }),
  };
}

export interface Impedance {
  re: number;
  im: number;
  mag: number;
  phaseDeg: number;
  /** equivalent series model */
  rs: number;
  ls?: number;
  cs?: number;
  q: number;
}

/** Complex impedance between two pins at frequency f (f = 0: DC resistance). Circuit is de-energised unless `powered`. */
export function measureImpedance(circuit: Circuit, a: AcProbe, b: AcProbe, f: number, o: { powered?: boolean; faults?: Record<string, Fault> } = {}): Impedance {
  const base = o.powered ? circuit : deenergize(circuit);
  const faults = { ...(base.faults ?? {}), ...(o.faults ?? {}) };
  const eff = effectiveCircuit(base, faults);
  const sim = new Sim(eff, { faults });
  sim.solveDC();
  const sol = sim.acAt(f, { port: { a: sim.netOf(a.comp, a.pin), b: sim.netOf(b.comp, b.pin) } });
  const get = (net: number, arr: Float64Array) => (net > 0 ? arr[net - 1] : 0);
  const na = sim.netOf(a.comp, a.pin), nb = sim.netOf(b.comp, b.pin);
  const re = get(na, sol.re) - get(nb, sol.re), im = get(na, sol.im) - get(nb, sol.im);
  const w = 2 * Math.PI * f;
  return {
    re, im, mag: Math.hypot(re, im), phaseDeg: deg(re, im), rs: re,
    ls: w > 0 && im > 0 ? im / w : undefined,
    cs: w > 0 && im < 0 ? -1 / (w * im) : undefined,
    q: re !== 0 ? Math.abs(im) / Math.abs(re) : Infinity,
  };
}

function withTestSource(c: Circuit, kind: 'isource' | 'dc_supply', value: number, a: AcProbe, b: AcProbe): Circuit {
  const id = '__test';
  const comp: PlacedComponent = { id, type: kind, ref: 'TEST', x: 0, z: 0, rot: 0, params: kind === 'isource' ? { i: value } : { wave: 'dc', v: value, ilimit: 1e9 } };
  return {
    ...c,
    components: [...c.components, comp],
    wires: [...c.wires, { id: '__w1', a: { comp: id, pin: 'P' }, b: { comp: a.comp, pin: a.pin }, color: '#fff', width: 1 }, { id: '__w2', a: { comp: id, pin: 'N' }, b: { comp: b.comp, pin: b.pin }, color: '#fff', width: 1 }],
  };
}

/** Diode test: forces 1 mA from a to b in the de-energised circuit and reports the forward voltage (V(a) − V(b)). */
export function diodeTest(circuit: Circuit, a: AcProbe, b: AcProbe, current = 1e-3): { volts: number; open: boolean } {
  const c = withTestSource(deenergize(circuit), 'isource', current, a, b);
  const faults = c.faults ?? {};
  const sim = new Sim(effectiveCircuit(c, faults), { faults });
  sim.solveDC();
  const v = sim.nodeVoltage(sim.netOf(a.comp, a.pin)) - sim.nodeVoltage(sim.netOf(b.comp, b.pin));
  return { volts: v, open: v > 3 };
}

/** Insulation (megohm) test: applies testV between a and b in the de-energised circuit and returns R = V / I. */
export function insulationTest(circuit: Circuit, a: AcProbe, b: AcProbe, testV = 500): { ohms: number; amps: number } {
  const c = withTestSource(deenergize(circuit), 'dc_supply', testV, a, b);
  const faults = c.faults ?? {};
  const sim = new Sim(effectiveCircuit(c, faults), { faults });
  sim.solveDC();
  const i = Math.abs(sim.results().__test.i);
  return { ohms: i > 1e-15 ? testV / i : Infinity, amps: i };
}
