import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import { COMPONENTS } from '../../library/components';
import { kicadPcb } from '../export/kicad';
import { autoPlace, ensureDesign, footprintOf, resolveFootprint, worldPads } from './design';
import { runDrc } from './drc';
import { footprintFor } from './footprints';
import { exportFabrication } from './gerber';
import { chip, dip, footprintCatalog, generateFootprint, header, pinCountOf, qfn, radialCap, soic, sot223, sot23, to220, tssop } from './landPatterns';
import type { Footprint, PcbDesign } from './types';

const def8 = COMPONENTS.find((d) => d.pins.length === 8 && d.model !== 'ground')!;
function part(type: string) {
  const b = new CircuitBuilder();
  const id = b.add(type, {}, 0, 0, 0, 'U1');
  const d = autoPlace(b.circuit);
  return { circuit: b.circuit, design: d, id };
}

describe('land pattern üreteçleri', () => {
  it('SOIC-8: 8 pad, pitch 1.27, iki sıra', () => {
    const f = soic(8);
    expect(f.pads).toHaveLength(8);
    const left = f.pads.filter((p) => p.x < 0).sort((a, b) => a.y - b.y);
    expect(left).toHaveLength(4);
    expect(left[1].y - left[0].y).toBeCloseTo(1.27);
    expect(f.pads.find((p) => p.pin === '1')!.x).toBeLessThan(0);
    expect(f.pads.find((p) => p.pin === '8')!.x).toBeGreaterThan(0);
    expect(f.smd).toBe(true);
  });
  it('TSSOP-14 pitch 0.65, DIP-16 pitch 2.54 / 7.62', () => {
    const t = tssop(14).pads.filter((p) => p.x < 0).sort((a, b) => a.y - b.y);
    expect(t[1].y - t[0].y).toBeCloseTo(0.65);
    const d = dip(16);
    expect(d.pads).toHaveLength(16);
    expect(d.pads.find((p) => p.pin === '16')!.x - d.pads.find((p) => p.pin === '1')!.x).toBeCloseTo(7.62);
    expect(d.pads.every((p) => p.drill > 0)).toBe(true);
  });
  it('0805 pad aralığı makul; boyutlar monoton', () => {
    const f = chip('0805');
    const gap = f.pads[1].x - f.pads[0].x;
    expect(gap).toBeGreaterThan(1.5);
    expect(gap).toBeLessThan(2.5);
    expect(chip('0402').pads[1].x).toBeLessThan(chip('0603').pads[1].x);
    expect(chip('0603').pads[1].x).toBeLessThan(chip('0805').pads[1].x);
    expect(chip('0805').pads[1].x).toBeLessThan(chip('1206').pads[1].x);
  });
  it('QFN-n pad sayısı ve benzersiz konum', () => {
    for (const n of [16, 20, 24, 32, 48]) {
      const f = qfn(n);
      expect(f.pads).toHaveLength(n);
      expect(new Set(f.pads.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)).size).toBe(n);
    }
    expect(() => qfn(18)).toThrow();
  });
  it('SOT-23-3/5/6, SOT-223, TO-220, header, radyal kondansatör', () => {
    expect([3, 5, 6].map((n) => sot23(n as 3 | 5 | 6).pads.length)).toEqual([3, 5, 6]);
    expect(sot223().pads).toHaveLength(4);
    expect(pinCountOf(sot223())).toBe(3);
    expect(to220().pads).toHaveLength(3);
    expect(header(1, 4).pads).toHaveLength(4);
    expect(header(2, 5).pads).toHaveLength(10);
    const e = radialCap(8, 3.5);
    expect(e.pads[1].x - e.pads[0].x).toBeCloseTo(3.5);
    expect(e.width).toBeGreaterThanOrEqual(8);
  });
  it('generateFootprint anahtarları; bilinmeyen -> undefined; katalog tutarlı', () => {
    expect(generateFootprint('SOIC-8')!.pads).toHaveLength(8);
    expect(generateFootprint('soic-8')!.name).toBe('SOIC-8');
    expect(generateFootprint('0805')!.name).toBe('CHIP-0805');
    expect(generateFootprint('FOO-3')).toBeUndefined();
    expect(generateFootprint('QFN-18')).toBeUndefined();
    for (const { key, pins } of footprintCatalog()) expect(pinCountOf(generateFootprint(key)!), key).toBe(pins);
  });
});

