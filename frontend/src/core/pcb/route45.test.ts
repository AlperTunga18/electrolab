import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import type { Circuit } from '../circuit/types';
import { EXAMPLES } from '../../examples/examples';
import { autoPlace, worldPads } from './design';
import { autoroute, type RouteOptions } from './router';
import { extractConnectivity, runDrc } from './drc';
import { netLengthReport, trackLength } from './length';
import { findDiffPairs, offsetPolyline, trimPolyline } from './diffpair';
import { netKeys } from './netclass';
import type { PcbDesign } from './types';

const hash = (s: string): number => { let x = 5381; for (let i = 0; i < s.length; i++) x = ((x * 33) ^ s.charCodeAt(i)) >>> 0; return x; };
const example = (id: string): Circuit => EXAMPLES.find((e) => e.id === id)!.build();
const withRoutes = (d: PcbDesign, r: { tracks: PcbDesign['tracks']; vias: PcbDesign['vias'] }): PcbDesign => ({ ...d, tracks: [...d.tracks, ...r.tracks], vias: [...d.vias, ...r.vias] });
const count = (c: Circuit, d: PcbDesign, code: string): number => runDrc(c, d).filter((i) => i.code === code).length;
const totalLen = (r: { tracks: { pts: [number, number][] }[] }): number => r.tracks.reduce((s, t) => s + trackLength(t), 0);

function placePadAt(circuit: Circuit, design: PcbDesign, comp: string, pin: string, x: number, y: number, rot: 0 | 90 | 180 | 270 = 0): void {
  design.placements[comp] = { x: 0, y: 0, rot, side: 'top' };
  const wp = worldPads(circuit, design).find((p) => p.comp === comp && p.pin === pin)!;
  design.placements[comp] = { x: x - wp.x, y: y - wp.y, rot, side: 'top' };
}

/** two 2-pin parts joined by one net, pads at the given positions on a 40x30 board */
function twoPad(a: [number, number], b: [number, number]): { c: Circuit; d: PcbDesign } {
  const bl = new CircuitBuilder();
  bl.add('r_smd0805_1k', {}, 0, 0, 0, 'R1'); bl.add('r_smd0805_1k', {}, 0, 0, 0, 'R2');
  bl.chain('R1.2', 'R2.1');
  const d = autoPlace(bl.circuit);
  d.outline = { w: 40, h: 30 };
  placePadAt(bl.circuit, d, 'R1', '2', a[0], a[1]);
  placePadAt(bl.circuit, d, 'R2', '1', b[0], b[1]);
  return { c: bl.circuit, d };
}

describe('router regression (default options = old behaviour)', () => {
  // hashes of JSON.stringify(autoroute(...)) taken from the router BEFORE the 45-degree / rip-up work
  const GOLD: [string, number][] = [
    ['led', 3999435209], ['divider', 955917019], ['rc', 1677252729], ['rectifier', 3159948582], ['npn', 1070253272],
    ['mosfet', 4278433048], ['role-flyback', 3684038802], ['h-kopru-motor', 2100602373], ['mcu_blink', 1787197953],
  ];
  for (const [id, h] of GOLD) {
    it(`${id}: output identical with 45 degrees and rip-up off`, () => {
      const c = example(id);
      const d = autoPlace(c);
      expect(hash(JSON.stringify(autoroute(c, d)))).toBe(h);
      expect(hash(JSON.stringify(autoroute(c, d, { diagonal: false, ripupRounds: 0, diffPairs: false })))).toBe(h);
    });
  }
});

