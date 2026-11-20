import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import { kicadPcb } from '../export/kicad';
import { autoPlace, ensureDesign, worldPads } from './design';
import { extractConnectivity, runDrc } from './drc';
import { exportFabrication } from './gerber';
import { signedInsideDist, type Poly } from './geom';
import { autoroute } from './router';
import type { PcbDesign, Track } from './types';

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
const trk = (id: string, pts: [number, number][], width = 0.4): Track => ({ id, layer: 'top', width, pts });
/** 70 x 40 board with the bottom-right corner (x > 40, y > 30) removed */
const L: Poly = [[0, 0], [70, 0], [70, 30], [40, 30], [40, 40], [0, 40]];
const file = (r: ReturnType<typeof exportFabrication>, suffix: string) => r.files.find((f) => f.name.endsWith(suffix))!.content;
const balanced = (t: string): boolean => {
  let d = 0, q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '\\') i++; else if (c === '"') q = false; continue; }
    if (c === '"') q = true; else if (c === '(') d++; else if (c === ')' && --d < 0) return false;
  }
  return d === 0 && !q;
};

describe('zone poligonu', () => {
  it('zone poligonunun dışındaki pad zone a bağlanmaz; poligonsuz zone tüm kartı kapsar', () => {
    const { circuit, design } = base();
    design.zones = [{ id: 'z', layer: 'top', anchor: { comp: 'R1', pin: '1' }, clearance: 0.3 }];
    expect(extractConnectivity(circuit, design).unrouted.filter((x) => x.net === 0)).toEqual([]); // tam kart: R1.1 ile R2.2 birleşir
    design.zones = [{ id: 'z', layer: 'top', anchor: { comp: 'R1', pin: '1' }, clearance: 0.3, poly: [[8, 10], [32, 10], [32, 30], [8, 30]] }];
    const u = extractConnectivity(circuit, design).unrouted.filter((x) => x.net === 0);
    expect(u.length).toBe(1);
    expect([u[0].a.comp, u[0].b.comp].sort()).toEqual(['R1', 'R2']);
    design.zones[0].poly = [[8, 10], [62, 10], [62, 30], [8, 30]]; // R2 de içeride: yeniden bağlanır
    expect(extractConnectivity(circuit, design).unrouted.filter((x) => x.net === 0)).toEqual([]);
  });

  it('aynı katmanda birden çok zone: uyarı yok, öncelik sırasıyla dolar', () => {
    const { circuit, design } = base();
    design.zones = [
      { id: 'hi', layer: 'top', anchor: { comp: 'R1', pin: '2' }, clearance: 0.3, priority: 2, poly: [[8, 5], [30, 5], [30, 35], [8, 35]] },
      { id: 'lo', layer: 'top', anchor: { comp: 'R1', pin: '1' }, clearance: 0.3, priority: 1 },
    ];
    const r = exportFabrication(circuit, design);
    expect(r.warnings.join('|')).not.toMatch(/yalnızca ilki/);
    const t = file(r, 'F_Cu.gtl');
    expect(t.split('\n').filter((l) => l === 'G36*').length).toBe(3); // lo, hi'nin altını temizleyen bölge, hi
    // ilk bölge (düşük öncelik, tam kart) 69.4 mm genişlikte: X69700000 içerir; hi poligonu (x<=30) içermez
    const first = t.slice(t.indexOf('G36*'), t.indexOf('G37*'));
    expect(first).toContain('X69700000');
    const last = t.slice(t.lastIndexOf('G36*'), t.lastIndexOf('G37*'));
    expect(last).not.toContain('X69700000');
    expect(last).toContain('X30000000');
  });

  it('eski proje (zone.poly/holes/outline.poly yok) ensureDesign ile bozulmaz', () => {
    const { circuit, design } = base();
    design.zones = [{ id: 'z', layer: 'top', anchor: { comp: 'R1', pin: '1' }, clearance: 0.3 }];
    const d = ensureDesign({ ...circuit, pcb: design });
    expect(d.outline.poly).toBeUndefined();
    expect(d.holes).toBeUndefined();
    expect(d.zones[0].poly).toBeUndefined();
    const p = ensureDesign({ ...circuit, pcb: { ...design, outline: { w: 70, h: 40, poly: L } } });
    expect(p.outline.poly).toEqual(L);
    expect(p.outline.w).toBe(70);
  });
});

