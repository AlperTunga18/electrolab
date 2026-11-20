import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import type { Circuit } from '../circuit/types';
import { EXAMPLES } from '../../examples/examples';
import { autoPlace, worldPads, type WorldPad } from './design';
import { autoroute } from './router';
import type { PcbDesign, Track, Via } from './types';

// ---------- independent geometry / checker (does not use router internals) ----------
const dPtSeg = (px: number, py: number, a: [number, number], b: [number, number]): number => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0;
  return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
};
const cross = (a: [number, number], b: [number, number], c: [number, number]): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const dSegSeg = (a: [number, number], b: [number, number], c: [number, number], d: [number, number]): number => {
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0;
  return Math.min(dPtSeg(a[0], a[1], c, d), dPtSeg(b[0], b[1], c, d), dPtSeg(c[0], c[1], a, b), dPtSeg(d[0], d[1], a, b));
};
const dPad = (p: WorldPad, x: number, y: number): number =>
  p.shape === 'circle' ? Math.max(Math.hypot(x - p.x, y - p.y) - p.w / 2, 0)
    : Math.hypot(Math.max(Math.abs(x - p.x) - p.w / 2, 0), Math.max(Math.abs(y - p.y) - p.h / 2, 0));
const dPolyPad = (t: Track, p: WorldPad): number => {
  let m = Infinity;
  for (let i = 0; i + 1 < t.pts.length; i++) {
    const [a, b] = [t.pts[i], t.pts[i + 1]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.02));
    for (let k = 0; k <= n; k++) m = Math.min(m, dPad(p, a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n));
  }
  return m;
};
const dPolyPoly = (s: Track, t: Track): number => {
  let m = Infinity;
  for (let i = 0; i + 1 < s.pts.length; i++) for (let j = 0; j + 1 < t.pts.length; j++) m = Math.min(m, dSegSeg(s.pts[i], s.pts[i + 1], t.pts[j], t.pts[j + 1]));
  return m;
};
const dPolyPt = (t: Track, x: number, y: number): number => {
  let m = Infinity;
  for (let i = 0; i + 1 < t.pts.length; i++) m = Math.min(m, dPtSeg(x, y, t.pts[i], t.pts[i + 1]));
  return m;
};

function analyze(circuit: Circuit, design: PcbDesign, tracks: Track[], vias: Via[]) {
  const pads = worldPads(circuit, design);
  const P = pads.length, T = tracks.length, n = P + T + vias.length;
  const par = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const uni = (a: number, b: number): void => { par[find(a)] = find(b); };
  const E = 1e-6;
  tracks.forEach((t, i) => {
    tracks.forEach((u, j) => { if (j > i && u.layer === t.layer && dPolyPoly(t, u) <= (t.width + u.width) / 2 + E) uni(P + i, P + j); });
    pads.forEach((p, k) => { if (p.layers.includes(t.layer) && dPolyPad(t, p) <= t.width / 2 + E) uni(P + i, k); });
    vias.forEach((v, j) => { if (dPolyPt(t, v.x, v.y) <= t.width / 2 + v.dia / 2 + E) uni(P + i, P + T + j); });
  });
  vias.forEach((v, j) => pads.forEach((p, k) => { if (dPad(p, v.x, v.y) <= v.dia / 2 + E) uni(P + T + j, k); }));
  // opens: pads of one net in several components; shorts: one component with several nets
  const compsPerNet = new Map<number, Set<number>>();
  const netsPerComp = new Map<number, Set<number>>();
  pads.forEach((p, k) => {
    if (p.net < 0) return;
    (compsPerNet.get(p.net) ?? compsPerNet.set(p.net, new Set()).get(p.net)!).add(find(k));
    (netsPerComp.get(find(k)) ?? netsPerComp.set(find(k), new Set()).get(find(k))!).add(p.net);
  });
  const opens = [...compsPerNet.entries()].filter(([, s]) => s.size > 1).map(([net]) => net);
  const shorts = [...netsPerComp.values()].filter((s) => s.size > 1).length;
  // clearance between copper of different nets
  const netOf = (item: number): number => {
    if (item < P) return pads[item].net >= 0 ? pads[item].net : -1000 - item;
    const r = find(item);
    for (let k = 0; k < P; k++) if (find(k) === r && pads[k].net >= 0) return pads[k].net;
    return -2000 - item;
  };
  const clr = design.rules.minClearance - 1e-3;
  let violations = 0;
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i], nt = netOf(P + i);
    for (let j = i + 1; j < tracks.length; j++) {
      if (tracks[j].layer === t.layer && netOf(P + j) !== nt && dPolyPoly(t, tracks[j]) - (t.width + tracks[j].width) / 2 < clr) violations++;
    }
    pads.forEach((p, k) => { if (p.layers.includes(t.layer) && netOf(k) !== nt && dPolyPad(t, p) - t.width / 2 < clr) violations++; });
    vias.forEach((v, j) => { if (netOf(P + T + j) !== nt && dPolyPt(t, v.x, v.y) - t.width / 2 - v.dia / 2 < clr) violations++; });
  }
  vias.forEach((v, j) => {
    const nv = netOf(P + T + j);
    pads.forEach((p, k) => { if (netOf(k) !== nv && dPad(p, v.x, v.y) - v.dia / 2 < clr) violations++; });
    vias.forEach((w, m) => { if (m > j && netOf(P + T + m) !== nv && Math.hypot(v.x - w.x, v.y - w.y) - (v.dia + w.dia) / 2 < clr) violations++; });
  });
  return { opens, shorts, violations };
}

