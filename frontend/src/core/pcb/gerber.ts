import type { Circuit } from '../circuit/types';
import { getDef } from '../../library/components';
import { formatSI } from '../units';
import { isPhysical } from './footprints';
import { resolveFootprint, rotate, worldPads, type WorldPad } from './design';
import type { PcbDesign, PcbPlacement, Zone, ZoneLayer } from './types';
import { offsetPoly, outlinePoly, pointInPoly, polyBBox, type Poly } from './geom';
import { textStrokes } from './strokeFont';

/**
 * Fabrication outputs: RS-274X Gerber (4.6 mm), Excellon drill, pick-and-place CSV, fab BOM and a STORE-only ZIP writer.
 * Our data has y DOWN; Gerber/Excellon/PnP use y UP: y_g = outline.h - y.
 */

const MASK_EXPAND = 0.05;
const EDGE_W = 0.1;
const SILK_W = 0.15;
const EPS = 1e-6;
const MISSING = 'EKSİK';

// ---------------------------------------------------------------- Gerber writer

type ApKind = 'C' | 'R' | 'O';

class GerberLayer {
  private defs: string[] = [];
  private codes = new Map<string, number>();
  private body: string[] = [];
  private cur = -1;
  private next = 10;
  constructor(private H: number, private attrs: string[]) {}

  private n(v: number): string { return String(Math.round(v * 1e6)); }
  private xy(x: number, y: number): string { return `X${this.n(x)}Y${this.n(this.H - y)}`; }

  aperture(kind: ApKind, w: number, h = w): void {
    const key = `${kind}${w.toFixed(6)}x${h.toFixed(6)}`;
    let code = this.codes.get(key);
    if (code === undefined) {
      code = this.next++;
      this.codes.set(key, code);
      this.defs.push(kind === 'C' ? `%ADD${code}C,${w.toFixed(6)}*%` : `%ADD${code}${kind},${w.toFixed(6)}X${h.toFixed(6)}*%`);
    }
    if (code !== this.cur) { this.body.push(`D${code}*`); this.cur = code; }
  }
  polarity(p: 'D' | 'C'): void { this.body.push(`%LP${p}*%`); }
  flash(x: number, y: number): void { this.body.push(`${this.xy(x, y)}D03*`); }
  draw(pts: [number, number][]): void {
    if (pts.length === 0) return;
    this.body.push(`${this.xy(pts[0][0], pts[0][1])}D02*`);
    if (pts.length === 1) { this.body.push(`${this.xy(pts[0][0], pts[0][1])}D01*`); return; }
    for (let i = 1; i < pts.length; i++) this.body.push(`${this.xy(pts[i][0], pts[i][1])}D01*`);
  }
  region(pts: [number, number][]): void {
    this.body.push('G36*');
    this.body.push(`${this.xy(pts[0][0], pts[0][1])}D02*`);
    for (let i = 1; i < pts.length; i++) this.body.push(`${this.xy(pts[i][0], pts[i][1])}D01*`);
    this.body.push(`${this.xy(pts[0][0], pts[0][1])}D01*`);
    this.body.push('G37*');
  }
  /** flash a pad shape expanded by `e` per side */
  pad(p: { x: number; y: number; w: number; h: number; shape: 'circle' | 'rect' | 'oval' }, e: number): void {
    if (p.shape === 'circle') this.aperture('C', Math.max(p.w, p.h) + 2 * e);
    else this.aperture(p.shape === 'rect' ? 'R' : 'O', p.w + 2 * e, p.h + 2 * e);
    this.flash(p.x, p.y);
  }
  toString(): string {
    return [
      ...this.attrs.map((a) => `%${a}*%`),
      '%FSLAX46Y46*%', '%MOMM*%', 'G01*', '%LPD*%',
      ...this.defs, ...this.body, 'M02*',
    ].join('\n') + '\n';
  }
}

const gerber = (H: number, fn: string): GerberLayer =>
  new GerberLayer(H, ['TF.GenerationSoftware,electrolab,fabrication export', `TF.FileFunction,${fn}`, 'TF.FilePolarity,Positive']);

// ---------------------------------------------------------------- net resolution

