import type { Circuit, PlacedComponent } from '../circuit/types';
import { buildNets } from '../circuit/nets';
import { getDef } from '../../library/components';
import { isPhysical } from '../pcb/footprints';
import { resolveFootprint, worldPads } from '../pcb/design';
import { offsetPoly, outlinePoly } from '../pcb/geom';
import { netClassList, netKeys, netLabel, classOfKey } from '../pcb/netclass';
import type { PcbDesign, ZoneLayer } from '../pcb/types';
import { formatSI } from '../units';

/**
 * KiCad export. EXPERIMENTAL: both writers follow the documented KiCad file structure (netlist `.net` S-expression, KiCad 7
 * `.kicad_pcb`) but could NOT be validated against a real KiCad install. Footprints are generated ElectroLab footprints
 * (not manufacturer land patterns), pad/track geometry is exported as-is in world coordinates (footprint rotation is baked into
 * the pad offsets, footprints are written with rotation 0). Zones are exported as outline polygons only (own polygon or the board inset; priority / thermal gap + bridge width / min thickness
 * when set; UNFILLED: press B in KiCad to refill); a polygon board becomes an Edge.Cuts gr_poly and mounting holes NPTH footprints; footprint reference/value texts are written, silkscreen outlines and 3D models are not.
 * Review the result in KiCad before use.
 */

/** S-expression string literal: escapes backslash and double quote, flattens newlines. */
export const sq = (s: string): string => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"`;

const n4 = (v: number): string => String(Number(v.toFixed(4)));

/** Short value text for a part ("1 kΩ", "5 V"), falling back to the library name. */
export function partValue(c: PlacedComponent): string {
  const def = getDef(c.type);
  const vals = def.params
    .filter((p) => p.type === 'number' && ['r', 'c', 'l', 'v', 'vz', 'i', 'amp', 'freq'].includes(p.key))
    .map((p) => (p.si ? formatSI(Number(c.params[p.key]), p.unit) : `${c.params[p.key]}${p.unit ? ' ' + p.unit : ''}`));
  return vals.length ? vals[0] : def.name;
}

/**
 * Net names: user name (design.netNames, by stable net key) when given, else GND for net 0, else Net-(REF-PadPIN) of the first
 * pin found (stable), falling back to N<i>. Duplicate user names get the net index appended so KiCad does not merge nets.
 */
export function netNames(circuit: Circuit, design?: PcbDesign): { names: string[]; nodes: Map<number, { ref: string; pin: string }[]>; keys: string[] } {
  const nets = buildNets(circuit);
  const nodes = new Map<number, { ref: string; pin: string }[]>();
  for (const c of circuit.components) {
    const def = getDef(c.type);
    if (def.model === 'ground') continue;
    for (const p of def.pins) {
      const n = nets.pinNet.get(`${c.id}:${p.id}`);
      if (n === undefined) continue;
      (nodes.get(n) ?? nodes.set(n, []).get(n)!).push({ ref: c.ref, pin: p.id });
    }
  }
  const keys = netKeys(circuit);
  const seen = new Set<string>();
  const names = nets.names.map((nm, i) => {
    let auto = nm;
    if (i === 0) auto = 'GND';
    else { const first = nodes.get(i)?.[0]; if (first) auto = `Net-(${first.ref}-Pad${first.pin})`; }
    let name = design ? netLabel(design, keys[i], auto) : auto;
    if (seen.has(name)) name = `${name}-${i}`;
    seen.add(name);
    return name;
  });
  return { names, nodes, keys };
}

