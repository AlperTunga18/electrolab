/**
 * Own single-stroke line font for silkscreen / fab text, drawn from scratch (no third-party font data).
 * Glyph grid: x 0..4, y 0..6 (y UP, cap height 6). Each glyph is a list of polylines. Advance = 5 grid units.
 * Lowercase maps to uppercase. Unknown characters draw an open box.
 */

type Poly = [number, number][];

const O: Poly = [[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]];
const P: Poly = [[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]];

export const GLYPHS: Record<string, Poly[]> = {
  A: [[[0, 0], [0, 4], [2, 6], [4, 4], [4, 0]], [[0, 3], [4, 3]]],
  B: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [0, 0]]],
  C: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1]]],
  D: [[[0, 0], [0, 6], [2, 6], [4, 4], [4, 2], [2, 0], [0, 0]]],
  E: [[[4, 6], [0, 6], [0, 0], [4, 0]], [[0, 3], [3, 3]]],
  F: [[[4, 6], [0, 6], [0, 0]], [[0, 3], [3, 3]]],
  G: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 3], [2, 3]]],
  H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
  I: [[[1, 6], [3, 6]], [[2, 6], [2, 0]], [[1, 0], [3, 0]]],
  J: [[[4, 6], [4, 1], [3, 0], [1, 0], [0, 1]]],
  K: [[[0, 0], [0, 6]], [[4, 6], [0, 2]], [[1, 3], [4, 0]]],
  L: [[[0, 6], [0, 0], [4, 0]]],
  M: [[[0, 0], [0, 6], [2, 3], [4, 6], [4, 0]]],
  N: [[[0, 0], [0, 6], [4, 0], [4, 6]]],
  O: [O],
  P: [P],
  Q: [O, [[2, 2], [4, 0]]],
  R: [P, [[2, 3], [4, 0]]],
  S: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
  T: [[[0, 6], [4, 6]], [[2, 6], [2, 0]]],
  U: [[[0, 6], [0, 1], [1, 0], [3, 0], [4, 1], [4, 6]]],
  V: [[[0, 6], [2, 0], [4, 6]]],
  W: [[[0, 6], [1, 0], [2, 3], [3, 0], [4, 6]]],
  X: [[[0, 0], [4, 6]], [[0, 6], [4, 0]]],
  Y: [[[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]],
  Z: [[[0, 6], [4, 6], [0, 0], [4, 0]]],
  '0': [O, [[1, 1], [3, 5]]],
  '1': [[[1, 5], [2, 6], [2, 0]], [[1, 0], [3, 0]]],
  '2': [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [0, 0], [4, 0]]],
  '3': [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
  '4': [[[3, 0], [3, 6], [0, 2], [4, 2]]],
  '5': [[[4, 6], [0, 6], [0, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
  '6': [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3], [0, 3]]],
  '7': [[[0, 6], [4, 6], [1, 0]]],
  '8': [[[1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3]]],
  '9': [[[0, 1], [1, 0], [3, 0], [4, 1], [4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [4, 3]]],
  '-': [[[0, 3], [4, 3]]],
  _: [[[0, 0], [4, 0]]],
  '.': [[[2, 0], [2, 0.5]]],
  ',': [[[2, 0.5], [1.5, -1]]],
  '/': [[[0, 0], [4, 6]]],
  '+': [[[2, 1], [2, 5]], [[0, 3], [4, 3]]],
  ':': [[[2, 1], [2, 1.5]], [[2, 4], [2, 4.5]]],
  '(': [[[3, 6], [2, 5], [2, 1], [3, 0]]],
  ')': [[[1, 6], [2, 5], [2, 1], [1, 0]]],
  '#': [[[1, 0], [1, 6]], [[3, 0], [3, 6]], [[0, 2], [4, 2]], [[0, 4], [4, 4]]],
  '=': [[[0, 2], [4, 2]], [[0, 4], [4, 4]]],
  '%': [[[0, 0], [4, 6]], [[0, 5], [1, 6]], [[3, 0], [4, 1]]],
  '?': [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [2, 3], [2, 2]], [[2, 0], [2, 0.5]]],
  'Ω': [[[0, 0], [1.5, 0], [0, 2], [0, 4], [1, 6], [3, 6], [4, 4], [4, 2], [2.5, 0], [4, 0]]],
  'µ': [[[0, 5], [0, -1]], [[0, 1], [1, 0], [3, 0], [4, 1]], [[4, 0], [4, 5]]],
  ' ': [],
};

const BOX: Poly[] = [[[0, 0], [4, 0], [4, 6], [0, 6], [0, 0]]];

export const GLYPH_ADVANCE = 5;
export const GLYPH_HEIGHT = 6;

export interface TextOpts {
  /** anchor (model coordinates, mm, y DOWN) */
  x: number;
  y: number;
  /** cap height, mm */
  height: number;
  /** clockwise rotation in degrees (as on screen) */
  rot?: number;
  /** mirror in x about the anchor (text on a bottom layer plotted in top view) */
  mirror?: boolean;
  /** 'center' (default): anchor is the middle of the text box; 'left': anchor is the left end of the text (vertically centred) */
  anchor?: 'center' | 'left';
}

/** text width in mm for a given cap height */
export function textWidth(text: string, height: number): number {
  const n = [...text].length;
  return n === 0 ? 0 : ((n * GLYPH_ADVANCE - (GLYPH_ADVANCE - 4)) * height) / GLYPH_HEIGHT;
}

/** text as polylines in model coordinates (y down). Rotation is clockwise on screen. */
export function textStrokes(text: string, o: TextOpts): [number, number][][] {
  const s = o.height / GLYPH_HEIGHT;
  const chars = [...text.toUpperCase()];
  const total = chars.length ? chars.length * GLYPH_ADVANCE - (GLYPH_ADVANCE - 4) : 0;
  const ox = o.anchor === 'left' ? 0 : total / 2;
  const rad = ((o.rot ?? 0) * Math.PI) / 180;
  const cs = Math.cos(rad), sn = Math.sin(rad);
  const out: [number, number][][] = [];
  chars.forEach((ch, i) => {
    const polys = GLYPHS[ch] ?? BOX;
    for (const poly of polys) {
      out.push(poly.map(([gx, gy]) => {
        let lx = (gx + i * GLYPH_ADVANCE - ox) * s;
        const ly = -(gy - GLYPH_HEIGHT / 2) * s; // glyph y up -> model y down, vertically centred
        if (o.mirror) lx = -lx;
        return [o.x + lx * cs - ly * sn, o.y + lx * sn + ly * cs] as [number, number];
      }));
    }
  });
  return out;
}

/** text as straight segments [x1,y1,x2,y2] in model coordinates */
export function textSegments(text: string, o: TextOpts): [number, number, number, number][] {
  const segs: [number, number, number, number][] = [];
  for (const p of textStrokes(text, o)) for (let i = 0; i + 1 < p.length; i++) segs.push([p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]]);
  return segs;
}
