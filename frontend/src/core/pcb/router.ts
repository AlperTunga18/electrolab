import type { Circuit } from '../circuit/types';
import { worldPads, type WorldPad } from './design';
import { classOfKey, netKeys } from './netclass';
import { signedInsideDist } from './geom';
import { deriveFollower, findDiffPairs, type DiffPairResult } from './diffpair';
import type { CopperLayer, NetClass, PcbDesign, Track, Via } from './types';

/**
 * Grid maze autorouter (two copper layers, Manhattan moves, A* with bend and via penalties).
 *
 * - Only NEW copper is returned; existing tracks/vias/pads of `design` are obstacles for other nets and already-connected
 *   copper for their own net (existing copper of a net is grouped by touching geometry, groups are joined by new copper).
 * - Nets with a copper-pour zone anchored on them are SKIPPED (the pour connects them). Zones are otherwise ignored.
 * - Inner layers (4-layer boards) are planes and carry no tracks.
 * - Clearance is guaranteed by construction: every obstacle is inflated by clearance + half track width (+ a small
 *   sagitta margin so a grid step cannot clip a rounded corner), vias use their own larger radius.
 * - Unroutable connections are reported in `failed`, never forced.
 * Net classes: each net routes with the track width and via size of its class and keeps max(own class, obstacle class)
 * clearance; one occupancy grid per class in use (a single class behaves exactly like before).
 * Options (all default to the old behaviour, so existing results are unchanged):
 * - diagonal: 8-direction (octile) search, 45-degree moves. Safety: the occupancy margin (sagitta) is doubled because a diagonal
 *   step is sqrt(2) longer, a diagonal step also needs both flanking cells free (no corner cutting through a gap).
 * - ripupRounds: when connections fail, up to N more passes are made on a clean grid; failed nets are routed first and (from
 *   round 2) the other nets are shuffled with a seeded PRNG (deterministic). The best pass (fewest failures) wins, so the result
 *   is never worse than the first pass. This is order-based retry, NOT push-and-shove.
 * - diffPairs: derive differential pairs (see diffpair.ts).
 * Limits: no push-and-shove, no length matching/tuning, no teardrops, greedy net order.
 */

export interface RouteOptions {
  /** grid pitch in mm (default 0.25) */
  gridMm?: number;
  /** route only the first N nets in routing order */
  maxNets?: number;
  /** allow 45-degree moves (default false) */
  diagonal?: boolean;
  /** extra rip-up/retry passes for failed connections (default 0) */
  ripupRounds?: number;
  /** seed of the retry shuffle (default 1) */
  seed?: number;
  /** derive differential pairs found by findDiffPairs (default false) */
  diffPairs?: boolean;
}

export interface RouteFailure {
  net: number;
  a: { comp: string; pin: string };
  b: { comp: string; pin: string };
}

export interface RouteResult {
  tracks: Track[];
  vias: Via[];
  failed: RouteFailure[];
  /** number of connections (spanning-tree edges) successfully routed */
  routed: number;
  /** passes made (1 + retry rounds that ran); only set when ripupRounds > 0 */
  passes?: number;
  /** differential pair outcomes; only set when diffPairs is on and pairs exist */
  diffPairs?: DiffPairResult[];
}

const COST_STEP = 10;
const COST_DIAG = COST_STEP * Math.SQRT2;
const COST_BEND = 8;
const COST_VIA = 60;
const BLOCK = 1;
const LAYERS: CopperLayer[] = ['top', 'bottom'];

// ---------- geometry ----------
function distPtSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

function distSegSeg(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): number {
  const o1 = orient(a[0], a[1], b[0], b[1], c[0], c[1]), o2 = orient(a[0], a[1], b[0], b[1], d[0], d[1]);
  const o3 = orient(c[0], c[1], d[0], d[1], a[0], a[1]), o4 = orient(c[0], c[1], d[0], d[1], b[0], b[1]);
  if (o1 * o2 < 0 && o3 * o4 < 0) return 0;
  return Math.min(
    distPtSeg(a[0], a[1], c[0], c[1], d[0], d[1]), distPtSeg(b[0], b[1], c[0], c[1], d[0], d[1]),
    distPtSeg(c[0], c[1], a[0], a[1], b[0], b[1]), distPtSeg(d[0], d[1], a[0], a[1], b[0], b[1]),
  );
}