describe('Gerber: termal rölyef, poligon sınır, NPTH', () => {
  function gerberSetup() {
    const { circuit, design } = base();
    design.zones = [{ id: 'z', layer: 'bottom', anchor: { comp: 'R1', pin: '1' }, clearance: 0.3, thermal: { gap: 0.3, spokeW: 0.25 } }];
    return { circuit, design };
  }
  /** number of dark draw segments made with the round aperture of diameter `dia` */
  function drawsWith(txt: string, dia: number): number {
    const lines = txt.split('\n');
    let spoke = -1;
    for (const l of lines) { const m = l.match(/^%ADD(\d+)C,([\d.]+)\*%$/); if (m && Math.abs(Number(m[2]) - dia) < 1e-9) spoke = Number(m[1]); }
    if (spoke < 0) return 0;
    let code = -1, pol = 'D', n = 0;
    for (const l of lines) {
      let m: RegExpMatchArray | null;
      if ((m = l.match(/^%LP([DC])\*%$/))) pol = m[1];
      else if ((m = l.match(/^D(\d+)\*$/))) code = Number(m[1]);
      else if (/^X-?\d+Y-?\d+D01\*$/.test(l) && code === spoke && pol === 'D') n++;
    }
    return n;
  }

  it('aynı netteki her pad için 4 termal spoke; termal yoksa spoke yok', () => {
    const { circuit, design } = gerberSetup();
    const pads = worldPads(circuit, design);
    const gnd = pads.find((p) => p.comp === 'R1' && p.pin === '1')!.net;
    const same = pads.filter((p) => p.net === gnd).length;
    expect(same).toBe(2);
    expect(drawsWith(file(exportFabrication(circuit, design), 'B_Cu.gbl'), 0.25)).toBe(4 * same);
    delete design.zones[0].thermal;
    expect(drawsWith(file(exportFabrication(circuit, design), 'B_Cu.gbl'), 0.25)).toBe(0);
  });

  it('zone dışındaki pad termal almaz', () => {
    const { circuit, design } = gerberSetup();
    design.zones[0].poly = [[8, 10], [32, 10], [32, 30], [8, 30]]; // yalnız R1
    expect(drawsWith(file(exportFabrication(circuit, design), 'B_Cu.gbl'), 0.25)).toBe(4);
  });

  it('Edge_Cuts poligon: köşe sayısı kadar çizim, y = H - y', () => {
    const { circuit, design } = base();
    design.outline = { w: 70, h: 40, poly: L };
    const t = file(exportFabrication(circuit, design), 'Edge_Cuts.gm1');
    const pts = t.split('\n').filter((l) => /^X-?\d+Y-?\d+D0[12]\*$/.test(l));
    expect(pts.length).toBe(L.length + 1); // kapanış dahil
    expect(pts[0]).toBe('X0Y40000000D02*'); // (0,0) -> y_g = 40
    expect(pts).toContain('X40000000Y10000000D01*'); // (40,30) -> y_g = 10
  });

  it('NPTH.drl montaj deliklerini yazar; deliksiz tasarımda boş', () => {
    const { circuit, design } = base();
    const count = (t: string) => t.split('\n').filter((l) => /^X\d/.test(l)).length;
    expect(count(file(exportFabrication(circuit, design), 'NPTH.drl'))).toBe(0);
    design.holes = [{ x: 3, y: 3, drill: 3.2 }, { x: 67, y: 3, drill: 3.2 }, { x: 3, y: 37, drill: 2.2 }];
    const t = file(exportFabrication(circuit, design), 'NPTH.drl');
    expect(count(t)).toBe(3);
    expect(t).toContain('T1C2.200');
    expect(t).toContain('X3.000Y37.000'); // (3,3): y_g = 40 - 3
    expect(count(file(exportFabrication(circuit, design), 'PTH.drl'))).toBe(4); // montaj delikleri PTH.drl'ye girmez
  });
});

