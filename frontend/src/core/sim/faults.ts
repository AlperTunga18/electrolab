import type { Circuit, Fault, FaultKind, PlacedComponent } from '../circuit/types';
import type { ComponentDef, ModelKind } from '../../library/types';

/** The two "main" terminals of a part (what a short/leak acts across). */
export function mainPins(model: ModelKind): [string, string] {
  switch (model) {
    case 'resistor': case 'capacitor': case 'inductor': case 'switch': return ['1', '2'];
    case 'diode': case 'led': case 'zener': return ['A', 'K'];
    case 'vsource': case 'isource': return ['P', 'N'];
    case 'npn': case 'pnp': return ['C', 'E'];
    case 'nmos': case 'pmos': return ['D', 'S'];
    case 'pot': return ['A', 'B'];
    case 'motor': return ['P', 'N'];
    case 'relay': return ['C1', 'C2'];
    case 'stepper': return ['A+', 'A-'];
    case 'servo': return ['VCC', 'GND'];
    case 'bldc': return ['U', 'V'];
    case 'bldc_esc': return ['VCC', 'GND'];
    case 'solenoid': return ['P', 'N'];
    case 'transformer': return ['P1', 'S1'];
    case 'eload': return ['P', 'N'];
    case 'bridge': return ['P', 'N'];
    default: return ['1', '2'];
  }
}

export interface FaultOption { kind: FaultKind; label: string; amountLabel?: string; amountDefault?: number; hint: string; /** UI: ask for the leaking pin and the target net (insulationFault) */ pinTarget?: boolean }

const O = (kind: FaultKind, label: string, hint: string, amountLabel?: string, amountDefault?: number): FaultOption => ({ kind, label, hint, amountLabel, amountDefault });

/** Insulation breakdown: leakage from one pin of the part to another net (ground by default). Detectable with the insulation (megger) test. */
const insul = (): FaultOption => ({ ...O('insulationFault', 'Yalıtım hatası (pin → toprak/net kaçağı)', 'Seçilen pin ile başka bir düğüm (varsayılan toprak) arasında yalıtım direnci Ω olarak düşer: nem/kirlenme/sargı yalıtımı bozulması; megger ile ölçüldüğünde okuma düşer.', 'Ω', 1e6), pinTarget: true });
const REV = () => O('reverseVoltage', 'Ters gerilim hasarı (ters polarite)', 'Polarize kondansatörde işaretli polarite ~1 V aşıldığında oksit tabakası iletir (Zener benzeri diz); ters gerilimde akım hızla artar ve parça arızalanır.');
const ESR = () => O('esrRise', 'ESR artışı (yaşlanma)', 'Seri eşdeğer direnç yüzde olarak artar (elektrolit kuruması); kapasite aynı kalır, ripple gerilimi ΔV ≈ I·ΔESR kadar artar.', '%', 400);