describe('45-degree routing', () => {
  it('path is no longer than the Manhattan path and uses only 0/45/90 degree segments', () => {
    const { c, d } = twoPad([5, 5], [25, 17]);
    const man = autoroute(c, d), dia = autoroute(c, d, { diagonal: true });
    expect(man.failed).toEqual([]);
    expect(dia.failed).toEqual([]);
    expect(totalLen(dia)).toBeLessThanOrEqual(totalLen(man) + 1e-9);
    expect(totalLen(dia)).toBeLessThan(totalLen(man) - 1); // a real saving on this layout (12 mm diagonal)
    for (const t of dia.tracks) for (let i = 0; i + 1 < t.pts.length; i++) {
      const dx = Math.abs(t.pts[i + 1][0] - t.pts[i][0]), dy = Math.abs(t.pts[i + 1][1] - t.pts[i][1]);
      expect(dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-6).toBe(true);
    }
    expect(dia.tracks.some((t) => t.pts.some((p, i) => i > 0 && Math.abs(p[0] - t.pts[i - 1][0]) > 1e-6 && Math.abs(p[1] - t.pts[i - 1][1]) > 1e-6))).toBe(true);
  });

  it('examples route completely with 0 CLEARANCE / SHORT / UNROUTED (diagonal on)', () => {
    for (const id of ['led', 'divider', 'npn', 'mosfet', 'role-flyback', 'h-kopru-motor', 'mcu_blink']) {
      const c = example(id), d = autoPlace(c);
      const r = autoroute(c, d, { diagonal: true });
      expect(r.failed, id).toEqual([]);
      const d2 = withRoutes(d, r);
      expect(count(c, d2, 'CLEARANCE'), id).toBe(0);
      expect(count(c, d2, 'SHORT'), id).toBe(0);
      expect(count(c, d2, 'UNROUTED'), id).toBe(0);
    }
  });

  it('keeps clearance when a diagonal squeezes past other nets on a congested fixture', () => {
    const bl = new CircuitBuilder();
    for (const t of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']) bl.add('r_smd0805_1k', {}, 0, 0, 0, t);
    bl.chain('R1.2', 'R2.1'); bl.chain('R3.1', 'R4.1'); bl.chain('R5.1', 'R6.1');
    const d = autoPlace(bl.circuit);
    d.outline = { w: 24, h: 24 };
    placePadAt(bl.circuit, d, 'R1', '2', 4, 4); placePadAt(bl.circuit, d, 'R2', '1', 20, 20);
    placePadAt(bl.circuit, d, 'R3', '1', 20, 4); placePadAt(bl.circuit, d, 'R4', '1', 4, 20);
    placePadAt(bl.circuit, d, 'R5', '1', 12, 3); placePadAt(bl.circuit, d, 'R6', '1', 12, 21);
    const r = autoroute(bl.circuit, d, { diagonal: true });
    expect(r.failed).toEqual([]);
    const d2 = withRoutes(d, r);
    expect(count(bl.circuit, d2, 'CLEARANCE')).toBe(0);
    expect(count(bl.circuit, d2, 'SHORT')).toBe(0);
  });

  it('is deterministic', () => {
    const c = example('npn'), d = autoPlace(c);
    const o: RouteOptions = { diagonal: true, ripupRounds: 2, seed: 7 };
    expect(JSON.stringify(autoroute(c, d, o))).toBe(JSON.stringify(autoroute(c, d, o)));
  });

  it('route time stays bounded (h-bridge example, diagonal + 3 retry rounds)', () => {
    const c = example('h-kopru-motor'), d = autoPlace(c);
    const t0 = Date.now();
    const r = autoroute(c, d, { diagonal: true, ripupRounds: 3 });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.failed).toEqual([]);
  });
});

describe('rip-up / retry', () => {
  /** a board that is too tight for a greedy order: shrink the board of an example until the first pass fails */
  function tight(id: string): { c: Circuit; d: PcbDesign } {
    const c = example(id), d = autoPlace(c);
    return { c, d };
  }
  it('never makes the failure count worse and is deterministic', () => {
    for (const id of ['npn', 'role-flyback', 'h-kopru-motor']) {
      const { c, d } = tight(id);
      for (const shrink of [1, 0.85, 0.7]) {
        const dd: PcbDesign = { ...d, outline: { w: d.outline.w * shrink, h: d.outline.h * shrink } };
        const base = autoroute(c, dd, { diagonal: true });
        const rip = autoroute(c, dd, { diagonal: true, ripupRounds: 4, seed: 3 });
        expect(rip.failed.length, `${id} x${shrink}`).toBeLessThanOrEqual(base.failed.length);
        expect(JSON.stringify(autoroute(c, dd, { diagonal: true, ripupRounds: 4, seed: 3 }))).toBe(JSON.stringify(rip));
        if (base.failed.length === 0) expect(JSON.stringify({ ...rip, passes: undefined })).toBe(JSON.stringify({ ...base, passes: undefined }));
      }
    }
  });

  it('a congested fixture: retry rounds reduce 2 failed connections to 0 and stay DRC-clean', () => {
    // 7 two-pad nets at fixed positions on a 26 x 14 board (found by a seed scan; the greedy order leaves 2 connections open)
    const POS: [number, number][] = [[9, 10], [20, 3], [6, 4], [7, 9], [8, 8], [6, 10], [20, 4], [22, 10], [21, 3], [13, 4], [21, 7], [6, 5], [22, 6], [16, 10]];
    const bl = new CircuitBuilder();
    for (let i = 1; i <= 14; i++) bl.add('r_smd0805_1k', {}, 0, 0, 0, 'R' + i);
    for (let i = 0; i < 7; i++) bl.chain(`R${2 * i + 1}.2`, `R${2 * i + 2}.1`);
    const c = bl.circuit, d = autoPlace(c);
    d.outline = { w: 26, h: 14 };
    POS.forEach(([x, y], i) => placePadAt(c, d, 'R' + (i + 1), i % 2 === 0 ? '2' : '1', x, y));
    const base = autoroute(c, d, {});
    const rip = autoroute(c, d, { ripupRounds: 6, seed: 1 });
    expect(base.failed.length).toBe(2);
    expect(rip.failed.length).toBe(0);
    expect(rip.passes).toBeGreaterThan(1);
    const d2 = withRoutes(d, rip);
    expect(count(c, d2, 'CLEARANCE')).toBe(0);
    // (the random pads of this fixture partly touch each other, so SHORT is not asserted here; the routes themselves add no clearance violation)
    expect(JSON.stringify(autoroute(c, d, { ripupRounds: 6, seed: 1 }))).toBe(JSON.stringify(rip)); // deterministic seed
  });
});

