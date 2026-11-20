import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import { autoPlace, worldPads } from './design';
import { bomForFab, crc32, exportFabrication, makeZip, pickAndPlaceCsv, readZip, readZipNames } from './gerber';
import type { PcbDesign } from './types';

function setup(layers: 2 | 4 = 2) {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 5 }); b.add('resistor', { r: 1000 }); b.add('resistor', { r: 1000 }); b.add('ground');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'R2.1'); b.chain('R2.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  const circuit = b.circuit;
  const d = autoPlace(circuit);
  const design: PcbDesign = { ...d, rules: { ...d.rules, layers } };
  const pads = worldPads(circuit, design);
  const pad = (c: string, p: string) => pads.find((x) => x.comp === c && x.pin === p)!;
  const a = pad('R1', '2'), c = pad('R2', '1');
  design.tracks = [
    { id: 't1', layer: 'top', width: 0.35, pts: [[a.x, a.y], [c.x, c.y]] },
    { id: 't2', layer: 'bottom', width: 0.5, pts: [[pad('V1', 'P').x, pad('V1', 'P').y], [pad('V1', 'P').x, pad('V1', 'P').y + 2]] },
  ];
  design.vias = [{ id: 'v1', x: pad('V1', 'P').x, y: pad('V1', 'P').y + 2, dia: 0.8, drill: 0.4 }];
  const zl = layers === 4 ? 'in1' : 'bottom';
  design.zones = [{ id: 'z1', layer: zl, anchor: { comp: 'V1', pin: 'N' }, clearance: 0.3 }];
  return { circuit, design, pads };
}

interface Parsed { aps: Map<number, string>; flashes: { x: number; y: number; pol: string; ap: number }[]; draws: { x: number; y: number; pol: string; inRegion: boolean }[]; pol: string[]; end: boolean; regions: number }
function parse(txt: string): Parsed {
  const r: Parsed = { aps: new Map(), flashes: [], draws: [], pol: [], end: false, regions: 0 };
  let pol = 'D', ap = -1, inReg = false;
  for (const raw of txt.split('\n')) {
    const l = raw.trim();
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^%ADD(\d+)(.*)\*%$/))) r.aps.set(Number(m[1]), m[2]);
    else if ((m = l.match(/^%LP([DC])\*%$/))) { pol = m[1]; r.pol.push(m[1]); }
    else if (l === 'G36*') { inReg = true; r.regions++; }
    else if (l === 'G37*') inReg = false;
    else if (l === 'M02*') r.end = true;
    else if ((m = l.match(/^D(\d+)\*$/))) ap = Number(m[1]);
    else if ((m = l.match(/^X(-?\d+)Y(-?\d+)D0([123])\*$/))) {
      const x = Number(m[1]) / 1e6, y = Number(m[2]) / 1e6;
      if (m[3] === '3') r.flashes.push({ x, y, pol, ap });
      else if (m[3] === '1') r.draws.push({ x, y, pol, inRegion: inReg });
    }
  }
  return r;
}

