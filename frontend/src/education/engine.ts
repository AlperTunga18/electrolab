import type { Circuit, Fault } from '../core/circuit/types';
import { Sim, runTransient, type CompResult, type TransientResult } from '../core/sim/mna';
import { effectiveCircuit } from '../core/sim/faults';
import type { Check, Expect, Probe, Stat, TranSpec } from './types';

/** Evaluates probes on a circuit (DC operating point or transient statistic). Used by lessons, quizzes, challenges and tests. */
export class EvalCtx {
  private dcCache: { sim: Sim; results: Record<string, CompResult> } | null = null;
  private tranCache = new Map<string, TransientResult>();
  private eff: Circuit;
  private faults: Record<string, Fault>;

  constructor(circuit: Circuit, extraFaults: Record<string, Fault> = {}) {
    this.faults = { ...(circuit.faults ?? {}), ...extraFaults };
    this.eff = effectiveCircuit(circuit, this.faults);
  }

  dc() {
    if (!this.dcCache) {
      const sim = new Sim(this.eff, { faults: this.faults });
      sim.solveDC();
      this.dcCache = { sim, results: sim.results() };
    }
    return this.dcCache;
  }

  tran(t: TranSpec): TransientResult {
    const key = `${t.stop}|${t.dt}`;
    let r = this.tranCache.get(key);
    if (!r) { r = runTransient(this.eff, { stop: t.stop, dt: t.dt, faults: this.faults }); this.tranCache.set(key, r); }
    return r;
  }

  value(p: Probe, t?: TranSpec): number {
    if (!t) {
      const { sim, results } = this.dc();
      switch (p.q) {
        case 'node': return sim.nodeVoltage(sim.netOf(p.comp, p.pin));
        case 'v': return results[p.comp].v;
        case 'i': return results[p.comp].i;
        case 'p': return results[p.comp].p;
        case 'val': return results[p.comp].vals[p.key];
      }
    }
    const r = this.tran(t);
    let series: number[];
    switch (p.q) {
      case 'node': series = r.netV[r.pinNet.get(`${p.comp}:${p.pin}`)!]; break;
      case 'v': series = r.comps[p.comp].v; break;
      case 'i': series = r.comps[p.comp].i; break;
      case 'p': series = r.comps[p.comp].p; break;
      case 'val': throw new Error('val probes are DC only');
    }
    return stat(r.t, series, t);
  }
}

function stat(time: number[], y: number[], t: TranSpec): number {
  if (t.at !== undefined) {
    let k = 0;
    while (k < time.length - 1 && time[k] < t.at) k++;
    return y[k];
  }
  const from = Math.floor((t.skip ?? 0) * y.length);
  const s = y.slice(from);
  const op: Record<Stat, () => number> = {
    max: () => Math.max(...s), min: () => Math.min(...s), mean: () => s.reduce((a, b) => a + b, 0) / s.length,
    rms: () => Math.sqrt(s.reduce((a, b) => a + b * b, 0) / s.length), final: () => s[s.length - 1],
    pp: () => Math.max(...s) - Math.min(...s),
    freq: () => {
      const m = s.reduce((a, b) => a + b, 0) / s.length;
      const ts = time.slice(from), c: number[] = [];
      for (let i = 1; i < s.length; i++) if (s[i - 1] < m && s[i] >= m) c.push(ts[i - 1] + ((m - s[i - 1]) / (s[i] - s[i - 1])) * (ts[i] - ts[i - 1]));
      return c.length >= 2 ? (c.length - 1) / (c[c.length - 1] - c[0]) : 0;
    },
  };
  return op[t.stat]();
}

export interface ExpectResult { label: string; got: number; want: number; unit: string; ok: boolean }

export function evalExpect(ctx: EvalCtx, e: Expect): ExpectResult {
  const got = ctx.value(e.probe, e.tran);
  const rel = e.tol?.rel ?? 0.03, abs = e.tol?.abs ?? 1e-9;
  return { label: e.label, got, want: e.value, unit: e.unit, ok: Math.abs(got - e.value) <= abs + rel * Math.abs(e.value) };
}

export interface CheckResult { label: string; got: number | null; ok: boolean; unit: string; range: string; error?: string }

export function evalCheck(ctx: EvalCtx, c: Check): CheckResult {
  const range = `${c.min !== undefined ? `≥ ${c.min}` : ''}${c.min !== undefined && c.max !== undefined ? ' ve ' : ''}${c.max !== undefined ? `≤ ${c.max}` : ''} ${c.unit}`;
  try {
    const got = ctx.value(c.probe, c.tran);
    const ok = Number.isFinite(got) && (c.min === undefined || got >= c.min) && (c.max === undefined || got <= c.max);
    return { label: c.label, got, ok, unit: c.unit, range };
  } catch (e) {
    return { label: c.label, got: null, ok: false, unit: c.unit, range, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Evaluate a challenge against the learner's circuit; errors (missing parts, no ground, ...) count as failing checks. */
export function evalChallenge(circuit: Circuit, checks: Check[]): { results: CheckResult[]; ok: boolean; error?: string } {
  let ctx: EvalCtx;
  try { ctx = new EvalCtx(circuit); ctx.dc(); } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { results: checks.map((c) => ({ label: c.label, got: null, ok: false, unit: c.unit, range: '', error: msg })), ok: false, error: msg };
  }
  const results = checks.map((c) => evalCheck(ctx, c));
  return { results, ok: results.every((r) => r.ok) };
}
