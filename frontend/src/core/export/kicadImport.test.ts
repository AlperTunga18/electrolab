import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import { autoPlace } from '../pcb/design';
import type { Poly } from '../pcb/geom';
import type { PcbDesign } from '../pcb/types';
import { kicadPcb } from './kicad';
import { applyKicadPatch, importKicadPcb } from './kicadImport';

/** R1 (x=20) and R2 (x=50) at y=20; GND (net 0) = R1.1 and R2.2, net 1 = R1.2-R2.1. Board 70 x 40. */
function base() {
  const b = new CircuitBuilder();
  b.add('resistor', { r: 1000 }, 0, 0, 0, 'R1');
  b.add('resistor', { r: 1000 }, 0, 0, 0, 'R2');
  b.add('ground', {}, 0, 0, 0, 'G1');
  b.wire('R1.2', 'R2.1').wire('R1.1', 'G1.G').wire('R2.2', 'G1.G');
  const design: PcbDesign = autoPlace(b.circuit);
  design.outline = { w: 70, h: 40 };
  design.placements.R1 = { x: 20, y: 20, rot: 0, side: 'top' };
  design.placements.R2 = { x: 50, y: 20, rot: 0, side: 'top' };
  return { circuit: b.circuit, design };
}
const L: Poly = [[0, 0], [70, 0], [70, 30], [40, 30], [40, 40], [0, 40]];
const noId = <T extends { id: string }>(l: T[]) => l.map(({ id: _id, ...r }) => r);
const imp = (text: string, c: ReturnType<typeof base>) => importKicadPcb(text, c.circuit, c.design);

describe('KiCad içe aktarma: kendi çıktımızla gidiş-dönüş', () => {
  it('yerleşim (rot/side), iz, via, zone, poligon kart, delikler aynen döner', () => {
    const c = base();
    const d = c.design;
    d.outline = { w: 70, h: 40, poly: L };
    d.placements.R1 = { x: 20, y: 20, rot: 90, side: 'bottom' };
    d.placements.R2 = { x: 50.5, y: 21.25, rot: 270, side: 'top' };
    d.tracks = [{ id: 'a', layer: 'top', width: 0.4, pts: [[20, 20], [30, 20], [30, 25]] }, { id: 'b', layer: 'bottom', width: 0.25, pts: [[10, 10], [12, 10]] }];
    d.vias = [{ id: 'v', x: 30, y: 25, dia: 0.8, drill: 0.4 }];
    d.zones = [
      { id: 'za', layer: 'top', anchor: { comp: 'R1', pin: '1' }, clearance: 0.3, priority: 2, thermal: { gap: 0.4, spokeW: 0.3 }, minThickness: 0.25, poly: [[8, 10], [32, 10], [32, 30], [8, 30]] },
      { id: 'zb', layer: 'bottom', anchor: { comp: 'R1', pin: '2' }, clearance: 0.3 },
    ];
    d.holes = [{ x: 3, y: 3, drill: 3.2 }, { x: 67, y: 3, drill: 2.5 }];
    const r = imp(kicadPcb(c.circuit, d), c);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
    const out = applyKicadPatch({ ...d, placements: { R1: { x: 0, y: 0, rot: 0, side: 'top' } }, tracks: [], vias: [], zones: [], holes: undefined, outline: { w: 1, h: 1 } }, r.patch!);
    expect(out.placements.R1).toEqual(d.placements.R1);
    expect(out.placements.R2).toEqual(d.placements.R2);
    expect(noId(out.tracks)).toEqual(noId(d.tracks));
    expect(noId(out.vias)).toEqual(noId(d.vias));
    expect(noId(out.zones)).toEqual(noId(d.zones));
    expect(out.outline).toEqual(d.outline);
    expect(out.holes).toEqual(d.holes);
    expect(r.summary).toMatchObject({ footprintsMatched: 2, footprintsUnmatched: 0, tracks: 2, vias: 1, zones: 2, holes: 2, outline: 'poly', layers: 2 });
  });

  it('dikdörtgen kart (gr_rect) ve 4 katman + iç katman zone', () => {
    const c = base();
    const d = c.design;
    d.rules = { ...d.rules, layers: 4 };
    d.zones = [{ id: 'z', layer: 'in1', anchor: { comp: 'R1', pin: '1' }, clearance: 0.3 }];
    const r = imp(kicadPcb(c.circuit, d), c);
    expect(r.warnings).toEqual([]);
    const out = applyKicadPatch({ ...d, rules: { ...d.rules, layers: 2 }, zones: [], outline: { w: 5, h: 5 } }, r.patch!);
    expect(out.rules.layers).toBe(4);
    expect(out.outline).toEqual({ w: 70, h: 40 });
    expect(noId(out.zones)).toEqual(noId(d.zones));
  });

  it('boş tasarım (iz/via/zone yok) çıktı değişmez; holes tanımsızsa tanımsız kalır', () => {
    const c = base();
    const r = imp(kicadPcb(c.circuit, c.design), c);
    const out = applyKicadPatch(c.design, r.patch!);
    expect(out).toEqual(c.design);
  });

  it('mevcut footprint override ve dosyada olmayan parçanın yerleşimi korunur (uyarıyla)', () => {
    const c = base();
    const full = kicadPcb(c.circuit, c.design);
    const without = full.split('\n').filter((l) => !l.includes('"R2"') || !l.includes('fp_text')).join('\n'); // R2 Reference metni yok → eşleşmez
    const r = imp(without, c);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes('Reference metni bulunamadı'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('"R2"') && w.includes('dosyada yok'))).toBe(true);
    const d2: PcbDesign = { ...c.design, placements: { ...c.design.placements, R1: { ...c.design.placements.R1, footprint: '0805' } } };
    const out = applyKicadPatch(d2, r.patch!);
    expect(out.placements.R1.footprint).toBe('0805');
    expect(out.placements.R2).toEqual(c.design.placements.R2);
  });
});

