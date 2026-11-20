import { describe, expect, it } from 'vitest';
import type { Circuit, PlacedComponent } from '../circuit/types';
import { getDef } from '../../library/components';
import { pinPos, symbolFor } from './symbols';
import type { Layout } from './layout';
import { bestRotation, rotationForPin, suggestPlacement } from './orient';

const comp = (id: string, type = 'resistor'): PlacedComponent => ({ id, type, ref: id, x: 0, z: 0, rot: 0, params: {} });
const wire = (id: string, a: string, b: string) => {
  const [ac, ap] = a.split('.'), [bc, bp] = b.split('.');
  return { id, a: { comp: ac, pin: ap }, b: { comp: bc, pin: bp }, color: '#000', width: 2 };
};

describe('rotationForPin', () => {
  it('finds the quarter turns that make a pin face a direction', () => {
    // resistor pin 2 leaves to the right at rot 0 (see symbols test)
    expect(rotationForPin('resistor', '2', 'r')).toBe(0);
    expect(rotationForPin('resistor', '2', 'd')).toBe(1);
    expect(rotationForPin('resistor', '2', 'l')).toBe(2);
    expect(rotationForPin('resistor', '2', 'u')).toBe(3);
    expect(rotationForPin('resistor', 'nope', 'u')).toBeNull();
  });
});

describe('suggestPlacement (new part faces the waiting pin)', () => {
  const c: Circuit = { components: [comp('r1')], wires: [] };
  const layout: Layout = { r1: { x: 100, y: 100, rot: 0 } };

  it('target pin facing right: new part to its right, its first pin facing left, tip 40 px away, on grid', () => {
    const t = pinPos(symbolFor(getDef('resistor')), 0, 100, 100, '2'); // (130,100) dir r
    const s = suggestPlacement(c, layout, { comp: 'r1', pin: '2' }, 'resistor')!;
    const sym = symbolFor(getDef('resistor'));
    const first = pinPos(sym, s.rot, s.x, s.y, sym.pins[0].id);
    expect(first.dir).toBe('l');
    expect(first.x).toBe(t.x + 40);
    expect(first.y).toBe(t.y);
    expect(s.x % 10 === 0 && s.y % 10 === 0).toBe(true);
  });

  it('works for every direction of the target pin', () => {
    for (const rot of [0, 1, 2, 3] as const) {
      const l: Layout = { r1: { x: 100, y: 100, rot } };
      const t = pinPos(symbolFor(getDef('resistor')), rot, 100, 100, '1');
      const s = suggestPlacement(c, l, { comp: 'r1', pin: '1' }, 'capacitor')!;
      const sym = symbolFor(getDef('capacitor'));
      const first = pinPos(sym, s.rot, s.x, s.y, sym.pins[0].id);
      const opp = { l: 'r', r: 'l', u: 'd', d: 'u' }[t.dir];
      expect(first.dir).toBe(opp);
      expect(Math.hypot(first.x - t.x, first.y - t.y)).toBe(40);
    }
  });

  it('returns null for unknown target or type', () => {
    expect(suggestPlacement(c, layout, { comp: 'zz', pin: '1' }, 'resistor')).toBeNull();
    expect(suggestPlacement(c, layout, { comp: 'r1', pin: '1' }, 'no-such-type')).toBeNull();
  });
});

describe('bestRotation (existing part)', () => {
  it('turns a resistor so its pins point at the parts it is wired to', () => {
    // r2 sits left of r1 and right of r3, but r2 is rotated vertical (rot 1)
    const c: Circuit = { components: [comp('r1'), comp('r2'), comp('r3')], wires: [wire('a', 'r1.2', 'r2.1'), wire('b', 'r2.2', 'r3.1')] };
    const layout: Layout = { r1: { x: 0, y: 0, rot: 0 }, r2: { x: 150, y: 0, rot: 1 }, r3: { x: 300, y: 0, rot: 0 } };
    expect(bestRotation(c, layout, 'r2')).toBe(0);
    // mirrored neighbours (r3 on the left) need the half-turn
    const swapped: Layout = { r1: { x: 300, y: 0, rot: 0 }, r2: { x: 150, y: 0, rot: 0 }, r3: { x: 0, y: 0, rot: 0 } };
    expect(bestRotation(c, swapped, 'r2')).toBe(2);
  });

  it('keeps the rotation when nothing is wired or the part is unknown', () => {
    const c: Circuit = { components: [comp('r1')], wires: [] };
    expect(bestRotation(c, { r1: { x: 0, y: 0, rot: 3 } }, 'r1')).toBe(3);
    expect(bestRotation(c, {}, 'zz')).toBe(0);
  });

  it('keeps an already good rotation (ties)', () => {
    const c: Circuit = { components: [comp('r1'), comp('r2')], wires: [wire('a', 'r1.2', 'r2.1')] };
    const layout: Layout = { r1: { x: 0, y: 0, rot: 0 }, r2: { x: 200, y: 0, rot: 0 } };
    expect(bestRotation(c, layout, 'r1')).toBe(0);
    expect(bestRotation(c, layout, 'r2')).toBe(0);
  });
});
