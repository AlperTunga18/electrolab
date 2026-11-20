import { describe, expect, it } from 'vitest';
import { normalizeBox } from './normalize';
import { checkModelFile, MAX_MODEL_BYTES } from './store';

describe('normalizeBox', () => {
  it('fits by the limiting axis, centres x/z, base at y=0', () => {
    const r = normalizeBox([0, 0, 0], [2, 1, 1], { w: 1, d: 1, h: 1 })!;
    expect(r.scale).toBeCloseTo(0.5);
    expect(r.offset[0]).toBeCloseTo(-0.5);
    expect(r.offset[1]).toBeCloseTo(0);
    expect(r.offset[2]).toBeCloseTo(-0.25);
  });
  it('handles offset origin and flat boxes', () => {
    const r = normalizeBox([-10, 5, -4], [-6, 5, 0], { w: 2, d: 2, h: 2 })!;
    expect(r.scale).toBeCloseTo(0.5);
    expect(r.offset[0]).toBeCloseTo(4);
    expect(r.offset[1]).toBeCloseTo(-2.5);
    expect(r.offset[2]).toBeCloseTo(1);
  });
  it('rejects degenerate', () => {
    expect(normalizeBox([0, 0, 0], [0, 0, 0], { w: 1, d: 1, h: 1 })).toBeNull();
    expect(normalizeBox([0, 0, 0], [NaN, 1, 1], { w: 1, d: 1, h: 1 })).toBeNull();
  });
});

describe('checkModelFile', () => {
  it('accepts glb/gltf under 2 MB, rejects STEP and big files', () => {
    expect(checkModelFile('a.glb', 100)).toBeNull();
    expect(checkModelFile('a.GLTF', 100)).toBeNull();
    expect(checkModelFile('a.step', 100)).toMatch(/STEP/);
    expect(checkModelFile('a.stp', 100)).toMatch(/STEP/);
    expect(checkModelFile('a.glb', MAX_MODEL_BYTES + 1)).toMatch(/2 MB/);
    expect(checkModelFile('a.obj', 10)).toMatch(/glb/i);
  });
});
