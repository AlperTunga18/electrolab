import { describe, expect, it } from 'vitest';
import { GLYPHS, textSegments, textStrokes, textWidth } from './strokeFont';

const SET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_./+';

describe('strokeFont', () => {
  it('covers A-Z, 0-9 and punctuation with non-empty glyphs', () => {
    for (const c of SET) { expect(GLYPHS[c], c).toBeDefined(); expect(GLYPHS[c].length, c).toBeGreaterThan(0); }
  });
  it('glyph points stay in the 0..4 x -1..6 grid', () => {
    for (const [c, polys] of Object.entries(GLYPHS)) for (const p of polys) for (const [x, y] of p) {
      expect(x, c).toBeGreaterThanOrEqual(0); expect(x, c).toBeLessThanOrEqual(4);
      expect(y, c).toBeGreaterThanOrEqual(-1); expect(y, c).toBeLessThanOrEqual(6);
    }
  });
  it('segment counts: I has 3, spaces have none', () => {
    expect(textSegments('I', { x: 0, y: 0, height: 6 }).length).toBe(3);
    expect(textSegments('  ', { x: 0, y: 0, height: 1 }).length).toBe(0);
  });
  it('scale, centring, y down', () => {
    const s = textSegments('T', { x: 10, y: 20, height: 2 });
    const ys = s.flatMap((q) => [q[1], q[3]]);
    expect(Math.min(...ys)).toBeCloseTo(19, 9);
    expect(Math.max(...ys)).toBeCloseTo(21, 9);
    expect(s[0][1]).toBeCloseTo(19, 9); // T bar is at the top = smaller model y
    const xs = s.flatMap((q) => [q[0], q[2]]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(10, 9);
    expect(textWidth('T', 6)).toBeCloseTo(4, 9);
    expect(textWidth('AB', 6)).toBeCloseTo(9, 9);
  });
  it('mirror flips x about the anchor, rotation 90 swaps axes', () => {
    const a = textStrokes('L', { x: 0, y: 0, height: 6 })[0];
    const m = textStrokes('L', { x: 0, y: 0, height: 6, mirror: true })[0];
    a.forEach((p, i) => { expect(m[i][0]).toBeCloseTo(-p[0], 9); expect(m[i][1]).toBeCloseTo(p[1], 9); });
    const r = textStrokes('L', { x: 0, y: 0, height: 6, rot: 90 })[0];
    a.forEach((p, i) => { expect(r[i][0]).toBeCloseTo(-p[1], 9); expect(r[i][1]).toBeCloseTo(p[0], 9); });
  });
  it('lowercase maps to uppercase, unknown draws a box', () => {
    expect(textSegments('r1', { x: 0, y: 0, height: 1 })).toEqual(textSegments('R1', { x: 0, y: 0, height: 1 }));
    expect(textSegments('@', { x: 0, y: 0, height: 1 }).length).toBe(4);
  });
});
