import type { ComponentDef } from '../../library/types';
import { packageClass } from '../thermal/thermal';
import type { Footprint, Pad } from './types';

/**
 * Footprints are GENERATED from the library pin layout (visual 0.5 cm grid == 2.54 mm pitch) and the package class.
 * They follow common conventions (axial 10.16 mm, radial 5.08 mm, DIP 7.62 mm rows, TO-220/TO-92 2.54 mm, SOT-23 0.95 mm,
 * 0805-style SMD) but are NOT manufacturer land patterns: verify against the datasheet before ordering boards.
 */

const MM = 5.08; // library cm-units (0.5 grid) -> mm (2.54 pitch)

export const isPhysical = (def: ComponentDef): boolean => def.model !== 'ground';

function minPitch(ps: { x: number; y: number }[]): number {
  let m = Infinity;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) m = Math.min(m, Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y));
  return Number.isFinite(m) ? m : 5;
}

/** `override` (an already resolved footprint, see resolveFootprint in design.ts) replaces the generated one; omitted = original behaviour */
export function footprintFor(def: ComponentDef, override?: Footprint): Footprint {
  if (override) return override;
  const pkg = packageClass(def);
  const n = def.pins.length;
  let pads: Pad[];
  let smd = false;
  if (pkg === 'smd' && n === 2 && def.model !== 'bridge') {
    smd = true;
    pads = def.pins.map((p, i) => ({ pin: p.id, x: i === 0 ? -1.0 : 1.0, y: 0, shape: 'rect' as const, w: 1.0, h: 1.3, drill: 0 }));
  } else if (pkg === 'sot23' && n === 3) {
    smd = true;
    const xs = [-0.95, 0.95, 0];
    const ys = [1.0, 1.0, -1.0];
    pads = def.pins.map((p, i) => ({ pin: p.id, x: xs[i], y: ys[i], shape: 'rect' as const, w: 0.8, h: 1.0, drill: 0 }));
  } else {
    const dip = pkg === 'dip' || (def.visual?.kind === 'ic' && n >= 6 && new Set(def.pins.map((p) => Math.sign(p.x))).size === 2);
    const raw = def.pins.map((p) => ({ pin: p.id, x: p.x * (dip ? 2.54 : MM), y: p.z * MM }));
    const pitch = minPitch(raw);
    const dia = pitch < 2.4 ? 1.5 : 1.8, drill = pitch < 2.4 ? 0.8 : 0.9;
    pads = raw.map((r, i) => ({ pin: r.pin, x: r.x, y: r.y, shape: i === 0 && n > 1 ? ('rect' as const) : ('circle' as const), w: dia, h: dia, drill }));
  }
  const xs = pads.map((p) => p.x), ys = pads.map((p) => p.y);
  const w0 = Math.max(...xs.map((x, i) => Math.abs(x) + pads[i].w / 2)), h0 = Math.max(...ys.map((y, i) => Math.abs(y) + pads[i].h / 2));
  const width = Math.max(2 * w0 + 1.0, smd ? 0 : def.size.w * 8), height = Math.max(2 * h0 + 1.0, smd ? 0 : def.size.d * 8);
  const x1 = -width / 2, x2 = width / 2, y1 = -height / 2, y2 = height / 2;
  return {
    name: `${smd ? 'SMD' : 'TH'}-${pkg}-${n}P`, pads, width, height, smd,
    silk: [{ x1, y1, x2, y2: y1 }, { x1: x2, y1, x2, y2 }, { x1: x2, y1: y2, x2: x1, y2 }, { x1, y1: y2, x2: x1, y2: y1 }],
  };
}