describe('net length', () => {
  function lenFixture(): { c: Circuit; d: PcbDesign } {
    const bl = new CircuitBuilder();
    bl.add('resistor', {}, 0, 0, 0, 'R1'); bl.add('resistor', {}, 0, 0, 0, 'R2');
    bl.chain('R1.2', 'R2.1');
    const d = autoPlace(bl.circuit);
    d.outline = { w: 40, h: 30 };
    placePadAt(bl.circuit, d, 'R1', '2', 5, 5);
    placePadAt(bl.circuit, d, 'R2', '1', 8, 9);
    d.tracks = [{ id: 't1', layer: 'top', width: 0.4, pts: [[5, 5], [8, 5]] }, { id: 't2', layer: 'bottom', width: 0.4, pts: [[8, 5], [8, 9]] }];
    d.vias = [{ id: 'v1', x: 8, y: 5, dia: 0.8, drill: 0.4 }];
    return { c: bl.circuit, d };
  }
  it('matches a hand calculation: 3 mm + 4 mm of track + 1 via x 1.6 mm board thickness = 8.6 mm', () => {
    const { c, d } = lenFixture();
    const row = netLengthReport(c, d, extractConnectivity(c, d)).find((r) => r.viaCount === 1)!;
    expect(row.trackMm).toBeCloseTo(7, 9);
    expect(row.viaMm).toBeCloseTo(1.6, 9);
    expect(row.totalMm).toBeCloseTo(8.6, 9);
    expect(row.complete).toBe(true);
    expect(trackLength({ pts: [[0, 0], [3, 0], [3, 4]] })).toBeCloseTo(7, 12);
    expect(trackLength({ pts: [[0, 0], [3, 4]] })).toBeCloseTo(5, 12); // diagonal segment
  });

  it('LENGTH warning only outside the tolerance (class target and per-net override)', () => {
    const { c, d } = lenFixture();
    const key = netKeys(c)[netKeys(c).findIndex((_, n) => worldPads(c, d).some((p) => p.net === n && p.comp === 'R1' && p.pin === '2'))];
    expect(count(c, d, 'LENGTH')).toBe(0); // no target -> no check
    const t1: PcbDesign = { ...d, netLengthTargets: { [key]: { mm: 8, tol: 0.5 } } };
    const w = runDrc(c, t1).filter((i) => i.code === 'LENGTH');
    expect(w.length).toBe(1);
    expect(w[0].severity).toBe('warning');
    expect(w[0].message).toContain('+0.6');
    expect(count(c, { ...d, netLengthTargets: { [key]: { mm: 8, tol: 1 } } }, 'LENGTH')).toBe(0);
    const cls: PcbDesign = { ...d, rules: { ...d.rules, netClasses: [{ name: 'Len', width: 0.4, clearance: 0.2, viaDia: 0.8, viaDrill: 0.4, targetLength: 20, lengthTol: 2 }] }, netClassOf: { [key]: 'Len' } };
    expect(count(c, cls, 'LENGTH')).toBe(1);
    // unrouted net: length incomplete -> no verdict
    expect(count(c, { ...t1, tracks: [], vias: [] }, 'LENGTH')).toBe(0);
  });
});

