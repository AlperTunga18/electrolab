import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import { K_B, noiseAnalysis } from './noise';

const rel = (a: number, b: number) => Math.abs(a - b) / b;

describe('Noise', () => {
  it('bölücü çıkış gürültüsü = sqrt(4kT·(R1||R2)·B)', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 5 }); b.add('resistor', { r: 10000 }); b.add('resistor', { r: 10000 }); b.add('ground');
    b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'R2.1'); b.chain('R2.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    const B = 10e3, T = 300;
    const r = noiseAnalysis(b.circuit, { probe: { comp: 'R2', pin: '1' }, bandwidth: B, temperature: T });
    const want = Math.sqrt(4 * K_B * T * 5000 * B);
    expect(rel(r.totalVrms, want)).toBeLessThan(0.02);
    expect(r.perSource).toHaveLength(2);
    expect(rel(r.perSource[0].vrms, r.perSource[1].vrms)).toBeLessThan(1e-6);
  });
  it('RC: toplam gürültü ≈ sqrt(kT/C) (B >> 1/RC)', () => {
    const b = new CircuitBuilder();
    b.add('resistor', { r: 10000 }); b.add('capacitor', { c: 1e-9 }); b.add('ground');
    b.chain('R1.1', 'GND1.G'); b.chain('R1.2', 'C1.1'); b.chain('C1.2', 'GND1.G');
    const r = noiseAnalysis(b.circuit, { probe: { comp: 'C1', pin: '1' }, bandwidth: 1e7, temperature: 300 });
    expect(r.method).toBe('integrated');
    expect(rel(r.totalVrms, Math.sqrt(K_B * 300 / 1e-9))).toBeLessThan(0.05);
  });
});
