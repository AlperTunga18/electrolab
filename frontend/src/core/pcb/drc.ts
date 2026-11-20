import type { Circuit } from '../circuit/types';
import { buildNets } from '../circuit/nets';
import { getDef } from '../../library/components';
import { footprintOf, resolveFootprint, worldPads, type WorldPad } from './design';
import { isPhysical } from './footprints';
import { DEFAULT_CLASS, classOfKey, netKeys } from './netclass';
import { outlinePoly, pointInPoly, polyBBox, segBoundaryDist, signedInsideDist, type Poly } from './geom';
import type { PcbDesign } from './types';
import { netLengthReport } from './length';

/**
 * PCB tasarım kuralı denetimi (DRC), bağlantı çıkarımı, IPC hesaplayıcıları ve sezgisel EMC ön kontrolleri.
 * Tümü saf fonksiyondur; birimler mm, y aşağı doğru.
 * UYARI: EMC kontrolleri sezgiseldir (ön kontrol); EMC uygunluk testi/onayı DEĞİLDİR.
 */

// ===================================================================================== IPC / hesaplayıcılar

const MIL = 0.0254; // 1 mil = 0.0254 mm
const OZ_MIL = 1.378; // 1 oz/ft² bakır = 1.378 mil kalınlık

/**
 * IPC-2221 izin akım kapasitesi: I = k · dT^0.44 · A^0.725
 * A = kesit alanı (mil²) = genişlikMil · (1.378·oz); k = 0.048 (dış katman) / 0.024 (iç katman). Sonuç amper.
 */
export function ipcCurrent(widthMm: number, dT: number, oz: number, external = true): number {
  const k = external ? 0.048 : 0.024;
  const A = (widthMm / MIL) * (OZ_MIL * oz);
  return k * Math.pow(dT, 0.44) * Math.pow(A, 0.725);
}

/** ipcCurrent'in tersi: verilen akım için gereken iz genişliği (mm). */
export function ipcTraceWidth(currentA: number, dT: number, oz: number, external = true): number {
  const k = external ? 0.048 : 0.024;
  const A = Math.pow(currentA / (k * Math.pow(dT, 0.44)), 1 / 0.725); // mil²
  return (A / (OZ_MIL * oz)) * MIL;
}

export type ClearanceKind = 'internal' | 'external-uncoated' | 'external-coated';

const V_BANDS = [15, 30, 50, 100, 150, 170, 250, 300, 500];
const CLR_TABLE: Record<ClearanceKind, { mm: number[]; perVolt: number }> = {
  internal: { mm: [0.05, 0.05, 0.1, 0.1, 0.2, 0.2, 0.2, 0.2, 0.25], perVolt: 0.0025 }, // IPC-2221A Tablo 6-1, B1
  'external-uncoated': { mm: [0.1, 0.1, 0.64, 0.64, 0.64, 1.25, 1.25, 1.25, 2.5], perVolt: 0.005 }, // B2 (<3050 m)
  'external-coated': { mm: [0.05, 0.13, 0.13, 0.13, 0.4, 0.4, 0.4, 0.4, 0.8], perVolt: 0.00305 }, // B4
};

/** IPC-2221A Tablo 6-1: tepe gerilimi (V) için minimum iletken aralığı (mm). 500 V üstünde V başına lineer eklenir. */
export function ipcClearanceMm(volts: number, kind: ClearanceKind): number {
  const v = Math.abs(volts);
  const t = CLR_TABLE[kind];
  const i = V_BANDS.findIndex((b) => v <= b);
  if (i >= 0) return t.mm[i];
  return t.mm[t.mm.length - 1] + (v - 500) * t.perVolt;
}

/** Mikroşerit karakteristik empedans (Ω): 87/sqrt(er+1.41) · ln(5.98h / (0.8w + t)). */
export function microstripZ0(wMm: number, hMm: number, tMm: number, er: number): number {
  return (87 / Math.sqrt(er + 1.41)) * Math.log((5.98 * hMm) / (0.8 * wMm + tMm));
}