/** EXPERIMENTAL. KiCad netlist (.net) of the circuit; ground parts only define net GND and are skipped. */
export function kicadNetlist(circuit: Circuit, design?: PcbDesign): string {
  const { names, nodes } = netNames(circuit, design);
  const o: string[] = [];
  o.push('(export (version "E")');
  o.push('  (design (source "ElectroLab 3D") (date "") (tool "electrolab"))');
  o.push('  (components');
  for (const c of circuit.components) {
    const def = getDef(c.type);
    if (def.model === 'ground') continue;
    o.push(`    (comp (ref ${sq(c.ref)})`);
    o.push(`      (value ${sq(partValue(c))})`);
    o.push(`      (footprint ${sq('ElectroLab:' + resolveFootprint(def, design?.placements[c.id], design).fp.name)})`);
    o.push(`      (libsource (lib "ElectroLab") (part ${sq(def.name)}) (description ${sq(def.description)})))`);
  }
  o.push('  )');
  o.push('  (nets');
  let code = 1;
  for (const [idx, list] of [...nodes.entries()].sort((a, b) => a[0] - b[0])) {
    if (!list.length) continue;
    o.push(`    (net (code ${sq(String(code++))}) (name ${sq(names[idx])})`);
    for (const nd of list) o.push(`      (node (ref ${sq(nd.ref)}) (pin ${sq(nd.pin)}))`);
    o.push('    )');
  }
  o.push('  )');
  o.push(')');
  return o.join('\n') + '\n';
}

