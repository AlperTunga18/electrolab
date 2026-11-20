import type { Footprint, Pad } from './types';

/**
 * Parametric land pattern generators, written from scratch (own formulas, general package knowledge).
 * Every dimension is TYPICAL (verified:false): these are NOT datasheet / IPC-7351 land patterns of a specific part.
 * Verify against the manufacturer datasheet before ordering boards.
 * Pads are numbered '1'..'n' (pin 1 first); the PCB layer maps them onto the library pins by order.
 */
export const LAND_PATTERN_VERIFIED = false;

type Rect = { pin: string; x: number; y: number; w: number; h: number; shape?: Pad['shape']; drill?: number };

function build(name: string, rects: Rect[], smd: boolean, margin: number, minW = 0, minH = 0): Footprint {
  const pads: Pad[] = rects.map((r) => ({ pin: r.pin, x: r.x, y: r.y, shape: r.shape ?? 'rect', w: r.w, h: r.h, drill: r.drill ?? 0 }));
  const w0 = Math.max(...pads.map((p) => Math.abs(p.x) + p.w / 2)), h0 = Math.max(...pads.map((p) => Math.abs(p.y) + p.h / 2));
  const width = Math.max(2 * w0 + margin, minW), height = Math.max(2 * h0 + margin, minH);
  const x1 = -width / 2, x2 = width / 2, y1 = -height / 2, y2 = height / 2;
  return {
    name, pads, width, height, smd,
    silk: [{ x1, y1, x2, y2: y1 }, { x1: x2, y1, x2, y2 }, { x1: x2, y1: y2, x2: x1, y2: y1 }, { x1, y1: y2, x2: x1, y2: y1 }],
  };
}

const byPin = (a: Rect, b: Rect): number => Number(a.pin) - Number(b.pin);

/** chip R/C/L: [centre distance, pad w (along x), pad h] typical mm */
const CHIP: Record<string, [number, number, number]> = {
  '0402': [1.0, 0.6, 0.6], '0603': [1.6, 0.8, 0.9], '0805': [2.0, 1.0, 1.4], '1206': [3.0, 1.1, 1.8],
};
export const chipSizes = (): string[] => Object.keys(CHIP);

export function chip(size: string): Footprint {
  const t = CHIP[size];
  if (!t) throw new Error(`unknown chip size ${size}`);
  const [c, w, h] = t;
  return build(`CHIP-${size}`, [{ pin: '1', x: -c / 2, y: 0, w, h }, { pin: '2', x: c / 2, y: 0, w, h }], true, 0.5);
}

/** dual row gull-wing (SOIC/TSSOP): pin 1 top-left, counter-clockwise */
function dualRow(name: string, n: number, pitch: number, span: number, padL: number, padW: number): Footprint {
  if (n < 4 || n % 2) throw new Error(`${name}: pin count must be even >= 4`);
  const half = n / 2, rects: Rect[] = [];
  for (let i = 0; i < half; i++) {
    const y = (i - (half - 1) / 2) * pitch;
    rects.push({ pin: String(i + 1), x: -span / 2, y, w: padL, h: padW });
    rects.push({ pin: String(n - i), x: span / 2, y, w: padL, h: padW });
  }
  return build(name, rects.sort(byPin), true, 0.5);
}
export const soic = (n: number): Footprint => dualRow(`SOIC-${n}`, n, 1.27, 5.4, 1.5, 0.6);
export const tssop = (n: number): Footprint => dualRow(`TSSOP-${n}`, n, 0.65, 5.8, 1.5, 0.4);

