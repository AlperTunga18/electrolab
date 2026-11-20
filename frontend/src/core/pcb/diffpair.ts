import type { Circuit } from '../circuit/types';
import { buildNets } from '../circuit/nets';
import { runDrc } from './drc';
import type { WorldPad } from './design';
import { classOfKey, netKeys, netLabel } from './netclass';
import type { PcbDesign, Track } from './types';

/**
 * Simple differential pairs. Two nets form a pair when
 *  - the user selected them (design.diffPairs, stable net keys), or
 *  - both nets belong to a class with `diffGap` and their names end in `_P` / `_N` with the same prefix.
 * The autorouter routes ONE net (the _P net) normally and derives the other as a constant-offset copy of the routed track
 * (miter corners, short straight stubs to the pads), then VERIFIES the result with the DRC. If no candidate passes the
 * DRC the pair is reported as 'failed' with a reason and the partner is routed as an ordinary net.
 * Limits: only 2-pad nets, the lead net must be a single track on one layer without vias, no length/skew matching, no
 * coupled impedance control (the gap is the edge-to-edge distance of the two tracks).
 */

export interface DiffPair {
  /** net indices */
  p: number;
  n: number;
  /** edge-to-edge gap, mm */
  gap: number;
  source: 'auto' | 'user';
}

export interface DiffPairResult {
  p: number;
  n: number;
  gap: number;
  status: 'derived' | 'failed';
  reason?: string;
}

type Pt = [number, number];

export function findDiffPairs(circuit: Circuit, design: PcbDesign): DiffPair[] {
  const keys = netKeys(circuit);
  const names = buildNets(circuit).names;
  const label = (n: number): string => netLabel(design, keys[n], names[n] ?? '');
  const out: DiffPair[] = [];
  const used = new Set<number>();
  const gapOf = (a: number, b: number): number => classOfKey(design, keys[a]).diffGap ?? classOfKey(design, keys[b]).diffGap ?? classOfKey(design, keys[a]).clearance;
  for (const u of design.diffPairs ?? []) {
    const p = keys.indexOf(u.p), n = keys.indexOf(u.n);
    if (p < 0 || n < 0 || p === n || used.has(p) || used.has(n)) continue;
    used.add(p); used.add(n);
    out.push({ p, n, gap: gapOf(p, n), source: 'user' });
  }
  const groups = new Map<string, { p?: number; n?: number }>();
  for (let net = 0; net < keys.length; net++) {
    if (used.has(net) || !((classOfKey(design, keys[net]).diffGap ?? 0) > 0)) continue;
    const m = /^(.*)_([PN])$/i.exec(label(net).trim());
    if (!m) continue;
    const g = groups.get(m[1].toUpperCase()) ?? groups.set(m[1].toUpperCase(), {}).get(m[1].toUpperCase())!;
    if (m[2].toUpperCase() === 'P') g.p ??= net; else g.n ??= net;
  }
  for (const g of groups.values()) if (g.p !== undefined && g.n !== undefined) out.push({ p: g.p, n: g.n, gap: gapOf(g.p, g.n), source: 'auto' });
  return out;
}

/** parallel copy of a polyline at distance d (positive = to the left of the travel direction, y down), miter joins (bevel when too sharp) */
export function offsetPolyline(pts: Pt[], d: number): Pt[] {
  const seg: { nx: number; ny: number }[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dy) || 1;
    seg.push({ nx: dy / l, ny: -dx / l });
  }
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) { out.push([pts[0][0] + seg[0].nx * d, pts[0][1] + seg[0].ny * d]); continue; }
    if (i === pts.length - 1) { const s = seg[seg.length - 1]; out.push([pts[i][0] + s.nx * d, pts[i][1] + s.ny * d]); continue; }
    const a = seg[i - 1], b = seg[i];
    const mx = a.nx + b.nx, my = a.ny + b.ny, dot = a.nx * b.nx + a.ny * b.ny;
    const k = 1 + dot; // miter scale = 1 / cos(half turn angle)
    if (k < 0.3) { out.push([pts[i][0] + a.nx * d, pts[i][1] + a.ny * d], [pts[i][0] + b.nx * d, pts[i][1] + b.ny * d]); continue; }
    out.push([pts[i][0] + (mx / k) * d, pts[i][1] + (my / k) * d]);
  }
  return out;
}