/** Hedef Z0 için iz genişliği (mm), ikili arama ile (Z0 genişlik arttıkça azalır). */
export function microstripWidthForZ0(z0: number, hMm: number, tMm: number, er: number): number {
  let lo = 0.01, hi = 20;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (microstripZ0(mid, hMm, tMm, er) > z0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Diferansiyel mikroşerit empedansı: Zdiff = 2·Z0·(1 − 0.48·exp(−0.96·s/h)). s = iz arası boşluk. */
export function diffMicrostripZ(wMm: number, hMm: number, tMm: number, er: number, sMm: number): number {
  return 2 * microstripZ0(wMm, hMm, tMm, er) * (1 - 0.48 * Math.exp((-0.96 * sMm) / hMm));
}

const RHO_CU = 1.72e-8; // Ω·m
/** via kovanı kesit alanı (mm²): ortalama çaplı silindir kabuk, A = π·(drill+plating)·plating */
const viaBarrelAreaMm2 = (drillMm: number, platingUm: number): number => {
  const p = platingUm / 1000;
  return Math.PI * (drillMm + p) * p;
};

/** Via DC direnci (mΩ): R = ρ·L / A, ρ = 1.72e-8 Ω·m, A = π·(drill+plating)·plating. */
export function viaResistanceMilliohm(drillMm: number, lengthMm: number, platingUm = 25): number {
  const A = viaBarrelAreaMm2(drillMm, platingUm) * 1e-6; // m²
  return ((RHO_CU * lengthMm * 1e-3) / A) * 1000;
}

/**
 * Via akım kapasitesi (A): IPC-2221 dış katman formülü kovan kesitiyle: I = 0.048 · dT^0.44 · A^0.725,
 * A = π·(drill+plating)·plating, mil² cinsinden. Kaba bir tahmindir.
 */
export function viaCurrentA(drillMm: number, dT = 10, platingUm = 25): number {
  const A = viaBarrelAreaMm2(drillMm, platingUm) / (MIL * MIL);
  return 0.048 * Math.pow(dT, 0.44) * Math.pow(A, 0.725);
}

// ===================================================================================== geometri

type Pt = [number, number];
type Prim =
  | { t: 'cap'; a: Pt; b: Pt; r: number }
  | { t: 'box'; x0: number; y0: number; x1: number; y1: number };

const EPS = 1e-6;

function ptSegDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
const cross = (o: Pt, a: Pt, b: Pt): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function segSegDist(p1: Pt, p2: Pt, q1: Pt, q2: Pt): number {
  const d1 = cross(q1, q2, p1), d2 = cross(q1, q2, p2), d3 = cross(p1, p2, q1), d4 = cross(p1, p2, q2);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(ptSegDist(p1, q1, q2), ptSegDist(p2, q1, q2), ptSegDist(q1, p1, p2), ptSegDist(q2, p1, p2));
}
const inBox = (p: Pt, b: { x0: number; y0: number; x1: number; y1: number }): boolean => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1;
function segBoxDist(a: Pt, b: Pt, bx: { x0: number; y0: number; x1: number; y1: number }): number {
  if (inBox(a, bx) || inBox(b, bx)) return 0;
  const c: Pt[] = [[bx.x0, bx.y0], [bx.x1, bx.y0], [bx.x1, bx.y1], [bx.x0, bx.y1]];
  let m = Infinity;
  for (let i = 0; i < 4; i++) m = Math.min(m, segSegDist(a, b, c[i], c[(i + 1) % 4]));
  return m;
}
/** kenarlar arası uzaklık; negatif = girişim */
function primDist(p: Prim, q: Prim): number {
  if (p.t === 'cap' && q.t === 'cap') return segSegDist(p.a, p.b, q.a, q.b) - p.r - q.r;
  if (p.t === 'cap' && q.t === 'box') return segBoxDist(p.a, p.b, q) - p.r;
  if (p.t === 'box' && q.t === 'cap') return segBoxDist(q.a, q.b, p) - q.r;
  const bp = p as Extract<Prim, { t: 'box' }>, bq = q as Extract<Prim, { t: 'box' }>;
  const dx = Math.max(0, bq.x0 - bp.x1, bp.x0 - bq.x1), dy = Math.max(0, bq.y0 - bp.y1, bp.y0 - bq.y1);
  return Math.hypot(dx, dy);
}
const primCenter = (p: Prim): Pt => (p.t === 'cap' ? [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2] : [(p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2]);
function primBBox(p: Prim): [number, number, number, number] {
  if (p.t === 'box') return [p.x0, p.y0, p.x1, p.y1];
  return [Math.min(p.a[0], p.b[0]) - p.r, Math.min(p.a[1], p.b[1]) - p.r, Math.max(p.a[0], p.b[0]) + p.r, Math.max(p.a[1], p.b[1]) + p.r];
}

// ===================================================================================== bakır nesneleri

interface Obj {
  id: string;
  kind: 'pad' | 'track' | 'via' | 'zone';
  /** gerçek bakır katmanları ('top' | 'bottom'); zone için kendi katmanı */
  layers: string[];
  prims: Prim[];
  bbox: [number, number, number, number];
  /** yalnız pad: şematik net */
  net: number;
  /** pad için: delikli mi */
  tht?: boolean;
  pad?: WorldPad;
  trackIdx?: number;
  viaIdx?: number;
  zoneNet?: number;
  /** yalnız zone: dolgu poligonu (zone.poly ya da kart poligonu) */
  zonePoly?: Poly;
}

function bboxOf(prims: Prim[]): [number, number, number, number] {
  let b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of prims) { const q = primBBox(p); b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])]; }
  return b;
}
const bboxGap = (a: Obj['bbox'], b: Obj['bbox']): number => Math.hypot(Math.max(0, b[0] - a[2], a[0] - b[2]), Math.max(0, b[1] - a[3], a[1] - b[3]));