describe('gerber export', () => {
  it('2-layer file set and names', () => {
    const { circuit, design } = setup();
    const { files, warnings } = exportFabrication(circuit, design);
    expect(files.map((f) => f.name).sort()).toEqual(['electrolab-B_Cu.gbl', 'electrolab-B_Mask.gbs', 'electrolab-B_Paste.gbp', 'electrolab-B_Silkscreen.gbo', 'electrolab-Edge_Cuts.gm1', 'electrolab-F_Cu.gtl', 'electrolab-F_Mask.gts', 'electrolab-F_Paste.gtp', 'electrolab-F_Silkscreen.gto', 'electrolab-NPTH.drl', 'electrolab-PTH.drl'].sort());
    expect(warnings).toContain('referans yazıları silkscreen\'e eklenmedi');
    expect(exportFabrication(circuit, design, { name: 'x' }).files[0].name.startsWith('x-')).toBe(true);
  });

  it('copper layers: flashes, apertures, bounds, polarity, M02', () => {
    const { circuit, design, pads } = setup();
    const { files } = exportFabrication(circuit, design);
    for (const [name, layer] of [['F_Cu.gtl', 'top'], ['B_Cu.gbl', 'bottom']] as const) {
      const g = parse(files.find((f) => f.name.endsWith(name))!.content);
      const expected = pads.filter((p) => p.layers.includes(layer)).length + design.vias.length;
      expect(g.flashes.filter((f) => f.pol === 'D').length).toBe(expected);
      expect(g.end).toBe(true);
      expect([...g.aps.values()].some((a) => a.startsWith('C,0.350000') || a.startsWith('C,0.500000'))).toBe(true);
      for (const f of [...g.flashes, ...g.draws]) { expect(f.x).toBeGreaterThanOrEqual(0); expect(f.x).toBeLessThanOrEqual(design.outline.w); expect(f.y).toBeGreaterThanOrEqual(0); expect(f.y).toBeLessThanOrEqual(design.outline.h); }
      expect(g.pol[g.pol.length - 1]).not.toBe('C');
    }
    const top = parse(files.find((f) => f.name.endsWith('.gtl'))!.content);
    expect([...top.aps.values()]).toContain('C,0.350000');
    const bot = parse(files.find((f) => f.name.endsWith('.gbl'))!.content);
    expect([...bot.aps.values()]).toContain('C,0.500000');
  });

  it('zone: region, clear flashes of other nets, balanced polarity, GND pads not cleared', () => {
    const { circuit, design, pads } = setup();
    const g = parse(exportFabrication(circuit, design).files.find((f) => f.name.endsWith('.gbl'))!.content);
    expect(g.regions).toBe(1);
    expect(g.pol.filter((p) => p === 'C').length).toBeGreaterThan(0);
    // every LPC followed by an LPD
    g.pol.forEach((p, i) => { if (p === 'C') expect(g.pol.slice(i + 1)).toContain('D'); });
    const clears = g.flashes.filter((f) => f.pol === 'C');
    const ground = pads.filter((p) => (p.comp === 'V1' && p.pin === 'N') || (p.comp === 'R2' && p.pin === '2'));
    for (const gp of ground) expect(clears.some((c) => Math.abs(c.x - gp.x) < 1e-6 && Math.abs(c.y - (design.outline.h - gp.y)) < 1e-6)).toBe(false);
    const vp = pads.find((p) => p.comp === 'V1' && p.pin === 'P')!;
    expect(clears.some((c) => Math.abs(c.x - vp.x) < 1e-6 && Math.abs(c.y - (design.outline.h - vp.y)) < 1e-6)).toBe(true);
    // region inside board
    for (const d of g.draws.filter((d) => d.inRegion)) { expect(d.x).toBeGreaterThanOrEqual(design.rules.edgeClearance - 1e-9); expect(d.x).toBeLessThanOrEqual(design.outline.w - design.rules.edgeClearance + 1e-9); }
  });

  it('edge cuts: 4 draws; mask openings expanded, vias tented', () => {
    const { circuit, design, pads } = setup();
    const { files } = exportFabrication(circuit, design);
    const e = parse(files.find((f) => f.name.endsWith('.gm1'))!.content);
    expect(e.draws.length).toBe(4);
    expect(e.end).toBe(true);
    const m = parse(files.find((f) => f.name.endsWith('.gts'))!.content);
    expect(m.flashes.length).toBe(pads.filter((p) => p.layers.includes('top')).length);
    const p0 = pads.find((p) => p.layers.includes('top'))!;
    const apStr = m.aps.get(m.flashes[0].ap)!;
    expect(apStr).toContain((Math.max(p0.w, p0.h) + 0.1).toFixed(6).slice(0, 4));
  });

  it('silkscreen has outline draws plus reference text strokes (D01 > 0)', () => {
    const { circuit, design } = setup();
    const s = parse(exportFabrication(circuit, design).files.find((f) => f.name.endsWith('.gto'))!.content);
    expect(s.draws.length).toBeGreaterThan(Object.keys(design.placements).length * 4);
    // 'R1' text is drawn: its strokes lie above the R1 outline (smaller model y = larger gerber y)
    const pl = design.placements[circuit.components.find((c) => c.ref === 'R1')!.id];
    const gy = design.outline.h - pl.y;
    expect(s.draws.some((d) => d.y > gy + 1)).toBe(true);
  });

  it('paste layers: only SMD pad flashes; through-hole parts get none', () => {
    const { circuit, design, pads } = setup();
    const th = parse(exportFabrication(circuit, design).files.find((f) => f.name.endsWith('.gtp'))!.content);
    expect(pads.some((p) => p.drill > 0)).toBe(true);
    expect(th.flashes.length).toBe(0); // test circuit is all through-hole
    // mixed board: one SMD 0805 resistor on top, one on the bottom
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 5 }); b.add('r_smd0805_1k'); b.add('r_smd0805_1k'); b.add('ground');
    b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'R2.1'); b.chain('R2.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    const c2 = b.circuit;
    const d0 = autoPlace(c2);
    const r2 = c2.components.find((c) => c.ref === 'R2')!;
    const d2: PcbDesign = { ...d0, placements: { ...d0.placements, [r2.id]: { ...d0.placements[r2.id], side: 'bottom' } } };
    const wp = worldPads(c2, d2);
    const smdTop = wp.filter((p) => p.drill <= 0 && p.layers.includes('top')).length;
    const smdBot = wp.filter((p) => p.drill <= 0 && p.layers.includes('bottom')).length;
    expect(smdTop).toBe(2); expect(smdBot).toBe(2);
    const files = exportFabrication(c2, d2).files;
    const gtp = parse(files.find((f) => f.name.endsWith('.gtp'))!.content);
    const gbp = parse(files.find((f) => f.name.endsWith('.gbp'))!.content);
    expect(gtp.flashes.length).toBe(smdTop);
    expect(gbp.flashes.length).toBe(smdBot);
    // each paste flash sits on an SMD pad of that side (no through-hole pad positions)
    const thPads = wp.filter((p) => p.drill > 0);
    for (const f of [...gtp.flashes, ...gbp.flashes]) expect(thPads.some((p) => Math.abs(p.x - f.x) < 1e-6 && Math.abs(d2.outline.h - p.y - f.y) < 1e-6)).toBe(false);
    expect(gtp.end && gbp.end).toBe(true);
  });

  it('bottom silkscreen is mirrored in x relative to the same part on top', () => {
    const { circuit, design } = setup();
    const r1 = circuit.components.find((c) => c.ref === 'R1')!;
    const top = parse(exportFabrication(circuit, design).files.find((f) => f.name.endsWith('.gto'))!.content);
    const pl = design.placements[r1.id];
    const flipped: PcbDesign = { ...design, placements: { ...design.placements, [r1.id]: { ...pl, side: 'bottom' } } };
    const files = exportFabrication(circuit, flipped).files;
    const bot = parse(files.find((f) => f.name.endsWith('.gbo'))!.content);
    expect(bot.draws.length).toBeGreaterThan(0);
    expect(bot.end).toBe(true);
    const topSilk = parse(files.find((f) => f.name.endsWith('.gto'))!.content);
    expect(topSilk.draws.length).toBeLessThan(top.draws.length); // R1 left the top file
    // text mirrored about pl.x: x mean of the bottom strokes above the part equals pl.x, and the set is symmetric image of upright text
    const gy = design.outline.h - pl.y;
    const upright = top.draws.filter((d) => d.y > gy + 1 && Math.abs(d.x - pl.x) < 2);
    const mirrored = bot.draws.filter((d) => d.y > gy + 1 && Math.abs(d.x - pl.x) < 2);
    expect(mirrored.length).toBe(upright.length);
    const key = (xs: number[]) => xs.map((x) => Math.round(x * 1e3)).sort((a, b) => a - b);
    expect(key(mirrored.map((d) => 2 * pl.x - d.x))).toEqual(key(upright.map((d) => d.x)));
  });

  it('excellon: tool per distinct drill and hole count', () => {
    const { circuit, design, pads } = setup();
    const drl = exportFabrication(circuit, design).files.find((f) => f.name.endsWith('.drl'))!.content;
    const th = pads.filter((p) => p.drill > 0);
    const dias = new Set([...th.map((p) => p.drill.toFixed(3)), ...design.vias.map((v) => v.drill.toFixed(3))]);
    expect(drl).toContain('METRIC,TZ');
    expect(drl.split('\n').filter((l) => /^T\d+C/.test(l)).length).toBe(dias.size);
    expect(drl.split('\n').filter((l) => /^X/.test(l)).length).toBe(th.length + design.vias.length);
    expect(drl.trim().endsWith('M30')).toBe(true);
  });

  it('4-layer adds inner planes', () => {
    const { circuit, design, pads } = setup(4);
    const { files, warnings } = exportFabrication(circuit, design);
    const in1 = parse(files.find((f) => f.name.endsWith('.g2'))!.content);
    expect(files.some((f) => f.name.endsWith('.g3'))).toBe(true);
    expect(in1.regions).toBe(1);
    const th = pads.filter((p) => p.drill > 0);
    const clears = in1.flashes.filter((f) => f.pol === 'C').length;
    expect(clears).toBeGreaterThan(0);
    expect(clears).toBeLessThan(th.length + design.vias.length);
    expect(warnings.some((w) => w.includes('in2'))).toBe(true);
  });

  it('pick and place rows and rotation conversion', () => {
    const { circuit, design } = setup();
    design.placements.R1 = { ...design.placements.R1, rot: 90 };
    const rows = pickAndPlaceCsv(circuit, design).split('\r\n');
    expect(rows[0]).toBe('Ref,Val,Package,PosX,PosY,Rot,Side');
    expect(rows.length - 1).toBe(Object.keys(design.placements).length);
    const r1 = rows.find((r) => r.startsWith('R1,'))!.split(',');
    expect(r1[5]).toBe('270');
    expect(Number(r1[4])).toBeCloseTo(design.outline.h - design.placements.R1.y, 3);
    expect(rows.find((r) => r.startsWith('R2,'))!.split(',')[5]).toBe('0');
    expect(rows.some((r) => r.startsWith('GND'))).toBe(false);
  });

  it('BOM groups identical resistors and marks missing', () => {
    const { circuit } = setup();
    const lines = bomForFab(circuit).split('\r\n');
    expect(lines[0]).toBe('Ref,Qty,Type,Value,Footprint,Manufacturer,MPN,Datasheet,Note');
    const r = lines.find((l) => l.startsWith('R1 R2,2,'))!;
    expect(r).toBeDefined();
    expect(r).toContain('EKSİK');
    expect(r).toContain('Genel model: üretici parçası değil');
    expect(lines.length).toBe(3); // header + resistors + supply
  });
});

describe('zip', () => {
  it('round trip: names, sizes, CRC', () => {
    const files = [{ name: 'a.gtl', data: 'G04 hello*\nM02*\n' }, { name: 'şekil/b.drl', data: new Uint8Array([0, 1, 2, 3, 255]) }, { name: 'empty.txt', data: '' }];
    const zip = makeZip(files);
    expect(readZipNames(zip)).toEqual(['a.gtl', 'şekil/b.drl', 'empty.txt']);
    const got = readZip(zip);
    got.forEach((g, i) => {
      const src = typeof files[i].data === 'string' ? new TextEncoder().encode(files[i].data as string) : (files[i].data as Uint8Array);
      expect(g.size).toBe(src.length);
      expect(Array.from(g.data)).toEqual(Array.from(src));
      expect(crc32(g.data)).toBe(g.crc);
    });
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
