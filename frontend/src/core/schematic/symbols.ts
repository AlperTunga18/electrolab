import type { ComponentDef } from '../../library/types';

/**
 * Schematic symbols. px grid = 10, Y down, symbol centred on its local origin (0,0).
 * Pin `dir` is the direction in which a wire leaves the pin (outward from the symbol).
 */
export type Dir = 'l' | 'r' | 'u' | 'd';
export type Rot = 0 | 1 | 2 | 3;

export type SymShape =
  | { t: 'path'; d: string; fill?: boolean }
  | { t: 'circle'; cx: number; cy: number; r: number; fill?: boolean }
  | { t: 'text'; x: number; y: number; text: string; anchor?: 'start' | 'middle' | 'end' }
  | { t: 'rect'; x: number; y: number; w: number; h: number };

export interface SymPin { id: string; x: number; y: number; dir: Dir; label: string }

export interface Symbol {
  w: number;
  h: number;
  pins: SymPin[];
  shapes: SymShape[];
  ref: { x: number; y: number };
  value: { x: number; y: number };
}

const DIR_ROT: Dir[] = ['r', 'd', 'l', 'u']; // clockwise order

/** rotate a local point by `rot` quarter turns clockwise (screen, Y down) */
export function rotatePoint(x: number, y: number, rot: number): { x: number; y: number } {
  const r = ((rot % 4) + 4) % 4;
  switch (r) {
    case 1: return { x: -y + 0, y: x + 0 };
    case 2: return { x: -x + 0, y: -y + 0 };
    case 3: return { x: y + 0, y: -x + 0 };
    default: return { x: x + 0, y: y + 0 };
  }
}

export function rotateDir(d: Dir, rot: number): Dir {
  const r = ((rot % 4) + 4) % 4;
  return DIR_ROT[(DIR_ROT.indexOf(d) + r) % 4];
}

/** pin tip in world coordinates for a symbol placed at (cx,cy) with `rot` quarter turns */
export function pinPos(sym: Symbol, rot: number, cx: number, cy: number, pinId: string): { x: number; y: number; dir: Dir } {
  const p = sym.pins.find((q) => q.id === pinId);
  if (!p) throw new Error(`Pin yok: ${pinId}`);
  const q = rotatePoint(p.x, p.y, rot);
  return { x: cx + q.x, y: cy + q.y, dir: rotateDir(p.dir, rot) };
}

/** symbol bounds relative to its origin after rotation */
export function symbolBounds(sym: Symbol, rot: number): { x0: number; y0: number; x1: number; y1: number } {
  const odd = (((rot % 4) + 4) % 4) % 2 === 1;
  const w = odd ? sym.h : sym.w;
  const h = odd ? sym.w : sym.h;
  return { x0: -w / 2, y0: -h / 2, x1: w / 2, y1: h / 2 };
}

// ---------- helpers ----------
const P = (id: string, x: number, y: number, dir: Dir, label?: string): SymPin => ({ id, x, y, dir, label: label ?? id });
const path = (d: string, fill = false): SymShape => (fill ? { t: 'path', d, fill: true } : { t: 'path', d });
const text = (x: number, y: number, s: string, anchor: 'start' | 'middle' | 'end' = 'middle'): SymShape => ({ t: 'text', x, y, text: s, anchor });
const circle = (cx: number, cy: number, r: number, fill = false): SymShape => (fill ? { t: 'circle', cx, cy, r, fill: true } : { t: 'circle', cx, cy, r });

/** filled arrow head with tip at (x,y) pointing along unit-ish direction (dx,dy) */
function head(x: number, y: number, dx: number, dy: number, s = 5): SymShape {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const bx = x - ux * s * 1.6, by = y - uy * s * 1.6;
  const px = -uy * s * 0.8, py = ux * s * 0.8;
  const f = (n: number) => Math.round(n * 100) / 100;
  return path(`M${f(x)} ${f(y)}L${f(bx + px)} ${f(by + py)}L${f(bx - px)} ${f(by - py)}Z`, true);
}

type Build = { w: number; h: number; pins: SymPin[]; shapes: SymShape[]; ref: { x: number; y: number }; value: { x: number; y: number } };

/** resolve named pins; falls back to positional order. Returns null when ids would not be unique. */
function pick(def: ComponentDef, names: string[]): string[] | null {
  const ids = names.map((n, i) => (def.pins.find((p) => p.id === n)?.id ?? def.pins[i]?.id));
  if (ids.some((x) => x === undefined)) return null;
  if (new Set(ids).size !== ids.length) return null;
  return ids as string[];
}

const lab = (def: ComponentDef, id: string): string => def.pins.find((p) => p.id === id)?.label ?? id;

