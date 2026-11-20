import { describe, expect, it } from 'vitest';
import type { Circuit, PlacedComponent } from '../circuit/types';
import { buildNets } from '../circuit/nets';
import { pruneTaps } from '../circuit/taps';
import { pasteGroup, removeGroup } from '../circuit/selection';
import { getDef } from '../../library/components';
import { pinPos, symbolFor } from './symbols';
import { boxOf, type Layout } from './layout';
import { polylineHitsBoxes } from '../circuit/wireRoute';
import { nearestOnPolyline, routeAllWires, snapOnSegment } from './wiring';

const comp = (id: string, type = 'resistor'): PlacedComponent => ({ id, type, ref: id.toUpperCase(), x: 0, z: 0, rot: 0, params: {} });
const w = (id: string, a: string, b: string, extra: object = {}) => {
  const [ac, ap] = a.split('.'), [bc, bp] = b.split('.');
  return { id, a: { comp: ac, pin: ap }, b: { comp: bc, pin: bp }, color: '#000', width: 2, ...extra };
};
const net = (c: Circuit, k: string) => buildNets(c).pinNet.get(k);

/** R1 (0,0) -- w1 -- R2 (200,0); R3 below at (100,120); R4 far away */
function base(): { c: Circuit; layout: Layout } {
  const c: Circuit = { components: [comp('r1'), comp('r2'), comp('r3'), comp('r4')], wires: [w('w1', 'r1.2', 'r2.1')] };
  const layout: Layout = { r1: { x: 0, y: 0, rot: 0 }, r2: { x: 200, y: 0, rot: 0 }, r3: { x: 100, y: 120, rot: 0 }, r4: { x: 100, y: -120, rot: 0 } };
  return { c, layout };
}

describe('T-junction: net model', () => {
  it('a pin tapped onto the middle of a wire joins that wire’s net (union-find unchanged)', () => {
    const { c } = base();
    expect(net(c, 'r3:1')).not.toBe(net(c, 'r1:2'));
    const t = { ...c, wires: [...c.wires, w('w2', 'r3.1', 'r1.2', { tap: { wire: 'w1', x: 100, y: 0 } })] };
    expect(net(t, 'r3:1')).toBe(net(t, 'r1:2'));
    expect(net(t, 'r3:1')).toBe(net(t, 'r2:1'));
    // two branches off the same wire are one net, an untouched part stays separate
    const t2 = { ...t, wires: [...t.wires, w('w3', 'r4.2', 'r1.2', { tap: { wire: 'w1', x: 120, y: 0 } })] };
    expect(net(t2, 'r4:2')).toBe(net(t2, 'r3:1'));
    expect(net(t2, 'r4:1')).not.toBe(net(t2, 'r3:1'));
  });

  it('a cut host wire disconnects its T-branch', () => {
    const { c } = base();
    const t = { ...c, wires: [{ ...c.wires[0], broken: true }, w('w2', 'r3.1', 'r1.2', { tap: { wire: 'w1', x: 100, y: 0 } })] };
    expect(net(t, 'r3:1')).not.toBe(net(t, 'r1:2'));
  });

  it('pruneTaps removes branches whose host is gone, also branches of branches', () => {
    const { c } = base();
    const ws = [...c.wires, w('w2', 'r3.1', 'r1.2', { tap: { wire: 'w1', x: 100, y: 0 } }), w('w3', 'r4.1', 'r3.1', { tap: { wire: 'w2', x: 100, y: 50 } })];
    expect(pruneTaps(ws).map((x) => x.id)).toEqual(['w1', 'w2', 'w3']);
    expect(pruneTaps(ws.filter((x) => x.id !== 'w1')).map((x) => x.id)).toEqual([]);
  });

  it('removing a part that owns the host wire removes the branch too', () => {
    const { c } = base();
    const t = { ...c, wires: [...c.wires, w('w2', 'r3.1', 'r1.2', { tap: { wire: 'w1', x: 100, y: 0 } })] };
    const r = removeGroup(t, ['r2']); // w1 attached to r2 goes away, so does the branch
    expect(r.wires).toEqual([]);
  });

  it('paste remaps a tap to the copied host; without the host it becomes a plain wire', () => {
    const { c } = base();
    const t = { ...c, wires: [...c.wires, w('w2', 'r3.1', 'r1.2', { tap: { wire: 'w1', x: 100, y: 0 } })] };
    let n = 0;
    const newId = (p: string) => `${p}${++n}`;
    const ref = () => 'X1';
    const all = pasteGroup(t, t.components.slice(0, 3), t.wires, 1, 1, newId, ref, 20);
    const tap = all.circuit.wires.find((x) => x.tap && x.id !== 'w2')!;
    const host = all.circuit.wires.find((x) => x.id === tap.tap!.wire)!;
    expect(host.id).not.toBe('w1');
    expect(host.a.comp).not.toBe('r1');
    expect(tap.tap!.x).toBe(120);
    // host wire w1 not part of the copy (only r1 + r3 copied: w2 has r2 as b? no, b is r1) -> wire w2 internal, w1 not
    const part = pasteGroup(t, [t.components[0], t.components[2]], t.wires, 1, 1, newId, ref, 20);
    const lone = part.circuit.wires.filter((x) => !['w1', 'w2'].includes(x.id));
    expect(lone).toHaveLength(1);
    expect(lone[0].tap).toBeUndefined();
  });
});

