import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import { autoPlace } from './design';
import {
  diffMicrostripZ, emcChecks, extractConnectivity, ipcClearanceMm, ipcCurrent, ipcTraceWidth, microstripWidthForZ0,
  microstripZ0, runDrc, viaCurrentA, viaResistanceMilliohm,
} from './drc';
import { DEFAULT_RULES, type PcbDesign, type Track } from './types';

/** R1 (x=20) and R2 (x=50) at y=20; pads at x = 14.92/25.08 and 44.92/55.08. Net 1 = R1.2-R2.1, ground (net 0) = R1.1, R2.2. */
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
  return { circuit: b.circuit, design, b };
}
const trk = (id: string, pts: [number, number][], width = 0.4, layer: Track['layer'] = 'top'): Track => ({ id, layer, width, pts });
const sig = (): Track => trk('S', [[25.08, 20], [44.92, 20]]);
const gnd = (): Track => trk('G', [[14.92, 20], [14.92, 30], [55.08, 30], [55.08, 20]]);
const codes = (c: ReturnType<typeof runDrc>) => c.map((i) => i.code);

describe('bağlantı / DRC', () => {
  it('tamamen bağlı tasarım temiz', () => {
    const { circuit, design } = base();
    design.tracks = [sig(), gnd()];
    const conn = extractConnectivity(circuit, design);
    expect(conn.unrouted).toEqual([]);
    expect(conn.shorts).toEqual([]);
    expect(runDrc(circuit, design)).toEqual([]);
  });

  it('eksik iz -> UNROUTED doğru pad\'lerle', () => {
    const { circuit, design } = base();
    design.tracks = [gnd()];
    const u = runDrc(circuit, design).filter((i) => i.code === 'UNROUTED');
    expect(u).toHaveLength(1);
    expect(u[0].refs!.sort()).toEqual(['R1.2', 'R2.1']);
    const conn = extractConnectivity(circuit, design);
    expect(conn.unrouted[0].net).toBe(1);
    expect(conn.unrouted[0].ax).toBeCloseTo(25.08);
  });

  it('iki net\'i köprüleyen iz -> SHORT', () => {
    const { circuit, design } = base();
    design.tracks = [sig(), gnd(), trk('X', [[25.08, 20], [14.92, 20]])];
    const issues = runDrc(circuit, design);
    expect(codes(issues)).toContain('SHORT');
    const s = extractConnectivity(circuit, design).shorts[0];
    expect([s.netA, s.netB].sort()).toEqual([0, 1]);
  });

  it('0.1 mm aralıklı izler -> CLEARANCE, 0.5 mm -> yok', () => {
    const { circuit, design } = base();
    design.tracks = [sig(), gnd(), trk('A', [[10, 35], [40, 35]], 0.2), trk('B', [[10, 35.3], [40, 35.3]], 0.2)];
    expect(codes(runDrc(circuit, design))).toContain('CLEARANCE');
    design.tracks = [sig(), gnd(), trk('A', [[10, 35], [40, 35]], 0.2), trk('B', [[10, 35.7], [40, 35.7]], 0.2)];
    expect(codes(runDrc(circuit, design))).not.toContain('CLEARANCE');
  });

  it('genişlik / delik / halka / kenar ihlalleri', () => {
    const { circuit, design } = base();
    design.tracks = [sig(), gnd(), trk('thin', [[10, 36], [20, 36]], 0.1), trk('edge', [[0.1, 5], [0.1, 10]], 0.2)];
    const c = codes(runDrc(circuit, design));
    expect(c).toContain('MIN_WIDTH');
    expect(c).toContain('EDGE');
    expect(c).not.toContain('MIN_DRILL');
    design.tracks = [sig(), gnd()];
    design.rules = { ...DEFAULT_RULES, minDrill: 1.0 };
    expect(codes(runDrc(circuit, design))).toContain('MIN_DRILL');
    design.rules = { ...DEFAULT_RULES, minAnnular: 0.5 };
    expect(codes(runDrc(circuit, design))).toContain('ANNULAR');
    design.vias = [{ id: 'v', x: 35, y: 10, dia: 0.5, drill: 0.4 }];
    design.rules = DEFAULT_RULES;
    expect(codes(runDrc(circuit, design))).toContain('ANNULAR'); // (0.5-0.4)/2 = 0.05 < 0.13
  });

  it('courtyard çakışması ve kart dışı', () => {
    const { circuit, design } = base();
    design.tracks = [sig(), gnd()];
    design.placements.R2 = { x: 30, y: 20, rot: 0, side: 'top' };
    expect(codes(runDrc(circuit, design))).toContain('COURTYARD');
    design.placements.R2 = { x: 2, y: 20, rot: 0, side: 'top' };
    expect(codes(runDrc(circuit, design))).toContain('OFF_BOARD');
  });

  it('CURRENT ve VOLTAGE_CLEARANCE', () => {
    const { circuit, design } = base();
    design.tracks = [sig(), gnd()];
    const need = ipcTraceWidth(2, 10, 1);
    expect(need).toBeGreaterThan(0.4);
    expect(codes(runDrc(circuit, design, { currents: { 1: 2 } }))).toContain('CURRENT');
    expect(codes(runDrc(circuit, design, { currents: { 1: 0.1 } }))).not.toContain('CURRENT');
    design.rules = { ...DEFAULT_RULES, voltage: 300 };
    const v = runDrc(circuit, design).filter((i) => i.code === 'VOLTAGE_CLEARANCE');
    expect(v).toHaveLength(1);
  });

  it('zone iki toprak pad\'ini bağlar', () => {
    const { circuit, design } = base();
    design.tracks = [sig()];
    expect(extractConnectivity(circuit, design).unrouted.some((u) => u.net === 0)).toBe(true);
    design.zones = [{ id: 'Z', layer: 'top', anchor: { comp: 'R1', pin: '1' }, clearance: 0.3 }];
    expect(extractConnectivity(circuit, design).unrouted).toEqual([]);
  });

  it('zone farklı net\'i birleştirmez', () => {
    const { circuit, design } = base();
    design.tracks = [sig(), gnd()];
    design.zones = [{ id: 'Z', layer: 'top', anchor: { comp: 'R1', pin: '1' }, clearance: 0.3 }];
    const conn = extractConnectivity(circuit, design);
    expect(conn.shorts).toEqual([]);
    expect(conn.clusters.find((c) => c.nets.includes(1))!.objects).not.toContain('Z');
  });

  it('via üst ve alt izi birleştirir', () => {
    const { circuit, design } = base();
    const top = trk('T', [[25.08, 20], [35, 20]]);
    const bot = trk('B', [[35, 20], [44.92, 20]], 0.4, 'bottom');
    design.tracks = [top, bot, gnd()];
    // via yok: üst ve alt iz ayrı, ama alt iz R2.1 (delikli) pad'ine değiyor, üst R1.2'ye -> bağlı değil
    expect(extractConnectivity(circuit, design).unrouted.some((u) => u.net === 1)).toBe(true);
    design.vias = [{ id: 'V', x: 35, y: 20, dia: 0.8, drill: 0.4 }];
    expect(extractConnectivity(circuit, design).unrouted.some((u) => u.net === 1)).toBe(false);
  });
});

