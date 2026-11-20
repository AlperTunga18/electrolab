import { describe, expect, it } from 'vitest';
import { amplitudeSpectrum, detectFundamental, estimateThd, fftInPlace, findPeaks, resampleUniform, scopeSpectrum, windowCoeffs, coherentGain } from './fft';

const FS = 64000, N = 4096; // 1 kHz = bin 64 exactly (64 periods) -> coherent
const sine = (f: number, a: number, n = N, fs = FS, ph = 0) => Array.from({ length: n }, (_, i) => a * Math.sin(2 * Math.PI * f * (i / fs) + ph));

describe('fft', () => {
  it('radix-2 FFT matches a direct DFT', () => {
    const x = [1, 2, 3, 4, 0, -1, 5, 2];
    const re = Float64Array.from(x), im = new Float64Array(8);
    fftInPlace(re, im);
    for (let k = 0; k < 8; k++) {
      let r = 0, i = 0;
      for (let n = 0; n < 8; n++) { r += x[n] * Math.cos((2 * Math.PI * k * n) / 8); i -= x[n] * Math.sin((2 * Math.PI * k * n) / 8); }
      expect(re[k]).toBeCloseTo(r, 9); expect(im[k]).toBeCloseTo(i, 9);
    }
  });

  it('window coherent gains', () => {
    expect(coherentGain(windowCoeffs('rect', 1024))).toBeCloseTo(1, 12);
    expect(coherentGain(windowCoeffs('hann', 1024))).toBeCloseTo(0.5, 12);
    expect(coherentGain(windowCoeffs('hamming', 1024))).toBeCloseTo(0.54, 12);
    expect(coherentGain(windowCoeffs('blackman', 1024))).toBeCloseTo(0.42, 12);
  });

  it('pure 1 kHz 1 V sine: 1 kHz peak, amplitude within 1 % (Hann + correction), all windows', () => {
    for (const w of ['rect', 'hann', 'hamming', 'blackman'] as const) {
      const s = amplitudeSpectrum(sine(1000, 1), FS, w);
      const p = findPeaks(s, 1)[0];
      expect(Math.abs(p.freq - 1000)).toBeLessThan(5);
      expect(Math.abs(p.amp - 1)).toBeLessThan(0.01);
      expect(Math.abs(p.dbv)).toBeLessThan(0.1);
    }
    expect(amplitudeSpectrum(sine(1000, 1), FS, 'hann').nyquist).toBe(32000);
  });

  it('non-coherent tone: Hann + parabolic interpolation still within 1 % and 0.5 Hz-ish', () => {
    const s = amplitudeSpectrum(sine(1234.5, 2), FS, 'hann');
    const p = findPeaks(s, 1)[0];
    expect(Math.abs(p.freq - 1234.5)).toBeLessThan(1);
    expect(Math.abs(p.amp - 2) / 2).toBeLessThan(0.01);
  });

  it('DC offset is reported in bin 0 with correct level', () => {
    const y = sine(1000, 1).map((v) => v + 0.5);
    const s = amplitudeSpectrum(y, FS, 'hann');
    expect(s.mag[0]).toBeCloseTo(0.5, 3);
  });

  it('two tones are both resolved with correct amplitudes', () => {
    const a = sine(1000, 1), b = sine(1500, 0.5);
    const y = a.map((v, i) => v + b[i]);
    const peaks = findPeaks(amplitudeSpectrum(y, FS, 'hann'), 2).sort((p, q) => p.freq - q.freq);
    expect(peaks).toHaveLength(2);
    expect(Math.abs(peaks[0].freq - 1000)).toBeLessThan(5);
    expect(Math.abs(peaks[1].freq - 1500)).toBeLessThan(5);
    expect(Math.abs(peaks[0].amp - 1)).toBeLessThan(0.02);
    expect(Math.abs(peaks[1].amp - 0.5)).toBeLessThan(0.02);
  });

  it('zero padding keeps amplitude scaling and refines bins', () => {
    const s = amplitudeSpectrum(sine(1000, 1), FS, 'hann', { nfft: N * 4 });
    expect(s.nfft).toBe(N * 4);
    expect(Math.abs(findPeaks(s, 1)[0].amp - 1)).toBeLessThan(0.01);
    const odd = amplitudeSpectrum(sine(1000, 1, 3000, FS), FS, 'hann'); // 3000 -> padded to 4096
    expect(odd.nfft).toBe(4096);
    expect(Math.abs(findPeaks(odd, 1)[0].freq - 1000)).toBeLessThan(10);
  });

  it('square wave: harmonics 3 and 5 at 1/3 and 1/5 of the fundamental (within 3 %)', () => {
    const P = 1024, n = 8192, fs = 1024000; // f0 = 1 kHz, 8 periods
    const y = Array.from({ length: n }, (_, i) => (Math.sin((2 * Math.PI * (i + 0.25)) / P) >= 0 ? 1 : -1));
    const s = amplitudeSpectrum(y, fs, 'hann');
    const peaks = findPeaks(s, 3).sort((a, b) => a.freq - b.freq);
    expect(peaks.map((p) => Math.round(p.freq / 1000))).toEqual([1, 3, 5]);
    expect(Math.abs(peaks[0].amp - 4 / Math.PI) / (4 / Math.PI)).toBeLessThan(0.02);
    expect(Math.abs(peaks[1].amp / peaks[0].amp - 1 / 3) / (1 / 3)).toBeLessThan(0.03);
    expect(Math.abs(peaks[2].amp / peaks[0].amp - 1 / 5) / (1 / 5)).toBeLessThan(0.03);
    expect(detectFundamental(s)!.freq).toBeCloseTo(1000, -1);
  });

  it('THD of 0.9 sin + 0.1 sin(3x) = 0.1/0.9 = 11.11 % (within 2 % relative)', () => {
    const a = sine(1000, 0.9), b = sine(3000, 0.1);
    const y = a.map((v, i) => v + b[i]);
    const exact = (0.1 / 0.9) * 100;
    for (const w of ['rect', 'hann', 'blackman'] as const) {
      const r = estimateThd(amplitudeSpectrum(y, FS, w))!;
      expect(r.fundamental).toBeCloseTo(1000, -1);
      expect(Math.abs(r.thdPercent - exact) / exact).toBeLessThan(0.02);
    }
    expect(estimateThd(amplitudeSpectrum(y, FS, 'hann'), 1000)!.harmonics[0].k).toBe(2);
  });

  it('THD of a pure sine is ~0', () => {
    const r = estimateThd(amplitudeSpectrum(sine(1000, 1), FS, 'hann'))!;
    expect(r.thdPercent).toBeLessThan(0.01);
  });

  it('non-uniform sample times are resampled to a uniform grid (linear interpolation)', () => {
    // jittered steps 5..15 us, 1 kHz sine, 1.2 V
    const t: number[] = [0], v: number[] = [0];
    let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    while (t[t.length - 1] < 0.04) { t.push(t[t.length - 1] + 5e-6 + rnd() * 10e-6); }
    t.forEach((tt, i) => { v[i] = 1.2 * Math.sin(2 * Math.PI * 1000 * tt); });
    const u = resampleUniform(t, v)!;
    expect(u.dt).toBeGreaterThan(5e-6); expect(u.dt).toBeLessThan(15e-6);
    const diffs = u.y.length;
    expect(diffs).toBeGreaterThan(2000);
    const s = scopeSpectrum(t, v, 'hann')!;
    const p = findPeaks(s, 1)[0];
    expect(Math.abs(p.freq - 1000)).toBeLessThan(20);
    expect(Math.abs(p.amp - 1.2) / 1.2).toBeLessThan(0.03);
    expect(s.nyquist).toBeCloseTo(1 / (2 * u.dt), 3);
  });

  it('resample caps the point count and rejects short buffers', () => {
    const t = Array.from({ length: 100000 }, (_, i) => i * 1e-6), v = t.map(() => 1);
    expect(resampleUniform(t, v, { maxPoints: 4096 })!.y.length).toBeLessThanOrEqual(4096);
    expect(resampleUniform([0, 1], [0, 1])).toBeNull();
  });
});