describe('DRC: poligon kart, montaj deliği', () => {
  it('L şekilli kartta girinti köşesindeki iz EDGE hatası verir (dikdörtgen kartta vermez)', () => {
    const { circuit, design } = base();
    design.tracks = [trk('X', [[10, 35], [60, 35]])];
    expect(runDrc(circuit, design).filter((i) => i.code === 'EDGE')).toEqual([]);
    design.outline = { w: 70, h: 40, poly: L };
    const e = runDrc(circuit, design).filter((i) => i.code === 'EDGE');
    expect(e.length).toBe(1);
    expect(e[0].refs).toEqual(['X']);
    expect(e[0].message).toMatch(/kart dışında/);
    design.tracks = [trk('Y', [[35, 25], [45, 25], [45, 35]])]; // ucu girintide
    expect(runDrc(circuit, design).some((i) => i.code === 'EDGE' && i.refs?.[0] === 'Y')).toBe(true);
    design.tracks = [trk('Z', [[5, 35], [35, 35]])]; // tamamen içeride
    expect(runDrc(circuit, design).some((i) => i.code === 'EDGE')).toBe(false);
  });

  it('girinti duvarına edgeClearance den yakın iz: EDGE (yakın)', () => {
    const { circuit, design } = base();
    design.outline = { w: 70, h: 40, poly: L };
    design.tracks = [trk('N', [[5, 35], [39.9, 35]])]; // duvar x=40: iz kenarı 39.9+0.2 -> değiyor/geçiyor
    expect(runDrc(circuit, design).some((i) => i.code === 'EDGE')).toBe(true);
    design.tracks = [trk('N', [[5, 35], [39.6, 35]])]; // iz kenarı 39.8: duvara 0.2 < 0.3
    const e = runDrc(circuit, design).find((i) => i.code === 'EDGE');
    expect(e?.message).toMatch(/yakın/);
  });

  it('montaj deliği: kart dışı, bakıra yakın, temiz durum', () => {
    const { circuit, design } = base();
    design.outline = { w: 70, h: 40, poly: L };
    design.holes = [{ x: 5, y: 5, drill: 3.2 }];
    expect(runDrc(circuit, design).filter((i) => i.code.startsWith('HOLE'))).toEqual([]);
    design.holes = [{ x: 55, y: 35, drill: 3.2 }]; // girintide
    expect(runDrc(circuit, design).some((i) => i.code === 'HOLE_OFF_BOARD')).toBe(true);
    design.holes = [{ x: 5, y: 5, drill: 3.2 }];
    design.tracks = [trk('T', [[5, 7], [20, 7]])]; // delik kenarı y=6.6, iz kenarı 6.8: 0.2 < 0.3
    const near = runDrc(circuit, design).filter((i) => i.code === 'HOLE_CLEARANCE');
    expect(near.length).toBe(1);
    expect(near[0].refs).toContain('T');
    design.tracks = [trk('T', [[5, 12], [20, 12]])];
    expect(runDrc(circuit, design).some((i) => i.code === 'HOLE_CLEARANCE')).toBe(false);
  });

  it('zone poligonu karttan taşarsa ZONE_OUTSIDE uyarısı', () => {
    const { circuit, design } = base();
    design.zones = [{ id: 'z', layer: 'top', anchor: { comp: 'R1', pin: '1' }, clearance: 0.3, poly: [[8, 10], [80, 10], [80, 30], [8, 30]] }];
    expect(runDrc(circuit, design).some((i) => i.code === 'ZONE_OUTSIDE')).toBe(true);
  });
});

