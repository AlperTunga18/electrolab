import type { Circuit } from '../circuit/types';
import type { CompResult } from './mna';
import { getDef } from '../../library/components';

export interface Overstress {
  key: string; // comp id + rating label
  comp: string;
  ref: string;
  label: string;
  value: number;
  limit: number;
  unit: string;
  ratio: number;
  note?: string;
}

export const SAT_LABEL = 'Doyma akımı (Isat)';
export const WEAR_LABEL = 'Kontak aşınması (ark enerjisi)';

/**
 * Compares instantaneous values against the datasheet-style ratings stored in the library.
 * This is a LIMIT-EXCEEDED check only. It does not predict when/if a part would actually fail:
 * time-to-failure needs thermal + manufacturer data (planned, see docs/STATUS.md).
 */
export function checkStress(circuit: Circuit, results: Record<string, CompResult>): Overstress[] {
  const out: Overstress[] = [];
  for (const c of circuit.components) {
    const def = getDef(c.type);
    const r = results[c.id];
    if (!r) continue;
    for (const rt of def.ratings) {
      const limit: number = rt.paramKey ? Number(c.params[rt.paramKey]) : (rt.value ?? NaN);
      if (!Number.isFinite(limit) || limit <= 0) continue;
      let value = 0;
      switch (rt.quantity) {
        case 'power': value = Math.abs(r.p); break;
        case 'voltage': value = Math.abs(r.vals.vgs ?? r.v); break;
        case 'reverseVoltage': value = -r.v; break;
        case 'vds': value = Math.abs(r.vals.vds ?? 0); break;
        case 'vce': value = Math.abs(r.vals.vce ?? 0); break;
        case 'current':
          value = Math.abs(def.model === 'relay' ? r.vals.icontact : def.model === 'npn' || def.model === 'pnp' ? r.vals.ic : def.model === 'nmos' || def.model === 'pmos' ? r.vals.id : r.i);
          break;
      }
      // sources deliver power; only flag their current limit
      if (def.model === 'vsource' && rt.quantity !== 'current') continue;
      if (value > limit) {
        out.push({ key: `${c.id}|${rt.label}`, comp: c.id, ref: c.ref, label: rt.label, value, limit, unit: rt.unit, ratio: value / limit });
      }
    }
    // inductor saturation: current above Isat means L has already dropped by `droppct` % (the data-sheet definition of Isat)
    if (def.model === 'inductor') {
      const isat = Number(c.params.isat), i = Math.abs(r.i);
      if (Number.isFinite(isat) && isat > 0 && i > isat) {
        out.push({ key: `${c.id}|sat`, comp: c.id, ref: c.ref, label: SAT_LABEL, value: i, limit: isat, unit: 'A', ratio: i / isat, note: 'doyma: akım > Isat' });
      }
    }
    // relay contact wear: accumulated arc energy above the (generic) limit
    if (def.model === 'relay') {
      const warc = Number(c.params.warc), e = r.vals.arcEnergy ?? 0;
      if (Number.isFinite(warc) && warc > 0 && e > warc) {
        out.push({ key: `${c.id}|wear`, comp: c.id, ref: c.ref, label: WEAR_LABEL, value: e, limit: warc, unit: 'J', ratio: e / warc, note: 'kontak aşınması: biriken ark enerjisi sınırı aşıldı' });
      }
    }
    if (def.model === 'mcu' && def.mcu) {
      const spec = def.mcu;
      const sup = new Map(spec.supplies.map((x) => [x.pin, x]));
      for (const key of Object.keys(r.vals)) {
        if (!key.startsWith('i_')) continue;
        const pin = key.slice(2), i = Math.abs(r.vals[key]), v = r.vals[`v_${pin}`] ?? 0;
        const sp = sup.get(pin);
        if (sp) {
          if (i > sp.imax) out.push({ key: `${c.id}|pin:${pin}|i`, comp: c.id, ref: `${c.ref}.${pin}`, label: `${sp.label} akımı`, value: i, limit: sp.imax, unit: 'A', ratio: i / sp.imax });
          continue;
        }
        if (i > spec.imaxPin) out.push({ key: `${c.id}|pin:${pin}|i`, comp: c.id, ref: `${c.ref}.${pin}`, label: 'GPIO akımı', value: i, limit: spec.imaxPin, unit: 'A', ratio: i / spec.imaxPin });
        const vmax = spec.vcc + spec.vInMargin;
        if (v > vmax || v < -0.3) out.push({ key: `${c.id}|pin:${pin}|v`, comp: c.id, ref: `${c.ref}.${pin}`, label: 'GPIO gerilimi', value: v, limit: v > 0 ? vmax : -0.3, unit: 'V', ratio: Math.abs(v) / (v > 0 ? vmax : 0.3) });
      }
    }
    if (c.type === 'capacitor_el' && r.v < -1) {
      out.push({ key: `${c.id}|polarity`, comp: c.id, ref: c.ref, label: 'Ters polarite', value: -r.v, limit: 1, unit: 'V', ratio: -r.v, note: 'Elektrolitik kondansatör ters bağlı.' });
    }
  }
  return out;
}