class UF {
  p: number[];
  constructor(n: number) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(a: number): number { while (this.p[a] !== a) { this.p[a] = this.p[this.p[a]]; a = this.p[a]; } return a; }
  union(a: number, b: number): void { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p[ra] = rb; }
}

function segDist(px: number, py: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

const inPad = (p: WorldPad, x: number, y: number, m = 0): boolean => Math.abs(x - p.x) <= p.w / 2 + m + EPS && Math.abs(y - p.y) <= p.h / 2 + m + EPS;

interface NetInfo { pad: number[]; via: number[]; track: number[] }

/** geometric net of every pad / via / track (-1 = unknown). Pads carry the schematic net; copper touching them inherits it. */
function resolveNets(pads: WorldPad[], design: PcbDesign): NetInfo {
  const P = pads.length, V = design.vias.length, T = design.tracks.length;
  const netIds = [...new Set(pads.map((p) => p.net).filter((n) => n >= 0))];
  const virt = new Map(netIds.map((n, i) => [n, P + V + T + i]));
  const uf = new UF(P + V + T + netIds.length);
  pads.forEach((p, i) => { const v = virt.get(p.net); if (v !== undefined) uf.union(i, v); });
  design.vias.forEach((v, vi) => {
    pads.forEach((p, pi) => { if (inPad(p, v.x, v.y)) uf.union(P + vi, pi); });
    design.vias.forEach((w, wi) => { if (wi > vi && Math.hypot(v.x - w.x, v.y - w.y) <= Math.max(v.dia, w.dia) / 2 + EPS) uf.union(P + vi, P + wi); });
  });
  design.tracks.forEach((t, ti) => {
    const node = P + V + ti;
    for (const [x, y] of t.pts) {
      pads.forEach((p, pi) => { if (p.layers.includes(t.layer) && inPad(p, x, y)) uf.union(node, pi); });
      design.vias.forEach((v, vi) => { if (Math.hypot(x - v.x, y - v.y) <= v.dia / 2 + EPS) uf.union(node, P + vi); });
      design.tracks.forEach((o, oi) => {
        if (oi === ti || o.layer !== t.layer) return;
        for (let k = 0; k + 1 < o.pts.length; k++) if (segDist(x, y, o.pts[k], o.pts[k + 1]) <= o.width / 2 + EPS) { uf.union(node, P + V + oi); break; }
      });
    }
  });
  const rootNet = new Map<number, number>();
  for (const [n, v] of virt) if (!rootNet.has(uf.find(v))) rootNet.set(uf.find(v), n);
  const of = (i: number) => rootNet.get(uf.find(i)) ?? -1;
  return {
    pad: pads.map((_, i) => of(i)),
    via: design.vias.map((_, i) => of(P + i)),
    track: design.tracks.map((_, i) => of(P + V + i)),
  };
}

// ---------------------------------------------------------------- layers

const LAYER_FN: Record<ZoneLayer, string> = { top: 'Copper,L1,Top', bottom: 'Copper,L4,Bot', in1: 'Copper,L2,Inr', in2: 'Copper,L3,Inr' };

/** pour polygon of a zone: its own polygon, else the board polygon inset by the edge clearance (null = nothing to pour) */
function zonePoly(z: Zone, design: PcbDesign): Poly | null {
  if (z.poly && z.poly.length >= 3) return z.poly;
  const inset = offsetPoly(outlinePoly(design.outline), design.rules.edgeClearance);
  return inset.length >= 3 ? inset : null;
}

function copperLayer(layer: ZoneLayer, pads: WorldPad[], nets: NetInfo, design: PcbDesign, warnings: string[]): GerberLayer {
  const { h } = design.outline;
  const g = gerber(h, LAYER_FN[layer]);
  const outer = layer === 'top' || layer === 'bottom';
  const layerPads = pads.map((p, i) => ({ p, i })).filter(({ p }) => (outer ? p.layers.includes(layer) : p.drill > 0));
  // several zones on one layer: filled in ascending priority (stable), so a higher priority zone is poured over lower ones
  const zones = design.zones.filter((z) => z.layer === layer).map((z, k) => ({ z, k })).sort((a, b) => (a.z.priority ?? 0) - (b.z.priority ?? 0) || a.k - b.k).map(({ z }) => z);
  if (!outer && !zones.length) warnings.push(`${layer} iç katmanında bölge yok: düzlem boş`);

  const filled: { z: Zone; poly: Poly; net: number }[] = [];
  for (const zone of zones) {
    const anchor = pads.findIndex((p) => p.comp === zone.anchor.comp && p.pin === zone.anchor.pin);
    if (anchor < 0) { warnings.push(`${layer} bölgesinin çapa pini (${zone.anchor.comp}.${zone.anchor.pin}) bulunamadı: bölge atlandı`); continue; }
    const poly = zonePoly(zone, design);
    if (!poly) { warnings.push('Kart bölge için çok küçük: bölge atlandı'); continue; }
    const zn = nets.pad[anchor], c = zone.clearance;
    const [bx0, by0, bx1, by1] = polyBBox(poly);
    const near = (x0: number, y0: number, x1: number, y1: number, e: number): boolean => x1 + e >= bx0 && x0 - e <= bx1 && y1 + e >= by0 && y0 - e <= by1;
    // lower priority zones of another net lose the area (plus clearance) covered by this one
    if (filled.some((f) => f.net !== zn || zn < 0)) { g.polarity('C'); const grown = offsetPoly(poly, -c); g.region(grown.length >= 3 ? grown : poly); }
    g.polarity('D');
    g.region(poly);
    g.polarity('C');
    for (const { p, i } of layerPads) {
      if (!near(p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2, c)) continue;
      const same = nets.pad[i] === zn && zn >= 0;
      if (!same) g.pad(p, c);
      else if (zone.thermal && pointInPoly(poly, p.x, p.y)) g.pad(p, zone.thermal.gap); // thermal relief: ring cleared, spokes drawn below
    }
    for (let i = 0; i < design.vias.length; i++) if (nets.via[i] !== zn || zn < 0) { const v = design.vias[i]; if (near(v.x, v.y, v.x, v.y, c + v.dia / 2)) { g.aperture('C', v.dia + 2 * c); g.flash(v.x, v.y); } }
    if (outer) design.tracks.forEach((t, i) => {
      if (t.layer !== layer || (nets.track[i] === zn && zn >= 0)) return;
      const xs = t.pts.map((q) => q[0]), ys = t.pts.map((q) => q[1]);
      if (near(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), c + t.width / 2)) { g.aperture('C', t.width + 2 * c); g.draw(t.pts); }
    });
    for (const m of design.holes ?? []) if (near(m.x, m.y, m.x, m.y, c + m.drill / 2)) { g.aperture('C', m.drill + 2 * c); g.flash(m.x, m.y); } // NPTH keep-out
    g.polarity('D');
    if (zone.thermal) {
      const { gap, spokeW } = zone.thermal;
      g.aperture('C', spokeW);
      for (const { p, i } of layerPads) {
        if (!(nets.pad[i] === zn && zn >= 0) || !pointInPoly(poly, p.x, p.y)) continue;
        const rx = p.w / 2 + gap + 0.05, ry = p.h / 2 + gap + 0.05;
        g.draw([[p.x, p.y], [p.x + rx, p.y]]); g.draw([[p.x, p.y], [p.x - rx, p.y]]);
        g.draw([[p.x, p.y], [p.x, p.y + ry]]); g.draw([[p.x, p.y], [p.x, p.y - ry]]);
      }
    }
    filled.push({ z: zone, poly, net: zn });
  }
  if (outer) {
    for (const t of design.tracks) if (t.layer === layer) { g.aperture('C', t.width); g.draw(t.pts); }
    for (const { p } of layerPads) g.pad(p, 0);
  } else if (filled.length) {
    // plane: same-net holes connect (flash the pad over the pour), others were cleared above
    for (const { p, i } of layerPads) if (filled.some((f) => nets.pad[i] === f.net && f.net >= 0 && pointInPoly(f.poly, p.x, p.y))) g.pad(p, 0);
  }
  if (outer) for (const v of design.vias) { g.aperture('C', v.dia); g.flash(v.x, v.y); }
  else if (filled.length) design.vias.forEach((v, i) => { if (filled.some((f) => nets.via[i] === f.net && f.net >= 0 && pointInPoly(f.poly, v.x, v.y))) { g.aperture('C', v.dia); g.flash(v.x, v.y); } });
  return g;
}