function padPrim(p: WorldPad): Prim {
  if (p.shape === 'rect') return { t: 'box', x0: p.x - p.w / 2, y0: p.y - p.h / 2, x1: p.x + p.w / 2, y1: p.y + p.h / 2 };
  if (p.shape === 'circle') return { t: 'cap', a: [p.x, p.y], b: [p.x, p.y], r: Math.min(p.w, p.h) / 2 };
  const r = Math.min(p.w, p.h) / 2, d = (Math.max(p.w, p.h) - 2 * r) / 2;
  return p.w >= p.h
    ? { t: 'cap', a: [p.x - d, p.y], b: [p.x + d, p.y], r }
    : { t: 'cap', a: [p.x, p.y - d], b: [p.x, p.y + d], r };
}

function buildObjs(circuit: Circuit, design: PcbDesign): { objs: Obj[]; pads: WorldPad[] } {
  const pads = worldPads(circuit, design);
  const objs: Obj[] = [];
  for (const p of pads) {
    const prims = [padPrim(p)];
    objs.push({ id: `${p.comp}.${p.pin}`, kind: 'pad', layers: [...p.layers], prims, bbox: bboxOf(prims), net: p.net, tht: p.drill > 0, pad: p });
  }
  design.tracks.forEach((t, i) => {
    const r = t.width / 2;
    const prims: Prim[] = [];
    if (t.pts.length === 1) prims.push({ t: 'cap', a: t.pts[0], b: t.pts[0], r });
    for (let k = 0; k + 1 < t.pts.length; k++) prims.push({ t: 'cap', a: t.pts[k], b: t.pts[k + 1], r });
    if (prims.length) objs.push({ id: t.id, kind: 'track', layers: [t.layer], prims, bbox: bboxOf(prims), net: -1, trackIdx: i });
  });
  design.vias.forEach((v, i) => {
    const prims: Prim[] = [{ t: 'cap', a: [v.x, v.y], b: [v.x, v.y], r: v.dia / 2 }];
    objs.push({ id: v.id, kind: 'via', layers: ['top', 'bottom'], prims, bbox: bboxOf(prims), net: -1, viaIdx: i });
  });
  return { objs, pads };
}

// ===================================================================================== bağlantı çıkarımı

export interface Cluster { id: string; objects: string[]; nets: number[]; layers: string[] }
export interface UnroutedLink { net: number; a: { comp: string; pin: string }; b: { comp: string; pin: string }; ax: number; ay: number; bx: number; by: number }
export interface ShortInfo { netA: number; netB: number; x: number; y: number }
export interface Connectivity { clusters: Cluster[]; unrouted: UnroutedLink[]; shorts: ShortInfo[] }

interface Analysis { objs: Obj[]; pads: WorldPad[]; clusterOf: number[]; conn: Connectivity }

