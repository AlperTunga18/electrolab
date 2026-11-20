import { describe, expect, it } from 'vitest';
import type { Layout } from './layout';
import { alignSch, distributeSch, marqueeSch, rotateSchGroup, translateSch } from './group';

const L: Layout = {
  a: { x: 0, y: 0, rot: 0 },
  b: { x: 100, y: 40, rot: 0 },
  c: { x: 300, y: 90, rot: 1 },
  d: { x: 500, y: 500, rot: 0 },
};

describe('schematic group operations', () => {
  it('translate moves only the group, by the same delta', () => {
    expect(translateSch(L, ['a', 'b'], 10, -20)).toEqual({ a: { x: 10, y: -20, rot: 0 }, b: { x: 110, y: 20, rot: 0 } });
    expect(translateSch(L, ['zz'], 1, 1)).toEqual({});
  });

  it('rotate: rigid clockwise quarter turn about the group centre, rot+1, two turns map back mirrored', () => {
    const p = rotateSchGroup(L, ['a', 'b']);
    // centre (50,20) -> snapped (50,20); a: (-50,-20) rotated cw = (20,-50) ; b: (50,20) -> (-20,50)
    expect(p.a).toEqual({ x: 70, y: -30, rot: 1 });
    expect(p.b).toEqual({ x: 30, y: 70, rot: 1 });
    // pairwise distance preserved
    const d0 = Math.hypot(L.b.x - L.a.x, L.b.y - L.a.y), d1 = Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y);
    expect(d1).toBeCloseTo(d0, 9);
    // four turns return to the start
    let cur: Layout = { a: L.a, b: L.b };
    for (let i = 0; i < 4; i++) cur = { ...cur, ...rotateSchGroup(cur, ['a', 'b']) };
    expect(cur.a).toEqual({ x: 0, y: 0, rot: 0 });
    expect(cur.b).toEqual({ x: 100, y: 40, rot: 0 });
    expect(rotateSchGroup(L, [])).toEqual({});
  });

  it('align: left/right/top/bottom/centres on screen axes', () => {
    expect(alignSch(L, ['a', 'b', 'c'], 'left')).toEqual({ b: { x: 0, y: 40, rot: 0 }, c: { x: 0, y: 90, rot: 1 } });
    expect(alignSch(L, ['a', 'b', 'c'], 'right')).toMatchObject({ a: { x: 300 }, b: { x: 300 } });
    expect(alignSch(L, ['a', 'b', 'c'], 'top')).toMatchObject({ b: { y: 0 }, c: { y: 0 } }); // top = smallest y
    expect(alignSch(L, ['a', 'b', 'c'], 'bottom')).toMatchObject({ a: { y: 90 }, b: { y: 90 } });
    expect(alignSch(L, ['a', 'b', 'c'], 'hcenter')).toMatchObject({ a: { x: 150 }, b: { x: 150 }, c: { x: 150 } });
    expect(alignSch(L, ['a', 'b', 'c'], 'vcenter')).toMatchObject({ a: { y: 50 }, b: { y: 50 }, c: { y: 50 } });
    expect(alignSch(L, ['a'], 'left')).toEqual({}); // needs 2+
    expect(alignSch(L, ['a', 'b'], 'left').b.rot).toBe(0); // rotation kept
  });

  it('distribute: even spacing between the outer two, needs 3+', () => {
    const l: Layout = { a: { x: 0, y: 0, rot: 0 }, b: { x: 30, y: 0, rot: 0 }, c: { x: 200, y: 0, rot: 0 } };
    expect(distributeSch(l, ['a', 'b', 'c'], 'x')).toEqual({ b: { x: 100, y: 0, rot: 0 } });
    expect(distributeSch(l, ['a', 'b'], 'x')).toEqual({});
    const v: Layout = { a: { x: 0, y: 0, rot: 0 }, b: { x: 0, y: 10, rot: 0 }, c: { x: 0, y: 100, rot: 0 } };
    expect(distributeSch(v, ['a', 'b', 'c'], 'y')).toEqual({ b: { x: 0, y: 50, rot: 0 } });
  });

  it('marquee selects parts inside the rectangle, any corner order', () => {
    expect(marqueeSch(L, { x: -10, y: -10 }, { x: 150, y: 60 })).toEqual(['a', 'b']);
    expect(marqueeSch(L, { x: 350, y: 120 }, { x: 250, y: 60 })).toEqual(['c']);
    expect(marqueeSch(L, { x: 1000, y: 1000 }, { x: 2000, y: 2000 })).toEqual([]);
  });
});