/** Faults that make physical sense for a part (spec: only real failure modes). */
export function faultOptions(def: ComponentDef): FaultOption[] {
  const open = O('open', 'Açık devre', 'Parça devreden kopar (iç tel / bağlantı kopması).');
  const short = (h: string) => O('short', 'Kısa devre', h);
  switch (def.model) {
    case 'resistor': return [open, short('Uçlar ~1 mΩ ile birleşir.'), O('drift', 'Değer kayması (yaşlanma / yanlış değer)', 'Direnç değeri yüzde olarak değişir.', '%', 30), O('intermittent', 'Aralıklı temas', 'Bağlantı periyodik olarak kopar.', 'Hz', 50), insul()];
    case 'pot': return [open, short('A–W–B kısalır.'), O('drift', 'Değer kayması', 'Toplam direnç yüzde olarak değişir.', '%', 30)];
    case 'capacitor': return [open, short('Dielektrik delinmesi.'), O('capLoss', 'Kapasite kaybı (yaşlanma)', 'Kapasite yüzde olarak azalır.', '%', 50), O('leak', 'Kaçak akım', 'Paralel kaçak direnci.', 'Ω', 10000), ...(def.type === 'capacitor_el' ? [ESR(), REV()] : []), insul()];
    case 'inductor': return [open, short('Sarım kısası (tam kısa varsayılır).'), insul()];
    case 'diode': case 'led': case 'zener': return [open, short('Eklem delinmesi.'), O('leak', 'Kaçak akım', 'Paralel kaçak direnci.', 'Ω', 10000)];
    case 'bridge': return [open, short('+ ve − uçları kısalır.'), O('leak', 'Kaçak akım', 'Paralel kaçak direnci.', 'Ω', 10000)];
    case 'npn': case 'pnp': return [open, short('Kolektör–emitör kısa.'), O('leak', 'C–E kaçak', 'Paralel kaçak direnci.', 'Ω', 10000)];
    case 'nmos': case 'pmos': return [open, short('Drain–source kısa.'), O('gateShort', 'Gate hasarı (G–S kısa)', 'Gate oksiti delinir; gate kaynağa çekilir.'), O('leak', 'D–S kaçak', 'Paralel kaçak direnci.', 'Ω', 10000)];
    case 'switch': return [O('welded', 'Yapışık kontak (hep kapalı)', 'Kontaklar kaynaklanır.'), O('stuckOpen', 'Kontak açık kalır', 'Hiç iletmez.'), O('intermittent', 'Aralıklı temas', 'Kontak periyodik olarak kopar.', 'Hz', 50)];
    case 'vsource': return [open, short('Kaynak çöker (çıkış kısa).')];
    case 'isource': return [open];
    case 'motor': return [open, short('Sargı kısa devre.'), insul(), O('drift', 'Sargı direnci kayması', 'Sargı direnci yüzde olarak değişir.', '%', 30), O('stalled', 'Rotor kilitlendi (stall)', 'Rotor mekanik olarak durdurulur: kalkış/stall akımı akar.')];
    case 'bldc': return [open, short('Faz–faz kısa devre (U–V sargıları).'), O('openPhase', 'Açık faz (tek sargı kopuk)', 'Seçilen faz sargısı kopar (akımı 0): kalan iki faz tek başına çalışır, tork dalgalanır ve azalır; yıldız nötr yüzer kaldığı için akım yolu kalan iki faz üzerinden kapanır.', 'Faz (1=U 2=V 3=W)', 1), insul(), O('drift', 'Sargı direnci kayması', 'Faz direnci yüzde olarak değişir.', '%', 30), O('stalled', 'Rotor kilitlendi (stall)', 'Rotor mekanik olarak durdurulur: kalkış/stall akımı akar (~ V/2R).')];
    case 'bldc_esc': return [open, short('VCC–GND kısa devre.'), insul()];
    case 'solenoid': return [open, short('Bobin kısa devre.'), insul(), O('drift', 'Bobin direnci kayması', 'Bobin direnci yüzde olarak değişir.', '%', 30), O('stalled', 'Plunger sıkıştı (jam)', 'Plunger olduğu konumda tutulur: endüktans artmaz, akım dalgalanması (dip) olmaz, bobin sürekli V/R akımı çeker.')];
    case 'relay': return [open, short('Bobin kısa devre.'), insul(), O('welded', 'Yapışık kontak (hep çekili)', 'Kontaklar kaynaklanır: bobin enerjisiz olsa da NO kapalı kalır.'), O('stuckOpen', 'Kontak çekmiyor (hep bırakık)', 'Kontak hiç kapanmaz.')];
    case 'transformer': return [open, short('Sargı kısası (primer uçları).'), insul(), O('leak', 'Yalıtım hatası (primer–sekonder kaçak)', 'Primer ve sekonder arasında kaçak direnci.', 'Ω', 100000)];
    case 'eload': return [open];
    case 'mcu': return [O('lowVoltage', 'Düşük besleme (brownout)', 'Kartın besleme rayları yüzde olarak çöker (USB/regülatör sagı). Ray, parçanın BOD eşiğinin altına inince MCU reset tutulur ve çıkışlar Hi-Z olur; eşik üstüne çıkınca program baştan başlar.', '% çökme', 40)];
    default: return [];
  }
}

/** Parameter-level fault effects. Structural ones (open/short/leak/gateShort/intermittent) are applied inside Sim. */
export function effectiveCircuit(circuit: Circuit, faults: Record<string, Fault>): Circuit {
  const ids = Object.keys(faults);
  if (!ids.length) return circuit;
  const comps = circuit.components.map((c): PlacedComponent => {
    const f = faults[c.id];
    if (!f) return c;
    const p = { ...c.params };
    const k = 1 + (f.amount ?? 0) / 100;
    if (f.kind === 'drift') {
      for (const key of ['r', 'c', 'l']) if (typeof p[key] === 'number') p[key] = (p[key] as number) * k;
    } else if (f.kind === 'capLoss') {
      if (typeof p.c === 'number') p.c = (p.c as number) * Math.max(1 - (f.amount ?? 0) / 100, 0.001);
    } else if (f.kind === 'esrRise') {
      p.esr = esrNominal(p) * (1 + (f.amount ?? 0) / 100);
    } else if (f.kind === 'stalled') { if (typeof p.tload === 'number') p.tload = 1e6; else if (typeof p.jam === 'boolean') p.jam = true; }
    else if (f.kind === 'welded') p.closed = true;
    else if (f.kind === 'stuckOpen') p.closed = false;
    else return c;
    return { ...c, params: p };
  });
  return { ...circuit, components: comps };
}

/**
 * Nominal ESR (ohm) of a capacitor: the 'esr' param if set, else a GENERIC electrolytic estimate ESR ~ 65 uOhm*F / C clamped to 5 mOhm..10 ohm
 * (rule-of-thumb for general-purpose aluminium electrolytics, not a datasheet value). Ideal (0) parts without the fault stay ideal.
 */
export function esrNominal(p: Record<string, number | string | boolean>): number {
  const e = Number(p.esr);
  if (Number.isFinite(e) && e > 0) return e;
  const c = Number(p.c) || 1e-6;
  return Math.min(Math.max(65e-6 / c, 5e-3), 10);
}

export const FAULT_LABEL: Record<FaultKind, string> = {
  open: 'açık devre', short: 'kısa devre', drift: 'değer kayması', capLoss: 'kapasite kaybı', leak: 'kaçak akım',
  gateShort: 'gate hasarı (G–S kısa)', stalled: 'rotor kilitli (stall)', welded: 'yapışık kontak', stuckOpen: 'açık kalan kontak', intermittent: 'aralıklı temas',
  reverseVoltage: 'ters gerilim hasarı (ters polarite)', lowVoltage: 'düşük besleme (brownout)', esrRise: 'ESR artışı', insulationFault: 'yalıtım hatası', looseConnector: 'gevşek konnektör', openPhase: 'açık faz (tek sargı kopuk)',
};
