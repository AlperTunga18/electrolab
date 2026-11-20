import type { Circuit } from './circuit/types';
import { buildNets } from './circuit/nets';
import { getDef, hasDef } from '../library/components';
import { erc } from './schematic/erc';

export interface Hint {
  severity: 'error' | 'warning' | 'tip';
  code: string;
  message: string;
  comp?: string;
}

const RANK = { error: 0, warning: 1, tip: 2 } as const;

/**
 * Anlık bağlantı geri bildirimi (simülasyon çalıştırmadan, yalnızca topolojiden).
 * ERC bulgularına ek olarak, yeni başlayanların sık yaptığı hataları yakalar.
 */
export function liveHints(circuit: Circuit): Hint[] {
  const out: Hint[] = [];
  const comps = circuit.components.filter((c) => hasDef(c.type));
  if (comps.length === 0) return out;
  const nets = buildNets({ ...circuit, components: comps });
  const netOf = (comp: string, pin: string) => nets.pinNet.get(`${comp}:${pin}`);

  // net -> components touching it (by model)
  const onNet = new Map<number, { id: string; model: string }[]>();
  for (const c of comps) {
    const def = getDef(c.type);
    for (const p of def.pins) {
      const n = netOf(c.id, p.id);
      if (n === undefined) continue;
      const arr = onNet.get(n) ?? [];
      if (!arr.some((x) => x.id === c.id)) arr.push({ id: c.id, model: def.model });
      onNet.set(n, arr);
    }
  }
  const only = (n: number, self: string, allowed: string[]) =>
    (onNet.get(n) ?? []).filter((x) => x.id !== self).every((x) => allowed.includes(x.model));

  for (const c of comps) {
    const def = getDef(c.type);
    if (def.model === 'led') {
      const a = netOf(c.id, 'A'), k = netOf(c.id, 'K');
      if (a === undefined || k === undefined) continue;
      if (a === k) {
        out.push({ severity: 'warning', code: 'LED_SHORTED', message: `${c.ref}: LED'in iki ucu aynı düğümde, hiç akım geçmez (LED kısa devre edilmiş).`, comp: c.id });
        continue;
      }
      if (a === 0 && k !== 0) {
        out.push({ severity: 'warning', code: 'LED_REVERSED', message: `${c.ref}: LED ters bağlı (anot toprakta). Anot + tarafa, katot toprağa gitmeli.`, comp: c.id });
      }
      const bare = ['vsource', 'ground', 'led', 'diode'];
      if (only(a, c.id, bare) && only(k, c.id, bare) && (onNet.get(a) ?? []).some((x) => x.model === 'vsource') ) {
        out.push({ severity: 'error', code: 'LED_NO_RESISTOR', message: `${c.ref}: LED doğrudan kaynağa bağlı, seri direnç yok. Akım sınırsız artar, LED yanar. Seri direnç ekleyin (R = (Vkaynak − Vf) / If).`, comp: c.id });
      }
    }
    if (def.model === 'resistor') {
      const a = netOf(c.id, def.pins[0].id), b = netOf(c.id, def.pins[1].id);
      if (a !== undefined && a === b) {
        out.push({ severity: 'tip', code: 'RESISTOR_BYPASSED', message: `${c.ref}: direncin iki ucu aynı düğümde, direnç devre dışı kalıyor.`, comp: c.id });
      }
    }
    if (def.model === 'vsource') {
      const p = netOf(c.id, def.pins[0].id), n = netOf(c.id, def.pins[1].id);
      if (p !== undefined && n !== undefined && p !== n) {
        const loadsP = (onNet.get(p) ?? []).filter((x) => x.id !== c.id && x.model !== 'ground').length;
        if (loadsP === 0 && p !== 0 && n !== 0) {
          out.push({ severity: 'tip', code: 'SOURCE_NO_LOAD', message: `${c.ref}: kaynağın + ucuna hiçbir bileşen bağlı değil (yük yok).`, comp: c.id });
        }
      }
    }
  }

  // dangling single-pin nets (a wire that goes nowhere useful)
  const wiredCount = new Map<number, number>();
  for (const w of circuit.wires) {
    const n = netOf(w.a.comp, w.a.pin);
    if (n !== undefined) wiredCount.set(n, (wiredCount.get(n) ?? 0) + 1);
  }
  for (const [n, cnt] of wiredCount) {
    if (n !== 0 && (onNet.get(n) ?? []).length === 1 && cnt >= 1) {
      const only1 = onNet.get(n)![0];
      const def = comps.find((c) => c.id === only1.id);
      if (def && getDef(def.type).model !== 'mcu' && getDef(def.type).model !== 'none') {
        out.push({ severity: 'tip', code: 'DEAD_END', message: `${def.ref}: bu tel başka hiçbir parçaya ulaşmıyor (uçta kalmış).`, comp: def.id });
      }
    }
  }

  // ERC issues (errors/warnings only; info is noise on the live bar)
  const seen = new Set(out.map((h) => `${h.code}:${h.comp}`));
  for (const e of erc(circuit)) {
    if (e.severity === 'info') continue;
    const key = `${e.code}:${e.comp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ severity: e.severity === 'error' ? 'error' : 'warning', code: e.code, message: e.message, comp: e.comp });
  }

  return out.map((x, i) => ({ x, i })).sort((a, b) => RANK[a.x.severity] - RANK[b.x.severity] || a.i - b.i).map((o) => o.x);
}
