import type { Circuit, PinRef } from '../circuit/types';
import { getDef, hasDef } from '../../library/components';
import { pinPos, rotateDir, rotatePoint, symbolFor, type Dir } from './symbols';
import { pinPoint, type Layout, type SchRot } from './layout';

const DV: Record<Dir, [number, number]> = { l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] };
const OPP: Record<Dir, Dir> = { l: 'r', r: 'l', u: 'd', d: 'u' };
const GAP = 40;

/** rotation (quarter turns clockwise) after which pin `pinId` leaves the symbol towards `facing`; null if the pin is unknown */
export function rotationForPin(type: string, pinId: string, facing: Dir): SchRot | null {
  const sym = symbolFor(getDef(type));
  const p = sym.pins.find((q) => q.id === pinId);
  if (!p) return null;
  for (let r = 0; r < 4; r++) if (rotateDir(p.dir, r) === facing) return r as SchRot;
  return null;
}

/**
 * Where to put a NEW part so that its first pin faces the pin `target` (which is already placed):
 * 40 px from the target pin tip along the target pin's outward direction, rotated so the new pin points back at it.
 * Result is on the 10 px grid (pin tips and offsets are multiples of 10). Null when the target or the type is unusable.
 */
export function suggestPlacement(circuit: Circuit, layout: Layout, target: PinRef, type: string): { x: number; y: number; rot: SchRot } | null {
  if (!hasDef(type)) return null;
  const T = pinPoint(circuit, layout, target);
  if (!T) return null;
  const sym = symbolFor(getDef(type));
  const first = sym.pins[0];
  if (!first) return null;
  const rot = rotationForPin(type, first.id, OPP[T.pt.dir]);
  if (rot === null) return null;
  const q = rotatePoint(first.x, first.y, rot);
  const d = DV[T.pt.dir];
  return { x: T.pt.x + d[0] * GAP - q.x, y: T.pt.y + d[1] * GAP - q.y, rot };
}

/**
 * Best rotation for an existing part: minimises, over its wired pins, the Manhattan distance to the other end,
 * with a penalty when the pin leaves the symbol AWAY from that other end. Ties keep the current rotation, then the lower one.
 */
export function bestRotation(circuit: Circuit, layout: Layout, id: string): SchRot {
  const c = circuit.components.find((q) => q.id === id);
  const l = layout[id];
  if (!c || !l || !hasDef(c.type)) return (l?.rot ?? 0) as SchRot;
  const sym = symbolFor(getDef(c.type));
  const links: { pin: string; ox: number; oy: number }[] = [];
  for (const w of circuit.wires) {
    const mine = w.a.comp === id ? w.a : w.b.comp === id ? w.b : null;
    if (!mine || (w.a.comp === id && w.b.comp === id)) continue;
    const other = pinPoint(circuit, layout, mine === w.a ? w.b : w.a);
    if (other) links.push({ pin: mine.pin, ox: other.pt.x, oy: other.pt.y });
  }
  if (!links.length) return l.rot;
  const score = (rot: number): number => {
    let s = 0;
    for (const k of links) {
      const p = pinPos(sym, rot, l.x, l.y, k.pin);
      const dx = k.ox - p.x, dy = k.oy - p.y;
      s += Math.abs(dx) + Math.abs(dy);
      if (DV[p.dir][0] * dx + DV[p.dir][1] * dy < 0) s += 60; // pin points away from where the wire goes
    }
    return s;
  };
  let best: number = l.rot, bs = score(l.rot);
  for (let r = 0; r < 4; r++) {
    const sc = score(r);
    if (sc < bs - 1e-9) { bs = sc; best = r; }
  }
  return best as SchRot;
}