function objDist(a: Obj, b: Obj): { d: number; at: Pt } {
  let best = Infinity;
  let at: Pt = primCenter(a.prims[0]);
  for (const p of a.prims) for (const q of b.prims) {
    const d = primDist(p, q);
    if (d < best) { best = d; const c1 = primCenter(p), c2 = primCenter(q); at = [(c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2]; }
  }
  return { d: best, at };
}

/** nesne zone poligonunun içinde mi: pad/via merkezi, iz için herhangi bir köşe noktası */
function inZone(o: Obj, poly: Poly): boolean {
  if (o.kind === 'pad') return pointInPoly(poly, o.pad!.x, o.pad!.y);
  if (o.kind === 'track') return o.prims.some((p) => p.t === 'cap' && (pointInPoly(poly, p.a[0], p.a[1]) || pointInPoly(poly, p.b[0], p.b[1])));
  return o.prims.length > 0 && o.prims[0].t === 'cap' ? pointInPoly(poly, o.prims[0].a[0], o.prims[0].a[1]) : true;
}

/** primitifin poligon sınırına boşluğu: içerideyse sınıra uzaklık (kenar-kenar), dışarı taşıyorsa/kesiyorsa negatif */
function primGapToPoly(poly: Poly, p: Prim): number {
  const pts: Pt[] = p.t === 'cap' ? [p.a, p.b] : [[p.x0, p.y0], [p.x1, p.y0], [p.x1, p.y1], [p.x0, p.y1]];
  const segs: [Pt, Pt][] = p.t === 'cap' ? [[p.a, p.b]] : [[pts[0], pts[1]], [pts[1], pts[2]], [pts[2], pts[3]], [pts[3], pts[0]]];
  const r = p.t === 'cap' ? p.r : 0;
  let d = Infinity;
  for (const [a, b] of segs) d = Math.min(d, segBoundaryDist(poly, a, b));
  if (pts.some((q) => !pointInPoly(poly, q[0], q[1]))) return -(d + r) - 1e-9;
  return d - r;
}

function analyze(circuit: Circuit, design: PcbDesign): Analysis {
  const { objs: base, pads } = buildObjs(circuit, design);
  const objs = [...base];
  const n0 = objs.length;
  const parent = objs.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a: number, b: number): void => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  // 1) aynı katmanda temas eden/üst üste binen bakır birleşir
  for (let i = 0; i < n0; i++) for (let j = i + 1; j < n0; j++) {
    const a = objs[i], b = objs[j];
    if (!a.layers.some((l) => b.layers.includes(l))) continue;
    if (find(i) === find(j)) continue;
    if (bboxGap(a.bbox, b.bbox) > EPS) continue;
    if (objDist(a, b).d <= EPS) union(i, j);
  }

  // 2) alanlar (zone): poligonu (yoksa kart poligonu) içindeki, yalnız AYNI net'e ait nesneleri bağlar
  const nets = buildNets(circuit);
  const zoneLayersOf = new Map<number, string>();
  const eligible = (o: Obj, layer: string): boolean =>
    layer === 'top' || layer === 'bottom' ? o.layers.includes(layer) : o.kind === 'via' || (o.kind === 'pad' && !!o.tht);
  design.zones.forEach((z) => {
    const zn = nets.pinNet.get(`${z.anchor.comp}:${z.anchor.pin}`);
    const zi = objs.length;
    const zpoly = z.poly && z.poly.length >= 3 ? z.poly : outlinePoly(design.outline);
    objs.push({ id: z.id, kind: 'zone', layers: [z.layer], prims: [], bbox: polyBBox(zpoly), net: zn ?? -1, zoneNet: zn, zonePoly: zpoly });
    parent.push(zi);
    zoneLayersOf.set(zi, z.layer);
    if (zn === undefined) return;
    // küme başına net kümesi (yalnız pad'lerden)
    const rootNets = new Map<number, Set<number>>();
    for (let i = 0; i < n0; i++) if (objs[i].kind === 'pad' && objs[i].net >= 0) {
      const r = find(i);
      (rootNets.get(r) ?? rootNets.set(r, new Set()).get(r)!).add(objs[i].net);
    }
    for (let i = 0; i < n0; i++) {
      if (!eligible(objs[i], z.layer) || !inZone(objs[i], zpoly)) continue;
      const ns = rootNets.get(find(i));
      if (ns && ns.size === 1 && ns.has(zn)) union(zi, i);
    }
  });

  // 3) kümeler
  const rootIdx = new Map<number, number>();
  const clusters: Cluster[] = [];
  const clusterOf: number[] = [];
  const layerSets: Set<string>[] = [];
  const netSets: Set<number>[] = [];
  objs.forEach((o, i) => {
    const r = find(i);
    let ci = rootIdx.get(r);
    if (ci === undefined) { ci = clusters.length; rootIdx.set(r, ci); clusters.push({ id: `C${ci}`, objects: [], nets: [], layers: [] }); layerSets.push(new Set()); netSets.push(new Set()); }
    clusterOf.push(ci);
    clusters[ci].objects.push(o.id);
    o.layers.forEach((l) => layerSets[ci!].add(l));
    if (o.kind === 'pad' && o.net >= 0) netSets[ci].add(o.net);
  });
  clusters.forEach((c, i) => { c.nets = [...netSets[i]].sort((a, b) => a - b); c.layers = [...layerSets[i]]; });

  // 4) kısa devreler
  const shorts: ShortInfo[] = [];
  clusters.forEach((c, ci) => {
    if (c.nets.length < 2) return;
    const cp = objs.filter((o, i) => clusterOf[i] === ci && o.kind === 'pad' && o.net >= 0);
    for (let a = 0; a < c.nets.length; a++) for (let b = a + 1; b < c.nets.length; b++) {
      let best = Infinity, at: Pt = [0, 0];
      for (const p of cp.filter((o) => o.net === c.nets[a])) for (const q of cp.filter((o) => o.net === c.nets[b])) {
        const d = Math.hypot(p.pad!.x - q.pad!.x, p.pad!.y - q.pad!.y);
        if (d < best) { best = d; at = [(p.pad!.x + q.pad!.x) / 2, (p.pad!.y + q.pad!.y) / 2]; }
      }
      shorts.push({ netA: c.nets[a], netB: c.nets[b], x: at[0], y: at[1] });
    }
  });

  // 5) bağlanmamış net'ler: küme çiftleri arası asgari ağaç (MST), en kısa önce
  const unrouted: UnroutedLink[] = [];
  const byNet = new Map<number, number[]>();
  objs.forEach((o, i) => { if (o.kind === 'pad' && o.net >= 0) (byNet.get(o.net) ?? byNet.set(o.net, []).get(o.net)!).push(i); });
  for (const [net, idxs] of byNet) {
    if (idxs.length < 2) continue;
    const groups = new Map<number, number[]>();
    for (const i of idxs) (groups.get(clusterOf[i]) ?? groups.set(clusterOf[i], []).get(clusterOf[i])!).push(i);
    if (groups.size < 2) continue;
    const gids = [...groups.keys()];
    const inTree = new Set<number>([gids[0]]);
    while (inTree.size < gids.length) {
      let best: { d: number; i: number; j: number } | null = null;
      for (const g of inTree) for (const h of gids) {
        if (inTree.has(h)) continue;
        for (const i of groups.get(g)!) for (const j of groups.get(h)!) {
          const d = Math.hypot(objs[i].pad!.x - objs[j].pad!.x, objs[i].pad!.y - objs[j].pad!.y);
          if (!best || d < best.d) best = { d, i, j };
        }
      }
      const pa = objs[best!.i].pad!, pb = objs[best!.j].pad!;
      unrouted.push({ net, a: { comp: pa.comp, pin: pa.pin }, b: { comp: pb.comp, pin: pb.pin }, ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y });
      inTree.add(clusterOf[best!.j]);
    }
  }
  unrouted.sort((p, q) => Math.hypot(p.ax - p.bx, p.ay - p.by) - Math.hypot(q.ax - q.bx, q.ay - q.by));

  return { objs, pads, clusterOf, conn: { clusters, unrouted, shorts } };
}

