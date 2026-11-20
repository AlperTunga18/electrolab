import type { Circuit, PlacedComponent } from '../circuit/types';
import { getDef } from '../../library/components';
import { buildNets } from '../circuit/nets';
import { footprintFor, isPhysical } from './footprints';
import { polyBBox } from './geom';
import { generateFootprint, pinCountOf } from './landPatterns';
import type { ComponentDef } from '../../library/types';
import { defaultClass } from './netclass';
import { DEFAULT_RULES, type Footprint, type Pad, type PcbDesign, type PcbPlacement } from './types';

/** A pad in board coordinates. */
export interface WorldPad {
  comp: string;
  ref: string;
  pin: string;
  x: number;
  y: number;
  /** width/height after rotation */
  w: number;
  h: number;
  shape: Pad['shape'];
  drill: number;
  /** copper layers this pad exists on */
  layers: ('top' | 'bottom')[];
  /** schematic net index (0 = ground) */
  net: number;
}

export function rotate(x: number, y: number, rot: number): [number, number] {
  switch (rot) {
    case 90: return [-y, x];
    case 180: return [-x, -y];
    case 270: return [y, -x];
    default: return [x, y];
  }
}

/** transform a footprint pad to board coordinates (bottom side mirrors x before rotation) */
export function placePad(pad: Pad, pl: PcbPlacement): { x: number; y: number; w: number; h: number } {
  const lx = pl.side === 'bottom' ? -pad.x : pad.x;
  const [rx, ry] = rotate(lx, pad.y, pl.rot);
  const swap = pl.rot === 90 || pl.rot === 270;
  return { x: pl.x + rx, y: pl.y + ry, w: swap ? pad.h : pad.w, h: swap ? pad.w : pad.h };
}

export function worldPads(circuit: Circuit, design: PcbDesign): WorldPad[] {
  const nets = buildNets(circuit);
  const out: WorldPad[] = [];
  for (const c of circuit.components) {
    const def = getDef(c.type);
    if (!isPhysical(def)) continue;
    const pl = design.placements[c.id];
    if (!pl) continue;
    const fp = resolveFootprint(def, pl, design).fp;
    for (const pad of fp.pads) {
      const wp = placePad(pad, pl);
      out.push({
        comp: c.id, ref: c.ref, pin: pad.pin, ...wp, shape: pad.shape, drill: pad.drill,
        layers: pad.drill > 0 ? ['top', 'bottom'] : [pl.side], net: nets.pinNet.get(`${c.id}:${pad.pin}`) ?? -1,
      });
    }
  }
  return out;
}

/**
 * Footprint of a placed part honouring placements[id].footprint (custom first, then generator key). The override is rejected
 * (default footprint + `warning`) when its distinct pin count differs from the part's pin count or the key is unknown.
 * Override pads are renamed to the part's pin ids by order of first appearance.
 */
export function resolveFootprint(def: ComponentDef, pl?: PcbPlacement, design?: PcbDesign): { fp: Footprint; warning?: string } {
  const key = pl?.footprint;
  if (!key) return { fp: footprintFor(def) };
  const cand = design?.customFootprints?.[key] ?? generateFootprint(key);
  if (!cand) return { fp: footprintFor(def), warning: `Bilinmeyen footprint "${key}"; varsayılan kullanıldı.` };
  const n = pinCountOf(cand);
  if (n !== def.pins.length) return { fp: footprintFor(def), warning: `Footprint "${key}" ${n} pinli, parça ${def.pins.length} pinli; varsayılan kullanıldı.` };
  const order: string[] = [];
  for (const p of cand.pads) if (!order.includes(p.pin)) order.push(p.pin);
  return { fp: footprintFor(def, { ...cand, pads: cand.pads.map((p) => ({ ...p, pin: def.pins[order.indexOf(p.pin)].id })) }) };
}

export const footprintOf = (c: PlacedComponent, design?: PcbDesign): Footprint => resolveFootprint(getDef(c.type), design?.placements[c.id], design).fp;