function maskLayer(side: 'top' | 'bottom', pads: WorldPad[], h: number): GerberLayer {
  const g = gerber(h, `Soldermask,${side === 'top' ? 'Top' : 'Bot'}`);
  for (const p of pads) if (p.layers.includes(side)) g.pad(p, MASK_EXPAND); // vias are tented: no opening
  return g;
}

const REF_H = 1.0;

/** Silkscreen of one side: footprint outlines + reference text. The bottom file is plotted in top view, so bottom parts
 * (and their text) are mirrored in x, exactly like the pads (see placePad). */
function silkLayer(side: 'top' | 'bottom', circuit: Circuit, design: PcbDesign): GerberLayer {
  const g = gerber(design.outline.h, side === 'top' ? 'Legend,Top' : 'Legend,Bot');
  g.aperture('C', SILK_W);
  const mirror = side === 'bottom';
  for (const c of circuit.components) {
    const def = getDef(c.type);
    const pl: PcbPlacement | undefined = design.placements[c.id];
    if (!isPhysical(def) || !pl || pl.side !== side) continue;
    const fp = resolveFootprint(def, pl, design).fp;
    for (const s of fp.silk) {
      const [ax, ay] = rotate(mirror ? -s.x1 : s.x1, s.y1, pl.rot), [bx, by] = rotate(mirror ? -s.x2 : s.x2, s.y2, pl.rot);
      g.draw([[pl.x + ax, pl.y + ay], [pl.x + bx, pl.y + by]]);
    }
    // reference text just above the (rotated) courtyard, always upright
    const swap = pl.rot === 90 || pl.rot === 270;
    const halfH = (swap ? fp.width : fp.height) / 2;
    for (const stroke of textStrokes(c.ref, { x: pl.x, y: pl.y - halfH - REF_H, height: REF_H, mirror })) g.draw(stroke);
  }
  return g;
}

