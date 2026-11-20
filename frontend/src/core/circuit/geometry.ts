import type { PlacedComponent } from './types';
import { getDef } from '../../library/components';

export const GRID_DEFAULT = 0.5;

export const snap = (v: number, grid: number): number => (grid > 0 ? Math.round(v / grid) * grid : v);

/** Rotate local (x,z) by rot quarter turns about Y (matches three.js rotation.y = rot*PI/2). */
export function rotateXZ(x: number, z: number, rot: number): [number, number] {
  switch (rot & 3) {
    case 1: return [z, -x];
    case 2: return [-x, -z];
    case 3: return [-z, x];
    default: return [x, z];
  }
}

export function pinWorld(c: PlacedComponent, pinId: string): [number, number, number] {
  const p = getDef(c.type).pins.find((q) => q.id === pinId);
  if (!p) return [c.x, 0.2, c.z];
  const [dx, dz] = rotateXZ(p.x, p.z, c.rot);
  return [c.x + dx, p.y, c.z + dz];
}
