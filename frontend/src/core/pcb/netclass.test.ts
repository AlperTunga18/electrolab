import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import { buildNets } from '../circuit/nets';
import { kicadNetlist, kicadPcb, kicadProject } from '../export/kicad';
import { autoPlace, ensureDesign } from './design';
import { runDrc } from './drc';
import { classOfKey, netClassList, netKeys, netLabel } from './netclass';
import { autoroute } from './router';
import type { PcbDesign, Track } from './types';

/** R1 (x=20), R2 (x=50) at y=20. Net "R1:2" = R1.2-R2.1 (signal), ground net key "G1:G". */
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
/** signal loop over the top (y=15) and a ground loop above it (y=14.2): copper gap 0.4 mm for 0.4 wide signal track */
const sig = (w = 0.4) => trk('S', [[25.08, 20], [25.08, 15], [44.92, 15], [44.92, 20]], w);
const gnd = () => trk('G', [[14.92, 20], [14.92, 14.2], [55.08, 14.2], [55.08, 20]]);
const POWER = { name: 'Power', width: 0.8, clearance: 0.5, viaDia: 1.2, viaDrill: 0.6 };
const withPower = (d: PcbDesign): PcbDesign => ({ ...d, rules: { ...d.rules, netClasses: [POWER] }, netClassOf: { 'R1:2': 'Power' } });
const codes = (d: ReturnType<typeof runDrc>) => d.map((i) => i.code);

describe('net sınıfları: anahtar ve çözümleme', () => {
  it('net anahtarı = en küçük pin anahtarı; net indeksi değil', () => {
    const { circuit } = base();
    const keys = netKeys(circuit);
    const nets = buildNets(circuit);
    expect(keys[nets.pinNet.get('R1:2')!]).toBe('R1:2');
    expect(keys[nets.pinNet.get('R2:2')!]).toBe('G1:G');
  });

  it('atama, başka parça/net eklenince (indeksler kayarken) aynı netle kalır', () => {
    const { circuit, design } = base();
    const d = withPower(design);
    const c2 = new CircuitBuilder();
    c2.circuit = { components: [...circuit.components], wires: [...circuit.wires] };
    c2.add('resistor', { r: 10 }, 0, 0, 0, 'R0');
    c2.add('resistor', { r: 10 }, 0, 0, 0, 'R9');
    c2.wire('R0.2', 'R9.1').wire('R0.1', 'G1.G');
    const keys = netKeys(c2.circuit);
    const nets = buildNets(c2.circuit);
    expect(classOfKey(d, keys[nets.pinNet.get('R1:2')!]).name).toBe('Power');
    expect(classOfKey(d, keys[nets.pinNet.get('R9:1')!]).name).toBe('Default');
  });

  it('Default her zaman genel kurallardan; bilinmeyen sınıf Default', () => {
    const { design } = base();
    design.rules = { ...design.rules, defaultWidth: 0.55, netClasses: [{ name: 'Default', width: 9, clearance: 9, viaDia: 9, viaDrill: 9 }] };
    design.netClassOf = { 'R1:2': 'YokBoyleSinif' };
    expect(netClassList(design)[0]).toMatchObject({ name: 'Default', width: 0.55, clearance: design.rules.minClearance });
    expect(classOfKey(design, 'R1:2').width).toBe(0.55);
  });

  it('net adı: kullanıcı adı varsa o, yoksa yedek', () => {
    expect(netLabel({ netNames: { 'R1:2': 'VCC' } }, 'R1:2', 'N1')).toBe('VCC');
    expect(netLabel({ netNames: { 'R1:2': '  ' } }, 'R1:2', 'N1')).toBe('N1');
    expect(netLabel({}, 'R1:2', 'N1')).toBe('N1');
  });
});

describe('ensureDesign: eski proje', () => {
  it('alanlar yoksa eklenir, tasarım bozulmaz', () => {
    const { circuit, design } = base();
    design.tracks = [sig(), gnd()];
    const legacy = { ...circuit, pcb: design };
    expect(legacy.pcb.rules.netClasses).toBeUndefined();
    const d = ensureDesign(legacy);
    expect(d.netClassOf).toEqual({});
    expect(d.netNames).toEqual({});
    expect(d.rules.netClasses).toHaveLength(1);
    expect(d.rules.netClasses![0].name).toBe('Default');
    expect(d.tracks).toEqual(design.tracks);
    expect(d.placements).toEqual(design.placements);
  });

  it('mevcut atama ve adlar korunur', () => {
    const { circuit, design } = base();
    const legacy = { ...circuit, pcb: { ...withPower(design), netNames: { 'R1:2': 'SIG' } } };
    const d = ensureDesign(legacy);
    expect(d.netClassOf).toEqual({ 'R1:2': 'Power' });
    expect(d.netNames).toEqual({ 'R1:2': 'SIG' });
    expect(d.rules.netClasses).toEqual([POWER]);
  });
});

