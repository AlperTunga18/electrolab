import type { Circuit } from '../circuit/types';
import { buildNets } from '../circuit/nets';
import type { NetClass, PcbDesign, PcbRules } from './types';

/** Net classes and user net names. Nets are addressed by a STABLE key (smallest 'comp:pin' key of the net), never by net index. */
export const DEFAULT_CLASS = 'Default';

export const defaultClass = (r: PcbRules): NetClass => ({ name: DEFAULT_CLASS, width: r.defaultWidth, clearance: r.minClearance, viaDia: r.viaDia, viaDrill: r.viaDrill });

/** all classes, 'Default' first and always taken live from the global rules */
export function netClassList(design: { rules: PcbRules }): NetClass[] {
  return [defaultClass(design.rules), ...(design.rules.netClasses ?? []).filter((c) => c.name !== DEFAULT_CLASS)];
}

/** net index -> stable key. The key changes only if a part with a smaller pin key joins or leaves the net. */
export function netKeys(circuit: Circuit): string[] {
  const nets = buildNets(circuit);
  const keys: string[] = [];
  for (const [pk, n] of nets.pinNet) if (keys[n] === undefined || pk < keys[n]) keys[n] = pk;
  for (let i = 0; i < nets.netCount; i++) keys[i] ??= `#net${i}`;
  return keys;
}

export function classByName(design: { rules: PcbRules }, name: string | undefined): NetClass {
  const list = netClassList(design);
  return list.find((c) => c.name === name) ?? list[0];
}

/** class of the net with this stable key (unassigned or unknown class -> Default) */
export function classOfKey(design: Pick<PcbDesign, 'rules' | 'netClassOf'>, key: string | undefined): NetClass {
  return classByName(design, key === undefined ? undefined : design.netClassOf?.[key]);
}

/** user name of the net, else the fallback */
export function netLabel(design: Pick<PcbDesign, 'netNames'>, key: string | undefined, fallback: string): string {
  const n = key === undefined ? undefined : design.netNames?.[key]?.trim();
  return n ? n : fallback;
}
