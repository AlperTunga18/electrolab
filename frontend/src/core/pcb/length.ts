import type { Circuit } from '../circuit/types';
import { buildNets } from '../circuit/nets';
import { classOfKey, netKeys, netLabel } from './netclass';
import type { Connectivity } from './drc';
import type { PcbDesign, Track } from './types';

/**
 * Net length report. Length = centre-line length of the copper tracks that are connected to the net (cluster of the
 * connectivity extraction) + one board thickness per via (through vias only; no blind/buried vias exist in this model).
 * It is the TOTAL copper length of the net (a branching net counts every branch), not a point-to-point path length, and
 * pad-internal copper, zone pours and the extra length of rounded corners are not counted.
 */

export interface NetLength {
  net: number;
  key: string;
  name: string;
  className: string;
  /** summed track centre-line length, mm */
  trackMm: number;
  viaCount: number;
  /** via contribution (viaCount x board thickness), mm */
  viaMm: number;
  totalMm: number;
  /** target length, mm (net target, else class target) */
  targetMm?: number;
  tolMm?: number;
  /** totalMm - targetMm */
  deviationMm?: number;
  /** false = the net still has unrouted links, so the length is incomplete (no deviation verdict) */
  complete: boolean;
  /** true when a target exists, the net is complete and |deviation| > tolerance */
  violates: boolean;
}

export const DEFAULT_LENGTH_TOL = 1;

/** centre-line length of a polyline track, mm */
export function trackLength(t: Pick<Track, 'pts'>): number {
  let l = 0;
  for (let i = 0; i + 1 < t.pts.length; i++) l += Math.hypot(t.pts[i + 1][0] - t.pts[i][0], t.pts[i + 1][1] - t.pts[i][1]);
  return l;
}

/** target length of the net with this stable key: per-net target first, then the class target */
export function lengthTargetOf(design: Pick<PcbDesign, 'rules' | 'netClassOf' | 'netLengthTargets'>, key: string | undefined): { mm: number; tol: number } | undefined {
  if (key === undefined) return undefined;
  const own = design.netLengthTargets?.[key];
  if (own && own.mm > 0) return { mm: own.mm, tol: own.tol ?? DEFAULT_LENGTH_TOL };
  const c = classOfKey(design, key);
  if (c.targetLength && c.targetLength > 0) return { mm: c.targetLength, tol: c.lengthTol ?? DEFAULT_LENGTH_TOL };
  return undefined;
}

/**
 * Length of every net that has at least one pad on the board (net index order). `conn` comes from extractConnectivity.
 * A cluster shared by several nets (short circuit) is attributed to none of them.
 */
export function netLengthReport(circuit: Circuit, design: PcbDesign, conn: Connectivity): NetLength[] {
  const keys = netKeys(circuit);
  const names = buildNets(circuit).names;
  const trackById = new Map(design.tracks.map((t) => [t.id, t]));
  const viaIds = new Set(design.vias.map((v) => v.id));
  const track = new Map<number, number>();
  const vias = new Map<number, number>();
  for (const c of conn.clusters) {
    if (c.nets.length !== 1) continue;
    const n = c.nets[0];
    for (const id of c.objects) {
      const t = trackById.get(id);
      if (t) track.set(n, (track.get(n) ?? 0) + trackLength(t));
      else if (viaIds.has(id)) vias.set(n, (vias.get(n) ?? 0) + 1);
    }
  }
  const incomplete = new Set(conn.unrouted.map((u) => u.net));
  const onBoard = new Set<number>();
  for (const c of conn.clusters) for (const n of c.nets) onBoard.add(n);
  const rows: NetLength[] = [];
  for (const n of [...onBoard].sort((a, b) => a - b)) {
    const trackMm = track.get(n) ?? 0, viaCount = vias.get(n) ?? 0, viaMm = viaCount * design.rules.thickness;
    const totalMm = trackMm + viaMm;
    const tg = lengthTargetOf(design, keys[n]);
    const complete = !incomplete.has(n);
    const deviationMm = tg ? totalMm - tg.mm : undefined;
    rows.push({
      net: n, key: keys[n], name: netLabel(design, keys[n], names[n] ?? `net ${n}`), className: classOfKey(design, keys[n]).name,
      trackMm, viaCount, viaMm, totalMm, targetMm: tg?.mm, tolMm: tg?.tol, deviationMm, complete,
      violates: !!tg && complete && Math.abs(deviationMm!) > tg.tol + 1e-9,
    });
  }
  return rows;
}