describe('IPC / hesaplayıcılar', () => {
  it('ipcCurrent / ipcTraceWidth (1 A, 10 °C, 1 oz, dış) ≈ 0.300 mm', () => {
    // A = (1 / (0.048·10^0.44))^(1/0.725) = 16.30 mil² ; /1.378 mil = 11.83 mil = 0.3005 mm
    const w = ipcTraceWidth(1, 10, 1, true);
    expect(w).toBeCloseTo(0.3005, 3);
    expect(ipcCurrent(w, 10, 1, true)).toBeCloseTo(1, 6);
    expect(ipcCurrent(0.3, 10, 1)).toBeCloseTo(0.9984, 2);
    // iç katman k yarı -> aynı genişlik için akım yarı
    expect(ipcCurrent(0.3, 10, 1, false)).toBeCloseTo(ipcCurrent(0.3, 10, 1, true) / 2, 9);
    expect(ipcTraceWidth(1, 10, 1, false)).toBeGreaterThan(w * 2);
  });

  it('ipcClearanceMm tabloları', () => {
    expect(ipcClearanceMm(5, 'internal')).toBe(0.05);
    expect(ipcClearanceMm(5, 'external-uncoated')).toBe(0.1);
    expect(ipcClearanceMm(5, 'external-coated')).toBe(0.05);
    expect(ipcClearanceMm(24, 'external-coated')).toBe(0.13);
    expect(ipcClearanceMm(24, 'external-uncoated')).toBe(0.1);
    expect(ipcClearanceMm(230, 'external-uncoated')).toBe(1.25);
    expect(ipcClearanceMm(500, 'internal')).toBe(0.25);
    expect(ipcClearanceMm(600, 'internal')).toBeCloseTo(0.25 + 100 * 0.0025, 9);
    expect(ipcClearanceMm(600, 'external-uncoated')).toBeCloseTo(2.5 + 0.5, 9);
    expect(ipcClearanceMm(1000, 'external-coated')).toBeCloseTo(0.8 + 500 * 0.00305, 9);
  });

  it('microstripZ0 (0.3/0.2/0.035, er 4.5) ≈ 52.6 Ω', () => {
    // 87/sqrt(5.91) = 35.787 ; ln(5.98·0.2/(0.8·0.3+0.035)) = ln(4.3491) = 1.4700 ; Z0 = 52.60
    expect(microstripZ0(0.3, 0.2, 0.035, 4.5)).toBeCloseTo(52.6, 1);
  });

  it('microstripWidthForZ0 tersi alır', () => {
    const w = microstripWidthForZ0(50, 0.2, 0.035, 4.5);
    expect(microstripZ0(w, 0.2, 0.035, 4.5)).toBeCloseTo(50, 6);
    expect(w).toBeGreaterThan(0.3);
    expect(microstripWidthForZ0(52.6, 0.2, 0.035, 4.5)).toBeCloseTo(0.3, 2);
  });

  it('diffMicrostripZ', () => {
    // s/h = 1 -> 2·52.60·(1-0.48·e^-0.96) = 105.2·(1-0.48·0.38289) = 105.2·0.81621 = 85.87
    expect(diffMicrostripZ(0.3, 0.2, 0.035, 4.5, 0.2)).toBeCloseTo(85.87, 1);
    expect(diffMicrostripZ(0.3, 0.2, 0.035, 4.5, 100)).toBeCloseTo(2 * 52.6, 0);
  });

  it('via direnci ve akımı', () => {
    // A = π·(0.4+0.025)·0.025 = 0.033379 mm² ; R = 1.72e-8·1.6e-3/3.3379e-8 = 0.8245 mΩ
    expect(viaResistanceMilliohm(0.4, 1.6, 25)).toBeCloseTo(0.8245, 3);
    expect(viaResistanceMilliohm(0.4, 3.2, 25)).toBeCloseTo(2 * 0.8245, 3);
    // A = 0.033379/0.00064516 = 51.74 mil² ; I = 0.048·10^0.44·51.74^0.725 ≈ 2.31 A
    expect(viaCurrentA(0.4)).toBeCloseTo(2.31, 1);
    expect(viaCurrentA(0.6)).toBeGreaterThan(viaCurrentA(0.4));
  });
});

