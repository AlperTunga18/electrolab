import type { Circuit } from '../circuit/types';
import { buildNets } from '../circuit/nets';
import { getDef } from '../../library/components';
import { isPhysical } from '../pcb/footprints';
import { placePad, resolveFootprint, rotate } from '../pcb/design';
import { offsetPoly, outlinePoly, polyArea, polyBBox, type Poly, type Pt } from '../pcb/geom';
import type { Footprint, MountHole, PcbDesign, PcbPlacement, Track, Via, Zone, ZoneLayer } from '../pcb/types';
import { netNames } from './kicad';
import { headOf, isList, kid, kids, numAt, strAt, tryParseSexpr, type SList } from './sexpr';

/**
 * RESTRICTED `.kicad_pcb` import. Reads the textual S-expression structure (written from the open file format description, no
 * KiCad source/library code) and turns it into a PATCH for the existing PcbDesign. LIMITS (read before trusting it):
 *  - it was ONLY tested against files written by our own kicadPcb() (round trip); no file produced by a real KiCad was available,
 *    so field names / angle sign / newer syntax (KiCad 8 `property "Reference"`, KiCad 7 `fp_text reference`) are UNVERIFIED;
 *  - footprints are matched to circuit parts by the Reference text only; pad geometry of a foreign footprint is NOT imported
 *    (the part keeps its ElectroLab footprint); the footprint `at` becomes the placement x/y;
 *  - our exporter bakes the footprint rotation into the pad offsets (it writes angle 0): the rotation is therefore recovered by
 *    matching the file pads against the part's footprint, falling back to the `at` angle (KiCad angle is assumed counter-clockwise,
 *    ours clockwise: sign flipped, UNVERIFIED);
 *  - only F.Cu/B.Cu tracks and through vias, zone outlines (fills ignored), Edge.Cuts rect/poly/line loops, NPTH pads;
 *  - net classes, arcs, text, graphics, dimensions, 3D models etc. are skipped and listed in the warnings, never silently.
 */

export interface KicadPatch {
  /** placements of the matched parts (x, y, rot, side); other parts are untouched */
  placements: Record<string, Pick<PcbPlacement, 'x' | 'y' | 'rot' | 'side'>>;
  tracks: Track[];
  vias: Via[];
  zones: Zone[];
  /** absent = the file had no usable Edge.Cuts: keep the current outline */
  outline?: PcbDesign['outline'];
  holes: MountHole[];
  /** absent = the file had no layer table: keep the current layer count */
  layers?: 2 | 4;
}

export interface KicadImportSummary {
  footprintsMatched: number;
  footprintsUnmatched: number;
  tracks: number;
  vias: number;
  zones: number;
  holes: number;
  /** the board outline became a polygon / a plain rectangle / was not found */
  outline: 'poly' | 'rect' | 'none';
  layers: 2 | 4 | null;
}

export interface KicadImportResult {
  ok: boolean;
  /** set when ok is false (unreadable / not a .kicad_pcb) */
  error?: string;
  patch?: KicadPatch;
  /** everything that was skipped, unmatched or doubtful (nothing is dropped silently) */
  warnings: string[];
  summary?: KicadImportSummary;
}

const SKIP_KNOWN = new Set(['version', 'generator', 'generator_version', 'general', 'paper', 'layers', 'setup', 'net', 'net_class', 'title_block', 'footprint', 'segment', 'via', 'zone', 'gr_line', 'gr_rect', 'gr_poly', 'gr_arc', 'gr_circle']);
const COPPER: Record<string, 'top' | 'bottom'> = { 'F.Cu': 'top', 'B.Cu': 'bottom' };
const ZONE_LAYER: Record<string, ZoneLayer> = { 'F.Cu': 'top', 'B.Cu': 'bottom', 'In1.Cu': 'in1', 'In2.Cu': 'in2' };
const EXPECTED_VERSION = 20221018;
const EPS = 1e-3;

