import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import { autoPlace, worldPads } from './design';
import { liveViolations, snapDir } from './manual';

describe('manual track tool helpers', () => {
  it('snapDir 45: snaps to 0/45/90 degrees, Shift (free) keeps the cursor, orth = old behaviour', () => {
    expect(snapDir([0, 0], [10, 3], '45')).toEqual([10, 0]);
    expect(snapDir([0, 0], [3, 10], '45')).toEqual([0, 10]);
    const d = snapDir([0, 0], [10, 8], '45'); // 38.7 deg -> 45 deg
    expect(d[0]).toBeCloseTo(d[1], 9);
    expect(d[0]).toBeCloseTo(9, 9); // projection (10+8)/sqrt2 = 12.73 -> (9, 9)
    expect(snapDir([5, 5], [1, 1], '45')[0]).toBeCloseTo(1, 9);
    expect(snapDir([0, 0], [10, 3], 'free')).toEqual([10, 3]);
    expect(snapDir([0, 0], [10, 3], 'orth')).toEqual([10, 0]);
    expect(snapDir([2, 2], [2, 2], '45')).toEqual([2, 2]);
  });

  it('liveViolations flags a track that runs too close to another net and passes a clear one', () => {
    const b = new CircuitBuilder();
    b.add('r_smd0805_1k', {}, 0, 0, 0, 'R1'); b.add('r_smd0805_1k', {}, 0, 0, 0, 'R2'); b.add('r_smd0805_1k', {}, 0, 0, 0, 'R3');
    b.chain('R1.2', 'R2.1');
    const d = autoPlace(b.circuit);
    d.outline = { w: 40, h: 30 };
    const put = (id: string, pin: string, x: number, y: number) => {
      d.placements[id] = { x: 0, y: 0, rot: 0, side: 'top' };
      const wp = worldPads(b.circuit, d).find((p) => p.comp === id && p.pin === pin)!;
      d.placements[id] = { x: x - wp.x, y: y - wp.y, rot: 0, side: 'top' };
    };
    put('R1', '2', 5, 5); put('R2', '1', 25, 5); put('R3', '1', 15, 12);
    const r3 = worldPads(b.circuit, d).find((p) => p.comp === 'R3' && p.pin === '1')!;
    // 0.4 mm track that passes 0.1 mm beside the pad of the unrelated part R3 (pad half height + 0.1 + half width)
    const y = r3.y - r3.h / 2 - 0.1 - 0.2;
    expect(liveViolations(b.circuit, d, { layer: 'top', width: 0.4, pts: [[5, y], [25, y]] }).some((i) => i.code === 'CLEARANCE')).toBe(true);
    expect(liveViolations(b.circuit, d, { layer: 'top', width: 0.4, pts: [[5, 5], [25, 5]] })).toEqual([]);
    expect(liveViolations(b.circuit, d, { layer: 'top', width: 0.4, pts: [[5, 5]] })).toEqual([]); // single point = nothing to check
  });
});