/** Places every physical part in rows (BFS order from the sources) and sizes the board around them. */
export function autoPlace(circuit: Circuit, rules = DEFAULT_RULES): PcbDesign {
  const phys = circuit.components.filter((c) => isPhysical(getDef(c.type)));
  const nets = buildNets(circuit);
  const adj = new Map<string, Set<string>>();
  const byNet = new Map<number, string[]>();
  for (const c of phys) for (const p of getDef(c.type).pins) {
    const n = nets.pinNet.get(`${c.id}:${p.id}`);
    if (n === undefined || n === 0) continue; // ground touches everything: ignore for ordering
    byNet.set(n, [...(byNet.get(n) ?? []), c.id]);
  }
  for (const list of byNet.values()) for (const a of list) for (const b of list) if (a !== b) { (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b); }
  const order: string[] = [];
  const seen = new Set<string>();
  const starts = [...phys.filter((c) => ['vsource', 'isource'].includes(getDef(c.type).model)), ...phys];
  for (const s of starts) {
    if (seen.has(s.id)) continue;
    const q = [s.id]; seen.add(s.id);
    while (q.length) {
      const id = q.shift()!;
      order.push(id);
      for (const nb of adj.get(id) ?? []) if (!seen.has(nb)) { seen.add(nb); q.push(nb); }
    }
  }
  const GAP = 3, MAXW = 90, M = 6;
  const placements: Record<string, PcbPlacement> = {};
  let x = M, y = M, rowH = 0, maxX = 0;
  for (const id of order) {
    const fp = footprintOf(circuit.components.find((c) => c.id === id)!);
    if (x + fp.width > MAXW + M && x > M) { x = M; y += rowH + GAP; rowH = 0; }
    placements[id] = { x: x + fp.width / 2, y: y + fp.height / 2, rot: 0, side: 'top' };
    x += fp.width + GAP; rowH = Math.max(rowH, fp.height); maxX = Math.max(maxX, x - GAP);
  }
  return { outline: { w: Math.ceil(maxX + M), h: Math.ceil(y + rowH + M) }, placements, tracks: [], vias: [], zones: [], rules };
}

/** the stored design, extended with placements for parts added later and without those of removed parts */
export function ensureDesign(circuit: Circuit): PcbDesign {
  return withNetDefaults(ensureDesignRaw(circuit));
}

/** adds the optional net class / net name fields (older projects lack them); existing values are kept */
function withNetDefaults(d: PcbDesign): PcbDesign {
  const rules = d.rules.netClasses ? d.rules : { ...d.rules, netClasses: [defaultClass(d.rules)] };
  return { ...d, rules, netClassOf: d.netClassOf ?? {}, netNames: d.netNames ?? {} };
}

function ensureDesignRaw(circuit: Circuit): PcbDesign {
  if (!circuit.pcb) return autoPlace(circuit);
  const d = circuit.pcb;
  const ids = new Set(circuit.components.filter((c) => isPhysical(getDef(c.type))).map((c) => c.id));
  const placements = Object.fromEntries(Object.entries(d.placements).filter(([id]) => ids.has(id)));
  const missing = circuit.components.filter((c) => ids.has(c.id) && !placements[c.id]);
  let y = Math.max(8, ...Object.entries(placements).map(([id, p]) => p.y + footprintOf(circuit.components.find((c) => c.id === id)!, d).height / 2)) + 4;
  let x = 6;
  for (const c of missing) { const fp = footprintOf(c, d); placements[c.id] = { x: x + fp.width / 2, y: y + fp.height / 2, rot: 0, side: 'top' }; x += fp.width + 3; if (x > 90) { x = 6; y += 14; } }
  if (d.outline.poly && d.outline.poly.length >= 3) { // polygon board: size follows the polygon, never grows with the parts
    const bb = polyBBox(d.outline.poly);
    return { ...d, placements, outline: { ...d.outline, w: Math.max(d.outline.w, bb[2]), h: Math.max(d.outline.h, bb[3]) } };
  }
  return { ...d, placements, outline: { w: Math.max(d.outline.w, ...Object.values(placements).map((p) => p.x + 8)), h: Math.max(d.outline.h, ...Object.values(placements).map((p) => p.y + 8)) } };
}
