import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildNets } from '../core/circuit/nets';

type Store = typeof import('./lab');
let useLab: Store['useLab'];

beforeAll(async () => {
  const mem = new Map<string, string>();
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
  ({ useLab } = await import('./lab'));
});

const s = () => useLab.getState();
const part = (id: string) => s().circuit.components.find((c) => c.id === id)!;
const pin = (comp: string, p: string) => ({ comp, pin: p });

function setup() {
  s().loadCircuit({ components: [], wires: [] }, 't');
  const r1 = s().addComponent('resistor', 0, 0);
  const r2 = s().addComponent('resistor', 4, 0);
  const r3 = s().addComponent('resistor', 2, 4);
  s().setSchMany({ [r1]: { x: 0, y: 0, rot: 0 }, [r2]: { x: 200, y: 0, rot: 0 }, [r3]: { x: 100, y: 100, rot: 0 } }, false);
  s().addWire(pin(r1, '2'), pin(r2, '1'));
  const host = s().circuit.wires[0].id;
  return { r1, r2, r3, host };
}

describe('schematic store: T-junction and group editing', () => {
  beforeEach(() => { s().loadCircuit({ components: [], wires: [] }, 't'); });

  it('addTapWire joins the net, is one undo step, rejects ends of the host and duplicates', () => {
    const { r1, r2, r3, host } = setup();
    const n0 = s().past.length;
    expect(s().addTapWire(pin(r3, '1'), host, 100, 0)).toBe(true);
    expect(s().past.length).toBe(n0 + 1);
    const nets = buildNets(s().circuit);
    expect(nets.pinNet.get(`${r3}:1`)).toBe(nets.pinNet.get(`${r1}:2`));
    expect(nets.pinNet.get(`${r3}:2`)).not.toBe(nets.pinNet.get(`${r1}:2`));
    expect(s().addTapWire(pin(r3, '1'), host, 120, 0)).toBe(false); // already branched there
    expect(s().addTapWire(pin(r1, '2'), host, 100, 0)).toBe(false); // is an end of the host
    expect(s().addTapWire(pin(r2, '1'), host, 100, 0)).toBe(false);
    expect(s().addTapWire(pin(r3, '2'), 'nope', 0, 0)).toBe(false);
    s().undo();
    expect(s().circuit.wires).toHaveLength(1);
  });

  it('deleting the host wire (or its part) removes the T-branch', () => {
    const { r3, host } = setup();
    s().addTapWire(pin(r3, '1'), host, 100, 0);
    s().select({ kind: 'wire', id: host });
    s().deleteSelected();
    expect(s().circuit.wires).toHaveLength(0);

    const b = setup();
    s().addTapWire(pin(b.r3, '1'), b.host, 100, 0);
    s().select({ kind: 'comp', id: b.r2 });
    s().deleteSelected();
    expect(s().circuit.wires).toHaveLength(0);
  });

  it('setSchMany patches several parts in one undo step (or none with history=false)', () => {
    const { r1, r2 } = setup();
    const n0 = s().past.length;
    s().setSchMany({ [r1]: { x: 10, y: 10, rot: 2 }, [r2]: { x: 210, y: 10, rot: 0 } });
    expect(s().past.length).toBe(n0 + 1);
    expect(part(r1).sch).toEqual({ x: 10, y: 10, rot: 2 });
    s().setSchMany({ [r1]: { x: 20, y: 20, rot: 2 } }, false);
    expect(s().past.length).toBe(n0 + 1);
    s().undo();
    expect(part(r1).sch).toEqual({ x: 0, y: 0, rot: 0 });
  });

  it('copy/paste keeps the schematic offset (+20) and remaps a copied T-branch to the copied host', () => {
    const { r1, r2, r3, host } = setup();
    s().addTapWire(pin(r3, '1'), host, 100, 0);
    s().setMulti([r1, r2, r3]);
    s().copy();
    s().paste();
    const ids = s().multi;
    expect(ids).toHaveLength(3);
    const copies = ids.map(part);
    const orig = [r1, r2, r3].map(part);
    copies.forEach((c, i) => expect(c.sch).toEqual({ x: orig[i].sch!.x + 20, y: orig[i].sch!.y + 20, rot: 0 }));
    const wires = s().circuit.wires;
    expect(wires).toHaveLength(4);
    const tap = wires.find((w) => w.tap && ids.includes(w.a.comp))!;
    const newHost = wires.find((w) => w.id === tap.tap!.wire)!;
    expect(newHost.id).not.toBe(host);
    expect(ids).toContain(newHost.a.comp);
    // copied circuit has the same shape: 2 nets in the copy, the tapped pin joined to the host net
    const nets = buildNets(s().circuit);
    expect(nets.pinNet.get(`${tap.a.comp}:${tap.a.pin}`)).toBe(nets.pinNet.get(`${newHost.a.comp}:${newHost.a.pin}`));
    // second paste moves on by another 20
    s().paste();
    expect(s().multi.map(part)[0].sch).toEqual({ x: orig[0].sch!.x + 40, y: orig[0].sch!.y + 40, rot: 0 });
  });

  it('Ctrl+A / group delete work on the shared selection state', () => {
    const { r1, r2, r3 } = setup();
    s().selectAll();
    expect(s().multi).toEqual([r1, r2, r3]);
    s().deleteSelected();
    expect(s().circuit.components).toHaveLength(0);
    expect(s().circuit.wires).toHaveLength(0);
  });
});