/** QFN: n pads (no exposed pad), n multiple of 4, pitch default 0.5; pin 1 top-left, counter-clockwise */
export function qfn(n: number, pitch = 0.5): Footprint {
  if (n < 8 || n % 4) throw new Error('QFN pin count must be a multiple of 4 (>= 8)');
  const side = n / 4, body = side * pitch + 1.0, padL = 0.8, padW = Math.min(0.3, pitch * 0.6), c = body / 2 + 0.05;
  const rects: Rect[] = [];
  for (let i = 0; i < side; i++) {
    const o = (i - (side - 1) / 2) * pitch;
    rects.push({ pin: String(i + 1), x: -c, y: o, w: padL, h: padW });
    rects.push({ pin: String(side + i + 1), x: o, y: c, w: padW, h: padL });
    rects.push({ pin: String(2 * side + i + 1), x: c, y: -o, w: padL, h: padW });
    rects.push({ pin: String(3 * side + i + 1), x: -o, y: -c, w: padW, h: padL });
  }
  return build(`QFN-${n}`, rects.sort(byPin), true, 0.5);
}

export function sot23(n: 3 | 5 | 6): Footprint {
  const p = 0.95, yb = 1.1, w = 0.6, h = 1.0;
  if (n === 3) return build('SOT-23-3', [{ pin: '1', x: -p, y: yb, w, h }, { pin: '2', x: p, y: yb, w, h }, { pin: '3', x: 0, y: -yb, w, h }], true, 0.5);
  const bottom: Rect[] = [-p, 0, p].map((x, i) => ({ pin: String(i + 1), x, y: yb, w, h }));
  const top: Rect[] = n === 5
    ? [{ pin: '4', x: p, y: -yb, w, h }, { pin: '5', x: -p, y: -yb, w, h }]
    : [p, 0, -p].map((x, i) => ({ pin: String(i + 4), x, y: -yb, w, h }));
  return build(`SOT-23-${n}`, [...bottom, ...top], true, 0.5);
}

/** SOT-223: 3 pins on 2.3 mm pitch plus the large tab (electrically pin 2, so it shares pin '2') */
export const sot223 = (): Footprint => build('SOT-223', [
  { pin: '1', x: -2.3, y: 3.15, w: 1.0, h: 1.5 }, { pin: '2', x: 0, y: 3.15, w: 1.0, h: 1.5 }, { pin: '3', x: 2.3, y: 3.15, w: 1.0, h: 1.5 },
  { pin: '2', x: 0, y: -3.15, w: 3.0, h: 2.0 },
], true, 0.5);

export const to220 = (): Footprint => build('TO-220-3', [
  { pin: '1', x: -2.54, y: 0, w: 1.9, h: 2.6, shape: 'rect', drill: 1.1 },
  { pin: '2', x: 0, y: 0, w: 1.9, h: 2.6, shape: 'oval', drill: 1.1 },
  { pin: '3', x: 2.54, y: 0, w: 1.9, h: 2.6, shape: 'oval', drill: 1.1 },
], false, 1.0, 10.4, 4.6);

/** DIP-n: rows 7.62 mm apart (300 mil), pitch 2.54, pin 1 top-left, counter-clockwise */
export function dip(n: number, rowSpacing = 7.62): Footprint {
  if (n < 4 || n % 2) throw new Error('DIP pin count must be even >= 4');
  const half = n / 2, rects: Rect[] = [];
  for (let i = 0; i < half; i++) {
    const y = (i - (half - 1) / 2) * 2.54;
    rects.push({ pin: String(i + 1), x: -rowSpacing / 2, y, w: 1.6, h: 1.6, shape: i === 0 ? 'rect' : 'circle', drill: 0.8 });
    rects.push({ pin: String(n - i), x: rowSpacing / 2, y, w: 1.6, h: 1.6, shape: 'circle', drill: 0.8 });
  }
  return build(`DIP-${n}`, rects.sort(byPin), false, 1.0);
}

