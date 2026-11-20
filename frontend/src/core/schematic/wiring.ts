import type { Circuit } from '../circuit/types';
import { hasDef } from '../../library/components';
import { polylineHitsBoxes, routeWire, type Box as RBox } from '../circuit/wireRoute';
import { boxOf, junctions, pinPoint, routeWires, simplify, type Layout, type Pt, type RoutedWire } from './layout';
import type { Dir } from './symbols';

const GRID = 10;
const DV: Record<Dir, [number, number]> = { l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] };

export interface NearPoint { x: number; y: number; seg: number; dist: number }

/** closest point on a polyline (screen coords) to p; `seg` is the index of the segment it lies on */
export function nearestOnPolyline(pts: Pt[], p: { x: number; y: number }): NearPoint | null {
  let best: NearPoint | null = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - x0) * dx + (p.y - y0) * dy) / len2));
    const x = x0 + t * dx, y = y0 + t * dy;
    const dist = Math.hypot(p.x - x, p.y - y);
    if (!best || dist < best.dist - 1e-9) best = { x, y, seg: i, dist };
  }
  return best;
}

/** snap a point lying on an axis-aligned segment to the grid along that segment (the other coordinate is kept) */
export function snapOnSegment(pts: Pt[], n: NearPoint, grid = GRID): { x: number; y: number } {
  const [x0, y0] = pts[n.seg], [x1, y1] = pts[n.seg + 1];
  const clamp = (v: number, a: number, b: number) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), v));
  if (y0 === y1) return { x: clamp(Math.round(n.x / grid) * grid, x0, x1), y: y0 };
  if (x0 === x1) return { x: x0, y: clamp(Math.round(n.y / grid) * grid, y0, y1) };
  return { x: n.x, y: n.y };
}

const isOrtho = (pts: Pt[]): boolean => pts.every((p, i) => i === 0 || p[0] === pts[i - 1][0] || p[1] === pts[i - 1][1]);

export interface WiringOpts { autoRoute?: boolean }
export interface Wiring { routes: RoutedWire[]; dots: [number, number][] }

/**
 * All wire polylines + junction dots of the schematic.
 * - plain wires: layout.ts router; with `autoRoute`, a route that crosses another part's body is replaced by the
 *   A* orthogonal route of core/circuit/wireRoute.ts when that one is clear and axis-aligned.
 * - T-branches (`wire.tap`): drawn from their pin to the nearest point of the host wire's CURRENT route (so they follow
 *   when parts move), final leg perpendicular to the host segment, junction dot at that point.
 */
export function routeAllWires(circuit: Circuit, layout: Layout, opts: WiringOpts = {}): Wiring {
  const plain = circuit.wires.filter((w) => !w.tap);
  const sub: Circuit = { ...circuit, wires: plain };
  let base = routeWires(sub, layout);
  if (opts.autoRoute) base = base.map((r) => improve(circuit, layout, r));
  const dots = junctions(circuit, layout);
  const byWire = new Map(base.map((r) => [r.wireId, r]));
  const out = [...base];

  let pending = circuit.wires.filter((w) => w.tap);
  while (pending.length) {
    const rest: typeof pending = [];
    for (const w of pending) {
      const host = byWire.get(w.tap!.wire);
      const A = pinPoint(circuit, layout, w.a);
      if (!host) { rest.push(w); continue; }
      if (!A) continue;
      const n = nearestOnPolyline(host.pts, { x: w.tap!.x, y: w.tap!.y });
      if (!n) continue;
      const q = snapOnSegment(host.pts, n);
      const pa: Pt = [A.pt.x, A.pt.y];
      const a1: Pt = [pa[0] + DV[A.pt.dir][0] * GRID, pa[1] + DV[A.pt.dir][1] * GRID];
      const hostHoriz = host.pts[n.seg][1] === host.pts[n.seg + 1][1];
      // last leg ends perpendicular to the host segment. Direct L-shape when its first leg leaves the pin in its own direction,
      // otherwise take the 10 px stub first.
      const direct: Pt = hostHoriz ? [q.x, pa[1]] : [pa[0], q.y];
      const forward = DV[A.pt.dir][0] * (direct[0] - pa[0]) + DV[A.pt.dir][1] * (direct[1] - pa[1]) > 0;
      const mid: Pt = hostHoriz ? [q.x, a1[1]] : [a1[0], q.y];
      const r: RoutedWire = { wireId: w.id, pts: forward ? simplify([pa, direct, [q.x, q.y]]) : simplify([pa, a1, mid, [q.x, q.y]]) };
      out.push(r);
      byWire.set(w.id, r);
      dots.push([q.x, q.y]);
    }
    if (rest.length === pending.length) {
      // host missing/unroutable: draw them as ordinary pin-to-pin wires so the connection stays visible
      for (const r of routeWires({ ...circuit, wires: rest.map((w) => ({ ...w, tap: undefined })) }, layout)) out.push(r);
      break;
    }
    pending = rest;
  }
  return { routes: out, dots };
}

function improve(circuit: Circuit, layout: Layout, r: RoutedWire): RoutedWire {
  const w = circuit.wires.find((q) => q.id === r.wireId);
  if (!w) return r;
  const obstacles: RBox[] = [];
  for (const c of circuit.components) {
    const l = layout[c.id];
    if (!l || !hasDef(c.type) || c.id === w.a.comp || c.id === w.b.comp) continue;
    const b = boxOf(c, l);
    obstacles.push({ minX: b.x0, maxX: b.x1, minZ: b.y0, maxZ: b.y1 });
  }
  const asXZ = (pts: Pt[]) => pts.map((p) => ({ x: p[0], z: p[1] }));
  if (!polylineHitsBoxes(asXZ(r.pts), obstacles)) return r;
  const A = pinPoint(circuit, layout, w.a), B = pinPoint(circuit, layout, w.b);
  if (!A || !B) return r;
  const pa: Pt = [A.pt.x, A.pt.y], pb: Pt = [B.pt.x, B.pt.y];
  const a1: Pt = [pa[0] + DV[A.pt.dir][0] * GRID, pa[1] + DV[A.pt.dir][1] * GRID];
  const b1: Pt = [pb[0] + DV[B.pt.dir][0] * GRID, pb[1] + DV[B.pt.dir][1] * GRID];
  const mid = routeWire({ x: a1[0], z: a1[1] }, { x: b1[0], z: b1[1] }, obstacles, GRID).map((p): Pt => [p.x, p.z]);
  const pts = simplify([pa, a1, ...mid, b1, pb]);
  if (!isOrtho(pts) || polylineHitsBoxes(asXZ(pts), obstacles)) return r;
  return { wireId: r.wireId, pts };
}