/** Paste stencil openings: SMD pads only (no drill), pad-sized, per side */
function pasteLayer(side: 'top' | 'bottom', pads: WorldPad[], h: number): GerberLayer {
  const g = gerber(h, `Paste,${side === 'top' ? 'Top' : 'Bot'}`);
  for (const p of pads) if (p.drill <= 0 && p.layers.includes(side)) g.pad(p, 0);
  return g;
}

function edgeLayer(design: PcbDesign): GerberLayer {
  const g = gerber(design.outline.h, 'Profile,NP');
  g.aperture('C', EDGE_W);
  const poly = outlinePoly(design.outline);
  g.draw([...poly, poly[0]]);
  return g;
}

/** Excellon, metric, trailing-zero format with explicit decimal points (so zero suppression is moot) */
function drillFile(pads: WorldPad[], design: PcbDesign, plated: boolean): string {
  const H = design.outline.h;
  const holes: { d: number; x: number; y: number }[] = [];
  // pad holes and vias are plated; only design.holes (mounting holes) are non-plated
  if (plated) {
    for (const p of pads) if (p.drill > 0) holes.push({ d: p.drill, x: p.x, y: p.y });
    for (const v of design.vias) holes.push({ d: v.drill, x: v.x, y: v.y });
  } else for (const m of design.holes ?? []) holes.push({ d: m.drill, x: m.x, y: m.y });
  const dias = [...new Set(holes.map((x) => x.d.toFixed(3)))].sort((a, b) => Number(a) - Number(b));
  const out = ['M48', '; DRILL file {electrolab} format: metric, coordinates in mm with decimal point, trailing zeros (METRIC,TZ)', plated ? '; #@! TF.FileFunction,Plated,1,2,PTH' : '; #@! TF.FileFunction,NonPlated,1,2,NPTH', plated ? '; All holes plated (PTH)' : (design.holes?.length ? '; Non-plated holes (NPTH): mounting holes' : '; Non-plated holes (NPTH): none in the model, file intentionally empty'), 'FMAT,2', 'METRIC,TZ'];
  dias.forEach((d, i) => out.push(`T${i + 1}C${d}`));
  out.push('%', 'G90', 'G05');
  dias.forEach((d, i) => {
    out.push(`T${i + 1}`);
    for (const h of holes) if (h.d.toFixed(3) === d) out.push(`X${h.x.toFixed(3)}Y${(H - h.y).toFixed(3)}`);
  });
  out.push('M30');
  return out.join('\n') + '\n';
}