const xy = (l: SList | undefined): Pt | undefined => { const x = numAt(l, 1), y = numAt(l, 2); return x === undefined || y === undefined ? undefined : [x, y]; };
const layerOf = (l: SList): string => strAt(kid(l, 'layer'), 1) ?? '';
const near = (a: Pt, b: Pt): boolean => Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS;
const ptsOf = (l: SList | undefined): Poly => (l ? kids(l, 'xy').map((p) => xy(p)).filter((p): p is Pt => !!p) : []);
const dropClosing = (p: Poly): Poly => (p.length > 1 && near(p[0], p[p.length - 1]) ? p.slice(0, -1) : p);

/** rotation of a placed footprint whose pads (pin + offset from the footprint origin, as in the file) equal the part's footprint pads under some rot (side fixed by the file layer) */
function rotFromPads(fp: Footprint, side: 'top' | 'bottom', filePads: { pin: string; x: number; y: number }[]): 0 | 90 | 180 | 270 | undefined {
  if (!fp.pads.length || fp.pads.length !== filePads.length) return undefined;
  for (const rot of [0, 90, 180, 270] as const) {
    const used = new Set<number>();
    const ok = fp.pads.every((p) => {
      const w = placePad(p, { x: 0, y: 0, rot, side });
      const j = filePads.findIndex((q, k) => !used.has(k) && q.pin === p.pin && Math.abs(q.x - w.x) <= EPS && Math.abs(q.y - w.y) <= EPS);
      if (j < 0) return false;
      used.add(j);
      return true;
    });
    if (ok) return rot;
  }
  return undefined;
}