/** Bakır geometrisinden bağlantı çıkarımı: kümeler, bağlanmamış bağlantılar ve kısa devreler. */
export function extractConnectivity(circuit: Circuit, design: PcbDesign): Connectivity {
  return analyze(circuit, design).conn;
}

// ===================================================================================== DRC

export interface DrcIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  x: number;
  y: number;
  refs?: string[];
}
export interface DrcOptions { /** net indeksi -> akım (A) */ currents?: Record<number, number> }

const f2 = (n: number): string => (Math.round(n * 100) / 100).toString();

function courtyard(circuit: Circuit, design: PcbDesign): { id: string; ref: string; x0: number; y0: number; x1: number; y1: number; smd: boolean; side: string }[] {
  const out = [];
  for (const c of circuit.components) {
    if (!isPhysical(getDef(c.type))) continue;
    const pl = design.placements[c.id];
    if (!pl) continue;
    const fp = footprintOf(c, design);
    const swap = pl.rot === 90 || pl.rot === 270;
    const w = swap ? fp.height : fp.width, h = swap ? fp.width : fp.height;
    out.push({ id: c.id, ref: c.ref, x0: pl.x - w / 2, y0: pl.y - h / 2, x1: pl.x + w / 2, y1: pl.y + h / 2, smd: fp.smd, side: pl.side });
  }
  return out;
}