/** distance from a point to the pad copper (0 inside). Ovals are treated as their bounding rectangle. */
function padDist(p: WorldPad, x: number, y: number): number {
  if (p.shape === 'circle') return Math.max(Math.hypot(x - p.x, y - p.y) - p.w / 2, 0);
  const dx = Math.max(Math.abs(x - p.x) - p.w / 2, 0), dy = Math.max(Math.abs(y - p.y) - p.h / 2, 0);
  return Math.hypot(dx, dy);
}

function polyPadDist(pts: [number, number][], p: WorldPad): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 0.05));
    for (let k = 0; k <= n; k++) best = Math.min(best, padDist(p, x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n));
  }
  if (pts.length === 1) best = padDist(p, pts[0][0], pts[0][1]);
  return best;
}

function polyPolyDist(a: [number, number][], b: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < a.length; i++) for (let j = 0; j + 1 < b.length; j++) best = Math.min(best, distSegSeg(a[i], a[i + 1], b[j], b[j + 1]));
  return best;
}

function polyPtDist(pts: [number, number][], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) best = Math.min(best, distPtSeg(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  return best;
}

class UnionFind {
  private p: number[];
  constructor(n: number) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(i: number): number { while (this.p[i] !== i) { this.p[i] = this.p[this.p[i]]; i = this.p[i]; } return i; }
  union(a: number, b: number): void { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p[Math.max(ra, rb)] = Math.min(ra, rb); }
}

class MinHeap {
  private f = new Float64Array(1 << 14);
  private s = new Int32Array(1 << 14);
  n = 0;
  topF = 0;
  topS = 0;
  clear(): void { this.n = 0; }
  push(f: number, s: number): void {
    if (this.n === this.f.length) {
      const nf = new Float64Array(this.n * 2); nf.set(this.f); this.f = nf;
      const ns = new Int32Array(this.n * 2); ns.set(this.s); this.s = ns;
    }
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[p] <= f) break;
      this.f[i] = this.f[p]; this.s[i] = this.s[p]; i = p;
    }
    this.f[i] = f; this.s[i] = s;
  }
  pop(): void {
    this.topF = this.f[0]; this.topS = this.s[0];
    const n = --this.n;
    if (n === 0) return;
    const f = this.f[n], s = this.s[n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && this.f[c + 1] < this.f[c]) c++;
      if (this.f[c] >= f) break;
      this.f[i] = this.f[c]; this.s[i] = this.s[c]; i = c;
    }
    this.f[i] = f; this.s[i] = s;
  }
}