function placePadAt(circuit: Circuit, design: PcbDesign, comp: string, pin: string, x: number, y: number, rot: 0 | 90 | 180 | 270): void {
  design.placements[comp] = { x: 0, y: 0, rot, side: 'top' };
  const wp = worldPads(circuit, design).find((p) => p.comp === comp && p.pin === pin)!;
  design.placements[comp] = { x: x - wp.x, y: y - wp.y, rot, side: 'top' };
}

describe('autoroute', () => {
  it('routes two resistors in series completely', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 5 }, 0, 0, 0, 'V1');
    b.add('resistor', { r: 100 });
    b.add('resistor', { r: 200 });
    b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'R2.1'); b.chain('R2.2', 'V1.N');
    const design = autoPlace(b.circuit);
    const res = autoroute(b.circuit, design);
    expect(res.failed).toEqual([]);
    expect(res.routed).toBe(3);
    const a = analyze(b.circuit, design, res.tracks, res.vias);
    expect(a.opens).toEqual([]);
    expect(a.shorts).toBe(0);
    expect(a.violations).toBe(0);
  });

  it('crosses another net on the other layer with vias and keeps clearance', () => {
    const b = new CircuitBuilder();
    for (const t of ['R1', 'R2', 'R3', 'R4']) b.add('r_smd0805_1k', {}, 0, 0, 0, t);
    b.chain('R1.2', 'R2.1'); b.chain('R3.1', 'R4.1');
    const design = autoPlace(b.circuit);
    design.outline = { w: 20, h: 20 };
    placePadAt(b.circuit, design, 'R1', '2', 3.5, 10, 0);
    placePadAt(b.circuit, design, 'R2', '1', 16.5, 10, 0);
    placePadAt(b.circuit, design, 'R3', '1', 9, 3, 0);
    placePadAt(b.circuit, design, 'R4', '1', 9, 17, 0);
    const res = autoroute(b.circuit, design);
    expect(res.failed).toEqual([]);
    expect(res.vias.length).toBeGreaterThanOrEqual(2);
    expect(new Set(res.tracks.map((t) => t.layer)).size).toBe(2);
    const a = analyze(b.circuit, design, res.tracks, res.vias);
    expect(a.opens).toEqual([]);
    expect(a.shorts).toBe(0);
    expect(a.violations).toBe(0);
  });

  it('reports a pad walled in by other-net pads as failed', () => {
    const b = new CircuitBuilder();
    for (const t of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']) b.add('resistor', {}, 0, 0, 0, t);
    b.chain('R1.1', 'R2.1');
    const design = autoPlace(b.circuit);
    design.outline = { w: 80, h: 80 };
    const cx = 40, cy = 40;
    placePadAt(b.circuit, design, 'R2', '1', cx, cy, 0);
    placePadAt(b.circuit, design, 'R1', '1', 10, 10, 0);
    ['R3', 'R4', 'R5', 'R6', 'R7', 'R8'].forEach((id, i) => {
      const ang = (Math.PI / 3) * i;
      placePadAt(b.circuit, design, id, '1', cx + 2.2 * Math.cos(ang), cy + 2.2 * Math.sin(ang), (i % 2 ? 90 : 0));
    });
    // keep the ring parts' other pads away from the centre
    const res = autoroute(b.circuit, design);
    expect(res.failed.length).toBe(1);
    expect(res.failed[0].a.comp === 'R1' || res.failed[0].b.comp === 'R1').toBe(true);
    expect(res.tracks).toEqual([]);
  });

  it('is deterministic', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 5 }, 0, 0, 0, 'V1');
    b.add('resistor', { r: 100 }); b.add('resistor', { r: 200 });
    b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'R2.1'); b.chain('R2.2', 'V1.N');
    const design = autoPlace(b.circuit);
    expect(JSON.stringify(autoroute(b.circuit, design))).toBe(JSON.stringify(autoroute(b.circuit, design)));
  });

  it('routes the LED example completely', () => {
    const circuit = EXAMPLES.find((e) => e.id === 'led')!.build();
    const design = autoPlace(circuit);
    const t0 = Date.now();
    const res = autoroute(circuit, design);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(res.failed).toEqual([]);
    const a = analyze(circuit, design, res.tracks, res.vias);
    expect(a.opens).toEqual([]);
    expect(a.shorts).toBe(0);
    expect(a.violations).toBe(0);
  });
});
