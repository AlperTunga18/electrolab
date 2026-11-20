import type { Circuit } from '../circuit/types';
import { buildNets } from '../circuit/nets';
import { getDef, hasDef } from '../../library/components';
import { autoLayout, boxOf, boxesOverlap } from './layout';

export interface ErcIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  comp?: string;
  pin?: string;
}

const RANK = { error: 0, warning: 1, info: 2 } as const;

/** electrical rule check on the circuit (static, no simulation) */
export function erc(circuit: Circuit): ErcIssue[] {
  const out: ErcIssue[] = [];
  const comps = circuit.components.filter((c) => hasDef(c.type));
  if (comps.length === 0 && circuit.wires.length === 0) return out;
  const nets = buildNets({ ...circuit, components: comps });
  const net = (comp: string, pin: string): number | undefined => nets.pinNet.get(`${comp}:${pin}`);
  const floating = new Set(nets.floatingPins);
  const ids = new Set(circuit.components.map((c) => c.id));

  if (!nets.hasGround) {
    out.push({ severity: 'error', code: 'NO_GROUND', message: 'Devrede toprak (GND) yok. Bir toprak bileşeni ekleyip bağlayın.' });
  }

  // duplicate reference designators
  const seen = new Map<string, string>();
  for (const c of circuit.components) {
    if (!c.ref) continue;
    const first = seen.get(c.ref);
    if (first === undefined) seen.set(c.ref, c.id);
    else out.push({ severity: 'error', code: 'DUPLICATE_REF', message: `Yinelenen referans: ${c.ref} birden fazla bileşende kullanılıyor.`, comp: c.id });
  }

  // wires pointing at missing parts / pins
  for (const w of circuit.wires) {
    for (const r of [w.a, w.b]) {
      const missing = !ids.has(r.comp) || (hasDef(circuit.components.find((c) => c.id === r.comp)!.type) &&
        !getDef(circuit.components.find((c) => c.id === r.comp)!.type).pins.some((p) => p.id === r.pin));
      if (missing) out.push({ severity: 'warning', code: 'UNCONNECTED_WIRE', message: `Tel ${w.id}: ${r.comp}.${r.pin} artık yok, tel boşta kalıyor.`, comp: r.comp, pin: r.pin });
    }
  }

  const sources: { id: string; ref: string; n1: number; n2: number; sig: string; sign: number }[] = [];

  for (const c of comps) {
    const def = getDef(c.type);

    if (def.model === 'none') {
      out.push({ severity: 'info', code: 'MISSING_MODEL', message: `${c.ref} (${def.name}): elektriksel modeli yok, simülasyonda yok sayılır.`, comp: c.id });
    }

    // unconnected pins
    if (def.model === 'none' || def.model === 'mcu' || def.model === 'busdev') {
      const un = def.pins.filter((p) => floating.has(`${c.id}:${p.id}`)).length;
      if (un > 0) out.push({ severity: 'info', code: 'UNUSED_PINS', message: `${c.ref}: ${un} pin bağlı değil (kullanılmayan pinler normal olabilir).`, comp: c.id });
    } else if (def.model !== 'ground') {
      for (const p of def.pins) {
        if (floating.has(`${c.id}:${p.id}`)) {
          out.push({ severity: 'warning', code: 'FLOATING_PIN', message: `${c.ref}.${p.label} pini hiçbir yere bağlı değil (askıda).`, comp: c.id, pin: p.id });
        }
      }
    }

    if (def.model === 'vsource') {
      const p = def.pins[0]?.id, n = def.pins[1]?.id;
      const np = net(c.id, p), nn = net(c.id, n);
      if (np !== undefined && nn !== undefined) {
        if (np === nn) {
          out.push({ severity: 'error', code: 'SHORT_SOURCE', message: `${c.ref}: kaynağın + ve − uçları aynı düğümde, kaynak kısa devre.`, comp: c.id });
        } else {
          const sign = np < nn ? 1 : -1;
          const wave = String(c.params.wave ?? 'dc');
          const v = Number(c.params.v ?? 0);
          const sig = wave === 'dc'
            ? `dc:${v * sign}`
            : `${wave}:${v * sign}:${Number(c.params.amp ?? 0) * sign}:${c.params.freq}:${c.params.duty}`;
          sources.push({ id: c.id, ref: c.ref, n1: Math.min(np, nn), n2: Math.max(np, nn), sig, sign });
        }
      }
    }

    if (def.model === 'capacitor' && def.pins[0]?.label.trim() === '+') {
      if (net(c.id, def.pins[0].id) === 0) {
        out.push({ severity: 'warning', code: 'POLARITY', message: `${c.ref}: polarize kondansatörün + ucu toprağa bağlı, ters polarite olabilir.`, comp: c.id, pin: def.pins[0].id });
      }
    }

    if (def.model === 'mcu' && def.mcu) {
      const sup = def.mcu.supplies.map((s) => s.pin).filter((id) => def.pins.some((p) => p.id === id));
      if (sup.length > 0 && sup.every((id) => floating.has(`${c.id}:${id}`))) {
        out.push({ severity: 'warning', code: 'POWER_PIN_MISSING', message: `${c.ref}: hiçbir besleme pini (${sup.join(', ')}) bağlı değil.`, comp: c.id });
      }
    }
  }

  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const a = sources[i], b = sources[j];
      if (a.n1 === b.n1 && a.n2 === b.n2 && a.sig !== b.sig) {
        out.push({ severity: 'error', code: 'SOURCE_CONFLICT', message: `${a.ref} ve ${b.ref}: farklı değerli ideal gerilim kaynakları doğrudan paralel bağlı.`, comp: b.id });
      }
    }
  }

  // overlapping symbols in the layout
  try {
    const layout = autoLayout({ ...circuit, components: comps });
    for (let i = 0; i < comps.length; i++) {
      for (let j = i + 1; j < comps.length; j++) {
        const la = layout[comps[i].id], lb = layout[comps[j].id];
        if (la && lb && boxesOverlap(boxOf(comps[i], la), boxOf(comps[j], lb))) {
          out.push({ severity: 'info', code: 'OVERLAP', message: `${comps[i].ref} ve ${comps[j].ref} şemada üst üste biniyor.`, comp: comps[j].id });
        }
      }
    }
  } catch { /* layout is advisory */ }

  return out.map((x, i) => ({ x, i })).sort((a, b) => RANK[a.x.severity] - RANK[b.x.severity] || a.i - b.i).map((o) => o.x);
}
