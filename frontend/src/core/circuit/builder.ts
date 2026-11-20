import type { Circuit, ParamMap, PlacedComponent } from './types';
import { defaultParams, getDef } from '../../library/components';

/** Programmatic circuit construction (examples + tests). Component id == reference designator. */
export class CircuitBuilder {
  circuit: Circuit = { components: [], wires: [] };
  private counters: Record<string, number> = {};
  private wireN = 0;

  add(type: string, params: ParamMap = {}, x = 0, z = 0, rot: 0 | 1 | 2 | 3 = 0, ref?: string): string {
    const def = getDef(type);
    if (!ref) {
      this.counters[def.prefix] = (this.counters[def.prefix] ?? 0) + 1;
      ref = `${def.prefix}${this.counters[def.prefix]}`;
    }
    const c: PlacedComponent = { id: ref, type, ref, x, z, rot, params: { ...defaultParams(type), ...params } };
    this.circuit.components.push(c);
    return ref;
  }

  /** wire('R1.1', 'V1.P') */
  wire(a: string, b: string, color = '#e11d48', width = 3): this {
    const [ca, pa] = a.split('.');
    const [cb, pb] = b.split('.');
    this.circuit.wires.push({ id: `w${++this.wireN}`, a: { comp: ca, pin: pa }, b: { comp: cb, pin: pb }, color, width });
    return this;
  }

  /** chain pins as consecutive wires */
  chain(...pins: string[]): this {
    for (let i = 0; i + 1 < pins.length; i++) this.wire(pins[i], pins[i + 1]);
    return this;
  }
}