describe('KiCad içe aktarma: uyarılar ve sağlamlık', () => {
  it('bilinmeyen token\'lar çökmeden atlanır ve listelenir', () => {
    const c = base();
    const t = kicadPcb(c.circuit, c.design).replace(/\)\n$/, '  (gr_text "hi" (at 1 1) (layer "F.SilkS"))\n  (dimension (type aligned))\n  (fancy_new_thing 1 2 3)\n  (segment (start 1 1) (end 2 2) (width 0.2) (layer "In1.Cu") (net 0))\n)\n');
    const r = imp(t, c);
    expect(r.ok).toBe(true);
    const w = r.warnings.join('\n');
    expect(w).toContain('dimension×1');
    expect(w).toContain('fancy_new_thing×1');
    expect(w).toContain('gr_text');
    expect(w).toContain('iç katman izi');
    expect(r.summary!.tracks).toBe(0);
  });

  it('ref uyuşmazlığı: eşleşmeyen footprint ve devrede kalan parça uyarı verir', () => {
    const c = base();
    const t = kicadPcb(c.circuit, c.design).replace('(fp_text reference "R1"', '(fp_text reference "R9"');
    const r = imp(t, c);
    expect(r.warnings.some((w) => w.includes('"R9"') && w.includes('eşleşen parça yok'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('"R1"') && w.includes('dosyada yok'))).toBe(true);
    expect(r.summary).toMatchObject({ footprintsMatched: 1, footprintsUnmatched: 1 });
    expect(r.patch!.placements.R1).toBeUndefined();
  });

  it('bilinmeyen net: iz uyarısı, zone atlanır', () => {
    const c = base();
    const t = kicadPcb(c.circuit, c.design).replace(/\)\n$/, '  (net 99 "FOO")\n  (segment (start 1 1) (end 2 2) (width 0.2) (layer "F.Cu") (net 99))\n  (zone (net 99) (net_name "FOO") (layer "F.Cu") (polygon (pts (xy 0 0) (xy 5 0) (xy 5 5))))\n)\n');
    const r = imp(t, c);
    expect(r.warnings.some((w) => w.includes('"FOO"') && w.includes('devrede yok'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('Zone bilinmeyen net "FOO"'))).toBe(true);
    expect(r.summary).toMatchObject({ tracks: 1, zones: 0 });
  });

  it('gr_line döngüsü kart sınırı olur; ek kontur ve açık zincir uyarı verir', () => {
    const c = base();
    const edge = (a: string, b: string) => `  (gr_line (start ${a}) (end ${b}) (layer "Edge.Cuts"))`;
    const lines = [edge('0 0', '30 0'), edge('30 10', '30 0'), edge('30 10', '0 10'), edge('0 10', '0 0'), edge('50 50', '60 50')].join('\n');
    const t = `(kicad_pcb (version 20221018)\n${lines}\n)\n`;
    const r = imp(t, c);
    expect(r.ok).toBe(true);
    expect(r.patch!.outline).toEqual({ w: 30, h: 10, poly: [[0, 0], [30, 0], [30, 10], [0, 10]] });
    expect(r.warnings.some((w) => w.includes('kapalı bir kontur oluşturmuyor'))).toBe(true);
  });

  it('Edge.Cuts yoksa sınır korunur (uyarı); sürüm farkı uyarı verir', () => {
    const c = base();
    const r = imp('(kicad_pcb (version 20240108))', c);
    expect(r.ok).toBe(true);
    expect(r.patch!.outline).toBeUndefined();
    expect(applyKicadPatch(c.design, r.patch!).outline).toEqual(c.design.outline);
    expect(r.warnings.some((w) => w.includes('Edge.Cuts kart sınırı bulunamadı'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('20240108'))).toBe(true);
  });

  it('pad eşleşmezse dönüş at açısından alınır (uyarıyla); açı 90 katı değilse uyarı', () => {
    const c = base();
    const t = '(kicad_pcb (version 20221018)\n  (footprint "Foreign:R" (layer "F.Cu") (at 10 12 90)\n    (fp_text reference "R1" (at 0 0) (layer "F.SilkS"))\n    (pad "1" smd rect (at -9 0) (size 1 1) (layers "F.Cu")))\n  (footprint "Foreign:R" (layer "F.Cu") (at 30 12 45)\n    (fp_text reference "R2" (at 0 0) (layer "F.SilkS")))\n)\n';
    const r = imp(t, c);
    expect(r.patch!.placements.R1).toEqual({ x: 10, y: 12, rot: 270, side: 'top' }); // KiCad 90° (CCW varsayımı) -> bizde 270
    expect(r.warnings.filter((w) => w.includes('pad dizilimi')).length).toBe(2);
    expect(r.warnings.some((w) => w.includes('90\'ın katı değil'))).toBe(true);
  });

  it('KiCad 8 tarzı property "Reference" okunur', () => {
    const c = base();
    const t = '(kicad_pcb (version 20221018)\n  (footprint "X" (layer "B.Cu") (at 5 6)\n    (property "Reference" "R2" (at 0 0))))\n';
    const r = imp(t, c);
    expect(r.patch!.placements.R2).toMatchObject({ x: 5, y: 6, side: 'bottom' });
  });

  it('Default dışı net_class uyarı verir (içe aktarılmaz)', () => {
    const c = base();
    const r = imp('(kicad_pcb (version 20221018) (net_class "Default" "") (net_class "Power" "" (add_net "GND")))', c);
    expect(r.warnings.filter((w) => w.includes('net_class'))).toEqual(['1 net_class içe aktarılmadı (net sınıfları desteklenmiyor).']);
  });

  it('bozuk dosyalar hata verir ama çökmez', () => {
    const c = base();
    const good = kicadPcb(c.circuit, c.design);
    for (const bad of ['', '   ', '(kicad_pcb (version 1)', good.slice(0, good.length >> 1), good + ')', '(foo)', 'düz metin', '"(kicad_pcb"', ')(']) {
      const r = imp(bad, c);
      expect(r.ok).toBe(false);
      expect(typeof r.error).toBe('string');
      expect(r.patch).toBeUndefined();
    }
  });

  it('eksik alanlı öğeler (segment/via/zone/pad) çökmeden uyarı olur', () => {
    const c = base();
    const t = '(kicad_pcb (version 20221018) (segment (start 1 1)) (via (at 1)) (zone) (footprint) (footprint "n" (at 1 1)) (gr_rect (layer "Edge.Cuts")) (gr_poly (pts (xy 0 0)) (layer "Edge.Cuts")) (net) (layers 5))';
    const r = imp(t, c);
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(5);
    expect(r.summary).toMatchObject({ tracks: 0, vias: 0, zones: 0, outline: 'none' });
  });
});
