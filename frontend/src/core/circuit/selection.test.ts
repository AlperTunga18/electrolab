import { describe, expect, it } from 'vitest';
import { alignComponents, distributeComponents, marqueeSelect, rotateGroup, translateComponents } from './selection';
import type { PlacedComponent } from './types';

const P = (id: string, x: number, z: number): PlacedComponent => ({ id, type: 'resistor', ref: id, x, z, rot: 0, params: {} });
const items = [P('a', 0, 0), P('b', 2, 1), P('c', 5, 5), P('d', -3, 2)];

describe('marqueeSelect', () => {
  it('selects parts inside, inclusive, any corner order', () => {
    expect(marqueeSelect(items, { x: -1, z: -1 }, { x: 2, z: 1 })).toEqual(['a', 'b']);
    expect(marqueeSelect(items, { x: 2, z: 1 }, { x: -1, z: -1 })).toEqual(['a', 'b']);
  });
  it('empty rectangle selects nothing; huge selects all in input order', () => {
    expect(marqueeSelect(items, { x: 10, z: 10 }, { x: 11, z: 11 })).toEqual([]);
    expect(marqueeSelect(items, { x: -99, z: -99 }, { x: 99, z: 99 })).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('group helpers', () => {
  it('translate keeps relative offsets and leaves others', () => {
    const r = translateComponents(items, ['a', 'b'], 1, -1);
    expect([r[0].x, r[0].z, r[1].x, r[1].z]).toEqual([1, -1, 3, 0]);
    expect(r[2]).toBe(items[2]);
  });
  it('align left/bottom/hcenter', () => {
    const ids = ['a', 'b', 'c'];
    expect(alignComponents(items, ids, 'left', 0.5).filter((c) => ids.includes(c.id)).map((c) => c.x)).toEqual([0, 0, 0]);
    expect(alignComponents(items, ids, 'bottom', 0.5).filter((c) => ids.includes(c.id)).map((c) => c.z)).toEqual([5, 5, 5]);
    expect(alignComponents(items, ids, 'hcenter', 0.5)[0].x).toBe(2.5);
  });
  it('distribute spaces evenly between extremes', () => {
    const r = distributeComponents([P('a', 0, 0), P('b', 1, 0), P('c', 10, 0)], ['a', 'b', 'c'], 'x', 0.5);
    expect(r.map((c) => c.x)).toEqual([0, 5, 10]);
    expect(distributeComponents(items, ['a', 'b'], 'x', 0.5)).toBe(items);
  });
  it('rotateGroup turns the group rigidly', () => {
    const r = rotateGroup([P('a', 0, 0), P('b', 2, 0)], ['a', 'b'], 0.5);
    expect(r.map((c) => c.rot)).toEqual([1, 1]);
    expect(Math.abs(r[0].x - r[1].x)).toBeLessThan(1e-9);
    expect(Math.abs(r[0].z - r[1].z)).toBe(2);
  });
});