describe('T-junction: drawing', () => {
  it('nearestOnPolyline projects onto the closest segment', () => {
    const pts: [number, number][] = [[0, 0], [100, 0], [100, 100]];
    expect(nearestOnPolyline(pts, { x: 40, y: 7 })).toMatchObject({ x: 40, y: 0, seg: 0 });
    expect(nearestOnPolyline(pts, { x: 93, y: 60 })).toMatchObject({ x: 100, y: 60, seg: 1 });
    expect(nearestOnPolyline([], { x: 0, y: 0 })).toBeNull();
    const n = nearestOnPolyline(pts, { x: 43, y: 3 })!;
    expect(snapOnSegment(pts, n)).toEqual({ x: 40, y: 0 });
  });

  it('branch ends exactly on the host wire, perpendicular, with a junction dot; all wires orthogonal', () => {
    const { c, layout } = base();
    const t = { ...c, wires: [...c.wires, w('w2', 'r3.1', 'r1.2', { tap: { wire: 'w1', x: 100, y: 0 } })] };
    const { routes, dots } = routeAllWires(t, layout);
    expect(routes.map((r) => r.wireId).sort()).toEqual(['w1', 'w2']);
    const host = routes.find((r) => r.wireId === 'w1')!, br = routes.find((r) => r.wireId === 'w2')!;
    const sym = symbolFor(getDef('resistor'));
    const p1 = pinPos(sym, 0, 100, 120, '1');
    expect(br.pts[0]).toEqual([p1.x, p1.y]);
    const end = br.pts[br.pts.length - 1];
    expect(end).toEqual([100, 0]);
    // the end lies on a host segment
    expect(nearestOnPolyline(host.pts, { x: end[0], y: end[1] })!.dist).toBeLessThan(1e-9);
    // last leg is vertical (host is horizontal there)
    expect(br.pts[br.pts.length - 2][0]).toBe(end[0]);
    for (const r of routes) for (let i = 1; i < r.pts.length; i++) expect(r.pts[i][0] === r.pts[i - 1][0] || r.pts[i][1] === r.pts[i - 1][1]).toBe(true);
    expect(dots).toContainEqual([100, 0]);
    // the junction dot is NOT drawn at the logical endpoint r1.2 (only the tap point)
    expect(dots).toHaveLength(1);
  });

  it('branch follows the host wire when the host moves', () => {
    const { c, layout } = base();
    const t = { ...c, wires: [...c.wires, w('w2', 'r3.1', 'r1.2', { tap: { wire: 'w1', x: 100, y: 0 } })] };
    const moved: Layout = { ...layout, r1: { x: 0, y: 40, rot: 0 }, r2: { x: 200, y: 40, rot: 0 } };
    const { routes } = routeAllWires(t, moved);
    const end = routes.find((r) => r.wireId === 'w2')!.pts.at(-1)!;
    expect(end[1]).toBe(40);
  });

  it('a branch whose host is missing is still drawn as a plain wire', () => {
    const { c, layout } = base();
    const t = { ...c, wires: [w('w2', 'r3.1', 'r1.2', { tap: { wire: 'nope', x: 100, y: 0 } })] };
    const { routes } = routeAllWires(t, layout);
    expect(routes).toHaveLength(1);
  });
});

describe('auto route (schematic)', () => {
  const ortho = (pts: [number, number][]) => pts.every((p, i) => i === 0 || p[0] === pts[i - 1][0] || p[1] === pts[i - 1][1]);
  it('goes around a wall of parts, orthogonally; leaves clear wires alone', () => {
    const c: Circuit = { components: [comp('r1'), comp('r2'), comp('r4'), comp('r5'), comp('r6')], wires: [w('w1', 'r1.2', 'r2.1')] };
    const layout: Layout = { r1: { x: 0, y: 0, rot: 0 }, r2: { x: 300, y: 0, rot: 0 }, r4: { x: 150, y: 0, rot: 0 }, r5: { x: 150, y: -20, rot: 0 }, r6: { x: 150, y: 20, rot: 0 } };
    const walls = ['r4', 'r5', 'r6'].map((id) => { const b = boxOf(c.components.find((q) => q.id === id)!, layout[id]); return { minX: b.x0, maxX: b.x1, minZ: b.y0, maxZ: b.y1 }; });
    const xz = (pts: [number, number][]) => pts.map((p) => ({ x: p[0], z: p[1] }));
    const plain = routeAllWires(c, layout).routes[0];
    const auto = routeAllWires(c, layout, { autoRoute: true }).routes[0];
    expect(polylineHitsBoxes(xz(plain.pts), walls)).toBe(true);
    expect(polylineHitsBoxes(xz(auto.pts), walls)).toBe(false);
    expect(ortho(auto.pts)).toBe(true);
    expect(auto.pts[0]).toEqual(plain.pts[0]);
    expect(auto.pts.at(-1)).toEqual(plain.pts.at(-1));
    // clear case unchanged
    const clear: Layout = { ...layout, r4: { x: 150, y: 300, rot: 0 }, r5: { x: 150, y: -300, rot: 0 }, r6: { x: 150, y: 400, rot: 0 } };
    expect(routeAllWires(c, clear, { autoRoute: true }).routes[0].pts).toEqual(routeAllWires(c, clear).routes[0].pts);
  });
});

describe('SVG export with T-junction', () => {
  it('draws the branch polyline and a dot on the host wire', async () => {
    const { schematicSvg } = await import('./svg');
    const { c, layout } = base();
    const t = { ...c, wires: [...c.wires, w('w2', 'r3.1', 'r1.2', { tap: { wire: 'w1', x: 100, y: 0 } })] };
    const svg = schematicSvg(t, { layout });
    expect(svg.match(/<polyline/g)).toHaveLength(2);
    expect(svg).toContain('<circle cx="100" cy="0" r="3" fill="#000000"/>');
  });
});