describe('yönlendirici: kart dışı hücre engel', () => {
  it('yuva yolu kesince iz poligonun içinden dolanır', () => {
    const { circuit, design } = base();
    // üstten açılan yuva x 33..37, y 0..22: R1.2 -> R2.1 doğrudan hattı (y=20) kesilir
    const slot: Poly = [[0, 0], [33, 0], [33, 22], [37, 22], [37, 0], [70, 0], [70, 40], [0, 40]];
    design.outline = { w: 70, h: 40, poly: slot };
    const r = autoroute(circuit, design);
    expect(r.failed).toEqual([]);
    expect(r.tracks.length).toBeGreaterThan(0);
    for (const t of r.tracks) for (const [x, y] of t.pts) expect(signedInsideDist(slot, x, y)).toBeGreaterThanOrEqual(design.rules.edgeClearance - 1e-6);
    const routed = { ...design, tracks: r.tracks, vias: r.vias };
    expect(runDrc(circuit, routed).filter((i) => i.code === 'EDGE' || i.code === 'UNROUTED' || i.code === 'SHORT')).toEqual([]);
  });

  it('montaj deliği çevresi engel: iz delik duvarına edgeClearance den yaklaşmaz', () => {
    const { circuit, design } = base();
    design.holes = [{ x: 35, y: 20, drill: 3 }];
    const r = autoroute(circuit, design);
    expect(r.failed).toEqual([]);
    for (const t of r.tracks) for (let i = 0; i + 1 < t.pts.length; i++) {
      const [a, b] = [t.pts[i], t.pts[i + 1]];
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const k = l2 ? Math.max(0, Math.min(1, ((35 - a[0]) * dx + (20 - a[1]) * dy) / l2)) : 0;
      expect(Math.hypot(35 - (a[0] + k * dx), 20 - (a[1] + k * dy)) - 1.5 - t.width / 2).toBeGreaterThanOrEqual(design.rules.edgeClearance - 1e-6);
    }
  });
});

describe('KiCad: poligon kart, zone, montaj deliği', () => {
  it('gr_poly, zone poligonu (priority + termal), NPTH footprint, parantez dengesi', () => {
    const { circuit, design } = base();
    design.outline = { w: 70, h: 40, poly: L };
    design.holes = [{ x: 3, y: 3, drill: 3.2 }, { x: 67, y: 3, drill: 3.2 }];
    design.zones = [
      { id: 'a', layer: 'top', anchor: { comp: 'R1', pin: '1' }, clearance: 0.3, priority: 2, thermal: { gap: 0.4, spokeW: 0.3 }, minThickness: 0.25, poly: [[8, 10], [32, 10], [32, 30], [8, 30]] },
      { id: 'b', layer: 'top', anchor: { comp: 'R1', pin: '2' }, clearance: 0.3 },
    ];
    const t = kicadPcb(circuit, design);
    expect(balanced(t)).toBe(true);
    expect(t).toContain('(gr_poly (pts (xy 0 0) (xy 70 0) (xy 70 30) (xy 40 30) (xy 40 40) (xy 0 40))');
    expect(t).not.toContain('gr_rect');
    expect((t.match(/np_thru_hole/g) ?? []).length).toBe(2);
    expect((t.match(/\(zone /g) ?? []).length).toBe(2);
    expect(t).toContain('(priority 2)');
    expect(t).toContain('(thermal_gap 0.4) (thermal_bridge_width 0.3)');
    expect(t).toContain('(min_thickness 0.25)');
    expect(t).toContain('(xy 8 10) (xy 32 10) (xy 32 30) (xy 8 30)');
    const z2 = t.split('\n').find((l) => l.includes('(zone ') && !l.includes('priority'))!; // poligonsuz zone: kart poligonu içe offsetli (6 köşe)
    expect((z2.match(/\(xy /g) ?? []).length).toBe(6);
  });

  it('dikdörtgen kart eski çıktıyı korur (gr_rect, zone 4 köşe)', () => {
    const { circuit, design } = base();
    design.zones = [{ id: 'b', layer: 'top', anchor: { comp: 'R1', pin: '2' }, clearance: 0.3 }];
    const t = kicadPcb(circuit, design);
    expect(t).toContain('(gr_rect (start 0 0) (end 70 40)');
    expect(t).toContain('(polygon (pts (xy 0.3 0.3) (xy 69.7 0.3) (xy 69.7 39.7) (xy 0.3 39.7)))');
    expect(t).not.toContain('priority');
    expect(balanced(t)).toBe(true);
  });
});