export function exportFabrication(circuit: Circuit, design: PcbDesign, opts: { name?: string } = {}): { files: { name: string; content: string }[]; warnings: string[] } {
  const n = opts.name ?? 'electrolab';
  const warnings: string[] = ['referans yazıları silkscreen\'e eklenmedi'];
  const pads = worldPads(circuit, design);
  const nets = resolveNets(pads, design);
  const files: { name: string; content: string }[] = [];
  const add = (name: string, g: GerberLayer | string) => files.push({ name: `${n}-${name}`, content: typeof g === 'string' ? g : g.toString() });
  add('F_Cu.gtl', copperLayer('top', pads, nets, design, warnings));
  add('B_Cu.gbl', copperLayer('bottom', pads, nets, design, warnings));
  if (design.rules.layers === 4) {
    add('In1_Cu.g2', copperLayer('in1', pads, nets, design, warnings));
    add('In2_Cu.g3', copperLayer('in2', pads, nets, design, warnings));
  }
  add('F_Mask.gts', maskLayer('top', pads, design.outline.h));
  add('B_Mask.gbs', maskLayer('bottom', pads, design.outline.h));
  add('F_Paste.gtp', pasteLayer('top', pads, design.outline.h));
  add('B_Paste.gbp', pasteLayer('bottom', pads, design.outline.h));
  add('F_Silkscreen.gto', silkLayer('top', circuit, design));
  add('B_Silkscreen.gbo', silkLayer('bottom', circuit, design));
  add('Edge_Cuts.gm1', edgeLayer(design));
  add('PTH.drl', drillFile(pads, design, true));
  add('NPTH.drl', drillFile(pads, design, false));
  return { files, warnings };
}

// ---------------------------------------------------------------- CSVs

