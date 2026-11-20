import { describe, expect, it } from 'vitest';
import { acRms, digitize, formatRanged, frequency, mean, powerStats, rms, thd } from './readings';

const sine = (f: number, amp: number, off = 0, dur = 0.1, dt = 1e-5, phase = 0) => {
  const t: number[] = [], y: number[] = [];
  for (let k = 0; k <= dur / dt; k++) { t.push(k * dt); y.push(off + amp * Math.sin(2 * Math.PI * f * k * dt + phase)); }
  return { t, y };
};
const close = (a: number, b: number, rel = 0.01, abs = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(abs + rel * Math.abs(b));

describe('instrument readings', () => {
  it('mean / true RMS / AC RMS of a sine with DC offset', () => {
    const { y } = sine(100, 2, 3);
    close(mean(y), 3, 0.01);
    close(rms(y), Math.sqrt(9 + 2), 0.01);          // sqrt(Vdc² + Vac²), Vac = 2/√2
    close(acRms(y), 2 / Math.SQRT2, 0.01);
  });

  it('frequency counter with duty on a square wave', () => {
    const t: number[] = [], y: number[] = [];
    for (let k = 0; k <= 20000; k++) { const tt = k * 1e-6; t.push(tt); y.push((tt * 1000) % 1 < 0.3 ? 5 : 0); }
    const f = frequency(t, y);
    close(f.freq, 1000, 0.01); close(f.duty, 0.3, 0.05); close(f.period, 1e-3, 0.01);
  });

  it('power analyzer: resistive PF = 1; 90° lag = pure reactive; 60° lag PF = 0.5', () => {
    const v = sine(50, 10, 0, 0.2, 1e-4);
    const resistive = powerStats(v.t, v.y, v.y.map((x) => x / 5));
    close(resistive.pf, 1, 0.01); close(resistive.p, 10 * 10 / 2 / 5, 0.01);
    const lag = (deg: number) => sine(50, 10, 0, 0.2, 1e-4, -(deg * Math.PI) / 180).y.map((x) => x / 5);
    const q = powerStats(v.t, v.y, lag(90));
    expect(Math.abs(q.p)).toBeLessThan(0.05); close(q.q, q.s, 0.01);
    close(powerStats(v.t, v.y, lag(60)).pf, 0.5, 0.02);
  });

  it('THD: pure sine ~0 %, sine + 10 % third harmonic ~10 %', () => {
    const a = sine(50, 1, 0, 0.2, 1e-5);
    expect(thd(a.t, a.y, 50)).toBeLessThan(0.5);
    const y = a.t.map((t, k) => a.y[k] + 0.1 * Math.sin(2 * Math.PI * 150 * t));
    close(thd(a.t, y, 50), 10, 0.03);
  });

  it('logic analyzer digitize with hysteresis; manual range OL and decimals', () => {
    expect(digitize([0, 0.2, 0.9, 3.3, 3.2, 1.7, 0.5, 0.1], 1.65, 0.2)).toEqual([false, false, false, true, true, true, false, false]);
    expect(formatRanged(1.2345, 2, 'V')).toBe('1.234 V');
    expect(formatRanged(12.345, 20, 'V')).toBe('12.35 V');
    expect(formatRanged(25, 20, 'V')).toBe('OL');
  });
});