describe('DRC: sınıfa göre eşik', () => {
  it('sınıfsız (eski) tasarım: iz/boşluk temiz', () => {
    const { circuit, design } = base();
    design.tracks = [sig(), gnd()];
    expect(runDrc(circuit, design)).toEqual([]);
  });

  it('ensureDesign sonrası aynı sonuç (regresyon)', () => {
    const { circuit, design } = base();
    design.tracks = [sig(), gnd()];
    const after = ensureDesign({ ...circuit, pcb: design });
    expect(runDrc(circuit, after)).toEqual(runDrc(circuit, design));
  });

  it('MIN_WIDTH sınıfa göre: Power neti 0.4 mm izle hata, 0.8 ile temiz', () => {
    const { circuit, design } = base();
    design.tracks = [sig(0.4), gnd()];
    const mw = runDrc(circuit, withPower(design)).filter((i) => i.code === 'MIN_WIDTH');
    expect(mw).toHaveLength(1);
    expect(mw[0].refs).toEqual(['S']);
    expect(mw[0].message).toContain('en az 0.8 mm');
    design.tracks = [sig(0.8), gnd()];
    expect(codes(runDrc(circuit, withPower(design)))).not.toContain('MIN_WIDTH');
  });

  it('CLEARANCE iki sınıfın büyüğü: 0.4 mm aralık Default için tamam, Power (0.5) için hata', () => {
    const { circuit, design } = base();
    design.tracks = [sig(0.4), gnd()];
    expect(codes(runDrc(circuit, design))).not.toContain('CLEARANCE');
    const cl = runDrc(circuit, withPower(design)).filter((i) => i.code === 'CLEARANCE');
    expect(cl.length).toBeGreaterThan(0);
    expect(cl[0].message).toContain('en az 0.5 mm');
  });

  it('Default genel minClearance’ı izler', () => {
    const { circuit, design } = base();
    design.tracks = [sig(), gnd()];
    design.rules = { ...design.rules, minClearance: 0.6 };
    expect(codes(runDrc(circuit, design))).toContain('CLEARANCE');
  });
});

describe('router: sınıftan iz/via/boşluk', () => {
  it('güç netine geniş iz, diğerine varsayılan; sonuç DRC temiz', () => {
    const { circuit, design } = base();
    const d = withPower(design);
    const r = autoroute(circuit, d);
    expect(r.failed).toEqual([]);
    const widths = new Set(r.tracks.map((t) => t.width));
    expect(widths).toEqual(new Set([0.8, 0.4]));
    const atR12 = r.tracks.filter((t) => t.pts.some((p) => Math.hypot(p[0] - 25.08, p[1] - 20) < 1e-6));
    expect(atR12.length).toBeGreaterThan(0);
    for (const t of atR12) expect(t.width).toBe(0.8);
    const bad = runDrc(circuit, { ...d, tracks: r.tracks, vias: r.vias }).filter((i) => i.severity === 'error');
    expect(bad).toEqual([]);
    for (const v of r.vias) expect([1.2, 0.8]).toContain(v.dia);
  });

  it('sınıflar yoksa çıktı, ensureDesign sonrası ile birebir aynı (regresyon)', () => {
    const { circuit, design } = base();
    const a = autoroute(circuit, design);
    const b = autoroute(circuit, ensureDesign({ ...circuit, pcb: design }));
    expect(b).toEqual(a);
    expect(a.tracks.length).toBeGreaterThan(0);
    for (const t of a.tracks) expect(t.width).toBe(design.rules.defaultWidth);
  });

  it('Power sınıfının geniş boşluğu: sonuç DRC temiz', () => {
    const { circuit, design } = base();
    const d = { ...withPower(design), rules: { ...design.rules, netClasses: [{ ...POWER, clearance: 1.0 }] } };
    const r = autoroute(circuit, d);
    expect(r.failed).toEqual([]);
    const errs = runDrc(circuit, { ...d, tracks: r.tracks, vias: r.vias }).filter((i) => i.severity === 'error');
    expect(errs).toEqual([]);
  });
});

describe('KiCad: net adları ve net_class', () => {
  it('kullanıcı net adı netlist ve .kicad_pcb içinde; net_class yazılır', () => {
    const { circuit, design } = base();
    const d: PcbDesign = { ...withPower(design), netNames: { 'R1:2': 'VCC' } };
    expect(kicadNetlist(circuit, d)).toContain('(name "VCC")');
    const pcb = kicadPcb(circuit, { ...d, tracks: [sig(0.8), gnd()] });
    expect(pcb).toMatch(/\(net \d+ "VCC"\)/);
    expect(pcb).toContain('(net_class "Default"');
    expect(pcb).toMatch(/\(net_class "Power" "" \(clearance 0\.5\) \(trace_width 0\.8\) \(via_dia 1\.2\) \(via_drill 0\.6\)[^\n]*\(add_net "VCC"\)\)/);
    let depth = 0;
    for (const ch of pcb.replace(/"(?:[^"\\]|\\.)*"/g, '')) { if (ch === '(') depth++; else if (ch === ')') depth--; }
    expect(depth).toBe(0);
  });

  it('adsız ve sınıfsız tasarım eski adlandırmayı korur', () => {
    const { circuit, design } = base();
    expect(kicadNetlist(circuit, design)).toContain('(name "Net-(R1-Pad2)")');
    expect(kicadNetlist(circuit)).toContain('(name "GND")');
  });

  it('yinelenen kullanıcı adı net birleşmesine yol açmaz', () => {
    const { circuit, design } = base();
    const d: PcbDesign = { ...design, netNames: { 'R1:2': 'X', 'G1:G': 'X' } };
    const names = [...kicadNetlist(circuit, d).matchAll(/\(name "([^"]+)"\)/g)].map((m) => m[1]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('.kicad_pro: sınıflar ve atama kalıpları geçerli JSON', () => {
    const { circuit, design } = base();
    const d: PcbDesign = { ...withPower(design), netNames: { 'R1:2': 'VCC' } };
    const j = JSON.parse(kicadProject(circuit, d));
    expect(j.net_settings.classes.map((c: { name: string }) => c.name)).toEqual(['Default', 'Power']);
    expect(j.net_settings.classes[1]).toMatchObject({ clearance: 0.5, track_width: 0.8, via_diameter: 1.2, via_drill: 0.6 });
    expect(j.net_settings.netclass_patterns).toEqual([{ netclass: 'Power', pattern: 'VCC' }]);
  });
});
