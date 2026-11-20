import type { Circuit, PlacedComponent, Wire } from './types';
import { rotateXZ, snap } from './geometry';
import { pruneTaps } from './taps';

export interface XZ { x: number; z: number }
export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter';
export type DistributeAxis = 'x' | 'z';

/** ids of items whose x/z lies inside the (any-corner-order) rectangle a-b, inclusive; input order preserved */
export function marqueeSelect(items: { id: string; x: number; z: number }[], a: XZ, b: XZ): string[] {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
  return items.filter((i) => i.x >= x0 && i.x <= x1 && i.z >= z0 && i.z <= z1).map((i) => i.id);
}

export function translateComponents(comps: PlacedComponent[], ids: string[], dx: number, dz: number): PlacedComponent[] {
  const s = new Set(ids);
  return comps.map((c) => (s.has(c.id) ? { ...c, x: c.x + dx, z: c.z + dz } : c));
}

/** rigid quarter-turn of the group about the centre of its bounding box (positions snapped to grid, each part rot+1) */
export function rotateGroup(comps: PlacedComponent[], ids: string[], grid: number): PlacedComponent[] {
  const s = new Set(ids);
  const g = comps.filter((c) => s.has(c.id));
  if (!g.length) return comps;
  const cx = snap((Math.min(...g.map((c) => c.x)) + Math.max(...g.map((c) => c.x))) / 2, grid);
  const cz = snap((Math.min(...g.map((c) => c.z)) + Math.max(...g.map((c) => c.z))) / 2, grid);
  return comps.map((c) => {
    if (!s.has(c.id)) return c;
    const [rx, rz] = rotateXZ(c.x - cx, c.z - cz, 1);
    return { ...c, x: cx + rx, z: cz + rz, rot: ((c.rot + 1) & 3) as 0 | 1 | 2 | 3 };
  });
}

/** remove the parts and every wire attached to them */
export function removeGroup(circuit: Circuit, ids: string[]): Circuit {
  const s = new Set(ids);
  return { ...circuit, components: circuit.components.filter((c) => !s.has(c.id)), wires: pruneTaps(circuit.wires.filter((w) => !s.has(w.a.comp) && !s.has(w.b.comp))) };
}

/** wires whose both ends are inside the group */
export const internalWires = (wires: Wire[], ids: string[]): Wire[] => {
  const s = new Set(ids);
  return wires.filter((w) => s.has(w.a.comp) && s.has(w.b.comp));
};

/**
 * Paste a clipboard group: new ids, offset position, refs from `allocRef`, internal wires re-created with remapped pin refs.
 * Returns the new circuit and the new component ids (in clipboard order).
 */
export function pasteGroup(
  circuit: Circuit, comps: PlacedComponent[], wires: Wire[], dx: number, dz: number,
  newId: (prefix: string) => string, allocRef: (existing: PlacedComponent[], type: string) => string,
  schOffset = 0,
): { circuit: Circuit; ids: string[] } {
  const map = new Map<string, string>();
  let all = circuit.components;
  const added: PlacedComponent[] = [];
  for (const src of comps) {
    const id = newId('c');
    map.set(src.id, id);
    const c: PlacedComponent = { ...src, id, ref: allocRef(all, src.type), x: src.x + dx, z: src.z + dz, params: { ...src.params } };
    if (src.sch) c.sch = { ...src.sch, x: src.sch.x + schOffset, y: src.sch.y + schOffset };
    added.push(c);
    all = [...all, c];
  }
  const inside = wires.filter((w) => map.has(w.a.comp) && map.has(w.b.comp));
  const wmap = new Map(inside.map((w) => [w.id, newId('w')]));
  const newWires: Wire[] = inside.map((w) => {
    const nw: Wire = { ...w, id: wmap.get(w.id)!, a: { comp: map.get(w.a.comp)!, pin: w.a.pin }, b: { comp: map.get(w.b.comp)!, pin: w.b.pin } };
    // a T-branch keeps its junction only when its host wire was copied too; otherwise it becomes a plain pin-to-pin wire
    if (w.tap) {
      if (wmap.has(w.tap.wire)) nw.tap = { wire: wmap.get(w.tap.wire)!, x: w.tap.x + schOffset, y: w.tap.y + schOffset };
      else delete nw.tap;
    }
    return nw;
  });
  return { circuit: { ...circuit, components: all, wires: [...circuit.wires, ...newWires] }, ids: added.map((c) => c.id) };
}

export function alignComponents(comps: PlacedComponent[], ids: string[], mode: AlignMode, grid: number): PlacedComponent[] {
  const s = new Set(ids);
  const g = comps.filter((c) => s.has(c.id));
  if (g.length < 2) return comps;
  const xs = g.map((c) => c.x), zs = g.map((c) => c.z);
  const target: Record<AlignMode, { axis: 'x' | 'z'; v: number }> = {
    left: { axis: 'x', v: Math.min(...xs) },
    right: { axis: 'x', v: Math.max(...xs) },
    top: { axis: 'z', v: Math.min(...zs) },
    bottom: { axis: 'z', v: Math.max(...zs) },
    hcenter: { axis: 'x', v: snap((Math.min(...xs) + Math.max(...xs)) / 2, grid) },
    vcenter: { axis: 'z', v: snap((Math.min(...zs) + Math.max(...zs)) / 2, grid) },
  };
  const { axis, v } = target[mode];
  return comps.map((c) => (s.has(c.id) ? { ...c, [axis]: v } : c));
}

/** even spacing along one axis between the two outermost parts (needs >= 3); ties keep input order */
export function distributeComponents(comps: PlacedComponent[], ids: string[], axis: DistributeAxis, grid: number): PlacedComponent[] {
  const s = new Set(ids);
  const sorted = comps.map((c, i) => ({ c, i })).filter((o) => s.has(o.c.id)).sort((p, q) => p.c[axis] - q.c[axis] || p.i - q.i);
  if (sorted.length < 3) return comps;
  const lo = sorted[0].c[axis], hi = sorted[sorted.length - 1].c[axis];
  const pos = new Map<string, number>();
  sorted.forEach((o, k) => pos.set(o.c.id, k === 0 ? lo : k === sorted.length - 1 ? hi : snap(lo + ((hi - lo) * k) / (sorted.length - 1), grid)));
  return comps.map((c) => (pos.has(c.id) ? { ...c, [axis]: pos.get(c.id)! } : c));
}
