/**
 * Polygon geometry for the PCB: board outline, copper zones. Pure functions, units mm, any winding, concave polygons supported.
 * Polygons are open vertex lists (the closing edge last->first is implicit). Written from scratch, no external geometry code.
 */

export type Pt = [number, number];
export type Poly = Pt[];

const ON_EDGE = 1e-9;

export function ptSegDist(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0;
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

const cross = (o: Pt, a: Pt, b: Pt): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** shortest distance between two segments (0 when they cross or touch) */
export function segSegDist(p1: Pt, p2: Pt, q1: Pt, q2: Pt): number {
  const d1 = cross(q1, q2, p1), d2 = cross(q1, q2, p2), d3 = cross(p1, p2, q1), d4 = cross(p1, p2, q2);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(ptSegDist(p1[0], p1[1], q1, q2), ptSegDist(p2[0], p2[1], q1, q2), ptSegDist(q1[0], q1[1], p1, p2), ptSegDist(q2[0], q2[1], p1, p2));
}

/** distance from a point to the polygon boundary (always >= 0) */
export function distToBoundary(poly: Poly, x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, ptSegDist(x, y, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

/** point in polygon, even-odd rule; points on the boundary count as inside */
export function pointInPoly(poly: Poly, x: number, y: number): boolean {
  if (poly.length < 3) return false;
  if (distToBoundary(poly, x, y) <= ON_EDGE) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** inside: +distance to the boundary, outside: -distance */
export function signedInsideDist(poly: Poly, x: number, y: number): number {
  const d = distToBoundary(poly, x, y);
  return pointInPoly(poly, x, y) ? d : -d;
}

/** minimum distance between a segment and the polygon boundary (0 when it crosses) */
export function segBoundaryDist(poly: Poly, a: Pt, b: Pt): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, segSegDist(a, b, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

/** [minX, minY, maxX, maxY] */
export function polyBBox(poly: Poly): [number, number, number, number] {
  let b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of poly) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
  return b;
}

/** signed shoelace area: positive for counter-clockwise in a y-up frame (clockwise on screen, y down) */
export function signedArea(poly: Poly): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; a += x1 * y2 - x2 * y1; }
  return a / 2;
}

/** polygon area (works for concave simple polygons) */
export const polyArea = (poly: Poly): number => Math.abs(signedArea(poly));

/**
 * Simple inward offset by `d` mm (negative d grows the polygon): every edge moves along its inward normal and neighbouring edges
 * are re-intersected (miter join). LIMITS: no self-intersection cleanup, so it is only reliable while `d` is smaller than the
 * narrowest feature; very sharp corners get a clamped miter. An empty list is returned when the result degenerates (inverted area).
 */
export function offsetPoly(poly: Poly, d: number): Poly {
  const n = poly.length;
  if (n < 3 || d === 0) return poly.map((p) => [p[0], p[1]] as Pt);
  const ccw = signedArea(poly) > 0; // inward normal of edge a->b is the left normal when ccw (y-up maths), right normal otherwise
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const nx = ccw ? -dy / len : dy / len, ny = ccw ? dx / len : -dx / len;
    return { p: [a[0] + nx * d, a[1] + ny * d] as Pt, dx: dx / len, dy: dy / len };
  });
  const out: Poly = [];
  for (let i = 0; i < n; i++) {
    const l0 = lines[(i + n - 1) % n], l1 = lines[i];
    const den = l0.dx * l1.dy - l0.dy * l1.dx;
    if (Math.abs(den) < 1e-9) { out.push([l1.p[0], l1.p[1]]); continue; } // collinear edges
    const t = ((l1.p[0] - l0.p[0]) * l1.dy - (l1.p[1] - l0.p[1]) * l1.dx) / den;
    let x = l0.p[0] + l0.dx * t, y = l0.p[1] + l0.dy * t;
    const reach = Math.abs(d) * 4; // clamp very sharp miters
    const vx = x - poly[i][0], vy = y - poly[i][1], vl = Math.hypot(vx, vy);
    if (vl > reach) { x = poly[i][0] + (vx / vl) * reach; y = poly[i][1] + (vy / vl) * reach; }
    out.push([x, y]);
  }
  if (d > 0) { // an edge that flipped direction means the polygon collapsed/inverted
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if ((out[j][0] - out[i][0]) * (poly[j][0] - poly[i][0]) + (out[j][1] - out[i][1]) * (poly[j][1] - poly[i][1]) <= 0) return [];
    }
    if (polyArea(out) >= polyArea(poly)) return [];
  }
  return out;
}

/** axis-aligned rectangle as polygon */
export const rectPoly = (w: number, h: number): Poly => [[0, 0], [w, 0], [w, h], [0, h]];

/** the board polygon: outline.poly when it has >= 3 vertices, else the w x h rectangle */
export function outlinePoly(outline: { w: number; h: number; poly?: Poly }): Poly {
  return outline.poly && outline.poly.length >= 3 ? outline.poly : rectPoly(outline.w, outline.h);
}
