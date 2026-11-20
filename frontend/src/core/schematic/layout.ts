import type { Circuit, PlacedComponent } from '../circuit/types';
import { getDef, hasDef } from '../../library/components';
import { pinPos, symbolBounds, symbolFor } from './symbols';
import type { Dir } from './symbols';

export type SchRot = 0 | 1 | 2 | 3;
export type Layout = Record<string, { x: number; y: number; rot: SchRot }>;
export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface RoutedWire { wireId: string; pts: [number, number][] }

const GRID = 10;
const COL_PITCH = 120;
const ROW_PITCH = 100;
const MARGIN = 10; // minimum clear gap between symbol bounds (text room)

const snap = (v: number): number => Math.round(v / GRID) * GRID;
const snapUp = (v: number): number => Math.ceil(v / GRID) * GRID;

const symOf = (c: PlacedComponent) => symbolFor(getDef(c.type));

/** world-space bounds of a placed component */
export function boxOf(c: PlacedComponent, l: { x: number; y: number; rot: SchRot }): Box {
  const b = symbolBounds(symOf(c), l.rot);
  return { x0: l.x + b.x0, y0: l.y + b.y0, x1: l.x + b.x1, y1: l.y + b.y1 };
}

export const boxesOverlap = (a: Box, b: Box, gap = 0): boolean =>
  a.x0 - gap / 2 < b.x1 + gap / 2 && a.x1 + gap / 2 > b.x0 - gap / 2 && a.y0 - gap / 2 < b.y1 + gap / 2 && a.y1 + gap / 2 > b.y0 - gap / 2;

const DV: Record<Dir, [number, number]> = { l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] };

/**
 * Deterministic schematic layout. Sources in column 0, other parts in columns by BFS distance,
 * ground symbols directly below the pin they connect to. Parts with `sch` keep their placement when `keep`.
 */
