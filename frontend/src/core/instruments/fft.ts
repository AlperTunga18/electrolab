/**
 * Spectrum analysis for the oscilloscope FFT view.
 *
 * Pipeline: scope buffer (t[], v[], generally NON-uniform time steps) -> resampleUniform (linear interpolation onto a
 * uniform grid) -> window -> zero-pad to a power of two -> radix-2 FFT -> single-sided amplitude spectrum.
 *
 * Resampling: the simulator uses variable sub-step lengths, so the buffer is not uniformly sampled. We pick
 * dt = median of the positive step lengths (so the grid follows the typical resolution and neither oversamples
 * quiet regions nor aliases busy ones too badly), clamp the point count to `maxPoints`, and linearly interpolate.
 * Linear interpolation low-pass filters slightly (error ~ (w*dt)^2/8 relative at the signal frequency) and does not
 * recover content above the new Nyquist = 1/(2 dt); the reported `nyquist` is therefore the bound of the spectrum.
 *
 * Amplitude scaling (volts, peak): A[k] = 2 |X[k]| / (N * CG) for k > 0, |X[0]| / (N * CG) for DC,
 * where N = number of signal samples (before zero padding) and CG = coherent gain = mean(window).
 * Dividing by CG makes a sine centred on a bin read its true peak amplitude regardless of window.
 * Zero padding only interpolates the spectrum (finer bins); it does not change the scaling or the resolution.
 */

export type WindowKind = 'rect' | 'hann' | 'hamming' | 'blackman';

export const WINDOW_LABELS: Record<WindowKind, string> = { rect: 'Dikdörtgen', hann: 'Hann', hamming: 'Hamming', blackman: 'Blackman' };

/** periodic (DFT-even) window coefficients */
export function windowCoeffs(kind: WindowKind, n: number): number[] {
  const w = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const x = (2 * Math.PI * i) / n;
    switch (kind) {
      case 'rect': w[i] = 1; break;
      case 'hann': w[i] = 0.5 - 0.5 * Math.cos(x); break;
      case 'hamming': w[i] = 0.54 - 0.46 * Math.cos(x); break;
      case 'blackman': w[i] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x); break;
    }
  }
  return w;
}

export const coherentGain = (w: number[]): number => (w.length ? w.reduce((a, b) => a + b, 0) / w.length : 1);

export const nextPow2 = (n: number): number => { let p = 1; while (p < n) p <<= 1; return p; };

/** in-place iterative radix-2 Cooley-Tukey FFT; re.length must be a power of two */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) throw new Error('FFT boyutu 2’nin kuvveti olmalı');
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const a = re[i]; re[i] = re[j]; re[j] = a; const b = im[i]; im[i] = im[j]; im[j] = b; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

export interface Uniform { y: number[]; dt: number; fs: number; t0: number }

/** Resample (t, v) to a uniform grid by linear interpolation. dt defaults to the median positive step. */
export function resampleUniform(t: number[], v: number[], opts: { dt?: number; maxPoints?: number } = {}): Uniform | null {
  const n = Math.min(t.length, v.length);
  if (n < 4) return null;
  const span = t[n - 1] - t[0];
  if (!(span > 0)) return null;
  let dt = opts.dt;
  if (!dt || !(dt > 0)) {
    const d: number[] = [];
    for (let i = 1; i < n; i++) { const x = t[i] - t[i - 1]; if (x > 0) d.push(x); }
    if (!d.length) return null;
    d.sort((a, b) => a - b);
    dt = d[d.length >> 1];
  }
  const maxPoints = opts.maxPoints ?? 65536;
  if (span / dt + 1 > maxPoints) dt = span / (maxPoints - 1);
  const m = Math.floor(span / dt) + 1;
  const y = new Array<number>(m);
  let j = 0;
  for (let k = 0; k < m; k++) {
    const tk = t[0] + k * dt;
    while (j < n - 2 && t[j + 1] < tk) j++;
    const dtt = t[j + 1] - t[j];
    const f = dtt > 0 ? Math.min(1, Math.max(0, (tk - t[j]) / dtt)) : 0;
    y[k] = v[j] + (v[j + 1] - v[j]) * f;
  }
  return { y, dt, fs: 1 / dt, t0: t[0] };
}