export function importKicadPcb(text: string, circuit: Circuit, design: PcbDesign): KicadImportResult {
  const warnings: string[] = [];
  const fail = (error: string): KicadImportResult => ({ ok: false, error, warnings });
  try {
    if (!text.trim()) return fail('Dosya boş.');
    const parsed = tryParseSexpr(text);
    if (!parsed.ok) return fail(`Dosya okunamadı (S-ifade hatası, karakter ${parsed.pos}): ${parsed.error}`);
    const root = parsed.value.find((x): x is SList => isList(x) && headOf(x) === 'kicad_pcb');
    if (!root) return fail('Bu bir .kicad_pcb dosyası değil (kök öğe kicad_pcb bulunamadı).');

    const ver = numAt(kid(root, 'version'), 1);
    if (ver !== undefined && ver !== EXPECTED_VERSION) warnings.push(`Dosya sürümü ${ver}; okuyucu yalnız ${EXPECTED_VERSION} biçimine göre yazıldı, diğer sürümlerin söz dizimi doğrulanmadı.`);

    // layers
    let layers: 2 | 4 | undefined;
    const lt = kid(root, 'layers');
    if (lt) {
      const inner = lt.filter((e): e is SList => isList(e)).filter((e) => /^In\d+\.Cu$/.test(strAt(e, 1) ?? '')).length;
      layers = inner === 0 ? 2 : 4;
      if (inner === 1 || inner > 2) warnings.push(`Dosyada ${inner} iç bakır katman var; model yalnız 0 veya 2 destekler: ${layers} katman olarak alındı.`);
    }
    const effLayers = layers ?? design.rules.layers;

    // nets
    const netTable = new Map<number, string>();
    for (const n of kids(root, 'net')) { const id = numAt(n, 1), nm = strAt(n, 2); if (id !== undefined && nm !== undefined) netTable.set(id, nm); }
    const names = netNames(circuit, design).names;
    const netIdxOf = new Map<string, number>();
    names.forEach((nm, i) => { if (!netIdxOf.has(nm)) netIdxOf.set(nm, i); });
    const unknownNets = new Set<string>();
    /** net name of a `(net ...)` / `(net_name ...)` reference; '' = no net. Unknown names are recorded. */
    const resolveNet = (l: SList): string => {
      const nn = strAt(kid(l, 'net_name'), 1);
      const nl = kid(l, 'net');
      let name = nn ?? '';
      if (!name && nl) { const v = nl[1]; name = typeof v === 'number' ? (v === 0 ? '' : netTable.get(v) ?? `#${v}`) : typeof v === 'string' ? v : ''; }
      if (name && !netIdxOf.has(name)) unknownNets.add(name);
      return name;
    };

    // footprints: parts by reference, NPTH holes
    const parts = new Map(circuit.components.filter((c) => isPhysical(getDef(c.type))).map((c) => [c.ref, c]));
    const placements: KicadPatch['placements'] = {};
    const holes: MountHole[] = [];
    let unmatched = 0;
    for (const f of kids(root, 'footprint')) {
      const fpName = strAt(f, 1) ?? '?';
      const at = kid(f, 'at');
      const fx = numAt(at, 1), fy = numAt(at, 2), fa = numAt(at, 3) ?? 0;
      const pads = kids(f, 'pad');
      if (pads.length && pads.every((p) => strAt(p, 3) === 'np_thru_hole' || strAt(p, 2) === 'np_thru_hole')) { // NPTH mounting hole footprint
        for (const p of pads) {
          const d = kid(p, 'drill');
          const drill = numAt(d, 1) ?? numAt(d, 2);
          const pa = xy(kid(p, 'at')) ?? [0, 0];
          if (fx === undefined || fy === undefined || !drill || drill <= 0) { warnings.push(`NPTH deliği (${fpName}) konum/delik çapı okunamadı; atlandı.`); continue; }
          const [rx, ry] = rotate(pa[0], pa[1], ((Math.round(-fa / 90) * 90) % 360 + 360) % 360);
          holes.push({ x: fx + rx, y: fy + ry, drill });
        }
        continue;
      }
      const ref = strAt(kids(f, 'fp_text').find((t) => strAt(t, 1) === 'reference'), 2) ?? strAt(kids(f, 'property').find((t) => strAt(t, 1) === 'Reference'), 2);
      if (ref === undefined) { unmatched++; warnings.push(`Footprint "${fpName}" Reference metni bulunamadı; atlandı.`); continue; }
      const comp = parts.get(ref);
      if (!comp) { unmatched++; warnings.push(`Footprint "${ref}" (${fpName}) devrede eşleşen parça yok; atlandı.`); continue; }
      if (fx === undefined || fy === undefined) { unmatched++; warnings.push(`Footprint "${ref}" konumu (at) okunamadı; atlandı.`); continue; }
      if (placements[comp.id]) { warnings.push(`Footprint "${ref}" dosyada birden çok kez var; ilki kullanıldı.`); continue; }
      const side: 'top' | 'bottom' = layerOf(f) === 'B.Cu' ? 'bottom' : 'top';
      if (!['F.Cu', 'B.Cu'].includes(layerOf(f))) warnings.push(`Footprint "${ref}" katmanı "${layerOf(f)}"; üst yüz sayıldı.`);
      const fp = resolveFootprint(getDef(comp.type), design.placements[comp.id], design).fp;
      const filePads = pads.map((p) => ({ pin: strAt(p, 1) ?? '', ...(() => { const a = xy(kid(p, 'at')) ?? [0, 0]; return { x: a[0], y: a[1] }; })() }));
      let rot = rotFromPads(fp, side, filePads);
      if (rot === undefined) {
        const q = -fa / 90;
        if (Math.abs(q - Math.round(q)) > 1e-6) warnings.push(`Footprint "${ref}" açısı ${fa}° 90'ın katı değil; en yakın 90° alındı.`);
        rot = ((((Math.round(q) * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
        warnings.push(`Footprint "${ref}": pad dizilimi ElectroLab footprint'iyle eşleşmedi; dönüş at açısından alındı (açı yönü doğrulanmadı).`);
      }
      placements[comp.id] = { x: fx, y: fy, rot, side };
    }
    for (const c of parts.values()) if (!placements[c.id]) warnings.push(`Devredeki "${c.ref}" dosyada yok; yerleşimi değişmedi.`);

    // tracks (consecutive collinear-chain segments of the same layer/width/net become one polyline)
    const tracks: Track[] = [];
    let skippedLayerSeg = 0;
    let lastKey = '';
    let tn = 0;
    for (const sg of kids(root, 'segment')) {
      const a = xy(kid(sg, 'start')), b = xy(kid(sg, 'end')), w = numAt(kid(sg, 'width'), 1);
      const ly = COPPER[layerOf(sg)];
      resolveNet(sg);
      if (!a || !b || w === undefined || w <= 0) { warnings.push('Eksik/bozuk segment (start/end/width) atlandı.'); lastKey = ''; continue; }
      if (!ly) { skippedLayerSeg++; lastKey = ''; continue; }
      const key = `${ly}|${w}|${resolveNetKey(sg)}`;
      const prev = tracks[tracks.length - 1];
      if (prev && key === lastKey && near(prev.pts[prev.pts.length - 1], a)) prev.pts.push(b);
      else tracks.push({ id: `kt${++tn}`, layer: ly, width: w, pts: [a, b] });
      lastKey = key;
    }
    if (skippedLayerSeg) warnings.push(`${skippedLayerSeg} segment F.Cu/B.Cu dışı katmanda (iç katman izi desteklenmez); atlandı.`);
    function resolveNetKey(l: SList): string { return strAt(kid(l, 'net_name'), 1) ?? String(kid(l, 'net')?.[1] ?? ''); }

    // vias
    const vias: Via[] = [];
    let vn = 0;
    for (const v of kids(root, 'via')) {
      resolveNet(v);
      const a = xy(kid(v, 'at')), dia = numAt(kid(v, 'size'), 1), drill = numAt(kid(v, 'drill'), 1);
      const kind = typeof v[1] === 'string' ? v[1] : '';
      if (kind === 'blind' || kind === 'micro') { warnings.push(`Via (${kind}) desteklenmiyor (yalnız tam geçişli); atlandı.`); continue; }
      const vl = kid(v, 'layers');
      if (vl && !(vl.includes('F.Cu') && vl.includes('B.Cu'))) { warnings.push('Via katmanları F.Cu+B.Cu değil; atlandı.'); continue; }
      if (!a || dia === undefined || drill === undefined) { warnings.push('Eksik/bozuk via (at/size/drill) atlandı.'); continue; }
      vias.push({ id: `kv${++vn}`, x: a[0], y: a[1], dia, drill });
    }

    // board outline (Edge.Cuts): gr_rect, gr_poly, closed gr_line loops
    type Shape = { poly: Poly; rect: boolean };
    const shapes: Shape[] = [];
    const lines: [Pt, Pt][] = [];
    const nonEdge = new Map<string, number>();
    for (const g of root.filter((x): x is SList => isList(x) && /^gr_/.test(headOf(x)))) {
      const h = headOf(g);
      if (layerOf(g) !== 'Edge.Cuts') { nonEdge.set(h, (nonEdge.get(h) ?? 0) + 1); continue; }
      if (h === 'gr_rect') {
        const a = xy(kid(g, 'start')), b = xy(kid(g, 'end'));
        if (a && b) shapes.push({ poly: [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]], rect: true });
        else warnings.push('Edge.Cuts gr_rect eksik (start/end); atlandı.');
      } else if (h === 'gr_poly') {
        const p = dropClosing(ptsOf(kid(g, 'pts')));
        if (p.length >= 3) shapes.push({ poly: p, rect: false }); else warnings.push('Edge.Cuts gr_poly 3 köşeden az; atlandı.');
      } else if (h === 'gr_line') {
        const a = xy(kid(g, 'start')), b = xy(kid(g, 'end'));
        if (a && b) lines.push([a, b]); else warnings.push('Edge.Cuts gr_line eksik (start/end); atlandı.');
      } else warnings.push(`Edge.Cuts üzerinde ${h} desteklenmiyor (yalnız gr_rect, gr_poly, gr_line); atlandı.`);
    }
    for (const [h, n] of nonEdge) warnings.push(`${n} adet ${h} Edge.Cuts dışı katmanda; atlandı.`);
    const usedLine = new Set<number>();
    for (let s0 = 0; s0 < lines.length; s0++) {
      if (usedLine.has(s0)) continue;
      usedLine.add(s0);
      const chain: Pt[] = [lines[s0][0], lines[s0][1]];
      for (let grew = true; grew;) {
        grew = false;
        if (near(chain[0], chain[chain.length - 1]) && chain.length > 2) break;
        for (let k = 0; k < lines.length; k++) {
          if (usedLine.has(k)) continue;
          const [a, b] = lines[k], end = chain[chain.length - 1];
          if (near(a, end)) { chain.push(b); usedLine.add(k); grew = true; break; }
          if (near(b, end)) { chain.push(a); usedLine.add(k); grew = true; break; }
        }
      }
      if (chain.length > 3 && near(chain[0], chain[chain.length - 1])) shapes.push({ poly: chain.slice(0, -1), rect: false });
      else warnings.push('Edge.Cuts gr_line zinciri kapalı bir kontur oluşturmuyor; atlandı.');
    }
    let outline: PcbDesign['outline'] | undefined;
    if (!shapes.length) warnings.push('Edge.Cuts kart sınırı bulunamadı; mevcut sınır korundu.');
    else {
      shapes.sort((a, b) => polyArea(b.poly) - polyArea(a.poly));
      if (shapes.length > 1) warnings.push(`${shapes.length - 1} ek kapalı Edge.Cuts şekli (iç kesim/ikinci kontur) desteklenmiyor; en büyüğü kart sınırı alındı.`);
      const s0 = shapes[0];
      const bb = polyBBox(s0.poly);
      if (Math.abs(bb[0]) > EPS || Math.abs(bb[1]) > EPS) warnings.push(`Kart sınırı (0,0)'da başlamıyor (${bb[0]}, ${bb[1]}); koordinatlar kaydırılmadan alındı.`);
      outline = s0.rect ? { w: bb[2], h: bb[3] } : { w: bb[2], h: bb[3], poly: s0.poly };
    }

    // zones
    const outForZone = outline ?? design.outline;
    const inset = offsetPoly(outlinePoly(outForZone), design.rules.edgeClearance);
    const nets = buildNets(circuit);
    const physPins: { comp: string; pin: string; net: number }[] = [];
    for (const c of circuit.components) {
      if (!parts.has(c.ref)) continue;
      for (const p of getDef(c.type).pins) { const n = nets.pinNet.get(`${c.id}:${p.id}`); if (n !== undefined) physPins.push({ comp: c.id, pin: p.id, net: n }); }
    }
    const anchorFor = (net: number): { comp: string; pin: string } | undefined => {
      const old = design.zones.map((z) => z.anchor).find((a) => nets.pinNet.get(`${a.comp}:${a.pin}`) === net && physPins.some((q) => q.comp === a.comp && q.pin === a.pin));
      const p = old ? undefined : physPins.find((q) => q.net === net);
      return old ?? (p ? { comp: p.comp, pin: p.pin } : undefined);
    };
    const zones: Zone[] = [];
    let zn = 0;
    for (const z of kids(root, 'zone')) {
      const name = resolveNet(z);
      const ly = ZONE_LAYER[layerOf(z)] ?? ZONE_LAYER[strAt(kid(z, 'layers'), 1) ?? ''];
      if (kid(z, 'layers') && !kid(z, 'layer')) warnings.push('Zone `layers` (çok katmanlı) kullanıyor; yalnız ilk katman alındı.');
      if (!ly) { warnings.push(`Zone katmanı "${layerOf(z) || '?'}" desteklenmiyor; atlandı.`); continue; }
      if ((ly === 'in1' || ly === 'in2') && effLayers !== 4) { warnings.push(`Zone ${layerOf(z)} katmanında ama tasarım 2 katmanlı; atlandı.`); continue; }
      const netIdx = name ? netIdxOf.get(name) : undefined;
      if (netIdx === undefined) { warnings.push(name ? `Zone bilinmeyen net "${name}" ile atlandı.` : 'Zone net atanmamış; atlandı.'); continue; }
      const anchor = anchorFor(netIdx);
      if (!anchor) { warnings.push(`Zone net "${name}" üzerinde kartta pad yok; atlandı.`); continue; }
      const polys = kids(z, 'polygon');
      if (polys.length > 1) warnings.push(`Zone (${name}) ${polys.length} poligon içeriyor; yalnız ilki alındı.`);
      const zp = dropClosing(ptsOf(polys[0] ? kid(polys[0], 'pts') : undefined));
      if (zp.length < 3) { warnings.push(`Zone (${name}) poligonu 3 köşeden az; atlandı.`); continue; }
      const clearance = numAt(kid(kid(z, 'connect_pads') ?? [], 'clearance'), 1) ?? design.rules.minClearance;
      const fill = kid(z, 'fill');
      const gap = numAt(kid(fill ?? [], 'thermal_gap'), 1), br = numAt(kid(fill ?? [], 'thermal_bridge_width'), 1);
      const prio = numAt(kid(z, 'priority'), 1);
      const mt = numAt(kid(z, 'min_thickness'), 1);
      const isInset = inset.length === zp.length && inset.every((p, i) => Math.abs(p[0] - zp[i][0]) <= 2e-4 && Math.abs(p[1] - zp[i][1]) <= 2e-4);
      const zone: Zone = { id: `kz${++zn}`, layer: ly, anchor, clearance };
      if (!isInset) zone.poly = zp;
      if (prio) zone.priority = prio;
      // our exporter writes 0.5/0.5 when a zone has no thermal relief, so exactly 0.5/0.5 is read as "solid" (a real 0.5/0.5 relief is indistinguishable)
      if (gap !== undefined && br !== undefined && !(Math.abs(gap - 0.5) < 1e-9 && Math.abs(br - 0.5) < 1e-9)) zone.thermal = { gap, spokeW: br };
      if (mt !== undefined && Math.abs(mt - design.rules.minWidth) > 1e-9) zone.minThickness = mt;
      zones.push(zone);
    }

    for (const n of unknownNets) warnings.push(`Dosyadaki net "${n}" devrede yok (iz/via/zone o net için bağlanmaz ya da atlandı).`);
    const skipped = new Map<string, number>();
    for (const x of root) if (isList(x) && !SKIP_KNOWN.has(headOf(x)) && !/^gr_/.test(headOf(x))) skipped.set(headOf(x) || '?', (skipped.get(headOf(x) || '?') ?? 0) + 1);
    if (skipped.size) warnings.push(`Bilinmeyen/desteklenmeyen öğeler atlandı: ${[...skipped].map(([k, n]) => `${k}×${n}`).join(', ')}.`);
    const ncl = kids(root, 'net_class').filter((l) => strAt(l, 1) !== 'Default').length; // 'Default' mirrors the global rules (always written by our exporter)
    if (ncl) warnings.push(`${ncl} net_class içe aktarılmadı (net sınıfları desteklenmiyor).`);

    return {
      ok: true,
      warnings,
      patch: { placements, tracks, vias, zones, outline, holes, layers },
      summary: {
        footprintsMatched: Object.keys(placements).length, footprintsUnmatched: unmatched, tracks: tracks.length, vias: vias.length, zones: zones.length,
        holes: holes.length, outline: !outline ? 'none' : outline.poly ? 'poly' : 'rect', layers: layers ?? null,
      },
    };
  } catch (e) {
    return fail(`İçe aktarma beklenmedik hatayla durdu: ${(e as Error)?.message ?? String(e)}`);
  }
}

/** applies the patch over a design (tracks, vias, zones, holes are REPLACED; placements of matched parts updated, footprint overrides kept) */
export function applyKicadPatch(design: PcbDesign, patch: KicadPatch): PcbDesign {
  const placements = { ...design.placements };
  for (const [id, p] of Object.entries(patch.placements)) placements[id] = { ...placements[id], ...p };
  const next: PcbDesign = { ...design, placements, tracks: patch.tracks, vias: patch.vias, zones: patch.zones };
  if (patch.outline) next.outline = patch.outline;
  if (patch.holes.length || design.holes) next.holes = patch.holes;
  if (patch.layers) next.rules = { ...design.rules, layers: patch.layers };
  return next;
}
