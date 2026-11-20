import { describe, expect, it } from 'vitest';
import { COMPONENTS, getDef } from '../../library/components';
import { EXAMPLES } from '../../examples/examples';
import { CircuitBuilder } from '../circuit/builder';
import type { Circuit } from '../circuit/types';
import { pinPos, rotatePoint, symbolBounds, symbolFor } from './symbols';
import { autoLayout, boxOf, boxesOverlap, junctions, routeWires } from './layout';
import { erc } from './erc';
import { schematicSvg } from './svg';

const onGrid = (v: number) => Math.abs(v / 10 - Math.round(v / 10)) < 1e-9;
const ex = (id: string): Circuit => EXAMPLES.find((e) => e.id === id)!.build();

describe('symbols', () => {
  for (const def of COMPONENTS) {
    it(`${def.type}: pins match, on grid, inside bounds`, () => {
      const s = symbolFor(def);
      expect(s.pins.map((p) => p.id).sort()).toEqual(def.pins.map((p) => p.id).sort());
      expect(new Set(s.pins.map((p) => p.id)).size).toBe(s.pins.length);
      for (const p of s.pins) {
        expect(onGrid(p.x) && onGrid(p.y)).toBe(true);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(s.w / 2);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(s.h / 2);
      }
    });
  }

  it('pinPos rotates clockwise, direction too', () => {
    const s = symbolFor(getDef('resistor'));
    expect(pinPos(s, 0, 100, 100, '2')).toEqual({ x: 130, y: 100, dir: 'r' });
    expect(pinPos(s, 1, 100, 100, '2')).toEqual({ x: 100, y: 130, dir: 'd' });
    expect(pinPos(s, 2, 100, 100, '2')).toEqual({ x: 70, y: 100, dir: 'l' });
    expect(pinPos(s, 3, 100, 100, '2')).toEqual({ x: 100, y: 70, dir: 'u' });
    expect(rotatePoint(10, 0, 1)).toEqual({ x: 0, y: 10 });
    const b = symbolBounds(s, 1);
    expect(b.x1 - b.x0).toBe(s.h);
    expect(b.y1 - b.y0).toBe(s.w);
  });
});

describe('layout', () => {
  for (const e of EXAMPLES) {
    it(`example ${e.id}: no overlaps, on grid, wires route orthogonally`, () => {
      const c = e.build();
      const lay = autoLayout(c);
      for (const comp of c.components) {
        const l = lay[comp.id];
        expect(l).toBeTruthy();
        expect(Number.isFinite(l.x) && Number.isFinite(l.y)).toBe(true);
        expect(onGrid(l.x) && onGrid(l.y)).toBe(true);
      }
      for (let i = 0; i < c.components.length; i++) {
        for (let j = i + 1; j < c.components.length; j++) {
          const a = c.components[i], b = c.components[j];
          expect(boxesOverlap(boxOf(a, lay[a.id]), boxOf(b, lay[b.id]))).toBe(false);
        }
      }
      const routes = routeWires(c, lay);
      expect(routes.length).toBe(c.wires.length);
      for (const r of routes) {
        expect(r.pts.length).toBeGreaterThanOrEqual(2);
        for (let i = 0; i + 1 < r.pts.length; i++) {
          expect(r.pts[i][0] === r.pts[i + 1][0] || r.pts[i][1] === r.pts[i + 1][1]).toBe(true);
        }
        const w = c.wires.find((q) => q.id === r.wireId)!;
        const pa = c.components.find((q) => q.id === w.a.comp)!;
        const s = symbolFor(getDef(pa.type));
        const t = pinPos(s, lay[pa.id].rot, lay[pa.id].x, lay[pa.id].y, w.a.pin);
        expect(r.pts[0]).toEqual([t.x, t.y]);
      }
      for (const j of junctions(c, lay)) expect(j.length).toBe(2);
    });
  }

  it('keeps stored sch placement', () => {
    const c = ex('led');
    c.components[0].sch = { x: 500, y: 500, rot: 1 };
    const lay = autoLayout(c);
    expect(lay[c.components[0].id]).toEqual({ x: 500, y: 500, rot: 1 });
    expect(autoLayout(c, false)[c.components[0].id].x).not.toBe(500);
  });

  it('is deterministic', () => {
    expect(autoLayout(ex('divider'))).toEqual(autoLayout(ex('divider')));
  });
});