/** removes `a` mm from the start and `b` mm from the end of a polyline (null when nothing is left) */
export function trimPolyline(pts: Pt[], a: number, b: number): Pt[] | null {
  const cut = (list: Pt[], len: number): Pt[] | null => {
    let rest = len;
    for (let i = 0; i + 1 < list.length; i++) {
      const l = Math.hypot(list[i + 1][0] - list[i][0], list[i + 1][1] - list[i][1]);
      if (rest < l - 1e-9) {
        const t = rest / l;
        return [[list[i][0] + (list[i + 1][0] - list[i][0]) * t, list[i][1] + (list[i + 1][1] - list[i][1]) * t], ...list.slice(i + 1)];
      }
      rest -= l;
    }
    return null;
  };
  const s = a > 0 ? cut(pts, a) : pts;
  if (!s) return null;
  const e = b > 0 ? cut([...s].reverse(), b) : [...s].reverse();
  return e ? e.reverse() : null;
}

const errorCount = (d: PcbDesign, circuit: Circuit): { other: number; unrouted: number } => {
  const issues = runDrc(circuit, d).filter((i) => i.severity === 'error');
  return { other: issues.filter((i) => i.code !== 'UNROUTED').length, unrouted: issues.length - issues.filter((i) => i.code !== 'UNROUTED').length };
};

/**
 * Derives the follower track from the routed lead track. `design` must already contain the lead copper (and everything routed
 * before it). Candidates: both sides x several end trims; the first that adds no DRC error and connects the follower wins.
 */
export function deriveFollower(args: {
  circuit: Circuit; design: PcbDesign; lead: Track[]; leadVias: number; followerPads: WorldPad[]; gap: number; width: number; id: string;
}): { track?: Track; reason?: string } {
  const { circuit, design, lead, followerPads, gap, width, id } = args;
  if (args.leadVias > 0) return { reason: 'ana net via içeriyor (yalnız tek katmanlı iz desteklenir)' };
  if (lead.length !== 1) return { reason: lead.length === 0 ? 'ana net için yeni iz yok' : 'ana net birden çok iz parçası (yalnız tek iz desteklenir)' };
  if (followerPads.length !== 2) return { reason: 'eş net 2 pinli değil (yalnız 2 pinli netler desteklenir)' };
  const L = lead[0];
  if (!followerPads.every((p) => p.layers.includes(L.layer))) return { reason: 'eş net pad’leri ana izin katmanında değil' };
  const base = errorCount(design, circuit);
  const dist = (L.width + width) / 2 + gap;
  for (const side of [1, -1]) {
    const off = offsetPolyline(L.pts, side * dist);
    for (const trim of [0, 1.5, 3, 4.5, 6]) {
      const mid = trim > 0 ? trimPolyline(off, trim, trim) : off;
      if (!mid || mid.length < 2) break;
      const [a, b] = followerPads;
      const straight = Math.hypot(a.x - mid[0][0], a.y - mid[0][1]) + Math.hypot(b.x - mid[mid.length - 1][0], b.y - mid[mid.length - 1][1]);
      const swapped = Math.hypot(b.x - mid[0][0], b.y - mid[0][1]) + Math.hypot(a.x - mid[mid.length - 1][0], a.y - mid[mid.length - 1][1]);
      const [s, e] = straight <= swapped ? [a, b] : [b, a];
      const pts: Pt[] = [[s.x, s.y], ...mid, [e.x, e.y]].filter((q, i, arr) => i === 0 || q[0] !== arr[i - 1][0] || q[1] !== arr[i - 1][1]) as Pt[];
      const cand: Track = { id, layer: L.layer, width, pts };
      const now = errorCount({ ...design, tracks: [...design.tracks, cand] }, circuit);
      if (now.other <= base.other && now.unrouted < base.unrouted) return { track: cand };
    }
  }
  return { reason: 'türetilen iz DRC’yi geçemedi (aralık/kenar/engel); eş net normal yönlendirildi' };
}