export function autoLayout(circuit: Circuit, keep = true): Layout {
  const out: Layout = {};
  const comps = circuit.components.filter((c) => hasDef(c.type));
  const byId = new Map(comps.map((c) => [c.id, c]));
  const placed: Box[] = [];
  const isGround = (c: PlacedComponent) => getDef(c.type).model === 'ground';
  const kept = new Set<string>();

  if (keep) {
    for (const c of comps) {
      if (!c.sch) continue;
      out[c.id] = { x: c.sch.x, y: c.sch.y, rot: c.sch.rot };
      placed.push(boxOf(c, out[c.id]));
      kept.add(c.id);
    }
  }

  const free = (hw: number, hh: number, x: number, y: number): boolean => {
    const b: Box = { x0: x - hw, y0: y - hh, x1: x + hw, y1: y + hh };
    return !placed.some((p) => boxesOverlap(b, p, MARGIN));
  };
  const place = (c: PlacedComponent, x: number, y: number, sideways: boolean): void => {
    const b = symbolBounds(symOf(c), 0);
    const hw = b.x1, hh = b.y1;
    const dxs = sideways ? [0, 40, -40, 80, -80, 120, -120] : [0];
    for (let dy = 0; dy < 20000; dy += GRID) {
      for (const dx of dxs) {
        if (free(hw, hh, x + dx, y + dy)) {
          out[c.id] = { x: x + dx, y: y + dy, rot: 0 };
          placed.push({ x0: x + dx - hw, y0: y + dy - hh, x1: x + dx + hw, y1: y + dy + hh });
          return;
        }
      }
    }
    out[c.id] = { x, y, rot: 0 };
    placed.push({ x0: x - hw, y0: y - hh, x1: x + hw, y1: y + hh });
  };

  // adjacency between non-ground parts
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    const la = adj.get(a) ?? []; if (!la.includes(b)) la.push(b); adj.set(a, la);
    const lb = adj.get(b) ?? []; if (!lb.includes(a)) lb.push(a); adj.set(b, lb);
  };
  for (const w of circuit.wires) {
    const a = byId.get(w.a.comp), b = byId.get(w.b.comp);
    if (!a || !b || isGround(a) || isGround(b)) continue;
    link(a.id, b.id);
  }

  const normal = comps.filter((c) => !isGround(c));
  const dist = new Map<string, number>();
  const order: string[] = [];
  const bfs = (seeds: string[]) => {
    const q: string[] = [];
    for (const s of seeds) if (!dist.has(s)) { dist.set(s, 0); q.push(s); order.push(s); }
    for (let i = 0; i < q.length; i++) {
      const cur = q[i];
      for (const n of adj.get(cur) ?? []) {
        if (dist.has(n)) continue;
        dist.set(n, dist.get(cur)! + 1); q.push(n); order.push(n);
      }
    }
  };
  bfs(normal.filter((c) => { const m = getDef(c.type).model; return m === 'vsource' || m === 'isource'; }).map((c) => c.id));
  for (const c of normal) if (!dist.has(c.id)) bfs([c.id]);

  const cols = new Map<number, PlacedComponent[]>();
  for (const id of order) {
    if (kept.has(id)) continue;
    const c = byId.get(id)!;
    const d = dist.get(id)!;
    const l = cols.get(d) ?? []; l.push(c); cols.set(d, l);
  }
  const colIdx = [...cols.keys()].sort((a, b) => a - b);
  let prevX = 0, prevHalf = 0;
  colIdx.forEach((ci, k) => {
    const list = cols.get(ci)!;
    const half = Math.max(...list.map((c) => symbolBounds(symOf(c), 0).x1));
    const x = k === 0 ? snapUp(half + 40) : snapUp(Math.max(prevX + COL_PITCH, prevX + prevHalf + half + 60));
    let prevY = -Infinity, prevH = 0;
    for (const c of list) {
      const hh = symbolBounds(symOf(c), 0).y1;
      const y = snapUp(prevY === -Infinity ? Math.max(60, hh + 40) : Math.max(prevY + ROW_PITCH, prevY + prevH + hh + 40));
      place(c, x, y, false);
      prevY = out[c.id].y; prevH = hh;
    }
    prevX = x; prevHalf = half;
  });

  // ground symbols under the pin they connect to
  const grounds = comps.filter((c) => isGround(c) && !kept.has(c.id));
  let fallbackY = placed.length ? Math.max(...placed.map((p) => p.y1)) + 60 : 60;
  for (const g of grounds) {
    let anchor: { x: number; y: number } | null = null;
    for (const w of circuit.wires) {
      let other: { comp: string; pin: string } | null = null;
      if (w.a.comp === g.id) other = w.b; else if (w.b.comp === g.id) other = w.a;
      if (!other) continue;
      const oc = byId.get(other.comp);
      const ol = out[other.comp];
      if (!oc || !ol || isGround(oc)) continue;
      const sym = symOf(oc);
      if (!sym.pins.some((p) => p.id === other!.pin)) continue;
      const t = pinPos(sym, ol.rot, ol.x, ol.y, other.pin);
      anchor = { x: snap(t.x), y: snap(t.y) + 30 };
      break;
    }
    if (anchor) place(g, anchor.x, anchor.y, true);
    else { place(g, 60, fallbackY, true); fallbackY = out[g.id].y + 60; }
  }
  return out;
}

// ---------- wires ----------

export interface PinPt { x: number; y: number; dir: Dir }

export function pinPoint(circuit: Circuit, layout: Layout, ref: { comp: string; pin: string }): { pt: PinPt; comp: string } | null {
  const c = circuit.components.find((q) => q.id === ref.comp);
  const l = layout[ref.comp];
  if (!c || !l || !hasDef(c.type)) return null;
  const sym = symOf(c);
  if (!sym.pins.some((p) => p.id === ref.pin)) return null;
  return { pt: pinPos(sym, l.rot, l.x, l.y, ref.pin), comp: c.id };
}

export type Pt = [number, number];

export function simplify(pts: Pt[]): Pt[] {
  const a: Pt[] = [];
  for (const p of pts) { const l = a[a.length - 1]; if (!l || l[0] !== p[0] || l[1] !== p[1]) a.push(p); }
  const o: Pt[] = [];
  for (const p of a) {
    while (o.length >= 2) {
      const q = o[o.length - 1], r = o[o.length - 2];
      const collinear = (r[0] === q[0] && q[0] === p[0]) || (r[1] === q[1] && q[1] === p[1]);
      if (collinear) o.pop(); else break;
    }
    o.push(p);
  }
  return o;
}

function reverses(pts: Pt[]): boolean {
  for (let i = 1; i + 1 < pts.length; i++) {
    const ax = Math.sign(pts[i][0] - pts[i - 1][0]), ay = Math.sign(pts[i][1] - pts[i - 1][1]);
    const bx = Math.sign(pts[i + 1][0] - pts[i][0]), by = Math.sign(pts[i + 1][1] - pts[i][1]);
    if (ax * bx + ay * by < 0) return true;
  }
  return false;
}