describe('EMC ön kontrolleri', () => {
  function icCircuit(capX: number | null) {
    const b = new CircuitBuilder();
    b.add('ne555', {}, 0, 0, 0, 'U1');
    b.add('ground', {}, 0, 0, 0, 'G1');
    if (capX !== null) { b.add('capacitor', {}, 0, 0, 0, 'C1'); b.wire('C1.1', 'U1.8').wire('C1.2', 'G1.G'); }
    b.wire('U1.1', 'G1.G');
    const design = autoPlace(b.circuit);
    design.placements.U1 = { x: 20, y: 20, rot: 0, side: 'top' };
    if (capX !== null) design.placements.C1 = { x: capX, y: 20, rot: 0, side: 'top' };
    return { circuit: b.circuit, design };
  }

  it('DECOUPLING: kondansatör yok / uzak / yakın', () => {
    let r = icCircuit(null);
    expect(emcChecks(r.circuit, r.design).filter((i) => i.code === 'DECOUPLING')).toHaveLength(1);
    r = icCircuit(60);
    expect(emcChecks(r.circuit, r.design).filter((i) => i.code === 'DECOUPLING')).toHaveLength(1);
    r = icCircuit(28);
    expect(emcChecks(r.circuit, r.design).filter((i) => i.code === 'DECOUPLING')).toHaveLength(0);
  });

  it('NO_GROUND_PLANE: zone yoksa info, varsa yok', () => {
    const { circuit, design } = base();
    expect(emcChecks(circuit, design).some((i) => i.code === 'NO_GROUND_PLANE')).toBe(true);
    design.zones = [{ id: 'Z', layer: 'bottom', anchor: { comp: 'R1', pin: '1' }, clearance: 0.3 }];
    expect(emcChecks(circuit, design).some((i) => i.code === 'NO_GROUND_PLANE')).toBe(false);
  });

  it('PARALLEL_RUN: uzun paralel farklı net izleri', () => {
    const { circuit, design } = base();
    design.tracks = [trk('S', [[25.08, 20], [44.92, 20]], 2), trk('G', [[14.92, 20], [14.92, 24], [55.08, 24], [55.08, 20]], 2)];
    expect(emcChecks(circuit, design).some((i) => i.code === 'PARALLEL_RUN')).toBe(true);
    design.tracks = [sig(), gnd()];
    expect(emcChecks(circuit, design).some((i) => i.code === 'PARALLEL_RUN')).toBe(false);
  });
});
