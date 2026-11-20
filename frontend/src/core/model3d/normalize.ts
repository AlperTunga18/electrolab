export type V3 = [number, number, number];

/**
 * Pure helper: fit a bounding box (min/max, any units) uniformly into `size` (cm: w along x, h along y, d along z).
 * Result: apply `scale` first, then translate by `offset`. Model ends up centred in x/z with its base on y = 0.
 * Returns null for an empty/degenerate box.
 */
export function normalizeBox(min: V3, max: V3, size: { w: number; d: number; h: number }): { scale: number; offset: V3 } | null {
  const ex = max[0] - min[0], ey = max[1] - min[1], ez = max[2] - min[2];
  if (![ex, ey, ez].every(Number.isFinite) || Math.max(ex, ey, ez) <= 0) return null;
  const ratios = [size.w / ex, size.h / ey, size.d / ez].filter((r) => Number.isFinite(r) && r > 0);
  if (!ratios.length) return null;
  const scale = Math.min(...ratios);
  const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2;
  return { scale, offset: [-cx * scale, -min[1] * scale, -cz * scale] };
}