describe('footprint override', () => {
  it('varsayılan yol: override yokken footprintFor/resolve/footprintOf aynı çıktı', () => {
    for (const d of COMPONENTS.filter((x) => x.model !== 'ground').slice(0, 60)) {
      const a = footprintFor(d);
      expect(footprintFor(d, undefined)).toEqual(a);
      expect(resolveFootprint(d).fp).toEqual(a);
      expect(resolveFootprint(d, { x: 0, y: 0, rot: 0, side: 'top' }).fp).toEqual(a);
    }
    const r = COMPONENTS.find((d) => d.type === 'resistor')!;
    const f = footprintFor(r);
    expect(f.pads.map((p) => p.pin)).toEqual(r.pins.map((p) => p.id));
    expect(f.name).toMatch(/^(TH|SMD)-/);
  });

  it('uyan override uygulanır, pad pinleri parça pinlerine eşlenir', () => {
    const { circuit, design, id } = part(def8.type);
    design.placements[id].footprint = 'SOIC-8';
    const fp = footprintOf(circuit.components[0], design);
    expect(fp.name).toBe('SOIC-8');
    expect(fp.pads.map((p) => p.pin)).toEqual(def8.pins.map((p) => p.id));
    expect(worldPads(circuit, design)).toHaveLength(8);
    expect(runDrc(circuit, design).filter((i) => i.code === 'FOOTPRINT_MISMATCH')).toEqual([]);
  });

  it('pin sayısı uyuşmazsa reddedilir + FOOTPRINT_MISMATCH', () => {
    const { circuit, design, id } = part(def8.type);
    design.placements[id].footprint = 'SOIC-14';
    const r = resolveFootprint(def8, design.placements[id], design);
    expect(r.warning).toBeTruthy();
    expect(r.fp).toEqual(footprintFor(def8));
    expect(footprintOf(circuit.components[0], design)).toEqual(footprintFor(def8));
    expect(runDrc(circuit, design).filter((i) => i.code === 'FOOTPRINT_MISMATCH')).toHaveLength(1);
    design.placements[id].footprint = 'BILINMEYEN';
    expect(runDrc(circuit, design).filter((i) => i.code === 'FOOTPRINT_MISMATCH')).toHaveLength(1);
  });

  it('customFootprints: JSON gidiş-dönüş, ensureDesign korur, pad pinleri eşlenir', () => {
    const { circuit, design, id } = part('resistor');
    const custom: Footprint = {
      name: 'MY-R', smd: true, width: 4, height: 2, silk: [],
      pads: [{ pin: 'a', x: -1.5, y: 0, shape: 'rect', w: 1, h: 1, drill: 0 }, { pin: 'b', x: 1.5, y: 0, shape: 'rect', w: 1, h: 1, drill: 0 }],
    };
    const d2: PcbDesign = { ...design, customFootprints: { 'MY-R': custom } };
    d2.placements[id].footprint = 'MY-R';
    const c2 = { ...circuit, pcb: JSON.parse(JSON.stringify(d2)) as PcbDesign };
    const e = ensureDesign(c2);
    expect(e.customFootprints!['MY-R']).toEqual(custom);
    expect(e.placements[id].footprint).toBe('MY-R');
    const wp = worldPads(c2, e);
    expect(wp).toHaveLength(2);
    expect(wp[1].x - wp[0].x).toBeCloseTo(3);
  });

  it('eski proje (footprint/customFootprints yok) bozulmaz', () => {
    const { circuit } = part('resistor');
    const e = ensureDesign(circuit);
    expect(e.customFootprints).toBeUndefined();
    expect(Object.values(e.placements).every((p) => p.footprint === undefined)).toBe(true);
  });

  it('KiCad çıktısında override pad sayısı doğru', () => {
    const { circuit, design, id } = part(def8.type);
    design.placements[id] = { ...design.placements[id], footprint: 'SOIC-8', x: 20, y: 20 };
    design.outline = { w: 40, h: 40 };
    const pcb = kicadPcb(circuit, design);
    expect(pcb).toContain('ElectroLab:SOIC-8');
    expect((pcb.match(/\(pad /g) ?? []).length).toBe(8);
    expect(typeof exportFabrication).toBe('function');
  });
});
