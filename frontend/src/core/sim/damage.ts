import type { Circuit, Fault, FaultKind, PlacedComponent } from '../circuit/types';
import { getDef } from '../../library/components';
import type { CompResult } from './mna';
import { checkStress, type Overstress } from './stress';
import { effectiveRth, thermalSpec } from '../thermal/thermal';
import { formatSI } from '../units';

/**
 * Damage model. It does NOT use one universal burn formula. Failure triggers:
 *   1. thermal:  Tj (from the lumped thermal model) reaches the junction limit
 *   2. hard overvoltage: gate / drain-source / collector-emitter / reverse / dielectric >= 1.5x rating, e-cap reversed >= 2 V
 *   3. hard overcurrent on small-signal parts (LED, diode, BJT) >= 3x rating (bond-wire class failure)
 *   4. switch contacts carrying >= 2x contact rating (welding)
 * Polarized capacitors: reverse > 1 V that lasts >= REVERSE_DWELL_S (sim time), or reverse >= 2 V at once, => 'reverseVoltage' failure
 * (oxide conducts, see Sim 'rev' path). Thresholds are engineering heuristics, shown to the user with an uncertainty note. Real failure time/mode depends on the
 * exact part (SOA, pulse width, lot), which the library does not have yet.
 */

export type Cause = 'thermal' | 'overvoltage' | 'reverse' | 'overcurrent' | 'contact' | 'saturation' | 'wear';
export const CAUSE_LABEL: Record<Cause, string> = {
  thermal: 'Aşırı ısınma (Tj ≥ Tj,max)', overvoltage: 'Aşırı gerilim', reverse: 'Ters polarite / ters gerilim', overcurrent: 'Aşırı akım', contact: 'Kontak akım kapasitesi aşıldı',
  saturation: 'doyma: akım > Isat', wear: 'kontak aşınması',
};

/** inductor current / Isat at which a saturated winding is declared failed (open: wire burns). Generic heuristic, not from a datasheet. */
export const SAT_FAIL_RATIO = 3;

/** how long (simulated seconds) a polarized capacitor may sit above 1 V reverse before it is declared failed. Generic, not from a datasheet. */
export const REVERSE_DWELL_S = 0.02;

export interface ThermalState { T: number; tjmax: number; rth: number; cth: number; P: number }

export interface DamageCandidate {
  comp: PlacedComponent;
  fault: Fault;
  cause: Cause;
  limitLabel: string;
  value: number;
  limit: number;
  unit: string;
}

export interface FailureReport {
  id: number;
  comp: string;
  ref: string;
  name: string;
  t: number;
  mode: FaultKind;
  cause: Cause;
  limitLabel: string;
  value: number;
  limit: number;
  unit: string;
  v: number;
  i: number;
  p: number;
  T?: number;
  connections: string[];
  sameCurrent: string[];
  prevent: string[];
  fix: string[];
  uncertainty: string;
}

const UNCERTAINTY = 'Kural tabanlı tahmin. Gerçek arıza zamanı ve modu (açık/kısa) parçanın SOA, darbe ve termal verisine bağlıdır; bu veriler kütüphanede yok. Sonuç bir risk göstergesidir, kesin süre değildir.';

/** heat dissipated in the part: copper loss for motors, absorbed electrical power otherwise */
export const heatPower = (r: CompResult): number => Math.max(r.vals.pcu ?? r.p, 0);

const MODE_ON_THERMAL: Record<string, FaultKind> = { motor: 'open', resistor: 'open', pot: 'open', led: 'open', inductor: 'open', diode: 'short', zener: 'short', bridge: 'short', npn: 'short', pnp: 'short', nmos: 'short', pmos: 'short' };

