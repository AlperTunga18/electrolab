/** Pure signal statistics used by the virtual instruments (DMM, counter, power analyzer). Inputs are sampled time series. */

export const mean = (y: number[]): number => (y.length ? y.reduce((a, b) => a + b, 0) / y.length : 0);
export const rms = (y: number[]): number => (y.length ? Math.sqrt(y.reduce((a, b) => a + b * b, 0) / y.length) : 0);
/** RMS of the AC component (DC removed) */
export const acRms = (y: number[]): number => { const m = mean(y); return rms(y.map((v) => v - m)); };

export interface FreqInfo { freq: number; period: number; duty: number; crossings: number }

/** frequency / period / duty from rising crossings of the signal mean (schmitt hysteresis = 2 % of Vpp) */
export function frequency(t: number[], y: number[]): FreqInfo {
  const none = { freq: 0, period: 0, duty: 0, crossings: 0 };
  if (y.length < 4) return none;
  let lo = Infinity, hi = -Infinity;
  for (const v of y) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const pp = hi - lo;
  if (pp < 1e-9) return none;
  const mid = (hi + lo) / 2, h = 0.02 * pp;
  const rise: number[] = [], fall: number[] = [];
  let state = y[0] > mid;
  for (let i = 1; i < y.length; i++) {
    if (!state && y[i] > mid + h) {
      state = true;
      rise.push(t[i - 1] + ((mid - y[i - 1]) / (y[i] - y[i - 1])) * (t[i] - t[i - 1]));
    } else if (state && y[i] < mid - h) {
      state = false;
      fall.push(t[i]);
    }
  }
  if (rise.length < 2) return { ...none, crossings: rise.length };
  const period = (rise[rise.length - 1] - rise[0]) / (rise.length - 1);
  let duty = 0;
  const n = Math.min(rise.length - 1, 50);
  let acc = 0, cnt = 0;
  for (let k = 0; k < n; k++) {
    const f = fall.find((x) => x > rise[k] && x < rise[k + 1]);
    if (f !== undefined) { acc += (f - rise[k]) / (rise[k + 1] - rise[k]); cnt++; }
  }
  if (cnt) duty = acc / cnt;
  return { freq: 1 / period, period, duty, crossings: rise.length };
}

/** amplitude of harmonic k of frequency f0 (projection over an integer number of periods) */
export function harmonic(t: number[], y: number[], f0: number, k: number): number {
  if (y.length < 8 || f0 <= 0) return 0;
  const T = 1 / f0, tEnd = t[t.length - 1];
  const periods = Math.floor((tEnd - t[0]) / T);
  if (periods < 1) return 0;
  const tStart = tEnd - periods * T;
  let re = 0, im = 0, n = 0;
  for (let i = 1; i < y.length; i++) {
    if (t[i] < tStart) continue;
    const dt = t[i] - t[i - 1], w = 2 * Math.PI * k * f0 * t[i];
    re += y[i] * Math.cos(w) * dt; im += y[i] * Math.sin(w) * dt; n += dt;
  }
  return n > 0 ? (2 * Math.hypot(re, im)) / n : 0;
}

/** total harmonic distortion (harmonics 2..10 relative to the fundamental), in percent */
export function thd(t: number[], y: number[], f0: number): number {
  const h1 = harmonic(t, y, f0, 1);
  if (h1 < 1e-12) return 0;
  let s = 0;
  for (let k = 2; k <= 10; k++) s += harmonic(t, y, f0, k) ** 2;
  return (Math.sqrt(s) / h1) * 100;
}

export interface PowerStats { vrms: number; irms: number; p: number; s: number; q: number; pf: number; vdc: number; idc: number }

/** real/apparent/reactive power and power factor from simultaneous v(t), i(t) (uniform or non-uniform time grid) */
export function powerStats(t: number[], v: number[], i: number[]): PowerStats {
  const n = Math.min(t.length, v.length, i.length);
  if (n < 2) return { vrms: 0, irms: 0, p: 0, s: 0, q: 0, pf: 0, vdc: 0, idc: 0 };
  let T = 0, pv = 0, vv = 0, ii = 0, vs = 0, is = 0;
  for (let k = 1; k < n; k++) {
    const dt = t[k] - t[k - 1];
    T += dt; pv += v[k] * i[k] * dt; vv += v[k] * v[k] * dt; ii += i[k] * i[k] * dt; vs += v[k] * dt; is += i[k] * dt;
  }
  const vrms = Math.sqrt(vv / T), irms = Math.sqrt(ii / T), p = pv / T, s = vrms * irms;
  return { vrms, irms, p, s, q: Math.sqrt(Math.max(s * s - p * p, 0)), pf: s > 1e-18 ? p / s : 0, vdc: vs / T, idc: is / T };
}

/** digital level of an analog trace with hysteresis (logic analyzer) */
export function digitize(y: number[], threshold: number, hyst = 0.1): boolean[] {
  const out: boolean[] = [];
  let state = (y[0] ?? 0) > threshold;
  for (const v of y) {
    if (state && v < threshold - hyst) state = false;
    else if (!state && v > threshold + hyst) state = true;
    out.push(state);
  }
  return out;
}

/** 3.5-digit style formatting for a selected manual range (full scale `range`) */
export function formatRanged(value: number, range: number, unit: string): string {
  if (Math.abs(value) > range * 1.0 + 1e-12) return 'OL';
  const dec = Math.max(0, 3 - Math.floor(Math.log10(range)));
  return `${value.toFixed(Math.min(dec, 6))} ${unit}`;
}