export interface Spectrum {
  /** bin centre frequencies, 0 .. Nyquist (inclusive) */
  freq: number[];
  /** single-sided amplitude in V (peak), window-gain corrected */
  mag: number[];
  /** 20 log10(mag) in dBV (peak) */
  dbv: number[];
  /** bin spacing (zero padding makes this finer than the true resolution) */
  df: number;
  /** sampling rate of the (resampled) buffer */
  fs: number;
  /** spectrum upper bound = fs / 2 */
  nyquist: number;
  /** number of signal samples used (before zero padding) */
  n: number;
  nfft: number;
  window: WindowKind;
}

/** main-lobe half width in (unpadded) bins */
const MAIN_LOBE: Record<WindowKind, number> = { rect: 1, hann: 2, hamming: 2, blackman: 3 };

const toDb = (a: number): number => 20 * Math.log10(Math.max(a, 1e-12));

/** Windowed, zero-padded single-sided amplitude spectrum of a uniformly sampled signal. */
export function amplitudeSpectrum(y: number[], fs: number, window: WindowKind = 'hann', opts: { nfft?: number; removeMean?: boolean } = {}): Spectrum {
  const n = y.length;
  const nfft = Math.max(nextPow2(opts.nfft ?? n), nextPow2(n), 2);
  const w = windowCoeffs(window, n);
  const cg = coherentGain(w);
  const m = opts.removeMean ? y.reduce((a, b) => a + b, 0) / Math.max(n, 1) : 0;
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  for (let i = 0; i < n; i++) re[i] = (y[i] - m) * w[i];
  fftInPlace(re, im);
  const half = nfft / 2;
  const freq = new Array<number>(half + 1), mag = new Array<number>(half + 1), dbv = new Array<number>(half + 1);
  const df = fs / nfft;
  for (let k = 0; k <= half; k++) {
    const a = Math.hypot(re[k], im[k]) / (n * cg);
    const amp = k === 0 || k === half ? a : 2 * a;
    freq[k] = k * df; mag[k] = amp; dbv[k] = toDb(amp);
  }
  return { freq, mag, dbv, df, fs, nyquist: fs / 2, n, nfft, window };
}

/** Convenience: non-uniform scope buffer -> spectrum (null when the buffer is too short). */
export function scopeSpectrum(t: number[], v: number[], window: WindowKind = 'hann', opts: { maxPoints?: number; padTo?: number; removeMean?: boolean } = {}): Spectrum | null {
  const u = resampleUniform(t, v, { maxPoints: opts.maxPoints });
  if (!u) return null;
  return amplitudeSpectrum(u.y, u.fs, window, { nfft: opts.padTo, removeMean: opts.removeMean });
}

export interface SpectralPeak { freq: number; amp: number; dbv: number; bin: number }

/**
 * Local maxima of the spectrum (DC bin skipped), strongest first. Frequency and amplitude are refined by a
 * parabola through the three dB samples around the maximum (log-parabolic interpolation).
 * `minDb` is the floor relative to the strongest peak (default -80 dB).
 */
