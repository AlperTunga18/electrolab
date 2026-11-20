import type { Circuit } from '../circuit/types';
import { getDef } from '../../library/components';
import { Sim } from './mna';

/**
 * Monte Carlo tolerans analizi (DC çalışma noktası).
 * Her koşuda devre klonlanır, R/C/L değerleri tolerans içinde rastgele değiştirilir ve DC çözülür.
 * Sınırlar: yalnız R (r), C (c), L (l) parametreleri değiştirilir; kaynaklar, yarıiletken parametreleri ve
 * sıcaklık etkisi sabit kalır. Çözülemeyen koşular (SimError) atlanır.
 */

export type McProbe = { comp: string; pin: string } | { comp: string; q: 'v' | 'i' | 'p' };
export type McDist = 'uniform' | 'gaussian';

export interface McOptions {
  runs: number;
  seed: number;
  probe: McProbe;
  /** bileşen id -> tolerans (%), varsayılanı ezer */
  tolerances?: Record<string, number>;
  /** uniform: ±tol düzgün; gaussian: σ = tol/3, ±tol'a kırpılır (varsayılan gaussian) */
  dist?: McDist;
}

export interface McResult {
  samples: number[];
  mean: number;
  std: number;
  min: number;
  max: number;
  p5: number;
  p95: number;
  nominal: number;
  /** birinci derece duyarlılık toplamıyla en kötü durum (doğrusal yaklaşım) */
  worstCase: { min: number; max: number };
  /** başarısız koşu sayısı */
  failed: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Perturb edilebilen parametre anahtarı (yoksa null) ve varsayılan tolerans (%). */
function tolInfo(type: string): { key: string; tol: number } | null {
  const model = getDef(type).model;
  if (model === 'resistor') return { key: 'r', tol: 5 };
  if (model === 'capacitor') return { key: 'c', tol: 10 };
  if (model === 'inductor') return { key: 'l', tol: 10 };
  return null;
}

interface Target { id: string; key: string; nominal: number; tol: number }

function targets(circuit: Circuit, over?: Record<string, number>): Target[] {
  const out: Target[] = [];
  for (const c of circuit.components) {
    const ti = tolInfo(c.type);
    if (!ti) continue;
    const nominal = Number(c.params[ti.key]);
    if (!Number.isFinite(nominal)) continue;
    const own = typeof c.params.tol === 'number' ? c.params.tol : ti.tol;
    const tol = (over?.[c.id] ?? own) / 100;
    if (tol > 0) out.push({ id: c.id, key: ti.key, nominal, tol });
  }
  return out;
}

function withValues(circuit: Circuit, vals: Map<string, { key: string; v: number }>): Circuit {
  return {
    ...circuit,
    components: circuit.components.map((c) => {
      const o = vals.get(c.id);
      return o ? { ...c, params: { ...c.params, [o.key]: o.v } } : c;
    }),
  };
}

function evalProbe(circuit: Circuit, p: McProbe): number {
  const sim = new Sim(circuit, { faults: circuit.faults });
  sim.solveDC();
  if ('pin' in p) return sim.nodeVoltage(sim.netOf(p.comp, p.pin));
  return sim.results()[p.comp][p.q];
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const x = q * (sorted.length - 1), lo = Math.floor(x), hi = Math.ceil(x);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
}

export function monteCarlo(circuit: Circuit, o: McOptions): McResult {
  const tg = targets(circuit, o.tolerances);
  const nominal = evalProbe(circuit, o.probe);
  const rnd = mulberry32(o.seed);
  const dist = o.dist ?? 'gaussian';
  const gauss = () => {
    const u = Math.max(rnd(), 1e-12), w = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
  };
  const samples: number[] = [];
  let failed = 0;
  for (let k = 0; k < o.runs; k++) {
    const vals = new Map<string, { key: string; v: number }>();
    for (const t of tg) {
      // x ∈ [-1, 1]: gaussian için σ = 1/3, ±1'e kırpılır
      const x = dist === 'uniform' ? rnd() * 2 - 1 : Math.max(-1, Math.min(1, gauss() / 3));
      vals.set(t.id, { key: t.key, v: t.nominal * (1 + t.tol * x) });
    }
    try { samples.push(evalProbe(withValues(circuit, vals), o.probe)); } catch { failed++; }
  }

  // en kötü durum: her parametre için ±tol tek tek, etkilerin mutlak toplamı
  let wMin = nominal, wMax = nominal;
  for (const t of tg) {
    const hi = evalProbe(withValues(circuit, new Map([[t.id, { key: t.key, v: t.nominal * (1 + t.tol) }]])), o.probe) - nominal;
    const lo = evalProbe(withValues(circuit, new Map([[t.id, { key: t.key, v: t.nominal * (1 - t.tol) }]])), o.probe) - nominal;
    wMax += Math.max(0, hi, lo);
    wMin += Math.min(0, hi, lo);
  }

  const n = samples.length;
  const mean = n ? samples.reduce((a, b) => a + b, 0) / n : NaN;
  const std = n > 1 ? Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples, mean, std, min: sorted[0] ?? NaN, max: sorted[n - 1] ?? NaN,
    p5: quantile(sorted, 0.05), p95: quantile(sorted, 0.95), nominal,
    worstCase: { min: wMin, max: wMax }, failed,
  };
}