export function evaluateDamage(circuit: Circuit, results: Record<string, CompResult>, thermal: Record<string, ThermalState>, existing: Record<string, Fault>, stress?: Overstress[], reverseDwell?: Record<string, number>): DamageCandidate[] {
  const out: DamageCandidate[] = [];
  const st = stress ?? checkStress(circuit, results);
  for (const c of circuit.components) {
    if (existing[c.id]?.kind === 'open' || existing[c.id]?.kind === 'short' || existing[c.id]?.kind === 'reverseVoltage') continue;
    const def = getDef(c.type);
    const r = results[c.id];
    if (!r) continue;
    const th = thermal[c.id];
    if (th && th.T >= th.tjmax && MODE_ON_THERMAL[def.model]) {
      out.push({ comp: c, fault: { kind: MODE_ON_THERMAL[def.model], auto: true }, cause: 'thermal', limitLabel: 'Tj,max', value: th.T, limit: th.tjmax, unit: '°C' });
      continue;
    }
    const mine = st.filter((s) => s.comp === c.id);
    let hit: DamageCandidate | null = null;
    for (const s of mine) {
      const rt = def.ratings.find((x) => x.label === s.label);
      if (s.key.endsWith('|polarity')) {
        if (s.value >= 2 || (s.value > 1 && (reverseDwell?.[c.id] ?? 0) >= REVERSE_DWELL_S)) hit = { comp: c, fault: { kind: 'reverseVoltage', auto: true }, cause: 'reverse', limitLabel: 'Polarite', value: s.value, limit: 0, unit: 'V' };
      } else if (s.key.endsWith('|sat')) {
        // saturated core: L collapses, current is limited only by the (unmodelled) DCR -> winding overheats; warning from Isat, failure at SAT_FAIL_RATIO x Isat
        if (s.ratio >= SAT_FAIL_RATIO) hit = { comp: c, fault: { kind: 'open', auto: true }, cause: 'saturation', limitLabel: s.label, value: s.value, limit: s.limit, unit: s.unit };
      } else if (s.key.endsWith('|wear')) {
        // contact erosion / welding from accumulated arc energy; a contact that is already welded is not reported again
        if (existing[c.id]?.kind !== 'welded') hit = { comp: c, fault: { kind: 'welded', auto: true }, cause: 'wear', limitLabel: s.label, value: s.value, limit: s.limit, unit: s.unit };
      } else if (rt && ['voltage', 'vds', 'vce', 'reverseVoltage'].includes(rt.quantity) && s.ratio >= 1.5) {
        const mos = def.model === 'nmos' || def.model === 'pmos';
        const gate = mos && rt.quantity === 'voltage';
        hit = { comp: c, fault: { kind: gate ? 'gateShort' : def.model === 'relay' || def.model === 'motor' ? 'open' : 'short', auto: true }, cause: rt.quantity === 'reverseVoltage' ? 'reverse' : 'overvoltage', limitLabel: s.label, value: s.value, limit: s.limit, unit: s.unit };
      } else if (rt?.quantity === 'current' && ['led', 'diode', 'npn', 'pnp'].includes(def.model) && s.ratio >= 3) {
        hit = { comp: c, fault: { kind: def.model === 'led' ? 'open' : 'short', auto: true }, cause: 'overcurrent', limitLabel: s.label, value: s.value, limit: s.limit, unit: s.unit };
      } else if (rt?.quantity === 'current' && (def.model === 'switch' || def.model === 'relay') && s.ratio >= 2) {
        hit = { comp: c, fault: { kind: 'welded', auto: true }, cause: 'contact', limitLabel: s.label, value: s.value, limit: s.limit, unit: s.unit };
      }
      if (hit) break;
    }
    if (hit) out.push(hit);
  }
  return out;
}

const STD_W = [0.125, 0.25, 0.5, 1, 2, 3, 5, 10, 25, 50];
const nextW = (w: number) => STD_W.find((x) => x >= w) ?? Math.ceil(w);

