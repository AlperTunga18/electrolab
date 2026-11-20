import type { Circuit } from '../circuit/types';
import { runDrc, type DrcIssue } from './drc';
import type { PcbDesign, Track } from './types';

/** Helpers of the manual track tool (pure, so they can be tested without the UI). */

export type AngleMode = 'free' | '45' | 'orth';

/**
 * Next vertex of a track being drawn: 'free' = cursor as is (Shift), '45' = direction snapped to the nearest multiple of
 * 45 degrees (length = projection of the cursor on that direction), 'orth' = old behaviour (dominant axis only).
 */
export function snapDir(last: [number, number], p: [number, number], mode: AngleMode): [number, number] {
  if (mode === 'free') return p;
  const dx = p[0] - last[0], dy = p[1] - last[1];
  if (mode === 'orth') return Math.abs(dx) >= Math.abs(dy) ? [p[0], last[1]] : [last[0], p[1]];
  if (dx === 0 && dy === 0) return last;
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const ux = Math.round(Math.cos(a) * 1e6) / 1e6, uy = Math.round(Math.sin(a) * 1e6) / 1e6; // exact 0 / +-1 / +-0.707107
  const len = dx * ux + dy * uy;
  return [Math.round((last[0] + len * ux) * 1e4) / 1e4, Math.round((last[1] + len * uy) * 1e4) / 1e4];
}

export const LIVE_ID = '__live__';

/**
 * Clearance / short problems the candidate track would cause (DRC with the candidate added). Only issues that involve the
 * candidate are returned; the position is where the conflict is.
 */
export function liveViolations(circuit: Circuit, design: PcbDesign, cand: Pick<Track, 'layer' | 'width' | 'pts'>): DrcIssue[] {
  if (cand.pts.length < 2) return [];
  const t: Track = { id: LIVE_ID, ...cand };
  const all = runDrc(circuit, { ...design, tracks: [...design.tracks, t] });
  const out = all.filter((i) => i.code === 'CLEARANCE' && i.refs?.includes(LIVE_ID));
  const shorts = all.filter((i) => i.code === 'SHORT');
  if (shorts.length) { // a short is new only if the design alone had fewer of them
    const before = runDrc(circuit, design).filter((i) => i.code === 'SHORT').length;
    if (shorts.length > before) out.push(...shorts.slice(before));
  }
  return out;
}