function segHitsBox(a: Pt, b: Pt, box: Box): boolean {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  return x0 < box.x1 - 1 && x1 > box.x0 + 1 && y0 < box.y1 - 1 && y1 > box.y0 + 1;
}

/** orthogonal polylines between pin tips: 10 px stub in the pin direction, then a Manhattan route with the fewest box crossings */
export function routeWires(circuit: Circuit, layout: Layout): RoutedWire[] {
  const boxes = new Map<string, Box>();
  for (const c of circuit.components) {
    const l = layout[c.id];
    if (l && hasDef(c.type)) boxes.set(c.id, boxOf(c, l));
  }
  const res: RoutedWire[] = [];
  for (const w of circuit.wires) {
    if (w.tap) continue; // T-branches are routed by routeAllWires (wiring.ts)
    const A = pinPoint(circuit, layout, w.a), B = pinPoint(circuit, layout, w.b);
    if (!A || !B) continue;
    const pa: Pt = [A.pt.x, A.pt.y], pb: Pt = [B.pt.x, B.pt.y];
    const a1: Pt = [pa[0] + DV[A.pt.dir][0] * GRID, pa[1] + DV[A.pt.dir][1] * GRID];
    const b1: Pt = [pb[0] + DV[B.pt.dir][0] * GRID, pb[1] + DV[B.pt.dir][1] * GRID];
    const mx = snap((a1[0] + b1[0]) / 2), my = snap((a1[1] + b1[1]) / 2);
    const lox = Math.min(a1[0], b1[0]) - 2 * GRID, hix = Math.max(a1[0], b1[0]) + 2 * GRID;
    const loy = Math.min(a1[1], b1[1]) - 2 * GRID, hiy = Math.max(a1[1], b1[1]) + 2 * GRID;
    const mids: Pt[][] = [
      [[b1[0], a1[1]]],
      [[a1[0], b1[1]]],
      [[mx, a1[1]], [mx, b1[1]]],
      [[a1[0], my], [b1[0], my]],
      [[lox, a1[1]], [lox, b1[1]]],
      [[hix, a1[1]], [hix, b1[1]]],
      [[a1[0], loy], [b1[0], loy]],
      [[a1[0], hiy], [b1[0], hiy]],
    ];
    let best: Pt[] | null = null, bestScore = Infinity;
    for (const mid of mids) {
      const raw: Pt[] = [pa, a1, ...mid, b1, pb];
      const rev = reverses(simplifyKeepReverse(raw));
      const pts = simplify(raw);
      let cross = 0;
      for (let i = 0; i + 1 < pts.length; i++) {
        for (const [id, box] of boxes) {
          if (id === A.comp || id === B.comp) continue;
          if (segHitsBox(pts[i], pts[i + 1], box)) cross++;
        }
      }
      let len = 0;
      for (let i = 0; i + 1 < pts.length; i++) len += Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1]);
      const score = cross * 100000 + (rev ? 50000 : 0) + (pts.length - 2) * 30 + len;
      if (score < bestScore) { bestScore = score; best = pts; }
    }
    let pts = best ?? [pa, pb];
    if (pts.length < 2) pts = [pa, pb];
    res.push({ wireId: w.id, pts });
  }
  return res;
}

/** only drop duplicate points (keeps doubling-back visible for the reversal test) */
function simplifyKeepReverse(pts: Pt[]): Pt[] {
  const a: Pt[] = [];
  for (const p of pts) { const l = a[a.length - 1]; if (!l || l[0] !== p[0] || l[1] !== p[1]) a.push(p); }
  return a;
}

/** dots where 3+ items (wire ends + pins) of one net meet at a pin tip */
export function junctions(circuit: Circuit, layout: Layout): [number, number][] {
  const count = new Map<string, { x: number; y: number; ends: number }>();
  for (const w of circuit.wires) {
    for (const r of w.tap ? [w.a] : [w.a, w.b]) { // a T-branch is drawn only at its own pin end; its dot sits on the host wire
      const p = pinPoint(circuit, layout, r);
      if (!p) continue;
      const k = `${p.pt.x},${p.pt.y}`;
      const e = count.get(k) ?? { x: p.pt.x, y: p.pt.y, ends: 0 };
      e.ends++;
      count.set(k, e);
    }
  }
  const out: [number, number][] = [];
  // one pin + 2 or more wire ends = 3+ items
  for (const e of count.values()) if (e.ends >= 2) out.push([e.x, e.y]);
  return out;
}
