import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../core/circuit/builder';
import { EvalCtx, evalChallenge, evalExpect } from './engine';

function divider() {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 10 }); b.add('resistor', { r: 1000 }); b.add('resistor', { r: 2000 }); b.add('ground');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'R2.1'); b.chain('R2.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
}

describe('education engine', () => {
  it('evaluates DC probes: node, v, i, p', () => {
    const ctx = new EvalCtx(divider());
    expect(ctx.value({ q: 'node', comp: 'R1', pin: '2' })).toBeCloseTo(20 / 3, 6);
    expect(ctx.value({ q: 'v', comp: 'R2' })).toBeCloseTo(20 / 3, 6);
    expect(ctx.value({ q: 'i', comp: 'R1' })).toBeCloseTo(10 / 3000, 9);
    expect(ctx.value({ q: 'p', comp: 'R1' })).toBeCloseTo((10 / 3000) ** 2 * 1000, 9);
  });

  it('expect tolerance logic', () => {
    const ctx = new EvalCtx(divider());
    const e = { label: 'Vout', probe: { q: 'node' as const, comp: 'R1', pin: '2' }, unit: 'V' };
    expect(evalExpect(ctx, { ...e, value: 6.7 }).ok).toBe(true);
    expect(evalExpect(ctx, { ...e, value: 7.5 }).ok).toBe(false);
    expect(evalExpect(ctx, { ...e, value: 7.5, tol: { rel: 0.2 } }).ok).toBe(true);
  });

  it('transient statistics: rms, max, freq of a sine source', () => {
    const b = new CircuitBuilder();
    b.add('signal_gen', { wave: 'sine', amp: 2, freq: 1000, v: 0 }); b.add('resistor', { r: 100 }); b.add('ground');
    b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    const ctx = new EvalCtx(b.circuit);
    const probe = { q: 'v' as const, comp: 'R1' };
    const base = { stop: 5e-3, dt: 5e-6 };
    expect(ctx.value(probe, { ...base, stat: 'max' })).toBeCloseTo(2, 1);
    expect(ctx.value(probe, { ...base, stat: 'rms', skip: 0 })).toBeCloseTo(2 / Math.SQRT2, 1);
    expect(ctx.value(probe, { ...base, stat: 'freq' })).toBeCloseTo(1000, -1);
    expect(ctx.value(probe, { ...base, stat: 'pp' })).toBeCloseTo(4, 1);
  });

  it('challenge evaluation: pass/fail and errors count as failures', () => {
    const checks = [{ label: 'Vout 3.2-3.4 V', probe: { q: 'node' as const, comp: 'R1', pin: '2' }, min: 3.2, max: 3.4, unit: 'V' }];
    expect(evalChallenge(divider(), checks).ok).toBe(false);
    const fixed = divider();
    fixed.components.find((c) => c.id === 'R2')!.params.r = 490; // 10 * 490 / 1490 = 3.29 V
    expect(evalChallenge(fixed, checks).ok).toBe(true);
    const noGnd = { ...divider(), components: divider().components.filter((c) => c.type !== 'ground') };
    const r = evalChallenge(noGnd, checks);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/toprak/i);
  });

  it('hidden faults change the measurement', () => {
    const c = divider();
    const healthy = new EvalCtx(c).value({ q: 'node', comp: 'R1', pin: '2' });
    const faulty = new EvalCtx(c, { R2: { kind: 'open' } }).value({ q: 'node', comp: 'R1', pin: '2' });
    expect(healthy).toBeCloseTo(6.667, 2);
    expect(faulty).toBeCloseTo(10, 3);
  });
});