/** pin header rows x cols at 2.54 mm; pins numbered along the columns (1,2 in the first row pair for 2xn) */
export function header(rows: 1 | 2, cols: number): Footprint {
  if (cols < 1) throw new Error('header needs >= 1 column');
  const rects: Rect[] = [];
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    rects.push({ pin: String(c * rows + r + 1), x: (r - (rows - 1) / 2) * 2.54, y: (c - (cols - 1) / 2) * 2.54, w: 1.7, h: 1.7, shape: c === 0 && r === 0 ? 'rect' : 'circle', drill: 1.0 });
  }
  return build(`HDR-${rows}x${cols}`, rects, false, 1.0);
}

/** radial electrolytic: body diameter d and lead pitch, mm; pin 1 = +, pin 2 = - */
export function radialCap(d: number, pitch: number): Footprint {
  return build(`ELCAP-D${d}-P${pitch}`, [
    { pin: '1', x: -pitch / 2, y: 0, w: 1.6, h: 1.6, shape: 'rect', drill: 0.8 },
    { pin: '2', x: pitch / 2, y: 0, w: 1.6, h: 1.6, shape: 'circle', drill: 0.8 },
  ], false, 1.0, d + 0.5, d + 0.5);
}
const RADIAL: [number, number][] = [[5, 2], [6.3, 2.5], [8, 3.5], [10, 5], [12.5, 5], [16, 7.5]];

/** distinct pin count of a footprint (a tab pad sharing a pin counts once) */
export const pinCountOf = (fp: Footprint): number => new Set(fp.pads.map((p) => p.pin)).size;

/** generator key -> footprint; undefined for unknown keys. Keys are case-insensitive. */
export function generateFootprint(key: string): Footprint | undefined {
  const k = key.trim().toUpperCase();
  try {
    let m: RegExpMatchArray | null;
    if ((m = k.match(/^(?:CHIP-)?(0402|0603|0805|1206)$/))) return chip(m[1]);
    if ((m = k.match(/^SOIC-(\d+)$/))) return soic(+m[1]);
    if ((m = k.match(/^TSSOP-(\d+)$/))) return tssop(+m[1]);
    if ((m = k.match(/^QFN-(\d+)$/))) return qfn(+m[1]);
    if ((m = k.match(/^SOT-23-(3|5|6)$/))) return sot23(+m[1] as 3 | 5 | 6);
    if (k === 'SOT-223') return sot223();
    if (k === 'TO-220' || k === 'TO-220-3') return to220();
    if ((m = k.match(/^DIP-(\d+)$/))) return dip(+m[1]);
    if ((m = k.match(/^HDR-([12])X(\d+)$/))) return header(+m[1] as 1 | 2, +m[2]);
    if ((m = k.match(/^ELCAP-D([\d.]+)-P([\d.]+)$/))) return radialCap(+m[1], +m[2]);
  } catch { return undefined; }
  return undefined;
}

/** keys offered in the UI with their distinct pin count */
export function footprintCatalog(): { key: string; pins: number }[] {
  const out: { key: string; pins: number }[] = [];
  for (const s of chipSizes()) out.push({ key: `CHIP-${s}`, pins: 2 });
  for (const n of [8, 14, 16, 18, 20, 24, 28]) out.push({ key: `SOIC-${n}`, pins: n });
  for (const n of [8, 14, 16, 20, 24, 28]) out.push({ key: `TSSOP-${n}`, pins: n });
  for (const n of [16, 20, 24, 28, 32, 40, 48]) out.push({ key: `QFN-${n}`, pins: n });
  for (const n of [3, 5, 6]) out.push({ key: `SOT-23-${n}`, pins: n });
  out.push({ key: 'SOT-223', pins: 3 }, { key: 'TO-220', pins: 3 });
  for (let n = 4; n <= 40; n += 2) out.push({ key: `DIP-${n}`, pins: n });
  for (let n = 2; n <= 20; n++) out.push({ key: `HDR-1x${n}`, pins: n });
  for (let n = 2; n <= 20; n++) out.push({ key: `HDR-2x${n}`, pins: 2 * n });
  for (const [d, p] of RADIAL) out.push({ key: `ELCAP-D${d}-P${p}`, pins: 2 });
  return out;
}
