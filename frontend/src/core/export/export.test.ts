import { describe, it, expect } from 'vitest';
import { EXAMPLES } from '../../examples/examples';
import type { Circuit } from '../circuit/types';
import { getDef } from '../../library/components';
import { buildNets } from '../circuit/nets';
import { autoPlace } from '../pcb/design';
import type { PcbDesign } from '../pcb/types';
import { kicadNetlist, kicadPcb } from './kicad';
import { asciiTr, buildReportPdf } from './report';

const ex = (id: string): Circuit => EXAMPLES.find((e) => e.id === id)!.build();

/** parentheses balance, ignoring those inside string literals */
function balanced(s: string): boolean {
  let depth = 0, inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (ch === '\\') i++; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth < 0) return false; }
  }
  return depth === 0 && !inStr;
}

const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;

describe('kicad netlist', () => {
  for (const id of ['led', 'divider', 'npn', 'ac-dc-adaptor']) {
    it(`netlist ${id}`, () => {
      const c = ex(id);
      const net = kicadNetlist(c);
      expect(balanced(net)).toBe(true);
      expect(net).toContain('(name "GND")');
      const real = c.components.filter((p) => getDef(p.type).model !== 'ground');
      for (const p of real) expect(net).toContain(`(ref "${p.ref}")`);
      for (const p of c.components.filter((q) => getDef(q.type).model === 'ground')) expect(net).not.toContain(`(comp (ref "${p.ref}")`);
      const pins = real.reduce((n, p) => n + getDef(p.type).pins.length, 0);
      expect(count(net, /\(node /g)).toBe(pins);
    });
  }
  it('escapes strings', () => {
    const c = ex('led');
    c.components[1].ref = 'R"1';
    expect(kicadNetlist(c)).toContain('R\\"1');
  });
});

describe('kicad pcb', () => {
  it('footprints, pads and nets', () => {
    const c = ex('npn');
    const d = autoPlace(c);
    const pcb = kicadPcb(c, d);
    expect(balanced(pcb)).toBe(true);
    expect(pcb.startsWith('(kicad_pcb (version 20221018)')).toBe(true);
    const placed = c.components.filter((p) => d.placements[p.id]);
    expect(count(pcb, /\(footprint "/g)).toBe(placed.length);
    const defined = new Set([...pcb.matchAll(/^ {2}\(net (\d+) "/gm)].map((m) => m[1]));
    defined.add('0');
    const padNets = [...pcb.matchAll(/\(pad [^\n]*\(net (\d+) "/g)].map((m) => m[1]);
    expect(padNets.length).toBeGreaterThan(0);
    for (const n of padNets) expect(defined.has(n)).toBe(true);
    expect(pcb).toContain('(layer "Edge.Cuts")');
  });
  it('tracks and vias appear with nets', () => {
    const c = ex('led');
    const base = autoPlace(c);
    const nets = buildNets(c);
    const r1 = c.components.find((p) => p.ref === 'R1')!;
    const pl = base.placements[r1.id];
    const d: PcbDesign = {
      ...base,
      tracks: [{ id: 't1', layer: 'top', width: 0.4, pts: [[pl.x - 5.08, pl.y], [pl.x - 5.08, pl.y + 10], [pl.x + 20, pl.y + 10]] }],
      vias: [{ id: 'v1', x: pl.x + 5.08, y: pl.y, dia: 0.8, drill: 0.4 }],
    };
    const pcb = kicadPcb(c, d);
    expect(balanced(pcb)).toBe(true);
    expect(count(pcb, /\(segment /g)).toBe(2);
    expect(count(pcb, /\(via /g)).toBe(1);
    const firstPadNet = nets.pinNet.get(`${r1.id}:1`)! + 1;
    expect(pcb).toMatch(new RegExp(`\\(segment [^\\n]*\\(net ${firstPadNet}\\)\\)`));
    const defined = new Set([...pcb.matchAll(/^ {2}\(net (\d+) "/gm)].map((m) => m[1]));
    for (const m of pcb.matchAll(/\((?:segment|via) [^\n]*\(net (\d+)\)\)/g)) expect(m[1] === '0' || defined.has(m[1])).toBe(true);
  });
});

describe('asciiTr', () => {
  it('maps Turkish and unit glyphs', () => {
    expect(asciiTr('şŞğĞıİöÖüÜçÇ')).toBe('sSgGiIoOuUcC');
    expect(asciiTr('10 kΩ 4.7 µF 25°C')).toBe('10 kohm 4.7 uF 25°C');
  });
});

describe('report pdf', () => {
  const txt = (u: Uint8Array): string => new TextDecoder('latin1').decode(u);
  it('small circuit', () => {
    const pdf = buildReportPdf(ex('led'), { title: 'LED devresi', date: new Date('2026-01-01T10:00:00Z'), ercLines: ['uyari 1'], drcLines: [] });
    expect(txt(pdf.slice(0, 4))).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(2048);
  });
  it('bigger circuit is multi-page', () => {
    const c = ex('ac-dc-adaptor');
    const pdf = buildReportPdf(c, { title: 'Adaptör', ercLines: Array.from({ length: 80 }, (_, i) => `ERC satırı ${i} ş ğ ı`), drcLines: Array.from({ length: 40 }, (_, i) => `DRC ${i}`) });
    expect(txt(pdf)).toMatch(/%PDF/);
    expect(count(txt(pdf), /\/Type \/Page\b(?!s)/g)).toBeGreaterThan(1);
  });
});

describe('kicad pcb: reference text, inner layers, zones', () => {
  const withZone = (c: Circuit, layers: 2 | 4, layer: 'bottom' | 'in1'): PcbDesign => {
    const base = autoPlace(c);
    const anchor = c.components.find((p) => getDef(p.type).model !== 'ground')!;
    return { ...base, rules: { ...base.rules, layers }, zones: [{ id: 'z1', layer, anchor: { comp: anchor.id, pin: getDef(anchor.type).pins[0].id }, clearance: 0.3 }] };
  };
  it('fp_text reference/value per footprint, mirrored on bottom', () => {
    const c = ex('led');
    const d = autoPlace(c);
    const placed = c.components.filter((p) => d.placements[p.id]);
    const pcb = kicadPcb(c, d);
    expect(balanced(pcb)).toBe(true);
    expect(count(pcb, /\(fp_text reference /g)).toBe(placed.length);
    for (const p of placed) expect(pcb).toContain(`(fp_text reference "${p.ref}"`);
    const flipped: PcbDesign = { ...d, placements: { ...d.placements, [placed[0].id]: { ...d.placements[placed[0].id], side: 'bottom' } } };
    const p2 = kicadPcb(c, flipped);
    expect(p2).toMatch(/\(fp_text reference "[^"]+" \(at [^)]*\) \(layer "B\.SilkS"\)[^\n]*\(justify mirror\)/);
    expect(p2).toContain('(34 "B.Paste" user)');
  });
  it('2-layer board defines only F.Cu/B.Cu; 4-layer adds In1/In2', () => {
    const c = ex('led');
    const two = kicadPcb(c, autoPlace(c));
    expect(two).not.toContain('In1.Cu');
    const d4 = withZone(c, 4, 'in1');
    const four = kicadPcb(c, d4);
    expect(four).toContain('(1 "In1.Cu" signal)');
    expect(four).toContain('(2 "In2.Cu" signal)');
    expect(balanced(four)).toBe(true);
  });
  it('zones exported as polygons on the anchor net; inner zone dropped on 2-layer', () => {
    const c = ex('led');
    const d = withZone(c, 2, 'bottom');
    const pcb = kicadPcb(c, d);
    expect(balanced(pcb)).toBe(true);
    expect(count(pcb, /\(zone /g)).toBe(1);
    const m = pcb.match(/\(zone \(net (\d+)\) \(net_name "([^"]*)"\) \(layer "B\.Cu"\)[^\n]*\(polygon \(pts ((?:\(xy [-\d.]+ [-\d.]+\) ?)+)\)\)\)/);
    expect(m).not.toBeNull();
    expect(count(m![3], /\(xy /g)).toBe(4);
    const defined = new Set([...pcb.matchAll(/^ {2}\(net (\d+) "/gm)].map((x) => x[1]));
    expect(m![1] === '0' || defined.has(m![1])).toBe(true);
    const d2 = withZone(c, 2, 'in1');
    expect(count(kicadPcb(c, d2), /\(zone /g)).toBe(0);
    expect(count(kicadPcb(c, withZone(c, 4, 'in1')), /\(zone [^\n]*\(layer "In1\.Cu"\)/g)).toBe(1);
  });
});
