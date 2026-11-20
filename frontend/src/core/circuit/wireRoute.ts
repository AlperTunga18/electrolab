/** Orthogonal (Manhattan) wire auto-routing on the board plane (x/z), pure and deterministic. */

export interface XZ { x: number; z: number }
export interface Box { minX: number; maxX: number; minZ: number; maxZ: number }

const EPS = 1e-9;

/** true when the segment p-q passes through the OPEN interior of the box (touching an edge is allowed) */
export function segmentHitsBox(p: XZ, q: XZ, b: Box): boolean {
  if (b.maxX - b.minX <= EPS || b.maxZ - b.minZ <= EPS) return false;
  let t0 = 0, t1 = 1;
  const axes: [number, number, number, number][] = [[p.x, q.x - p.x, b.minX, b.maxX], [p.z, q.z - p.z, b.minZ, b.maxZ]];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-12) {
      if (!(o > lo + EPS && o < hi - EPS)) return false;
    } else {
      let a = (lo - o) / d, c = (hi - o) / d;
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
      if (t1 - t0 <= EPS) return false;
    }
  }
  return t1 - t0 > EPS;
}

export const polylineHitsBoxes = (pts: XZ[], boxes: Box[]): boolean => {
  for (let i = 0; i + 1 < pts.length; i++) for (const b of boxes) if (segmentHitsBox(pts[i], pts[i + 1], b)) return true;
  return false;
};

const MAX_CELLS = 40000;
const TURN_COST = 2;
const DIRS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

type HeapNode = [number, number, number, number, number];

/**
 * Route a wire from a to b around obstacle boxes. Returns a polyline [a, ..., b].
 * Straight [a, b] when the direct line is clear or no path exists; otherwise axis-aligned segments
 * on a lattice (spacing `grid`, anchored at a) found with A* (turn-penalised, fixed tie-breaking).
 */
export function routeWire(a: XZ, b: XZ, obstacles: Box[], grid: number): XZ[] {
  const straight: XZ[] = [{ x: a.x, z: a.z }, { x: b.x, z: b.z }];
  if (!polylineHitsBoxes(straight, obstacles)) return straight;
  const g = grid > 0 ? grid : 0.5;

  const ti = Math.round((b.x - a.x) / g), tj = Math.round((b.z - a.z) / g);
  let maxDim = 0;
  for (const o of obstacles) maxDim = Math.max(maxDim, o.maxX - o.minX, o.maxZ - o.minZ);
  const M = Math.min(40, Math.max(8, Math.ceil(maxDim / g) + 2));
  const i0 = Math.min(0, ti) - M, i1 = Math.max(0, ti) + M, j0 = Math.min(0, tj) - M, j1 = Math.max(0, tj) + M;
  const W = i1 - i0 + 1, H = j1 - j0 + 1;
  if (W * H > MAX_CELLS) return straight;

  const pt = (i: number, j: number): XZ => ({ x: a.x + i * g, z: a.z + j * g });
  const nodeBlocked = (i: number, j: number): boolean => {
    const p = pt(i, j);
    return obstacles.some((o) => p.x > o.minX + EPS && p.x < o.maxX - EPS && p.z > o.minZ + EPS && p.z < o.maxZ - EPS);
  };
  const idx = (i: number, j: number, d: number) => ((j - j0) * W + (i - i0)) * 4 + d;

  const cost = new Float64Array(W * H * 4).fill(Infinity);
  const prev = new Int32Array(W * H * 4).fill(-1);
  const heap: HeapNode[] = [];
  let seq = 0;
  const less = (x: HeapNode, y: HeapNode) => x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
  const push = (n: HeapNode) => {
    heap.push(n);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (less(heap[k], heap[p])) { [heap[k], heap[p]] = [heap[p], heap[k]]; k = p; } else break;
    }
  };
  const pop = (): HeapNode => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === k) break;
        [heap[k], heap[m]] = [heap[m], heap[k]];
        k = m;
      }
    }
    return top;
  };
  const h = (i: number, j: number) => Math.abs(i - ti) + Math.abs(j - tj);

  for (let d = 0; d < 4; d++) { cost[idx(0, 0, d)] = 0; push([h(0, 0), seq++, 0, 0, d]); }
  let goal = -1;
  while (heap.length) {
    const [, , i, j, d] = pop();
    const here = idx(i, j, d);
    if (i === ti && j === tj) { goal = here; break; }
    const c0 = cost[here];
    for (let nd = 0; nd < 4; nd++) {
      const ni = i + DIRS[nd][0], nj = j + DIRS[nd][1];
      if (ni < i0 || ni > i1 || nj < j0 || nj > j1) continue;
      if (nodeBlocked(ni, nj)) continue;
      const p = pt(i, j), q = pt(ni, nj);
      if (obstacles.some((o) => segmentHitsBox(p, q, o))) continue;
      const turn = nd !== d && !(i === 0 && j === 0) ? TURN_COST : 0;
      const nc = c0 + 1 + turn;
      const k = idx(ni, nj, nd);
      if (nc < cost[k] - 1e-12) { cost[k] = nc; prev[k] = here; push([nc + h(ni, nj), seq++, ni, nj, nd]); }
    }
  }
  if (goal < 0) return straight;

  const nodes: XZ[] = [];
  for (let k = goal; k >= 0; k = prev[k]) {
    const cell = k >> 2;
    nodes.push(pt((cell % W) + i0, Math.floor(cell / W) + j0));
  }
  nodes.reverse();
  nodes[0] = { x: a.x, z: a.z };
  const last = nodes[nodes.length - 1];
  const tails: XZ[][] = [[{ x: b.x, z: last.z }, { x: b.x, z: b.z }], [{ x: last.x, z: b.z }, { x: b.x, z: b.z }]];
  for (const tail of tails) {
    const poly = simplify([...nodes, ...tail]);
    if (!polylineHitsBoxes(poly, obstacles)) return poly;
  }
  return straight;
}

/** drop duplicate and collinear points */
function simplify(pts: XZ[]): XZ[] {
  const out: XZ[] = [];
  for (const p of pts) {
    const l = out[out.length - 1];
    if (l && Math.abs(l.x - p.x) < EPS && Math.abs(l.z - p.z) < EPS) continue;
    out.push({ x: p.x, z: p.z });
    while (out.length >= 3) {
      const [u, v, w] = out.slice(-3);
      const col = (Math.abs(u.x - v.x) < EPS && Math.abs(v.x - w.x) < EPS) || (Math.abs(u.z - v.z) < EPS && Math.abs(v.z - w.z) < EPS);
      if (!col) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}