// ---------- router ----------
export function autoroute(circuit: Circuit, design: PcbDesign, opts: RouteOptions = {}): RouteResult {
  const rules = design.rules;
  const g = opts.gridMm ?? 0.25;
  const W = design.outline.w, H = design.outline.h;
  const pads = worldPads(circuit, design);
  const keys = netKeys(circuit);
  const classOfNet = (n: number): NetClass => classOfKey(design, n >= 0 ? keys[n] : undefined);
  /** clearance of whatever owns an occupancy cell (owner = net + 2; other owners carry no net -> default) */
  const ownerClr = (owner: number): number => (owner >= 2 && owner < 1_000_000 ? classOfNet(owner - 2).clearance : rules.minClearance);

  const result: RouteResult = { tracks: [], vias: [], failed: [], routed: 0 };
  const nx = Math.floor(W / g) + 1, ny = Math.floor(H / g) + 1, N = nx * ny;
  if (nx < 2 || ny < 2) return result;

  // one occupancy grid pair per net class in use
  interface Occ { occT: Int32Array[]; occV: Int32Array[]; hw: number; vr: number; clr: number; marg: number; cls: NetClass }
  const occs = new Map<string, Occ>();
  for (const p of pads) {
    if (p.net < 0) continue;
    const cls = classOfNet(p.net);
    if (occs.has(cls.name)) continue;
    const hw = cls.width / 2, vr = cls.viaDia / 2, clr = cls.clearance;
    occs.set(cls.name, { occT: [new Int32Array(N), new Int32Array(N)], occV: [new Int32Array(N), new Int32Array(N)], hw, vr, clr, marg: ((opts.diagonal === true ? 2 : 1) * g * g) / (8 * (clr + hw)) + 1e-4, cls });
  }
  const put = (arr: Int32Array, i: number, owner: number): void => {
    const v = arr[i];
    if (v === 0) arr[i] = owner; else if (v !== owner && v !== BLOCK) arr[i] = BLOCK;
  };

  /** mark every cell within rT / rV of a shape (dist(x,y) = distance to the shape) on one layer */
  const mark = (o: Occ, layer: number, minx: number, miny: number, maxx: number, maxy: number, dist: (x: number, y: number) => number, objHalf: number, owner: number): void => {
    const c0 = Math.max(o.clr, ownerClr(owner));
    const rT = c0 + o.hw + objHalf + o.marg, rV = c0 + o.vr + objHalf + o.marg;
    const r = Math.max(rT, rV);
    const x0 = Math.max(0, Math.ceil((minx - r) / g)), x1 = Math.min(nx - 1, Math.floor((maxx + r) / g));
    const y0 = Math.max(0, Math.ceil((miny - r) / g)), y1 = Math.min(ny - 1, Math.floor((maxy + r) / g));
    for (let iy = y0; iy <= y1; iy++) for (let ix = x0; ix <= x1; ix++) {
      const d = dist(ix * g, iy * g);
      const c = iy * nx + ix;
      if (d <= rT) put(o.occT[layer], c, owner);
      if (d <= rV) put(o.occV[layer], c, owner);
    }
  };

  // board edge keep-out (cells outside a polygon board are blocked too)
  const bpoly = design.outline.poly && design.outline.poly.length >= 3 ? design.outline.poly : null;
  for (const o of occs.values()) {
    const mT = rules.edgeClearance + o.hw + o.marg, mV = rules.edgeClearance + o.vr + o.marg;
    for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
      const x = ix * g, y = iy * g, e = bpoly ? signedInsideDist(bpoly, x, y) : Math.min(x, y, W - x, H - y), c = iy * nx + ix; // polygon board: negative outside
      for (let l = 0; l < 2; l++) { if (e < mT) o.occT[l][c] = BLOCK; if (e < mV) o.occV[l][c] = BLOCK; }
    }
  }

  // NPTH mounting holes: keep copper at least the edge clearance away from the hole wall
  for (const o of occs.values()) for (const m of design.holes ?? []) {
    const rT = m.drill / 2 + rules.edgeClearance + o.hw + o.marg, rV = m.drill / 2 + rules.edgeClearance + o.vr + o.marg, r = Math.max(rT, rV);
    for (let iy = Math.max(0, Math.ceil((m.y - r) / g)); iy <= Math.min(ny - 1, Math.floor((m.y + r) / g)); iy++) {
      for (let ix = Math.max(0, Math.ceil((m.x - r) / g)); ix <= Math.min(nx - 1, Math.floor((m.x + r) / g)); ix++) {
        const d = Math.hypot(ix * g - m.x, iy * g - m.y), c = iy * nx + ix;
        for (let l = 0; l < 2; l++) { if (d <= rT) o.occT[l][c] = BLOCK; if (d <= rV) o.occV[l][c] = BLOCK; }
      }
    }
  }

  // ---- connectivity of existing copper ----
  const P = pads.length, T = design.tracks.length, V = design.vias.length;
  const uf = new UnionFind(P + T + V);
  const tb = design.tracks.map((t) => {
    const xs = t.pts.map((p) => p[0]), ys = t.pts.map((p) => p[1]);
    return [Math.min(...xs) - t.width / 2, Math.min(...ys) - t.width / 2, Math.max(...xs) + t.width / 2, Math.max(...ys) + t.width / 2];
  });
  const E = 1e-6;
  for (let i = 0; i < T; i++) {
    const ti = design.tracks[i];
    for (let j = i + 1; j < T; j++) {
      const tj = design.tracks[j];
      if (ti.layer !== tj.layer) continue;
      if (tb[i][0] > tb[j][2] || tb[j][0] > tb[i][2] || tb[i][1] > tb[j][3] || tb[j][1] > tb[i][3]) continue;
      if (polyPolyDist(ti.pts, tj.pts) <= (ti.width + tj.width) / 2 + E) uf.union(P + i, P + j);
    }
    for (let k = 0; k < P; k++) {
      const p = pads[k];
      if (!p.layers.includes(ti.layer)) continue;
      if (p.x + p.w / 2 < tb[i][0] || p.x - p.w / 2 > tb[i][2] || p.y + p.h / 2 < tb[i][1] || p.y - p.h / 2 > tb[i][3]) continue;
      if (polyPadDist(ti.pts, p) <= ti.width / 2 + E) uf.union(P + i, k);
    }
    for (let v = 0; v < V; v++) {
      const via = design.vias[v];
      if (polyPtDist(ti.pts, via.x, via.y) <= ti.width / 2 + via.dia / 2 + E) uf.union(P + i, P + T + v);
    }
  }
  for (let v = 0; v < V; v++) {
    const via = design.vias[v];
    for (let k = 0; k < P; k++) if (padDist(pads[k], via.x, via.y) <= via.dia / 2 + E) uf.union(P + T + v, k);
    for (let w = v + 1; w < V; w++) if (Math.hypot(via.x - design.vias[w].x, via.y - design.vias[w].y) <= (via.dia + design.vias[w].dia) / 2 + E) uf.union(P + T + v, P + T + w);
  }
  const compNet = new Map<number, number>();
  for (let k = 0; k < P; k++) { const r = uf.find(k); if (pads[k].net >= 0 && !compNet.has(r)) compNet.set(r, pads[k].net); }
  const padOwner = (k: number): number => (pads[k].net >= 0 ? pads[k].net + 2 : 1_000_000 + k);
  const itemOwner = (item: number): number => { const n = compNet.get(uf.find(item)); return n !== undefined ? n + 2 : 2_000_000 + item; };

  // ---- fixed obstacles ----
  for (let k = 0; k < P; k++) {
    const p = pads[k], owner = padOwner(k);
    for (const o of occs.values()) for (const ly of p.layers) mark(o, LAYERS.indexOf(ly), p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2, (x, y) => padDist(p, x, y), 0, owner);
  }
  const markPoly = (layer: number, pts: [number, number][], w: number, owner: number): void => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      for (const o of occs.values()) mark(o, layer, Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2), (x, y) => distPtSeg(x, y, x1, y1, x2, y2), w / 2, owner);
    }
  };
  const markVia = (x: number, y: number, dia: number, owner: number): void => {
    for (const o of occs.values()) for (let l = 0; l < 2; l++) mark(o, l, x, y, x, y, (cx, cy) => Math.hypot(cx - x, cy - y), dia / 2, owner);
  };
  design.tracks.forEach((t, i) => markPoly(LAYERS.indexOf(t.layer), t.pts, t.width, itemOwner(P + i)));
  design.vias.forEach((v, i) => markVia(v.x, v.y, v.dia, itemOwner(P + T + i)));

  // ---- node helpers (node = layer * N + cell) ----
  const clampCell = (x: number, y: number): number => Math.max(0, Math.min(ny - 1, Math.round(y / g))) * nx + Math.max(0, Math.min(nx - 1, Math.round(x / g)));
  const nodesWhere = (layer: number, minx: number, miny: number, maxx: number, maxy: number, inside: (x: number, y: number) => boolean, out: Set<number>): number => {
    let found = 0;
    const x0 = Math.max(0, Math.ceil(minx / g)), x1 = Math.min(nx - 1, Math.floor(maxx / g));
    const y0 = Math.max(0, Math.ceil(miny / g)), y1 = Math.min(ny - 1, Math.floor(maxy / g));
    for (let iy = y0; iy <= y1; iy++) for (let ix = x0; ix <= x1; ix++) if (inside(ix * g, iy * g)) { out.add(layer * N + iy * nx + ix); found++; }
    return found;
  };
  const padNodes = (k: number, out: Set<number>): void => {
    const p = pads[k];
    for (const ly of p.layers) {
      const l = LAYERS.indexOf(ly);
      if (nodesWhere(l, p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2, (x, y) => padDist(p, x, y) <= 1e-9, out) === 0) out.add(l * N + clampCell(p.x, p.y));
    }
  };
  const polyNodes = (layer: number, pts: [number, number][], w: number, out: Set<number>): void => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      const r = w / 2 + 1e-9;
      nodesWhere(layer, Math.min(x1, x2) - r, Math.min(y1, y2) - r, Math.max(x1, x2) + r, Math.max(y1, y2) + r, (x, y) => distPtSeg(x, y, x1, y1, x2, y2) <= r, out);
    }
    for (const [x, y] of pts) out.add(layer * N + clampCell(x, y));
  };
  const viaNodes = (v: Via, out: Set<number>): void => {
    for (let l = 0; l < 2; l++) {
      if (nodesWhere(l, v.x - v.dia / 2, v.y - v.dia / 2, v.x + v.dia / 2, v.y + v.dia / 2, (x, y) => Math.hypot(x - v.x, y - v.y) <= v.dia / 2, out) === 0) out.add(l * N + clampCell(v.x, v.y));
    }
  };

  // ---- A* ----
  const diagonal = opts.diagonal === true;
  const K = 9; // states per node: direction 0..3 orthogonal, 4 = none (start / layer change), 5..8 diagonal
  const S = 2 * N * K;
  const gArr = new Float32Array(S);
  const gStamp = new Uint32Array(S);
  const cStamp = new Uint32Array(S);
  const parent = new Int32Array(S);
  const tStamp = new Uint32Array(2 * N);
  const heap = new MinHeap();
  let gen = 0;
  const DX = [1, -1, 0, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 0, 1, -1, 1, -1];
  const DIRS = diagonal ? [0, 1, 2, 3, 5, 6, 7, 8] : [0, 1, 2, 3];
  const SQ = Math.SQRT2 - 1;

  const search = (sources: number[], targets: number[], own: number, occT: Int32Array[], occV: Int32Array[]): number[] | null => {
    gen++;
    heap.clear();
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const t of targets) {
      tStamp[t] = gen;
      const c = t >= N ? t - N : t, ix = c % nx, iy = (c / nx) | 0;
      if (ix < bx0) bx0 = ix; if (ix > bx1) bx1 = ix; if (iy < by0) by0 = iy; if (iy > by1) by1 = iy;
    }
    /** admissible estimate: Manhattan (orthogonal) or octile (diagonal) distance to the target bounding box */
    const heur = (ix: number, iy: number): number => {
      const ddx = Math.max(bx0 - ix, 0, ix - bx1), ddy = Math.max(by0 - iy, 0, iy - by1);
      return (diagonal ? Math.max(ddx, ddy) + SQ * Math.min(ddx, ddy) : ddx + ddy) * COST_STEP;
    };
    for (const s0 of sources) {
      const s = s0 * K + 4;
      if (gStamp[s] === gen) continue;
      gStamp[s] = gen; gArr[s] = 0; parent[s] = -1;
      const c = s0 >= N ? s0 - N : s0, ix = c % nx, iy = (c / nx) | 0;
      heap.push(heur(ix, iy), s);
    }
    while (heap.n > 0) {
      heap.pop();
      const s = heap.topS;
      if (cStamp[s] === gen) continue;
      cStamp[s] = gen;
      const node = (s / K) | 0, dir = s - node * K;
      if (tStamp[node] === gen) {
        const path: number[] = [];
        for (let q = s; q >= 0; q = parent[q]) path.push((q / K) | 0);
        return path.reverse();
      }
      const layer = node >= N ? 1 : 0, cell = node - layer * N, ix = cell % nx, iy = (cell / nx) | 0;
      const gc = gArr[s];
      for (const d of DIRS) {
        const jx = ix + DX[d], jy = iy + DY[d];
        if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) continue;
        const nc = jy * nx + jx, ov = occT[layer][nc];
        if (ov !== 0 && ov !== own) continue;
        if (d >= 5) { // diagonal: both flanking cells must be free (no squeezing through a corner gap)
          const f1 = occT[layer][iy * nx + jx], f2 = occT[layer][jy * nx + ix];
          if ((f1 !== 0 && f1 !== own) || (f2 !== 0 && f2 !== own)) continue;
        }
        const nn = layer * N + nc, ns = nn * K + d;
        if (cStamp[ns] === gen) continue;
        const ng = gc + (d < 4 ? COST_STEP : COST_DIAG) + (dir !== 4 && dir !== d ? COST_BEND : 0);
        if (gStamp[ns] !== gen || ng < gArr[ns]) {
          gStamp[ns] = gen; gArr[ns] = ng; parent[ns] = s;
          heap.push(ng + heur(jx, jy), ns);
        }
      }
      // layer change
      const ol = 1 - layer, o = occV[layer][cell], o2 = occV[ol][cell];
      if ((o === 0 || o === own) && (o2 === 0 || o2 === own)) {
        const t2 = occT[ol][cell];
        if (t2 === 0 || t2 === own) {
          const ns = (ol * N + cell) * K + 4;
          if (cStamp[ns] !== gen) {
            const ng = gc + COST_VIA;
            if (gStamp[ns] !== gen || ng < gArr[ns]) {
              gStamp[ns] = gen; gArr[ns] = ng; parent[ns] = s;
              heap.push(ng + heur(ix, iy), ns);
            }
          }
        }
      }
    }
    return null;
  };

  // ---- nets ----
  const zoneNets = new Set<number>();
  for (const z of design.zones) {
    const a = pads.find((p) => p.comp === z.anchor.comp && p.pin === z.anchor.pin);
    if (a && a.net >= 0) zoneNets.add(a.net);
  }
  const byNet = new Map<number, number[]>();
  pads.forEach((p, k) => { if (p.net >= 0) (byNet.get(p.net) ?? byNet.set(p.net, []).get(p.net)!).push(k); });
  const hpwl = (ks: number[]): number => {
    const xs = ks.map((k) => pads[k].x), ys = ks.map((k) => pads[k].y);
    return Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys);
  };
  let order = [...byNet.entries()].filter(([n, ks]) => ks.length >= 2 && !zoneNets.has(n));
  order.sort((a, b) => a[1].length - b[1].length || hpwl(a[1]) - hpwl(b[1]) || a[0] - b[0]);
  if (opts.maxNets !== undefined) order = order.slice(0, Math.max(0, opts.maxNets));

  // differential pairs: lead = the _P net (or the user's first net), the follower is derived from it
  const inOrder = new Set(order.map(([n]) => n));
  const leadPairs = new Map<number, { n: number; gap: number }>();
  const followers = new Set<number>();
  const preFailed: DiffPairResult[] = [];
  if (opts.diffPairs) {
    for (const pr of findDiffPairs(circuit, design)) {
      if (!inOrder.has(pr.p) || !inOrder.has(pr.n)) { preFailed.push({ p: pr.p, n: pr.n, gap: pr.gap, status: 'failed', reason: 'net yönlendirme listesinde değil (2 pinden az, zone ile bağlı ya da maxNets dışı)' }); continue; }
      leadPairs.set(pr.p, { n: pr.n, gap: pr.gap }); followers.add(pr.n);
    }
  }

  const baseOcc = [...occs.values()].map((o) => ({ o, t: o.occT.map((a) => a.slice()), v: o.occV.map((a) => a.slice()) }));
  const restoreOcc = (): void => { for (const s of baseOcc) for (let l = 0; l < 2; l++) { s.o.occT[l].set(s.t[l]); s.o.occV[l].set(s.v[l]); } };

  interface Group { pads: number[]; nodes: Set<number>; pts: [number, number][] }

  /** one complete routing pass over `list` on a clean occupancy grid */
  const runPass = (list: [number, number[]][]): RouteResult => {
    restoreOcc();
    const result: RouteResult = { tracks: [], vias: [], failed: [], routed: 0 };
    const pairOut: DiffPairResult[] = [...preFailed];
    const usedIds = new Set<string>([...design.tracks.map((t) => t.id), ...design.vias.map((v) => v.id)]);
    let idN = 0;
    const nextId = (prefix: string): string => { let id: string; do { id = `${prefix}${++idN}`; } while (usedIds.has(id)); usedIds.add(id); return id; };
    const viaKeys = new Set(design.vias.map((v) => `${v.x.toFixed(4)},${v.y.toFixed(4)}`));

    const routeNet = (net: number, netPads: number[]): void => {
      const own = net + 2;
      const cls = classOfNet(net);
      const { occT, occV } = occs.get(cls.name)!;
      const width = cls.width;
      const groupsByRoot = new Map<number, Group>();
      const getGroup = (root: number): Group => groupsByRoot.get(root) ?? (groupsByRoot.set(root, { pads: [], nodes: new Set(), pts: [] }), groupsByRoot.get(root)!);
      for (const k of netPads) {
        const gr = getGroup(uf.find(k));
        gr.pads.push(k); padNodes(k, gr.nodes); gr.pts.push([pads[k].x, pads[k].y]);
      }
      design.tracks.forEach((t, i) => {
        const gr = groupsByRoot.get(uf.find(P + i));
        if (!gr) return;
        polyNodes(LAYERS.indexOf(t.layer), t.pts, t.width, gr.nodes);
        for (const p of t.pts) gr.pts.push([p[0], p[1]]);
      });
      design.vias.forEach((v, i) => {
        const gr = groupsByRoot.get(uf.find(P + T + i));
        if (!gr) return;
        viaNodes(v, gr.nodes); gr.pts.push([v.x, v.y]);
      });
      const groups = [...groupsByRoot.values()].sort((a, b) => a.pads[0] - b.pads[0]);
      if (groups.length < 2) return;

      const sources = new Set<number>(groups[0].nodes);
      const connPts: [number, number][] = [...groups[0].pts];
      const connPads: number[] = [...groups[0].pads];
      const remaining = groups.slice(1);
      const throughOwn = netPads.filter((k) => pads[k].drill > 0);

      while (remaining.length) {
        // nearest remaining group to the connected copper
        let bi = 0, bd = Infinity;
        remaining.forEach((gr, i) => {
          let d = Infinity;
          for (const a of gr.pts) for (const b of connPts) d = Math.min(d, Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]));
          if (d < bd) { bd = d; bi = i; }
        });
        const target = remaining.splice(bi, 1)[0];
        const targets = [...target.nodes].filter((n) => { const l = n >= N ? 1 : 0, v = occT[l][n - l * N]; return v === 0 || v === own; });
        const path = targets.length ? search([...sources], targets, own, occT, occV) : null;
        if (!path) {
          let best = Infinity, pa = connPads[0], pb = target.pads[0];
          for (const b of target.pads) for (const a of connPads) {
            const d = Math.abs(pads[a].x - pads[b].x) + Math.abs(pads[a].y - pads[b].y);
            if (d < best) { best = d; pa = a; pb = b; }
          }
          result.failed.push({ net, a: { comp: pads[pa].comp, pin: pads[pa].pin }, b: { comp: pads[pb].comp, pin: pads[pb].pin } });
          continue;
        }
        result.routed++;

        // path -> polylines + vias
        const pos = (n: number): [number, number] => { const c = n >= N ? n - N : n; return [(c % nx) * g, ((c / nx) | 0) * g]; };
        const lay = (n: number): number => (n >= N ? 1 : 0);
        const runs: { layer: number; pts: [number, number][] }[] = [];
        const newVias: [number, number][] = [];
        let cur = { layer: lay(path[0]), pts: [pos(path[0])] as [number, number][] };
        for (let i = 1; i < path.length; i++) {
          const p = pos(path[i]);
          if (lay(path[i]) !== cur.layer) {
            newVias.push(p);
            runs.push(cur);
            cur = { layer: lay(path[i]), pts: [p] };
          } else cur.pts.push(p);
        }
        runs.push(cur);
        const padAt = (x: number, y: number, layer: number): number => netPads.find((k) => pads[k].layers.includes(LAYERS[layer]) && padDist(pads[k], x, y) <= 1e-9) ?? -1;
        const first = runs[0], last = runs[runs.length - 1];
        const pf = padAt(first.pts[0][0], first.pts[0][1], first.layer);
        if (pf >= 0) first.pts.unshift([pads[pf].x, pads[pf].y]);
        const pl = padAt(last.pts[last.pts.length - 1][0], last.pts[last.pts.length - 1][1], last.layer);
        if (pl >= 0) last.pts.push([pads[pl].x, pads[pl].y]);

        for (const run of runs) {
          const pts: [number, number][] = [];
          for (const p of run.pts) {
            if (pts.length && pts[pts.length - 1][0] === p[0] && pts[pts.length - 1][1] === p[1]) continue;
            while (pts.length >= 2) {
              const a = pts[pts.length - 2], b = pts[pts.length - 1];
              if (Math.abs(orient(a[0], a[1], b[0], b[1], p[0], p[1])) < 1e-9) pts.pop(); else break;
            }
            pts.push([p[0], p[1]]);
          }
          if (pts.length < 2) continue;
          result.tracks.push({ id: nextId('ar-t'), layer: LAYERS[run.layer], width, pts });
          markPoly(run.layer, pts, width, own);
          for (const p of pts) connPts.push(p);
        }
        for (const [x, y] of newVias) {
          const key = `${x.toFixed(4)},${y.toFixed(4)}`;
          if (viaKeys.has(key)) continue;
          if (throughOwn.some((k) => padDist(pads[k], x, y) <= 1e-9)) continue;
          viaKeys.add(key);
          result.vias.push({ id: nextId('ar-v'), x, y, dia: cls.viaDia, drill: cls.viaDrill });
          markVia(x, y, cls.viaDia, own);
        }
        for (const n of path) sources.add(n);
        for (const n of target.nodes) sources.add(n);
        for (const p of target.pts) connPts.push(p);
        for (const k of target.pads) connPads.push(k);
      }
    };

    for (const [net, netPads] of list) {
      if (followers.has(net)) continue; // derived from its lead net (or routed after a failed derivation)
      const t0 = result.tracks.length, v0 = result.vias.length, f0 = result.failed.length;
      routeNet(net, netPads);
      const pr = leadPairs.get(net);
      if (!pr) continue;
      const fPads = byNet.get(pr.n)!;
      const fail = (reason: string): void => {
        pairOut.push({ p: net, n: pr.n, gap: pr.gap, status: 'failed', reason });
        routeNet(pr.n, fPads);
      };
      if (result.failed.length > f0) { fail('ana net yönlendirilemedi'); continue; }
      const d2: PcbDesign = { ...design, tracks: [...design.tracks, ...result.tracks], vias: [...design.vias, ...result.vias] };
      const r = deriveFollower({ circuit, design: d2, lead: result.tracks.slice(t0), leadVias: result.vias.length - v0, followerPads: fPads.map((k) => pads[k]), gap: pr.gap, width: classOfNet(pr.n).width, id: nextId('ar-t') });
      if (!r.track) { fail(r.reason ?? 'türetilemedi'); continue; }
      result.tracks.push(r.track);
      result.routed++;
      markPoly(LAYERS.indexOf(r.track.layer), r.track.pts, r.track.width, pr.n + 2);
      pairOut.push({ p: net, n: pr.n, gap: pr.gap, status: 'derived' });
    }
    if (pairOut.length) result.diffPairs = pairOut;
    return result;
  };

  let best = runPass(order);
  const rounds = Math.max(0, Math.floor(opts.ripupRounds ?? 0));
  if (rounds > 0) {
    let passes = 1;
    const everFailed = new Set<number>();
    let seed = ((opts.seed ?? 1) >>> 0) || 1;
    const rnd = (): number => { seed = (seed + 0x6d2b79f5) >>> 0; let x = seed; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const shuffle = <T,>(a: T[]): T[] => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
    for (let r = 1; r <= rounds && best.failed.length > 0; r++) {
      for (const f of best.failed) everFailed.add(f.net);
      let head = order.filter(([n]) => everFailed.has(n)), rest = order.filter(([n]) => !everFailed.has(n));
      if (r >= 2) { head = shuffle(head); rest = shuffle(rest); }
      const res = runPass([...head, ...rest]);
      passes++;
      if (res.failed.length < best.failed.length) best = res;
    }
    best.passes = passes;
  }
  return best;
}
