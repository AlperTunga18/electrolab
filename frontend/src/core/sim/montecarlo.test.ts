import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import { monteCarlo } from './montecarlo';

function divider() {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 10 }); b.add('resistor', { r: 1000, tol: 5 }); b.add('resistor', { r: 1000, tol: 5 }); b.add('ground');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'R2.1'); b.chain('R2.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
}
const probe = { comp: 'R2', pin: '1' };

describe('Monte Carlo', () => {
  it('bölücü: ortalama ≈ nominal, std ≈ analitik, aralık en kötü durum içinde', () => {
    const r = monteCarlo(divider(), { runs: 10000, seed: 1, probe });
    expect(r.nominal).toBeCloseTo(5, 6);
    expect(Math.abs(r.mean - 5) / 5).toBeLessThan(0.01);
    // dV/dR = 10*R/(2R)^2 = 2.5e-3 V/Ω; σR = 1000*0.05/3
    const analytic = Math.SQRT2 * 2.5e-3 * (1000 * 0.05 / 3);
    expect(Math.abs(r.std - analytic) / analytic).toBeLessThan(0.05);
    expect(r.min).toBeGreaterThanOrEqual(r.worstCase.min);
    expect(r.max).toBeLessThanOrEqual(r.worstCase.max);
    expect(r.worstCase.max).toBeGreaterThan(5);
    expect(r.p5).toBeLessThan(r.p95);
  });
  it('uniform dağılım: σ = tol·R/√3 duyarlılığı', () => {
    const r = monteCarlo(divider(), { runs: 6000, seed: 7, probe, dist: 'uniform' });
    const analytic = Math.SQRT2 * 2.5e-3 * (1000 * 0.05 / Math.sqrt(3));
    expect(Math.abs(r.std - analytic) / analytic).toBeLessThan(0.05);
  });
  it('aynı tohum aynı çıktı, farklı tohum farklı', () => {
    const a = monteCarlo(divider(), { runs: 200, seed: 42, probe });
    const b = monteCarlo(divider(), { runs: 200, seed: 42, probe });
    const c = monteCarlo(divider(), { runs: 200, seed: 43, probe });
    expect(a).toEqual(b);
    expect(a.samples).not.toEqual(c.samples);
  });
  it('q probu (R2 gerilimi) çalışır', () => {
    const r = monteCarlo(divider(), { runs: 50, seed: 3, probe: { comp: 'R2', q: 'v' } });
    expect(r.nominal).toBeCloseTo(5, 6);
  });
});