export function runDrc(circuit: Circuit, design: PcbDesign, opts: DrcOptions = {}): DrcIssue[] {
  const issues: DrcIssue[] = [];
  const rules = design.rules;
  const an = analyze(circuit, design);
  const { objs, clusterOf, conn } = an;

  // bağlantı
  for (const u of conn.unrouted) {
    issues.push({ severity: 'error', code: 'UNROUTED', message: `Bağlanmamış hat: ${u.a.comp}.${u.a.pin} ile ${u.b.comp}.${u.b.pin} arasında bakır bağlantı yok (net ${u.net}).`, x: (u.ax + u.bx) / 2, y: (u.ay + u.by) / 2, refs: [`${u.a.comp}.${u.a.pin}`, `${u.b.comp}.${u.b.pin}`] });
  }
  for (const s of conn.shorts) {
    issues.push({ severity: 'error', code: 'SHORT', message: `Kısa devre: net ${s.netA} ile net ${s.netB} bakırla birleşmiş.`, x: s.x, y: s.y });
  }

  // net sınıfları: net indeksi -> sınıf (kararlı pin anahtarı üzerinden)
  const keys = netKeys(circuit);
  const classOfNet = (net: number) => classOfKey(design, keys[net]);
  // kural: genişlik, delik, halka (genişlik sınıfa göre; 'Default' genel minWidth, diğerleri max(minWidth, sınıf genişliği))
  const trackNets = new Map<number, number[]>();
  objs.forEach((o, i) => { if (o.kind === 'track') trackNets.set(o.trackIdx!, conn.clusters[clusterOf[i]].nets); });
  for (let ti = 0; ti < design.tracks.length; ti++) {
    const t = design.tracks[ti];
    let minW = rules.minWidth, cname = '';
    for (const net of trackNets.get(ti) ?? []) {
      const c = classOfNet(net);
      const need = c.name === DEFAULT_CLASS ? rules.minWidth : Math.max(rules.minWidth, c.width);
      if (need > minW) { minW = need; cname = c.name; }
    }
    if (t.width < minW - 1e-9) issues.push({ severity: 'error', code: 'MIN_WIDTH', message: `İz genişliği ${f2(t.width)} mm < en az ${f2(minW)} mm${cname ? ` (sınıf ${cname})` : ''} (${t.id}).`, x: t.pts[0]?.[0] ?? 0, y: t.pts[0]?.[1] ?? 0, refs: [t.id] });
  }
  for (const p of an.pads) {
    if (p.drill <= 0) continue;
    const id = `${p.comp}.${p.pin}`;
    if (p.drill < rules.minDrill - 1e-9) issues.push({ severity: 'error', code: 'MIN_DRILL', message: `Delik ${f2(p.drill)} mm < en az ${f2(rules.minDrill)} mm (${id}).`, x: p.x, y: p.y, refs: [id] });
    const dia = p.shape === 'circle' ? p.w : Math.min(p.w, p.h);
    const ring = (dia - p.drill) / 2;
    if (ring < rules.minAnnular - 1e-9) issues.push({ severity: 'error', code: 'ANNULAR', message: `Halka genişliği ${f2(ring)} mm < en az ${f2(rules.minAnnular)} mm (${id}).`, x: p.x, y: p.y, refs: [id] });
  }
  for (const v of design.vias) {
    if (v.drill < rules.minDrill - 1e-9) issues.push({ severity: 'error', code: 'MIN_DRILL', message: `Via deliği ${f2(v.drill)} mm < en az ${f2(rules.minDrill)} mm (${v.id}).`, x: v.x, y: v.y, refs: [v.id] });
    const ring = (v.dia - v.drill) / 2;
    if (ring < rules.minAnnular - 1e-9) issues.push({ severity: 'error', code: 'ANNULAR', message: `Via halka genişliği ${f2(ring)} mm < en az ${f2(rules.minAnnular)} mm (${v.id}).`, x: v.x, y: v.y, refs: [v.id] });
  }

  // kart kenarı
  const { w: bw, h: bh } = design.outline;
  const ec = rules.edgeClearance;
  const bpoly = design.outline.poly && design.outline.poly.length >= 3 ? design.outline.poly : null;
  for (const o of objs) {
    if (o.kind === 'zone') continue;
    const [x0, y0, x1, y1] = o.bbox;
    const gap = bpoly ? Math.min(...o.prims.map((p) => primGapToPoly(bpoly, p))) : Math.min(x0, y0, bw - x1, bh - y1);
    if (gap < ec - 1e-9) {
      const outside = gap < 0;
      issues.push({ severity: 'error', code: 'EDGE', message: outside ? `Bakır kart dışında (${o.id}).` : `Bakır kart kenarına ${f2(gap)} mm (< ${f2(ec)} mm) yakın (${o.id}).`, x: (x0 + x1) / 2, y: (y0 + y1) / 2, refs: [o.id] });
    }
  }

  // montaj delikleri (NPTH): kart içinde olmalı, bakır delik kenarından en az kenar boşluğu kadar uzak olmalı
  (design.holes ?? []).forEach((m, hi) => {
    const id = `hole${hi + 1}`, r = m.drill / 2;
    const inside = bpoly ? signedInsideDist(bpoly, m.x, m.y) : Math.min(m.x, m.y, bw - m.x, bh - m.y);
    if (inside < r - 1e-9) issues.push({ severity: 'error', code: 'HOLE_OFF_BOARD', message: `Montaj deliği ${hi + 1} (Ø${f2(m.drill)} mm) kart dışına taşıyor veya kenara değiyor.`, x: m.x, y: m.y, refs: [id] });
    const hole: Prim = { t: 'cap', a: [m.x, m.y], b: [m.x, m.y], r };
    for (const o of objs) {
      if (o.kind === 'zone') continue;
      let d = Infinity;
      for (const p of o.prims) d = Math.min(d, primDist(p, hole));
      if (d < ec - 1e-9) issues.push({ severity: 'error', code: 'HOLE_CLEARANCE', message: `Bakır (${o.id}) montaj deliğine ${f2(Math.max(0, d))} mm (< ${f2(ec)} mm) yakın.`, x: m.x, y: m.y, refs: [o.id, id] });
    }
  });
  for (const z of design.zones) {
    if (!z.poly || z.poly.length < 3) continue;
    const out = z.poly.find((q) => (bpoly ? signedInsideDist(bpoly, q[0], q[1]) : Math.min(q[0], q[1], bw - q[0], bh - q[1])) < -1e-9);
    if (out) issues.push({ severity: 'warning', code: 'ZONE_OUTSIDE', message: `Bölge ${z.id} poligonu kart sınırının dışına taşıyor.`, x: out[0], y: out[1], refs: [z.id] });
  }

  // footprint override pin-count mismatch (override rejected, default footprint used)
  for (const c of circuit.components) {
    const pl = design.placements[c.id];
    if (!pl?.footprint || !isPhysical(getDef(c.type))) continue;
    const w = resolveFootprint(getDef(c.type), pl, design).warning;
    if (w) issues.push({ severity: 'warning', code: 'FOOTPRINT_MISMATCH', message: `${c.ref}: ${w}`, x: pl.x, y: pl.y, refs: [c.id] });
  }

  // courtyard
  const cy = courtyard(circuit, design);
  for (const c of cy) {
    if (c.x0 < -1e-9 || c.y0 < -1e-9 || c.x1 > bw + 1e-9 || c.y1 > bh + 1e-9 || (bpoly && [[c.x0, c.y0], [c.x1, c.y0], [c.x1, c.y1], [c.x0, c.y1]].some((q) => !pointInPoly(bpoly, q[0], q[1])))) {
      issues.push({ severity: 'error', code: 'OFF_BOARD', message: `${c.ref} parçasının courtyard alanı kart dışına taşıyor.`, x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2, refs: [c.id] });
    }
  }
  for (let i = 0; i < cy.length; i++) for (let j = i + 1; j < cy.length; j++) {
    const a = cy[i], b = cy[j];
    if (a.side !== b.side && a.smd && b.smd) continue; // karşı yüzdeki SMD parçalar çakışmaz
    const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (ox > 1e-6 && oy > 1e-6) {
      issues.push({ severity: 'error', code: 'COURTYARD', message: `${a.ref} ve ${b.ref} courtyard alanları çakışıyor.`, x: Math.max(a.x0, b.x0) + ox / 2, y: Math.max(a.y0, b.y0) + oy / 2, refs: [a.id, b.id] });
    }
  }

  // aralık (clearance)
  const clOf = (net: number | null): number => (net === null ? rules.minClearance : classOfNet(net).clearance);
  const n = objs.filter((o) => o.kind !== 'zone').length; // alanlar sona eklendi
  const netOf = (i: number): number | null => {
    const ns = conn.clusters[clusterOf[i]].nets;
    return ns.length === 1 ? ns[0] : null;
  };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = objs[i], b = objs[j];
    if (clusterOf[i] === clusterOf[j]) continue;
    const na = netOf(i), nb = netOf(j);
    if (na !== null && na === nb) continue; // aynı net, ayrı parçalar
    if (!a.layers.some((l) => b.layers.includes(l))) continue;
    const cl = Math.max(clOf(na), clOf(nb)); // iki sınıfın büyüğü
    if (bboxGap(a.bbox, b.bbox) >= cl) continue;
    const { d, at } = objDist(a, b);
    if (d < cl - 1e-9) {
      issues.push({ severity: 'error', code: 'CLEARANCE', message: `Aralık ${f2(Math.max(0, d))} mm < en az ${f2(cl)} mm (${a.id} ↔ ${b.id}).`, x: at[0], y: at[1], refs: [a.id, b.id] });
    }
  }

  // akım
  for (const [k, amps] of Object.entries(opts.currents ?? {})) {
    const net = Number(k);
    if (!(amps > 0)) continue;
    const need = ipcTraceWidth(amps, 10, rules.copperOz, true);
    let thin: { w: number; i: number } | null = null;
    objs.forEach((o, i) => {
      if (o.kind !== 'track') return;
      if (!conn.clusters[clusterOf[i]].nets.includes(net)) return;
      const w = design.tracks[o.trackIdx!].width;
      if (!thin || w < thin.w) thin = { w, i };
    });
    const t = thin as { w: number; i: number } | null;
    if (t && t.w < need - 1e-9) {
      const o = objs[t.i];
      issues.push({ severity: 'warning', code: 'CURRENT', message: `Net ${net}: ${f2(amps)} A için (ΔT 10 °C, ${rules.copperOz} oz, dış katman) iz en az ${f2(need)} mm olmalı; en ince iz ${f2(t.w)} mm (${o.id}).`, x: (o.bbox[0] + o.bbox[2]) / 2, y: (o.bbox[1] + o.bbox[3]) / 2, refs: [o.id] });
    }
  }

  // gerilim aralığı (tasarım başına tek)
  const need = ipcClearanceMm(rules.voltage, 'external-coated');
  if (need > rules.minClearance + 1e-9) {
    issues.push({ severity: 'warning', code: 'VOLTAGE_CLEARANCE', message: `${f2(rules.voltage)} V için IPC-2221A (dış katman, maskeli, B4) en az ${f2(need)} mm aralık ister; kural ${f2(rules.minClearance)} mm. Aralık kuralını artırın.`, x: 0, y: 0 });
  }
  // net uzunluğu hedefi (yalnız hedefi olan ve tamamen bağlı net'ler)
  if (design.netLengthTargets || (design.rules.netClasses ?? []).some((c) => c.targetLength)) {
    for (const r of netLengthReport(circuit, design, conn)) {
      if (!r.violates) continue;
      const o = objs.find((q) => q.kind === 'pad' && q.net === r.net);
      issues.push({ severity: 'warning', code: 'LENGTH', message: `Net ${r.name}: uzunluk ${f2(r.totalMm)} mm, hedef ${f2(r.targetMm!)} mm (sapma ${r.deviationMm! > 0 ? '+' : ''}${f2(r.deviationMm!)} mm, tolerans ±${f2(r.tolMm!)} mm).`, x: o ? (o.bbox[0] + o.bbox[2]) / 2 : 0, y: o ? (o.bbox[1] + o.bbox[3]) / 2 : 0 });
    }
  }
  return issues;
}