const csvCell = (x: string | number): string => { const s = String(x); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (rows: (string | number)[][]): string => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

function valueSummary(c: Circuit['components'][number]): string {
  const def = getDef(c.type);
  return def.params
    .filter((p) => p.type === 'number' && ['r', 'c', 'l', 'v', 'vz', 'i', 'amp', 'freq'].includes(p.key))
    .map((p) => `${p.label}=${p.si ? formatSI(Number(c.params[p.key]), p.unit) : c.params[p.key]}`)
    .join('; ');
}

const packageName = (c: Circuit['components'][number], design?: PcbDesign): string => {
  const def = getDef(c.type);
  const pl = design?.placements[c.id];
  if (pl?.footprint) { const r = resolveFootprint(def, pl, design); if (!r.warning) return r.fp.name; }
  return def.package ?? resolveFootprint(def).fp.name;
};

export function pickAndPlaceCsv(circuit: Circuit, design: PcbDesign): string {
  const rows: (string | number)[][] = [['Ref', 'Val', 'Package', 'PosX', 'PosY', 'Rot', 'Side']];
  for (const c of [...circuit.components].sort((a, b) => natural(a.ref, b.ref))) {
    const def = getDef(c.type);
    const pl = design.placements[c.id];
    if (!isPhysical(def) || !pl) continue;
    rows.push([c.ref, valueSummary(c), packageName(c, design), pl.x.toFixed(3), (design.outline.h - pl.y).toFixed(3), (360 - pl.rot) % 360, pl.side === 'top' ? 'Top' : 'Bottom']);
  }
  return csv(rows);
}

export function bomForFab(circuit: Circuit): string {
  const groups = new Map<string, { refs: string[]; c: Circuit['components'][number]; value: string }>();
  for (const c of circuit.components) {
    const def = getDef(c.type);
    if (!isPhysical(def)) continue;
    const value = valueSummary(c);
    const key = `${c.type}|${value}`;
    const g = groups.get(key);
    if (g) g.refs.push(c.ref); else groups.set(key, { refs: [c.ref], c, value });
  }
  const rows: (string | number)[][] = [['Ref', 'Qty', 'Type', 'Value', 'Footprint', 'Manufacturer', 'MPN', 'Datasheet', 'Note']];
  const list = [...groups.values()].map((g) => ({ ...g, refs: g.refs.sort(natural) })).sort((a, b) => natural(a.refs[0], b.refs[0]));
  for (const g of list) {
    const def = getDef(g.c.type);
    rows.push([
      g.refs.join(' '), g.refs.length, def.name, g.value || MISSING, packageName(g.c),
      def.manufacturer ?? MISSING, def.mpn ?? MISSING, def.datasheetUrl ?? def.datasheet ?? MISSING,
      def.dataSource === 'generic-model' ? 'Genel model: üretici parçası değil' : '',
    ]);
  }
  return csv(rows);
}

// ---------------------------------------------------------------- ZIP (STORE)

let crcTable: Uint32Array | null = null;
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function makeZip(files: { name: string; data: Uint8Array | string }[]): Uint8Array {
  const enc = new TextEncoder();
  const entries = files.map((f) => ({ name: enc.encode(f.name), data: typeof f.data === 'string' ? enc.encode(f.data) : f.data }));
  const DOS_TIME = 0, DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01 00:00 (deterministic)
  let size = 22;
  for (const e of entries) size += 30 + 46 + 2 * e.name.length + e.data.length;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let o = 0;
  const offsets: number[] = [];
  const crcs = entries.map((e) => crc32(e.data));
  entries.forEach((e, i) => {
    offsets.push(o);
    dv.setUint32(o, 0x04034b50, true); dv.setUint16(o + 4, 20, true); dv.setUint16(o + 6, 0x0800, true); dv.setUint16(o + 8, 0, true);
    dv.setUint16(o + 10, DOS_TIME, true); dv.setUint16(o + 12, DOS_DATE, true); dv.setUint32(o + 14, crcs[i], true);
    dv.setUint32(o + 18, e.data.length, true); dv.setUint32(o + 22, e.data.length, true);
    dv.setUint16(o + 26, e.name.length, true); dv.setUint16(o + 28, 0, true);
    out.set(e.name, o + 30); out.set(e.data, o + 30 + e.name.length);
    o += 30 + e.name.length + e.data.length;
  });
  const cdStart = o;
  entries.forEach((e, i) => {
    dv.setUint32(o, 0x02014b50, true); dv.setUint16(o + 4, 20, true); dv.setUint16(o + 6, 20, true); dv.setUint16(o + 8, 0x0800, true); dv.setUint16(o + 10, 0, true);
    dv.setUint16(o + 12, DOS_TIME, true); dv.setUint16(o + 14, DOS_DATE, true); dv.setUint32(o + 16, crcs[i], true);
    dv.setUint32(o + 20, e.data.length, true); dv.setUint32(o + 24, e.data.length, true);
    dv.setUint16(o + 28, e.name.length, true); // extra, comment, disk, int attr, ext attr stay 0
    dv.setUint32(o + 42, offsets[i], true);
    out.set(e.name, o + 46);
    o += 46 + e.name.length;
  });
  dv.setUint32(o, 0x06054b50, true); dv.setUint16(o + 8, entries.length, true); dv.setUint16(o + 10, entries.length, true);
  dv.setUint32(o + 12, o - cdStart, true); dv.setUint32(o + 16, cdStart, true);
  return out;
}

/** parse the central directory (test helper); data is the stored bytes read via the local header */
export function readZip(bytes: Uint8Array): { name: string; crc: number; size: number; data: Uint8Array }[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let e = bytes.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('ZIP: EOCD yok');
  const count = dv.getUint16(e + 10, true);
  let o = dv.getUint32(e + 16, true);
  const dec = new TextDecoder();
  const res: { name: string; crc: number; size: number; data: Uint8Array }[] = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(o, true) !== 0x02014b50) throw new Error('ZIP: bozuk merkezi dizin');
    const crc = dv.getUint32(o + 16, true), size = dv.getUint32(o + 24, true);
    const nl = dv.getUint16(o + 28, true), xl = dv.getUint16(o + 30, true), cl = dv.getUint16(o + 32, true), lo = dv.getUint32(o + 42, true);
    const name = dec.decode(bytes.subarray(o + 46, o + 46 + nl));
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    res.push({ name, crc, size, data: bytes.subarray(start, start + size) });
    o += 46 + nl + xl + cl;
  }
  return res;
}

export const readZipNames = (bytes: Uint8Array): string[] => readZip(bytes).map((f) => f.name);
