/**
 * Loose-connector contact model. The contact resistance is a pure, seeded function of time (piecewise constant over dwell
 * cells of LOOSE_TAU seconds), so a run is reproducible and step-halving / re-solves see the same value at the same t.
 * GENERIC, NOT MEASURED: the distribution (mostly low-ohm with a heavy tail, 5 % open cells) is a plausible bad-crimp
 * behaviour, not data from a specific connector.
 */
export const LOOSE_RMIN = 0.05;
export const LOOSE_RMAX_DEFAULT = 1000;
/** dwell time of one contact state (s) */
export const LOOSE_TAU = 2e-3;
/** probability that a dwell cell is an open contact */
export const LOOSE_P_OPEN = 0.05;
export const LOOSE_R_OPEN = 1e9;

/** FNV-1a string hash */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** mulberry32 step on (seed + cell) -> uniform [0,1) */
function uniform(seed: number, cell: number): number {
  let a = (seed + Math.imul(cell, 0x9e3779b9)) >>> 0;
  a = (a + 0x6d2b79f5) >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Series contact resistance (ohm) at time t for the connector identified by `id`. */
export function looseContactR(id: string, t: number, rmax = LOOSE_RMAX_DEFAULT): number {
  const seed = hashSeed(id);
  const cell = Math.floor(Math.max(t, 0) / LOOSE_TAU);
  if (uniform(seed, cell * 2 + 1) < LOOSE_P_OPEN) return LOOSE_R_OPEN;
  const u = uniform(seed, cell * 2);
  const hi = Math.max(rmax, LOOSE_RMIN * 2);
  // log-uniform between rmin and rmax, skewed toward the low end (u^2)
  return LOOSE_RMIN * Math.pow(hi / LOOSE_RMIN, u * u);
}
