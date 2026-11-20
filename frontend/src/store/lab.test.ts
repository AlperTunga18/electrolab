import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Store = typeof import('./lab');
let useLab: Store['useLab'];

beforeAll(async () => {
  const mem = new Map<string, string>();
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
  ({ useLab } = await import('./lab'));
});

/** r1(0,0) r2(2,0) r3(4,0) with wires r1-r2, r2-r3 and an outside part c1(10,10) wired to r3 */
function setup() {
  const s = useLab.getState();
  s.loadCircuit({ components: [], wires: [] }, 't');
  const r1 = s.addComponent('resistor', 0, 0);
  const r2 = s.addComponent('resistor', 2, 0);
  const r3 = s.addComponent('resistor', 4, 0);
  const c1 = s.addComponent('capacitor', 10, 10);
  const pin = (comp: string, p: string) => ({ comp, pin: p });
  s.addWire(pin(r1, '2'), pin(r2, '1'));
  s.addWire(pin(r2, '2'), pin(r3, '1'));
  s.addWire(pin(r3, '2'), pin(c1, '1'));
  return { r1, r2, r3, c1 };
}

describe('multi-selection group operations', () => {
  beforeEach(() => { useLab.getState().loadCircuit({ components: [], wires: [] }, 't'); });

  it('toggleMulti / setMulti / clearMulti / selectAll', () => {
    const { r1, r2, r3 } = setup();
    const s = () => useLab.getState();
    s().select({ kind: 'comp', id: r1 });
    s().toggleMulti(r2);
    expect(s().multi).toEqual([r1, r2]);
    expect(s().selection).toBeNull();
    s().toggleMulti(r1);
    expect(s().multi).toEqual([]);
    expect(s().selection).toEqual({ kind: 'comp', id: r2 });
    s().setMulti([r1, r2, r3, 'nope']);
    expect(s().multi).toEqual([r1, r2, r3]);
    s().clearMulti();
    expect(s().multi).toEqual([]);
    expect(s().selection).toBeNull();
    s().selectAll();
    expect(s().multi).toHaveLength(4);
  });

  it('group drag moves all by the same delta, one undo step', () => {
    const { r1, r2, r3 } = setup();
    const s = () => useLab.getState();
    s().setMulti([r1, r2]);
    const before = s().past.length;
    s().beginDrag();
    s().moveMulti(r1, 1, 3);
    s().moveMulti(r1, 2, 3);
    const p = (id: string) => s().circuit.components.find((c) => c.id === id)!;
    expect([p(r1).x, p(r1).z, p(r2).x, p(r2).z, p(r3).x]).toEqual([2, 3, 4, 3, 4]);
    expect(s().past.length).toBe(before + 1);
    s().undo();
    expect([p(r1).x, p(r2).x]).toEqual([0, 2]);
  });

  it('group delete removes attached wires in one history entry', () => {
    const { r1, r2, r3, c1 } = setup();
    const s = () => useLab.getState();
    s().setMulti([r1, r2]);
    const before = s().past.length;
    s().deleteSelected();
    expect(s().past.length).toBe(before + 1);
    expect(s().circuit.components.map((c) => c.id)).toEqual([r3, c1]);
    expect(s().circuit.wires).toHaveLength(1);
    expect(s().multi).toEqual([]);
    s().undo();
    expect(s().circuit.components).toHaveLength(4);
    expect(s().circuit.wires).toHaveLength(3);
  });

  it('group duplicate copies internal wires with new ids/refs, one undo step', () => {
    const { r1, r2, r3 } = setup();
    const s = () => useLab.getState();
    s().setMulti([r1, r2, r3]);
    const before = s().past.length;
    s().duplicateSelected();
    expect(s().past.length).toBe(before + 1);
    const c = s().circuit;
    expect(c.components).toHaveLength(7);
    expect(c.wires).toHaveLength(5);
    const newIds = s().multi;
    expect(newIds).toHaveLength(3);
    const refs = c.components.map((x) => x.ref);
    expect(new Set(refs).size).toBe(refs.length);
    expect(c.components.filter((x) => newIds.includes(x.id)).map((x) => x.ref)).toEqual(['R4', 'R5', 'R6']);
    for (const w of c.wires.slice(3)) { expect(newIds).toContain(w.a.comp); expect(newIds).toContain(w.b.comp); }
    expect(new Set(c.wires.map((w) => w.id)).size).toBe(5);
    s().undo();
    expect(s().circuit.components).toHaveLength(4);
    expect(s().circuit.wires).toHaveLength(3);
  });

  it('rotate / setParamMulti / align are single history entries', () => {
    const { r1, r2, r3 } = setup();
    const s = () => useLab.getState();
    const ids = [r1, r2, r3];
    s().setMulti(ids);
    let n = s().past.length;
    s().rotateSelected();
    expect(s().past.length).toBe(++n);
    expect(s().circuit.components.filter((c) => ids.includes(c.id)).every((c) => c.rot === 1)).toBe(true);
    s().setParamMulti(ids, 'r', 4700);
    expect(s().past.length).toBe(++n);
    expect(s().circuit.components.filter((c) => ids.includes(c.id)).map((c) => c.params.r)).toEqual([4700, 4700, 4700]);
    s().alignSelected('top');
    expect(s().past.length).toBe(++n);
  });
});