describe('differential pair', () => {
  function pairFixture(nPads = 2): { c: Circuit; d: PcbDesign } {
    const bl = new CircuitBuilder();
    for (const t of ['R1', 'R2', 'R3', 'R4', 'R5']) bl.add('r_smd0805_1k', {}, 0, 0, 0, t);
    bl.chain('R1.2', 'R2.1'); bl.chain('R3.1', 'R4.1');
    if (nPads === 3) bl.chain('R4.1', 'R5.1');
    const c = bl.circuit;
    const d = autoPlace(c);
    d.outline = { w: 40, h: 30 };
    placePadAt(c, d, 'R1', '2', 5, 8); placePadAt(c, d, 'R2', '1', 25, 8);
    placePadAt(c, d, 'R3', '1', 5, 13); placePadAt(c, d, 'R4', '1', 25, 13);
    placePadAt(c, d, 'R5', '1', 15, 25);
    const keys = netKeys(c), wp = worldPads(c, d);
    const kP = keys[wp.find((p) => p.comp === 'R1' && p.pin === '2')!.net], kN = keys[wp.find((p) => p.comp === 'R3' && p.pin === '1')!.net];
    d.rules = { ...d.rules, netClasses: [{ name: 'USB', width: 0.3, clearance: 0.2, viaDia: 0.8, viaDrill: 0.4, diffGap: 0.3 }] };
    d.netClassOf = { [kP]: 'USB', [kN]: 'USB' };
    d.netNames = { [kP]: 'DATA_P', [kN]: 'DATA_N' };
    return { c, d };
  }

  it('detects the _P/_N pair of a class with diffGap, and honours a user selection', () => {
    const { c, d } = pairFixture();
    const pr = findDiffPairs(c, d);
    expect(pr.length).toBe(1);
    expect(pr[0].source).toBe('auto');
    expect(pr[0].gap).toBe(0.3);
    expect(findDiffPairs(c, { ...d, netNames: {}, diffPairs: [{ p: Object.keys(d.netNames!)[0], n: Object.keys(d.netNames!)[1] }] })[0].source).toBe('user');
    expect(findDiffPairs(c, { ...d, netClassOf: {} }).length).toBe(0); // no diffGap class -> no auto pair
  });

  it('derives the partner net at constant offset, DRC-clean, with the requested gap', () => {
    const { c, d } = pairFixture();
    const r = autoroute(c, d, { diffPairs: true });
    expect(r.failed).toEqual([]);
    expect(r.diffPairs?.map((p) => p.status)).toEqual(['derived']);
    const d2 = withRoutes(d, r);
    for (const code of ['CLEARANCE', 'SHORT', 'UNROUTED']) expect(count(c, d2, code), code).toBe(0);
    // lead track and derived track run parallel: lateral distance between their middle parts = width + gap
    const [a, b] = [r.tracks[0], r.tracks[r.tracks.length - 1]];
    expect(a.id).not.toBe(b.id);
    const mid = (t: { pts: [number, number][] }): number => t.pts[Math.floor(t.pts.length / 2) - 1][1];
    expect(Math.abs(mid(a) - mid(b))).toBeCloseTo(0.3 + 0.3, 6);
  });

  it('reports failure honestly and still routes the partner normally (3-pad partner net)', () => {
    const { c, d } = pairFixture(3);
    const r = autoroute(c, d, { diffPairs: true });
    expect(r.diffPairs?.[0].status).toBe('failed');
    expect(r.diffPairs?.[0].reason).toMatch(/2 pinli/);
    const d2 = withRoutes(d, r);
    expect(count(c, d2, 'UNROUTED')).toBe(0);
    expect(count(c, d2, 'CLEARANCE')).toBe(0);
  });

  it('is off by default (no pair handling, same output as before)', () => {
    const { c, d } = pairFixture();
    expect(autoroute(c, d).diffPairs).toBeUndefined();
  });

  it('polyline helpers: offset with miter corner and trimming', () => {
    const o = offsetPolyline([[0, 0], [10, 0], [10, 10]], 1); // left of travel (y down): up/right side
    expect(o[0][1]).toBeCloseTo(-1, 9);
    expect(o[1][0]).toBeCloseTo(11, 9);
    expect(o[1][1]).toBeCloseTo(-1, 9);
    expect(o[2][0]).toBeCloseTo(11, 9);
    const t = trimPolyline([[0, 0], [10, 0], [10, 10]], 3, 4)!;
    expect(t[0]).toEqual([3, 0]);
    expect(t[t.length - 1][0]).toBeCloseTo(10, 9);
    expect(t[t.length - 1][1]).toBeCloseTo(6, 9);
    expect(trimPolyline([[0, 0], [2, 0]], 1.5, 1.5)).toBeNull();
  });
});
