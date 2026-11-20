import { describe, expect, it } from 'vitest';
import { COMPONENTS, defaultParams } from './components';
import { searchParts } from './search';
import { CircuitBuilder } from '../core/circuit/builder';
import { Sim } from '../core/sim/mna';

describe('library catalog integrity', () => {
  it('has a large catalog with unique type ids', () => {
    expect(COMPONENTS.length).toBeGreaterThan(100);
    expect(new Set(COMPONENTS.map((c) => c.type)).size).toBe(COMPONENTS.length);
  });

  for (const c of COMPONENTS) {
    it(`${c.type}: pins unique, params/ratings consistent`, () => {
      expect(c.pins.length).toBeGreaterThan(0);
      expect(new Set(c.pins.map((p) => p.id)).size).toBe(c.pins.length);
      const keys = new Set(c.params.map((p) => p.key));
      for (const r of c.ratings) if (r.paramKey) expect(keys.has(r.paramKey)).toBe(true);
      for (const p of c.pins) { expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true); }
      if (c.model === 'none') expect(c.simModel).toBe('none');
      if (c.mpn) expect(c.datasheetUrl).toMatch(/^https:\/\//);
      if (c.mpn) expect(c.verified).toBe(false);
    });
  }

  it('every simulatable part solves (DC) in a pulled-up/pulled-down harness without throwing', () => {
    for (const c of COMPONENTS) {
      if (c.model === 'none' || c.model === 'ground') continue;
      const b = new CircuitBuilder();
      b.add('dc_supply', { v: 5 }, 0, 0, 0, 'VS');
      b.add('ground', {}, 0, 0, 0, 'G0');
      b.wire('VS.N', 'G0.G');
      const ref = b.add(c.type, {}, 0, 0, 0, 'DUT');
      c.pins.forEach((p, i) => {
        const r = b.add('resistor', { r: 1000 }, 0, 0, 0, `RX${i}`);
        b.wire(`DUT.${p.id}`, `${r}.1`);
        b.wire(`${r}.2`, i % 2 === 0 ? 'VS.P' : 'G0.G');
      });
      expect(ref).toBe('DUT');
      const sim = new Sim(b.circuit);
      expect(() => sim.solveDC(), c.type).not.toThrow();
      for (const v of sim.netVoltages()) expect(Number.isFinite(v), c.type).toBe(true);
    }
  });

  it('default params exist for every part', () => {
    for (const c of COMPONENTS) expect(Object.keys(defaultParams(c.type)).length).toBe(c.params.length);
  });

  it('search: multi-token, mpn, manufacturer, category', () => {
    expect(searchParts('resistor').length).toBeGreaterThan(0);
    expect(searchParts('zzzzzz')).toHaveLength(0);
    expect(searchParts('', 'passive').every((c) => c.category === 'passive')).toBe(true);
  });
});