/** EXPERIMENTAL. Minimal KiCad 7-style .kicad_pcb (footprints, pads, segments, vias, board outline). */
export function kicadPcb(circuit: Circuit, design: PcbDesign): string {
  const { names, keys } = netNames(circuit, design);
  const pads = worldPads(circuit, design);
  const netId = (n: number): number => (n >= 0 && n < names.length ? n + 1 : 0);
  const netName = (id: number): string => (id === 0 ? '' : names[id - 1]);
  const used = new Set<number>();
  const layerOf = (l: string): string => (l === 'bottom' ? 'B.Cu' : 'F.Cu');
  const eps = 0.05;
  const hit = (p: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean =>
    Math.abs(p.x - x) <= p.w / 2 + eps && Math.abs(p.y - y) <= p.h / 2 + eps;

  // vias take the net of a pad they sit on, else 0
  const viaIds = design.vias.map((v) => {
    const p = pads.find((q) => hit(q, v.x, v.y));
    return p ? netId(p.net) : 0;
  });
  // net of a track = net of the via/pad at its first vertex
  const netAt = (x: number, y: number, layer: string): number => {
    for (let i = 0; i < design.vias.length; i++) {
      const v = design.vias[i];
      if (Math.hypot(v.x - x, v.y - y) <= v.dia / 2 + eps) return viaIds[i];
    }
    for (const p of pads) {
      if (p.layers.includes(layer as 'top' | 'bottom') && hit(p, x, y)) return netId(p.net);
    }
    return 0;
  };

  const body: string[] = [];
  for (const c of circuit.components) {
    const def = getDef(c.type);
    const pl = design.placements[c.id];
    if (!isPhysical(def) || !pl) continue;
    const fp = resolveFootprint(def, pl, design).fp;
    const side = layerOf(pl.side);
    body.push(`  (footprint ${sq('ElectroLab:' + fp.name)} (layer ${sq(side)}) (at ${n4(pl.x)} ${n4(pl.y)} 0)`);
    const bot = pl.side === 'bottom';
    const halfH = (pl.rot === 90 || pl.rot === 270 ? fp.width : fp.height) / 2;
    const mir = bot ? ' (justify mirror)' : '';
    body.push(`    (fp_text reference ${sq(c.ref)} (at 0 ${n4(-halfH - 1)}) (layer ${sq(bot ? 'B.SilkS' : 'F.SilkS')}) (effects (font (size 1 1) (thickness 0.15))${mir}))`);
    body.push(`    (fp_text value ${sq(partValue(c))} (at 0 ${n4(halfH + 1)}) (layer ${sq(bot ? 'B.Fab' : 'F.Fab')}) (effects (font (size 1 1) (thickness 0.15))${mir}))`);
    for (const wp of pads.filter((p) => p.comp === c.id)) {
      const id = netId(wp.net);
      used.add(id);
      const th = wp.drill > 0;
      const layers = th ? '"*.Cu" "*.Mask"' : `${sq(side)} ${sq(side === 'F.Cu' ? 'F.Mask' : 'B.Mask')} ${sq(side === 'F.Cu' ? 'F.Paste' : 'B.Paste')}`;
      const shape = wp.shape === 'circle' ? 'circle' : wp.shape === 'oval' ? 'oval' : 'rect';
      body.push(`    (pad ${sq(wp.pin)} ${th ? 'thru_hole' : 'smd'} ${shape} (at ${n4(wp.x - pl.x)} ${n4(wp.y - pl.y)}) (size ${n4(wp.w)} ${n4(wp.h)})${th ? ` (drill ${n4(wp.drill)})` : ''} (layers ${layers}) (net ${id} ${sq(netName(id))}))`);
    }
    body.push('  )');
  }
  for (const t of design.tracks) {
    if (t.pts.length < 2) continue;
    const id = netAt(t.pts[0][0], t.pts[0][1], t.layer);
    used.add(id);
    for (let i = 0; i + 1 < t.pts.length; i++) {
      body.push(`  (segment (start ${n4(t.pts[i][0])} ${n4(t.pts[i][1])}) (end ${n4(t.pts[i + 1][0])} ${n4(t.pts[i + 1][1])}) (width ${n4(t.width)}) (layer ${sq(layerOf(t.layer))}) (net ${id}))`);
    }
  }
  design.vias.forEach((v, i) => {
    used.add(viaIds[i]);
    body.push(`  (via (at ${n4(v.x)} ${n4(v.y)}) (size ${n4(v.dia)}) (drill ${n4(v.drill)}) (layers "F.Cu" "B.Cu") (net ${viaIds[i]}))`);
  });
  // zones: board-wide pour polygon (inset by the edge clearance) on the anchor pin's net; outline only, KiCad refills it
  const inner = design.rules.layers === 4;
  const zoneLayer: Record<ZoneLayer, string | null> = { top: 'F.Cu', bottom: 'B.Cu', in1: inner ? 'In1.Cu' : null, in2: inner ? 'In2.Cu' : null };
  const ec = design.rules.edgeClearance;
  const board = outlinePoly(design.outline);
  const hasPoly = !!design.outline.poly && design.outline.poly.length >= 3;
  for (const z of design.zones) {
    const layer = zoneLayer[z.layer];
    const anchor = pads.find((p) => p.comp === z.anchor.comp && p.pin === z.anchor.pin);
    const zp = z.poly && z.poly.length >= 3 ? z.poly : offsetPoly(board, ec); // no own polygon: the board inset by the edge clearance
    if (!layer || !anchor || zp.length < 3) continue;
    const id = netId(anchor.net);
    used.add(id);
    const pts = zp.map(([x, y]) => `(xy ${n4(x)} ${n4(y)})`).join(' ');
    const prio = z.priority ? ` (priority ${Math.round(z.priority)})` : '';
    const th = z.thermal ? `(thermal_gap ${n4(z.thermal.gap)}) (thermal_bridge_width ${n4(z.thermal.spokeW)})` : '(thermal_gap 0.5) (thermal_bridge_width 0.5)';
    body.push(`  (zone (net ${id}) (net_name ${sq(netName(id))}) (layer ${sq(layer)}) (hatch edge 0.5)${prio} (connect_pads (clearance ${n4(z.clearance)})) (min_thickness ${n4(z.minThickness ?? design.rules.minWidth)}) (fill yes ${th}) (polygon (pts ${pts})))`);
  }
  // NPTH mounting holes: a footprint with one non-plated through-hole pad
  (design.holes ?? []).forEach((m, i) => {
    body.push(`  (footprint ${sq('ElectroLab:MountingHole_' + n4(m.drill) + 'mm')} (layer "F.Cu") (at ${n4(m.x)} ${n4(m.y)} 0)`);
    body.push(`    (fp_text reference ${sq('H' + (i + 1))} (at 0 ${n4(-m.drill / 2 - 1)}) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))`);
    body.push(`    (pad "" np_thru_hole circle (at 0 0) (size ${n4(m.drill)} ${n4(m.drill)}) (drill ${n4(m.drill)}) (layers "*.Cu" "*.Mask"))`);
    body.push('  )');
  });
  if (hasPoly) body.push(`  (gr_poly (pts ${board.map(([x, y]) => `(xy ${n4(x)} ${n4(y)})`).join(' ')}) (stroke (width 0.1) (type default)) (fill none) (layer "Edge.Cuts"))`);
  else body.push(`  (gr_rect (start 0 0) (end ${n4(design.outline.w)} ${n4(design.outline.h)}) (stroke (width 0.1) (type default)) (fill none) (layer "Edge.Cuts"))`);

  const o: string[] = [];
  o.push('(kicad_pcb (version 20221018) (generator "electrolab")');
  o.push('  (general (thickness 1.6))');
  o.push('  (paper "A4")');
  const cu = design.rules.layers === 4 ? '(0 "F.Cu" signal) (1 "In1.Cu" signal) (2 "In2.Cu" signal) (31 "B.Cu" signal)' : '(0 "F.Cu" signal) (31 "B.Cu" signal)';
  o.push(`  (layers ${cu} (32 "B.Adhes" user "B.Adhesive") (33 "F.Adhes" user "F.Adhesive") (34 "B.Paste" user) (35 "F.Paste" user) (36 "B.SilkS" user "B.Silkscreen") (37 "F.SilkS" user "F.Silkscreen") (38 "B.Mask" user) (39 "F.Mask" user) (44 "Edge.Cuts" user) (48 "B.Fab" user) (49 "F.Fab" user))`);
  o.push('  (setup (pad_to_mask_clearance 0))');
  o.push('  (net 0 "")');
  for (let i = 0; i < names.length; i++) if (used.has(i + 1)) o.push(`  (net ${i + 1} ${sq(names[i])})`);
  // net classes, legacy KiCad 5/6 `net_class` syntax (UNVERIFIED in KiCad 7: current KiCad keeps classes in the .kicad_pro, see kicadProject)
  for (const c of netClassList(design)) {
    const members = names.map((nm, i) => ({ nm, i })).filter(({ i }) => used.has(i + 1) && classOfKey(design, keys[i]).name === c.name).map(({ nm }) => ` (add_net ${sq(nm)})`).join('');
    o.push(`  (net_class ${sq(c.name)} "" (clearance ${n4(c.clearance)}) (trace_width ${n4(c.width)}) (via_dia ${n4(c.viaDia)}) (via_drill ${n4(c.viaDrill)}) (uvia_dia 0.3) (uvia_drill 0.1)${c.diffGap !== undefined ? ` (diff_pair_gap ${n4(c.diffGap)})` : ''}${c.name === 'Default' ? '' : members})`);
  }
  o.push(...body);
  o.push(')');
  return o.join('\n') + '\n';
}

/**
 * EXPERIMENTAL / UNVERIFIED. KiCad 7-style project file (.kicad_pro JSON) carrying only the net classes and the net-name ->
 * class assignments (`net_settings`). The layout follows the documented project file structure from memory of the format;
 * it was NOT opened in KiCad. Default-class assignments are implicit.
 */
export function kicadProject(circuit: Circuit, design: PcbDesign): string {
  const { names, keys } = netNames(circuit, design);
  const classes = netClassList(design).map((c) => ({
    name: c.name, clearance: c.clearance, track_width: c.width, via_diameter: c.viaDia, via_drill: c.viaDrill,
    ...(c.diffGap !== undefined ? { diff_pair_gap: c.diffGap } : {}),
  }));
  const patterns = names
    .map((nm, i) => ({ netclass: classOfKey(design, keys[i]).name, pattern: nm }))
    .filter((p) => p.netclass !== 'Default');
  return JSON.stringify({ meta: { filename: 'electrolab.kicad_pro', version: 1 }, net_settings: { classes, meta: { version: 3 }, netclass_patterns: patterns } }, null, 2) + '\n';
}