// ===================================================================================== EMC ön kontrolleri

export interface EmcIssue { severity: 'error' | 'warning' | 'info'; code: string; message: string; x?: number; y?: number }

const SUPPLY_LABEL = /^(vcc|vdd|v\+|vin|vs|vbat|vbus|3v3|5v|\+?\d+v\d*)$/i;
const TAG = '[Sezgisel ön kontrol, EMC uygunluğu değildir] ';

/** Sezgisel EMC ön kontrolleri (DECOUPLING, NO_GROUND_PLANE, PARALLEL_RUN). LOOP (besleme/dönüş döngüsü) kapsam dışı bırakıldı. */
export function emcChecks(circuit: Circuit, design: PcbDesign): EmcIssue[] {
  const out: EmcIssue[] = [];
  const nets = buildNets(circuit);

  // DECOUPLING
  const caps = circuit.components.filter((c) => getDef(c.type).model === 'capacitor' && design.placements[c.id]);
  for (const c of circuit.components) {
    const def = getDef(c.type);
    const icLike = def.visual?.kind === 'ic' || (def.model === 'none' && (def.category === 'ic' || def.category === 'mcu'));
    const pl = design.placements[c.id];
    if (!icLike || !pl) continue;
    const supply = new Set<number>();
    for (const p of def.pins) {
      if (!SUPPLY_LABEL.test(p.label.trim().replace(/^\d+\s+/, ''))) continue;
      const nn = nets.pinNet.get(`${c.id}:${p.id}`);
      if (nn !== undefined && nn !== 0) supply.add(nn);
    }
    for (const sn of supply) {
      const onNet = caps.filter((k) => getDef(k.type).pins.some((p) => nets.pinNet.get(`${k.id}:${p.id}`) === sn));
      if (!onNet.length) {
        out.push({ severity: 'warning', code: 'DECOUPLING', message: `${TAG}${c.ref}: besleme hattında (net ${sn}) dekuplaj kondansatörü yok.`, x: pl.x, y: pl.y });
        continue;
      }
      const near = onNet.some((k) => Math.hypot(design.placements[k.id].x - pl.x, design.placements[k.id].y - pl.y) <= 10);
      if (!near) out.push({ severity: 'warning', code: 'DECOUPLING', message: `${TAG}${c.ref}: besleme kondansatörü 10 mm'den uzakta; dekuplaj kondansatörünü yaklaştırın.`, x: pl.x, y: pl.y });
    }
  }

  // NO_GROUND_PLANE
  const hasGndZone = design.zones.some((z) => nets.pinNet.get(`${z.anchor.comp}:${z.anchor.pin}`) === 0);
  if (design.rules.layers === 2 && !hasGndZone) {
    out.push({ severity: 'info', code: 'NO_GROUND_PLANE', message: `${TAG}2 katmanlı kartta toprak alanı yok; toprak alanı (pour) önerilir.` });
  }

  // PARALLEL_RUN
  const an = analyze(circuit, design);
  const tracks = an.objs.map((o, i) => ({ o, i })).filter((e) => e.o.kind === 'track');
  const tnet = (i: number): number | null => { const ns = an.conn.clusters[an.clusterOf[i]].nets; return ns.length === 1 ? ns[0] : null; };
  for (let a = 0; a < tracks.length; a++) for (let b = a + 1; b < tracks.length; b++) {
    const ta = design.tracks[tracks[a].o.trackIdx!], tb = design.tracks[tracks[b].o.trackIdx!];
    if (ta.layer !== tb.layer) continue;
    const na = tnet(tracks[a].i), nb = tnet(tracks[b].i);
    if (na === null || nb === null || na === nb) continue;
    const lim = 3 * Math.max(ta.width, tb.width);
    let run = 0, at: [number, number] = [0, 0];
    for (let i = 0; i + 1 < ta.pts.length; i++) for (let j = 0; j + 1 < tb.pts.length; j++) {
      const [p1, p2, q1, q2] = [ta.pts[i], ta.pts[i + 1], tb.pts[j], tb.pts[j + 1]];
      const dx = p2[0] - p1[0], dy = p2[1] - p1[1], len = Math.hypot(dx, dy);
      const ex = q2[0] - q1[0], ey = q2[1] - q1[1], lenQ = Math.hypot(ex, ey);
      if (len < EPS || lenQ < EPS) continue;
      if (Math.abs(dx * ey - dy * ex) / (len * lenQ) > 1e-3) continue; // paralel değil
      const ux = dx / len, uy = dy / len;
      const dist = Math.abs((q1[0] - p1[0]) * -uy + (q1[1] - p1[1]) * ux);
      if (dist > lim) continue;
      const s0 = (q1[0] - p1[0]) * ux + (q1[1] - p1[1]) * uy, s1 = (q2[0] - p1[0]) * ux + (q2[1] - p1[1]) * uy;
      const ov = Math.min(len, Math.max(s0, s1)) - Math.max(0, Math.min(s0, s1));
      if (ov > 0) { run += ov; at = [p1[0] + ux * (Math.max(0, Math.min(s0, s1)) + ov / 2), p1[1] + uy * (Math.max(0, Math.min(s0, s1)) + ov / 2)]; }
    }
    if (run > 15) out.push({ severity: 'info', code: 'PARALLEL_RUN', message: `${TAG}${ta.id} ve ${tb.id} ${f2(run)} mm paralel gidiyor (aralık ≤ 3×genişlik): karışma (crosstalk) olabilir.`, x: at[0], y: at[1] });
  }
  return out;
}