describe('erc', () => {
  const codes = (c: Circuit) => erc(c).map((i) => i.code);

  it('clean divider has no errors', () => {
    expect(erc(ex('divider')).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('missing ground', () => {
    const c = ex('divider');
    c.components = c.components.filter((q) => q.type !== 'ground');
    const r = erc(c);
    expect(r.map((i) => i.code)).toContain('NO_GROUND');
    expect(r[0].severity).toBe('error');
  });

  it('shorted source', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 5 }, 0, 0, 0, 'V1');
    b.add('ground', {}, 0, 0, 0, 'G1');
    b.wire('V1.P', 'G1.G'); b.wire('V1.N', 'G1.G');
    expect(codes(b.circuit)).toContain('SHORT_SOURCE');
  });

  it('source conflict', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 5 }, 0, 0, 0, 'V1');
    b.add('dc_supply', { v: 9 }, 0, 0, 0, 'V2');
    b.add('ground', {}, 0, 0, 0, 'G1');
    b.wire('V1.N', 'G1.G'); b.wire('V2.N', 'G1.G'); b.wire('V1.P', 'V2.P');
    expect(codes(b.circuit)).toContain('SOURCE_CONFLICT');
  });

  it('duplicate ref', () => {
    const c = ex('divider');
    c.components[1].ref = c.components[2].ref;
    expect(codes(c)).toContain('DUPLICATE_REF');
  });

  it('floating pin', () => {
    const c = ex('led');
    c.wires = c.wires.filter((w) => !(w.a.comp === 'R1' && w.a.pin === '2') && !(w.b.comp === 'R1' && w.b.pin === '2'));
    const r = erc(c).filter((i) => i.code === 'FLOATING_PIN');
    expect(r.some((i) => i.comp === 'R1' && i.pin === '2')).toBe(true);
  });

  it('dangling wire and electrolytic + on ground', () => {
    const c = ex('led');
    c.wires.push({ id: 'wx', a: { comp: 'NOPE', pin: '1' }, b: { comp: 'R1', pin: '1' }, color: '#000', width: 2 });
    expect(codes(c)).toContain('UNCONNECTED_WIRE');
    const b = new CircuitBuilder();
    b.add('capacitor_el', {}, 0, 0, 0, 'C1');
    b.add('ground', {}, 0, 0, 0, 'G1');
    b.wire('C1.1', 'G1.G');
    expect(codes(b.circuit)).toContain('POLARITY');
  });
});

describe('svg', () => {
  it('LED example is well-formed and has every ref', () => {
    const c = ex('led');
    const svg = schematicSvg(c, { title: 'LED <test> & "x"', showNets: true });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    const body = svg.replace(/<[^>]*\/>/g, '');
    const opens = new Map<string, number>();
    for (const m of body.matchAll(/<(\/?)([a-zA-Z]+)[^>]*>/g)) {
      const n = m[2];
      opens.set(n, (opens.get(n) ?? 0) + (m[1] ? -1 : 1));
    }
    for (const [, v] of opens) expect(v).toBe(0);
    for (const comp of c.components) if (getDef(comp.type).model !== 'ground') expect(svg).toContain(`>${comp.ref}</text>`);
    expect(svg).toContain('LED &lt;test&gt; &amp; &quot;x&quot;');
    expect(svg).toContain('150 Ω');
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it('renders every example', () => {
    for (const e of EXAMPLES) {
      const s = schematicSvg(e.build());
      expect(s).not.toMatch(/NaN|undefined/);
    }
  });
});
