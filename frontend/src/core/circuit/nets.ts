import type { Circuit } from './types';
import { pinKey } from './types';
import { getDef } from '../../library/components';

export interface NetInfo {
  /** pin key ("compId:pinId") -> net index. Net 0 is ground. */
  pinNet: Map<string, number>;
  netCount: number;
  names: string[];
  hasGround: boolean;
  /** pins that are connected to nothing at all */
  floatingPins: string[];
}

class DSU {
  parent = new Map<string, string>();
  find(a: string): string {
    let root = a;
    if (!this.parent.has(root)) { this.parent.set(root, root); return root; }
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    while (this.parent.get(a) !== root) { const next = this.parent.get(a)!; this.parent.set(a, root); a = next; }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const GND = '#GND';

/** Derives electrical nets from wires. Ground components tie their pin to net 0. */
export function buildNets(circuit: Circuit): NetInfo {
  const d = new DSU();
  const wired = new Set<string>();
  const allPins: string[] = [];
  let hasGround = false;
  const gndPins = new Set<string>();
  d.find(GND);
  for (const c of circuit.components) {
    const def = getDef(c.type);
    for (const p of def.pins) {
      const k = `${c.id}:${p.id}`;
      allPins.push(k);
      d.find(k);
      if (def.model === 'ground') { d.union(k, GND); hasGround = true; gndPins.add(k); }
    }
  }
  const byId = new Map(circuit.wires.map((w) => [w.id, w]));
  for (const w of circuit.wires) {
    const a = pinKey(w.a), b = pinKey(w.b);
    if (w.tap && byId.get(w.tap.wire)?.broken) continue; // T-branch off a cut wire: not connected
    if (w.broken || !d.parent.has(a) || !d.parent.has(b)) continue; // cut or dangling wire
    if (w.loose) { wired.add(a); wired.add(b); continue; } // loose contact: a time-varying resistor in the solver, not a node merge
    d.union(a, b);
    wired.add(a); wired.add(b);
  }
  const rootIdx = new Map<string, number>();
  rootIdx.set(d.find(GND), 0);
  const pinNet = new Map<string, number>();
  const names = ['GND'];
  for (const k of allPins) {
    const r = d.find(k);
    let idx = rootIdx.get(r);
    if (idx === undefined) { idx = rootIdx.size; rootIdx.set(r, idx); names.push(`N${idx}`); }
    pinNet.set(k, idx);
  }
  const floatingPins = allPins.filter((k) => !wired.has(k) && !gndPins.has(k));
  return { pinNet, netCount: rootIdx.size, names, hasGround, floatingPins };
}