export function findPeaks(s: Spectrum, count = 5, minDb = -80): SpectralPeak[] {
  const m = s.mag, cand: SpectralPeak[] = [];
  let top = 0;
  for (let k = 1; k < m.length - 1; k++) if (m[k] > top) top = m[k];
  if (top <= 0) return cand;
  const floor = top * Math.pow(10, minDb / 20);
  for (let k = 1; k < m.length - 1; k++) {
    if (m[k] > m[k - 1] && m[k] >= m[k + 1] && m[k] >= floor) {
      const a = Math.log(Math.max(m[k - 1], 1e-300)), b = Math.log(m[k]), c = Math.log(Math.max(m[k + 1], 1e-300));
      const den = a - 2 * b + c;
      const p = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
      const amp = Math.exp(b - 0.25 * (a - c) * p);
      cand.push({ freq: (k + p) * s.df, amp, dbv: toDb(amp), bin: k });
    }
  }
  // rank by raw bin magnitude (interpolation overshoots on side lobes), then drop window side lobes:
  // a maximum within the main-lobe half width of a stronger accepted peak is not a separate line
  cand.sort((x, y) => m[y.bin] - m[x.bin]);
  const R = MAIN_LOBE[s.window] * (s.nfft / s.n);
  const out: SpectralPeak[] = [];
  for (const c of cand) {
    if (out.some((o) => Math.abs(o.bin - c.bin) <= R)) continue;
    out.push(c);
    if (out.length >= count) break;
  }
  return out;
}

/**
 * Fundamental = the lowest-frequency peak whose amplitude is at least `ratio` (default 0.5) of the strongest peak.
 * (Handles a strong 2nd harmonic without picking it; a fundamental weaker than half the strongest harmonic is
 * missed - documented limitation.) Returns null if there is no peak.
 */
export function detectFundamental(s: Spectrum, ratio = 0.5): SpectralPeak | null {
  const peaks = findPeaks(s, 12);
  if (!peaks.length) return null;
  const strongest = peaks[0].amp;
  const cand = peaks.filter((p) => p.amp >= strongest * ratio).sort((a, b) => a.freq - b.freq);
  return cand[0] ?? peaks[0];
}

/** amplitude of the spectral line nearest f: maximum (interpolated) peak within +-`tol` bins */
function lineAmp(s: Spectrum, f: number, tolBins: number): number {
  const k0 = Math.round(f / s.df);
  let best = 0;
  for (let k = Math.max(1, k0 - tolBins); k <= Math.min(s.mag.length - 2, k0 + tolBins); k++) {
    if (s.mag[k] >= s.mag[k - 1] && s.mag[k] >= s.mag[k + 1] && s.mag[k] > best) {
      const a = Math.log(Math.max(s.mag[k - 1], 1e-300)), b = Math.log(s.mag[k]), c = Math.log(Math.max(s.mag[k + 1], 1e-300));
      const den = a - 2 * b + c;
      const p = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
      best = Math.exp(b - 0.25 * (a - c) * p);
    }
  }
  return best;
}

export interface ThdResult { fundamental: number; a1: number; harmonics: { k: number; freq: number; amp: number }[]; thdPercent: number; thdDb: number }

/**
 * THD estimate:  THD = sqrt( A2^2 + A3^2 + ... + AK^2 ) / A1   (amplitudes in V peak; reported in %, and as 20 log10(THD) in dB)
 * A1 = line amplitude at f0 (the given fundamental, or the detected one), Ak = line amplitude near k*f0 (max within
 * +-3 bins to tolerate non-coherent sampling, parabolic-interpolated), K = `harmonics` (default 10), only harmonics
 * below Nyquist are used. Noise between the harmonics is not included (THD, not THD+N).
 */
export function estimateThd(s: Spectrum, f0?: number, harmonics = 10): ThdResult | null {
  let fund = f0;
  if (!fund) { const p = detectFundamental(s); if (!p) return null; fund = p.freq; }
  const tol = Math.ceil(3 * (s.nfft / s.n));
  const a1 = lineAmp(s, fund, tol);
  if (a1 <= 0) return null;
  const hs: ThdResult['harmonics'] = [];
  let sum = 0;
  for (let k = 2; k <= harmonics; k++) {
    const f = k * fund;
    if (f >= s.nyquist - s.df * tol) break;
    const a = lineAmp(s, f, tol);
    hs.push({ k, freq: f, amp: a });
    sum += a * a;
  }
  const r = Math.sqrt(sum) / a1;
  return { fundamental: fund, a1, harmonics: hs, thdPercent: r * 100, thdDb: toDb(r) };
}