function horizontal2(def: ComponentDef, shapes: SymShape[], h = 20): Build {
  const [a, b] = def.pins;
  return {
    w: 60, h,
    pins: [P(a.id, -30, 0, 'l', a.label), P(b.id, 30, 0, 'r', b.label)],
    shapes,
    ref: { x: 0, y: -(h / 2 + 6) }, value: { x: 0, y: h / 2 + 12 },
  };
}

function vertical2(def: ComponentDef, shapes: SymShape[], w = 40): Build {
  const [a, b] = def.pins;
  return {
    w, h: 60,
    pins: [P(a.id, 0, -30, 'u', a.label), P(b.id, 0, 30, 'd', b.label)],
    shapes,
    ref: { x: w / 2 + 6, y: -4 }, value: { x: w / 2 + 6, y: 10 },
  };
}

function genericIc(def: ComponentDef): Build {
  const n = def.pins.length;
  const leftN = Math.ceil(n / 2);
  const rows = Math.max(leftN, 1);
  const maxLen = Math.max(1, ...def.pins.map((p) => p.label.length));
  const name = (def.mpn ?? def.name ?? def.type).slice(0, 16);
  // body width: both label columns plus the part name must fit; half width is a multiple of 10
  const need = Math.max(2 * maxLen * 6 + 24, name.length * 6 + 20, 60);
  const half = Math.ceil(need / 2 / 10) * 10;
  const bodyW = half * 2;
  const bodyH = rows * 20;
  const tip = half + 10;
  const top = -((rows - 1) * 10);
  const pins: SymPin[] = [];
  const shapes: SymShape[] = [{ t: 'rect', x: -half, y: -bodyH / 2, w: bodyW, h: bodyH }];
  def.pins.forEach((p, i) => {
    const left = i < leftN;
    const row = left ? i : i - leftN;
    const y = top + row * 20;
    if (left) {
      pins.push(P(p.id, -tip, y, 'l', p.label));
      shapes.push(path(`M${-tip} ${y}H${-half}`));
      shapes.push(text(-half + 4, y + 3, p.label, 'start'));
    } else {
      pins.push(P(p.id, tip, y, 'r', p.label));
      shapes.push(path(`M${tip} ${y}H${half}`));
      shapes.push(text(half - 4, y + 3, p.label, 'end'));
    }
  });
  shapes.push(text(0, 3, name, 'middle'));
  return {
    w: bodyW + 20, h: bodyH, pins, shapes,
    ref: { x: 0, y: -bodyH / 2 - 6 }, value: { x: 0, y: bodyH / 2 + 12 },
  };
}