export function buildReport(
  id: number, circuit: Circuit, cand: DamageCandidate, results: Record<string, CompResult>, thermal: Record<string, ThermalState>,
  pinNet: Map<string, number>, netNames: string[], t: number, ambient: number,
): FailureReport {
  const c = cand.comp;
  const def = getDef(c.type);
  const r = results[c.id] ?? { v: 0, i: 0, p: 0, vals: {} };
  const refOf = (cid: string) => circuit.components.find((x) => x.id === cid)?.ref ?? cid;
  const members = (net: number) => [...pinNet.entries()].filter(([, n]) => n === net).map(([k]) => { const [cid, p] = k.split(':'); return `${refOf(cid)}.${p}`; });
  const connections = def.pins.map((p) => {
    const net = pinNet.get(`${c.id}:${p.id}`);
    if (net === undefined) return `${p.label}: bağlı değil`;
    const others = members(net).filter((m) => !m.startsWith(`${c.ref}.`));
    return `${p.label} → ${netNames[net]}${others.length ? ` (${others.slice(0, 6).join(', ')})` : ' (başka bağlantı yok)'}`;
  });
  const iMain = Math.abs(def.model === 'npn' || def.model === 'pnp' ? (r.vals.ic ?? r.i) : def.model === 'nmos' || def.model === 'pmos' ? (r.vals.id ?? r.i) : r.i);
  const sameCurrent = circuit.components
    .filter((x) => x.id !== c.id && getDef(x.type).model !== 'ground' && iMain > 1e-9)
    .filter((x) => { const q = results[x.id]; return q && Math.abs(Math.abs(q.i) - iMain) <= 0.1 * iMain; })
    .map((x) => x.ref);
  const th = thermal[c.id];
  const vSrc = Math.max(0, ...circuit.components.filter((x) => getDef(x.type).model === 'vsource').map((x) => Math.abs(Number(x.params.v) || 0) + (Number(x.params.amp) || 0)));
  const hasInductor = circuit.components.some((x) => getDef(x.type).model === 'inductor');

  const prevent: string[] = [];
  const fix: string[] = [];
  const m = def.model;
  if (cand.cause === 'thermal' && th) {
    const spec = thermalSpec(def, c);
    const Pw = Math.max(th.P, 1e-6);
    const need = (cand.limit - 15 - ambient) / Pw;
    fix.push(`Güç kaybı ≈ ${formatSI(th.P, 'W')} ile Tj ≈ ${th.T.toFixed(0)} °C (sınır ${cand.limit} °C). Güvenli çalışma için Rθja ≲ ${need.toFixed(1)} K/W gerekir (mevcut ≈ ${th.rth.toFixed(1)} K/W).`);
    if (spec?.heatsinkable) { prevent.push('Soğutucu (heatsink) ve fan'); fix.push('Inspector → Isıl bölümünden soğutucu / fan ekleyip tekrar çalıştırın.'); }
    if (m === 'resistor' || m === 'pot') { prevent.push('Daha yüksek watt’lı direnç'); fix.push(`En az ${nextW(Pw * 2)} W anma gücünde direnç kullanın (≥ 2× güvenlik payı).`); }
    if (m === 'nmos' || m === 'pmos') { prevent.push('Daha düşük RDS(on) / tam gate sürüşü'); fix.push('Gate gerilimini artırın veya mantık seviyeli / düşük RDS(on) MOSFET seçin; anahtarlama frekansını düşürün.'); }
    if (m === 'led') fix.push(vSrc > 0 ? `Seri direnç ≥ (${vSrc} V − ${r.v.toFixed(2)} V) / ${(0.8 * Number(c.params.ifmax)).toFixed(3)} A ≈ ${((vSrc - r.v) / (0.8 * Number(c.params.ifmax))).toFixed(0)} Ω.` : 'Seri akım sınırlama direnci ekleyin.');
    if (m === 'diode' || m === 'bridge' || m === 'zener') fix.push('Akımı azaltın veya daha yüksek akım/güç değerli diyot kullanın; zener için seri direnç değerini kontrol edin.');
    if (m === 'npn' || m === 'pnp') fix.push('Kolektör akımını/Vce düşümünü azaltın (doyuma sürün) veya güç transistörü + soğutucu kullanın.');
    prevent.push('Akım sınırlama / sigorta');
  } else if (cand.cause === 'overvoltage') {
    if (m === 'nmos' || m === 'pmos') {
      if (cand.limitLabel.includes('VGS')) { prevent.push('Gate–source zener (≈12–15 V)', 'Gate seri direnci'); fix.push(`Gate sürüşünü ≤ ${cand.limit} V tutun; ${Math.min(Math.round(cand.limit * 0.75), 15)} V zener ile gate–source arasını kıskaçlayın.`); }
      else { prevent.push('Flyback diyotu / snubber / TVS'); fix.push(hasInductor ? 'Devrede bobin var: bobine paralel serbest dönüş (flyback) diyotu ekleyin; gerekirse snubber veya TVS.' : `VDS ≥ ${cand.value.toFixed(0)} V olan parça seçin veya kaynak gerilimini düşürün.`); }
    } else { prevent.push('Gerilim kıskacı (TVS/zener)'); fix.push(`Anma gerilimi ≥ ${Math.ceil(cand.value * 1.5)} V olan parça kullanın veya gerilimi sınırlayın.`); }
    if (m === 'capacitor') fix.push('Anma gerilimi çalışma geriliminin en az 1.5 katı olan kondansatör seçin.');
  } else if (cand.cause === 'reverse') {
    if (c.type === 'capacitor_el' || m === 'capacitor') { prevent.push('Ters polarite koruma diyotu', 'Doğru polarite kontrolü'); fix.push('Ters polarite: kondansatörün + ucu daha pozitif düğüme bağlanmalı; ters bağlanmayı önlemek için seri diyot/MOSFET koruma kullanın.'); }
    else { prevent.push('Daha yüksek VR’li diyot', 'Seri koruma diyotu'); fix.push(`Ters gerilim ${cand.value.toFixed(0)} V: VR ≥ ${Math.ceil(cand.value * 1.5)} V olan diyot seçin veya polariteyi düzeltin.`); }
  } else if (cand.cause === 'overcurrent') {
    prevent.push('Seri akım sınırlama direnci', 'Sigorta');
    if (m === 'led') fix.push(vSrc > 0 ? `Seri direnç ≥ (${vSrc} V − ${r.v.toFixed(2)} V) / ${(0.8 * Number(c.params.ifmax)).toFixed(3)} A ≈ ${((vSrc - r.v) / (0.8 * Number(c.params.ifmax))).toFixed(0)} Ω.` : 'LED’e seri direnç ekleyin: R = (Vkaynak − Vf) / If.');
    else if (m === 'npn' || m === 'pnp') fix.push('Yükü azaltın veya güç transistörü / MOSFET kullanın; taban akımını Ic/10 civarında zorlayarak doyuma sürün.');
    else fix.push('Akımı sınırlayan bir direnç/regülatör ekleyin veya daha yüksek akım değerli parça kullanın.');
  } else if (cand.cause === 'contact') {
    prevent.push('Akım değeri yüksek kontak / röle', 'Snubber (endüktif yükte)');
    fix.push(`Kontak akım değeri ≥ ${(cand.value * 1.5).toFixed(1)} A olan anahtar/röle seçin; endüktif yükte diyot/RC snubber ekleyin.`);
  }
  else if (cand.cause === 'saturation') {
    prevent.push('Isat değeri daha yüksek bobin', 'Akım sınırlama (soft-start / akım limiti)');
    fix.push(`Bobin akımı ${cand.value.toFixed(2)} A, doyma akımı ${cand.limit.toFixed(2)} A. Doyduğunda endüktans çöker ve akım yalnızca DCR/kaynakla sınırlanır: Isat ≥ ${(cand.value * 1.2).toFixed(1)} A olan bobin seçin, tepe akımı düşürün veya anahtarlama frekansını artırın.`);
  } else if (cand.cause === 'wear') {
    prevent.push('Flyback diyotu / RC snubber (endüktif yükte)', 'Daha yüksek kontak değerli röle veya yarı iletken anahtar');
    fix.push(`Biriken ark enerjisi ${cand.value.toFixed(1)} J (genel sınır ${cand.limit.toFixed(1)} J). Endüktif yüke paralel flyback diyotu / RC snubber ekleyin ya da yükü MOSFET/SSR ile anahtarlayın.`);
  }
  return {
    id, comp: c.id, ref: c.ref, name: def.name, t, mode: cand.fault.kind, cause: cand.cause, limitLabel: cand.limitLabel,
    value: cand.value, limit: cand.limit, unit: cand.unit, v: r.v, i: r.i, p: r.p, T: th?.T,
    connections, sameCurrent, prevent: [...new Set(prevent)], fix, uncertainty: UNCERTAINTY,
  };
}

export type { Fault };

/** Per-part thermal states for a given power map. */
export function thermalStates(circuit: Circuit, power: Record<string, number>, temps: Record<string, number>, ambient: number): Record<string, ThermalState> {
  const out: Record<string, ThermalState> = {};
  for (const c of circuit.components) {
    const spec = thermalSpec(getDef(c.type), c);
    if (!spec) continue;
    const { rth, cth } = effectiveRth(spec, c);
    out[c.id] = { T: temps[c.id] ?? ambient, tjmax: spec.tjmax, rth, cth, P: Math.max(power[c.id] ?? 0, 0) };
  }
  return out;
}
