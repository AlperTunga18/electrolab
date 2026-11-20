import { describe, expect, it } from 'vitest';
import { polylineHitsBoxes, routeWire, type Box } from './wireRoute';

const wall: Box = { minX: 4, maxX: 6, minZ: -3, maxZ: 3 };

describe('routeWire', () => {
  it('returns the straight line when clear', () => {
    expect(routeWire({ x: 0, z: 5 }, { x: 10, z: 5 }, [wall], 0.5)).toEqual([{ x: 0, z: 5 }, { x: 10, z: 5 }]);
    expect(routeWire({ x: 0, z: 0 }, { x: 3, z: 3 }, [], 0.5)).toHaveLength(2);
  });
  it('detours around an obstacle between the points', () => {
    const r = routeWire({ x: 0, z: 0 }, { x: 10, z: 0 }, [wall], 0.5);
    expect(r.length).toBeGreaterThan(2);
    expect(r[0]).toEqual({ x: 0, z: 0 });
    expect(r[r.length - 1]).toEqual({ x: 10, z: 0 });
  });
  it('is orthogonal and never enters an obstacle (sampled)', () => {
    const boxes: Box[] = [wall, { minX: 7, maxX: 9, minZ: 2, maxZ: 8 }];
    const r = routeWire({ x: 0.25, z: 0.5 }, { x: 11.3, z: 1 }, boxes, 0.5);
    expect(r.length).toBeGreaterThan(2);
    expect(polylineHitsBoxes(r, boxes)).toBe(false);
    for (let i = 0; i + 1 < r.length; i++) {
      expect(r[i].x === r[i + 1].x || r[i].z === r[i + 1].z).toBe(true);
      for (let t = 0; t <= 1; t += 0.01) {
        const x = r[i].x + (r[i + 1].x - r[i].x) * t, z = r[i].z + (r[i + 1].z - r[i].z) * t;
        for (const b of boxes) expect(x > b.minX + 1e-6 && x < b.maxX - 1e-6 && z > b.minZ + 1e-6 && z < b.maxZ - 1e-6).toBe(false);
      }
    }
  });
  it('is deterministic', () => {
    const a = routeWire({ x: 0, z: 0 }, { x: 10, z: 0 }, [wall], 0.5);
    expect(routeWire({ x: 0, z: 0 }, { x: 10, z: 0 }, [wall], 0.5)).toEqual(a);
  });
  it('falls back to straight when no path exists (target inside a box)', () => {
    const box: Box[] = [{ minX: 8, maxX: 12, minZ: -2, maxZ: 2 }];
    expect(routeWire({ x: 0, z: 0 }, { x: 10, z: 0 }, box, 0.5)).toEqual([{ x: 0, z: 0 }, { x: 10, z: 0 }]);
  });
});