function build(def: ComponentDef): Build {
  const n = def.pins.length;
  const model = def.model;

  if (model === 'resistor' && n === 2) {
    return horizontal2(def, [path('M-30 0H-20M20 0H30'), { t: 'rect', x: -20, y: -6, w: 40, h: 12 }]);
  }
  if (model === 'pot' && n === 3) {
    const [a, w, b] = def.pins;
    return {
      w: 60, h: 40,
      pins: [P(a.id, -30, 0, 'l', a.label), P(w.id, 0, -20, 'u', w.label), P(b.id, 30, 0, 'r', b.label)],
      shapes: [path('M-30 0H-20M20 0H30'), { t: 'rect', x: -20, y: -6, w: 40, h: 12 }, path('M0 -20V-8'), head(0, -6, 0, 1, 4)],
      ref: { x: 16, y: -22 }, value: { x: 0, y: 28 },
    };
  }
  if (model === 'capacitor' && n === 2) {
    const polar = def.pins[0].label.trim() === '+';
    const shapes: SymShape[] = [path('M-30 0H-4M4 0H30'), path('M-4 -12V12')];
    if (polar) { shapes.push(path('M10 -12Q4 0 10 12')); shapes.push(path('M4 0H10')); shapes.push(text(-12, -10, '+', 'middle')); }
    else shapes.push(path('M4 -12V12'));
    return horizontal2(def, shapes, 24);
  }
  if (model === 'inductor' && n === 2) {
    return horizontal2(def, [path('M-30 0H-20a5 5 0 0 1 10 0a5 5 0 0 1 10 0a5 5 0 0 1 10 0a5 5 0 0 1 10 0H30')], 20);
  }
  if (model === 'diode' && n === 2) {
    return horizontal2(def, [path('M-30 0H-8M8 0H30'), path('M-8 -10V10L8 0Z'), path('M8 -10V10')]);
  }
  if (model === 'led' && n === 2) {
    return horizontal2(def, [
      path('M-30 0H-8M8 0H30'), path('M-8 -10V10L8 0Z'), path('M8 -10V10'),
      path('M-4 -12L4 -22'), head(4, -22, 1, -1.25, 3.5), path('M2 -10L10 -20'), head(10, -20, 1, -1.25, 3.5),
    ], 40);
  }
  if (model === 'zener' && n === 2) {
    return horizontal2(def, [path('M-30 0H-8M8 0H30'), path('M-8 -10V10L8 0Z'), path('M12 -10H8V10H4')]);
  }
  if (model === 'switch' && n === 2) {
    const button = /button|buton/i.test(`${def.type} ${def.nameEn} ${def.name}`);
    const shapes: SymShape[] = [path('M-30 0H-15M15 0H30'), circle(-15, 0, 2.5), circle(15, 0, 2.5), path('M-15 0L12 -14')];
    if (button) { shapes.push(path('M-6 -17V-10')); shapes.push(path('M-12 -17H0')); }
    return horizontal2(def, shapes, 30);
  }

  if (model === 'vsource' && n === 2) {
    const bat = /^bat/i.test(def.type) || (def.tags ?? []).some((t) => /bat/i.test(t)) || /battery|pil/i.test(`${def.nameEn} ${def.name}`);
    const ac = def.params.some((p) => p.key === 'freq');
    if (bat) {
      const b = vertical2(def, [path('M0 -30V-4M0 4V30'), path('M-12 -4H12'), path('M-6 4H6'), text(-16, -6, '+', 'middle')]);
      return b;
    }
    const shapes: SymShape[] = [path('M0 -30V-20M0 20V30'), circle(0, 0, 20)];
    if (ac) shapes.push(path('M-10 0Q-5 -10 0 0T10 0'));
    else { shapes.push(text(0, -7, '+', 'middle')); shapes.push(text(0, 14, '−', 'middle')); }
    return vertical2(def, shapes);
  }
  if (model === 'isource' && n === 2) {
    return vertical2(def, [path('M0 -30V-20M0 20V30'), circle(0, 0, 20), path('M0 12V-8'), head(0, -12, 0, -1, 4)]);
  }
  if (model === 'ground' && n === 1) {
    return {
      w: 30, h: 30,
      pins: [P(def.pins[0].id, 0, -10, 'u', def.pins[0].label)],
      shapes: [path('M0 -10V0'), path('M-12 0H12'), path('M-8 5H8'), path('M-4 10H4')],
      ref: { x: 16, y: 0 }, value: { x: 16, y: 12 },
    };
  }
  if (model === 'motor' && n === 2) {
    const fan = def.prefix === 'FAN';
    return vertical2(def, [path('M0 -30V-20M0 20V30'), circle(0, 0, 20), text(0, 4, fan ? 'F' : 'M', 'middle')]);
  }
  if (model === 'solenoid' && n === 2) {
    // coil loops with a plunger (core bar) running underneath
    return horizontal2(def, [path('M-30 0H-20a5 5 0 0 1 10 0a5 5 0 0 1 10 0a5 5 0 0 1 10 0a5 5 0 0 1 10 0H30'), path('M-22 9H22'), path('M-22 12H22')], 30);
  }
  if (model === 'bldc' && n === 3) {
    const ids = pick(def, ['U', 'V', 'W']);
    if (ids) {
      const [u, v, w] = ids;
      return {
        w: 70, h: 60,
        pins: [P(u, -30, -20, 'l', lab(def, u)), P(v, -30, 0, 'l', lab(def, v)), P(w, -30, 20, 'l', lab(def, w))],
        shapes: [path('M-30 -20H-5M-30 0H-15M-30 20H-5'), circle(10, 0, 25), text(10, 2, 'M', 'middle'), text(10, 14, '3~', 'middle')],
        ref: { x: 10, y: -32 }, value: { x: 10, y: 42 },
      };
    }
  }
  if (model === 'eload' && n === 2) {
    return vertical2(def, [path('M0 -30V-20M0 20V30'), { t: 'rect', x: -15, y: -20, w: 30, h: 40 }, path('M0 -10V6'), head(0, 10, 0, 1, 4)]);
  }

  if ((model === 'npn' || model === 'pnp') && n === 3) {
    const ids = pick(def, ['C', 'B', 'E']);
    if (ids) {
      const [c, b, e] = ids;
      const shapes: SymShape[] = [
        circle(4, 0, 20), path('M-30 0H-5'), path('M-5 -12V12'),
        path('M-5 -5L10 -14V-30'), path('M-5 5L10 14V30'),
      ];
      if (model === 'npn') shapes.push(head(10, 14, 1.5, 1, 4));
      else shapes.push(head(-5, 5, -1.5, -1, 4));
      return {
        w: 60, h: 60,
        pins: [P(c, 10, -30, 'u', lab(def, c)), P(b, -30, 0, 'l', lab(def, b)), P(e, 10, 30, 'd', lab(def, e))],
        shapes, ref: { x: 30, y: -6 }, value: { x: 30, y: 8 },
      };
    }
  }
  if ((model === 'nmos' || model === 'pmos') && n === 3) {
    const ids = pick(def, ['G', 'D', 'S']);
    if (ids) {
      const [g, d, s] = ids;
      const shapes: SymShape[] = [
        path('M-30 0H-10'), path('M-10 -14V14'),
        path('M-4 -18V-10'), path('M-4 -4V4'), path('M-4 10V18'),
        path('M-4 -14H10V-30'), path('M-4 14H10V30'), path('M-4 0H10V14'),
      ];
      // body arrow: N-channel points at the channel, P-channel away from it
      shapes.push(model === 'nmos' ? head(-4, 0, -1, 0, 4) : head(4, 0, 1, 0, 4));
      return {
        w: 60, h: 60,
        pins: [P(g, -30, 0, 'l', lab(def, g)), P(d, 10, -30, 'u', lab(def, d)), P(s, 10, 30, 'd', lab(def, s))],
        shapes, ref: { x: 18, y: -4 }, value: { x: 18, y: 10 },
      };
    }
  }
  if (model === 'bridge' && n === 4) {
    const ids = pick(def, ['AC1', 'AC2', 'P', 'N']);
    if (ids) {
      const [a1, a2, p, nn] = ids;
      return {
        w: 60, h: 60,
        pins: [P(a1, -30, 0, 'l', lab(def, a1)), P(a2, 30, 0, 'r', lab(def, a2)), P(p, 0, -30, 'u', lab(def, p)), P(nn, 0, 30, 'd', lab(def, nn))],
        shapes: [
          path('M-30 0H-20M20 0H30M0 -30V-20M0 20V30'), path('M-20 0L0 -20L20 0L0 20Z'),
          text(-9, 3, '~', 'middle'), text(9, 3, '~', 'middle'), text(0, -9, '+', 'middle'), text(0, 14, '−', 'middle'),
        ],
        ref: { x: 20, y: -24 }, value: { x: 20, y: -12 },
      };
    }
  }
  if (model === 'relay' && n === 5) {
    const ids = pick(def, ['C1', 'C2', 'COM', 'NO', 'NC']);
    if (ids) {
      const [c1, c2, com, no, nc] = ids;
      return {
        w: 80, h: 50,
        pins: [
          P(c1, -40, -10, 'l', lab(def, c1)), P(c2, -40, 10, 'l', lab(def, c2)),
          P(com, 40, -20, 'r', lab(def, com)), P(no, 40, 0, 'r', lab(def, no)), P(nc, 40, 20, 'r', lab(def, nc)),
        ],
        shapes: [
          path('M-40 -10H-30M-40 10H-30'), { t: 'rect', x: -30, y: -15, w: 20, h: 30 },
          path('M-10 0H-4M0 0H6M10 0H14'),
          path('M40 -20H20'), circle(20, -20, 2, true), path('M20 -20L30 -4'),
          path('M40 0H30'), circle(30, 0, 2.5), path('M40 20H30'), circle(30, 20, 2.5),
          text(-20, 3, 'K', 'middle'),
        ],
        ref: { x: 0, y: -30 }, value: { x: 0, y: 38 },
      };
    }
  }
  if (model === 'transformer' && n === 4) {
    const ids = pick(def, ['P1', 'P2', 'S1', 'S2']);
    if (ids) {
      const [p1, p2, s1, s2] = ids;
      const coil = (x: number, sweep: 0 | 1) => `M${x} -20${`a5 5 0 0 ${sweep} 0 10`.repeat(4)}`;
      return {
        w: 80, h: 50,
        pins: [
          P(p1, -40, -20, 'l', lab(def, p1)), P(p2, -40, 20, 'l', lab(def, p2)),
          P(s1, 40, -20, 'r', lab(def, s1)), P(s2, 40, 20, 'r', lab(def, s2)),
        ],
        shapes: [
          path('M-40 -20H-6M-40 20H-6M40 -20H6M40 20H6'),
          path(coil(-6, 0)), path(coil(6, 1)), path('M-1 -20V20M1 -20V20'),
          circle(-16, -16, 1.5, true), circle(16, -16, 1.5, true),
        ],
        ref: { x: 0, y: -30 }, value: { x: 0, y: 38 },
      };
    }
  }

  return genericIc(def);
}

const cache = new WeakMap<ComponentDef, Symbol>();

/** schematic symbol for a library part */
export function symbolFor(def: ComponentDef): Symbol {
  const hit = cache.get(def);
  if (hit && hit.pins.length === def.pins.length) return hit;
  let b = build(def);
  const ids = new Set(b.pins.map((p) => p.id));
  if (ids.size !== def.pins.length || def.pins.some((p) => !ids.has(p.id))) b = genericIc(def);
  const sym: Symbol = { w: b.w, h: b.h, pins: b.pins, shapes: b.shapes, ref: b.ref, value: b.value };
  cache.set(def, sym);
  return sym;
}
