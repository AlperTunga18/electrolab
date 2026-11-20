import type { Circuit, PlacedComponent } from '../circuit/types';
import { buildNets, type NetInfo } from '../circuit/nets';
import { getDef } from '../../library/components';
import type { ComponentDef } from '../../library/types';
import { Sim, type CompResult } from '../sim/mna';
import { effectiveCircuit } from '../sim/faults';
import { checkStress, type Overstress } from '../sim/stress';
import { heatPower, type ThermalState } from '../sim/damage';
import { effectiveRth, thermalSpec } from '../thermal/thermal';
import { erc, type ErcIssue } from '../schematic/erc';

/** Everything the offline assistant knows about a circuit: topology, DC solution, limits, heat, ERC. */
export interface Ctx {
  circuit: Circuit;
  nets: NetInfo;
  results: Record<string, CompResult> | null;
  dcError?: string;
  stress: Overstress[];
  thermal: Record<string, ThermalState>;
  erc: ErcIssue[];
  def: (c: PlacedComponent) => ComponentDef;
  comp: (id: string) => PlacedComponent | undefined;
  byModel: (model: string) => PlacedComponent[];
  net: (c: PlacedComponent, pin: string) => number;
  netPins: (net: number) => { comp: PlacedComponent; pin: string }[];
  v: (c: PlacedComponent, pin: string) => number;
}

export function buildContext(circuit: Circuit): Ctx {
  const nets = buildNets(circuit);
  let results: Record<string, CompResult> | null = null;
  let sim: Sim | null = null;
  let dcError: string | undefined;
  try {
    const faults = circuit.faults ?? {};
    const eff = effectiveCircuit(circuit, faults);
    sim = new Sim(eff, { faults });
    sim.solveDC();
    results = sim.results();
  } catch (e) { dcError = e instanceof Error ? e.message : String(e); }
  const stress = results ? checkStress(circuit, results) : [];
  const thermal: Record<string, ThermalState> = {};
  const amb = circuit.ambient ?? 25;
  if (results) {
    for (const c of circuit.components) {
      const spec = thermalSpec(getDef(c.type), c);
      if (!spec || !results[c.id]) continue;
      const { rth, cth } = effectiveRth(spec, c);
      const P = heatPower(results[c.id]);
      thermal[c.id] = { T: amb + P * rth, tjmax: spec.tjmax, rth, cth, P };
    }
  }
  const byId = new Map(circuit.components.map((c) => [c.id, c]));
  const pinList = new Map<number, { comp: PlacedComponent; pin: string }[]>();
  for (const c of circuit.components) for (const p of getDef(c.type).pins) {
    const n = nets.pinNet.get(`${c.id}:${p.id}`);
    if (n !== undefined) pinList.set(n, [...(pinList.get(n) ?? []), { comp: c, pin: p.id }]);
  }
  return {
    circuit, nets, results, dcError, stress, thermal, erc: erc(circuit),
    def: (c) => getDef(c.type),
    comp: (id) => byId.get(id),
    byModel: (m) => circuit.components.filter((c) => getDef(c.type).model === m),
    net: (c, pin) => nets.pinNet.get(`${c.id}:${pin}`) ?? -1,
    netPins: (n) => pinList.get(n) ?? [],
    v: (c, pin) => { const n = nets.pinNet.get(`${c.id}:${pin}`); return sim && n !== undefined ? sim.nodeVoltage(n) : 0; },
  };
}

export const num = (c: PlacedComponent, key: string, fallback = 0): number => { const v = c.params[key]; return typeof v === 'number' ? v : fallback; };
