import { COMPONENTS } from '../../library/components';
import type { ComponentDef } from '../../library/types';
import { formatSI } from '../units';
import { effectiveRth, HEATSINKS, thermalSpec } from '../thermal/thermal';
import type { PlacedComponent } from '../circuit/types';
import { SRC, type Calc } from './types';

/** Worked engineering calculations. Every function returns the formula, the numbers plugged in and the references used. */

const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];

/** nearest E24 value at or above (up) / at or below (down) r */
export function e24(r: number, dir: 'up' | 'down' | 'near' = 'up'): number {
  if (!(r > 0)) return r;
  const dec = Math.floor(Math.log10(r));
  const cand: number[] = [];
  for (const d of [dec - 1, dec, dec + 1]) for (const m of E24) cand.push(Number((m * 10 ** d).toPrecision(3)));
  cand.sort((a, b) => a - b);
  if (dir === 'up') return cand.find((x) => x >= r * 0.9999) ?? r;
  if (dir === 'down') return [...cand].reverse().find((x) => x <= r * 1.0001) ?? r;
  return cand.reduce((best, x) => (Math.abs(x - r) < Math.abs(best - r) ? x : best), cand[0]);
}

export function ledResistor(vs: number, vf: number, i: number): Calc {
  const r = (vs - vf) / i;
  const std = e24(r, 'up');
  const iAct = (vs - vf) / std;
  return {
    title: 'LED seri direnci',
    steps: [`R = (Vkaynak − Vf) / If = (${vs} V − ${vf} V) / ${formatSI(i, 'A')} = ${formatSI(r, 'Ω', 4)}`, `Bir üst E24 değeri: ${formatSI(std, 'Ω')} → gerçek akım ${formatSI(iAct, 'A', 3)}`, `Direnç gücü: P = I²·R = ${formatSI(iAct * iAct * std, 'W', 3)} (en az 2× güvenlik payı ile ${formatSI(Math.max(0.125, iAct * iAct * std * 2), 'W')} seç)`],
    result: `${formatSI(std, 'Ω')} (E24)`, sources: [SRC.ohm, SRC.e24, SRC.power], values: { r, std, iAct },
  };
}

export function baseResistor(ic: number, beta: number, vdrive: number, vbe = 0.7, forced = 10): Calc {
  const ib = ic / Math.min(forced, beta / 2);
  const r = (vdrive - vbe) / ib;
  const std = e24(r, 'down');
  return {
    title: 'Transistör taban direnci (doyum)',
    steps: [`Doyuma sürmek için zorlanmış β ≈ ${Math.min(forced, beta / 2)} (β_min/2 veya 10): Ib = Ic / β_zorlanmış = ${formatSI(ic, 'A')} / ${Math.min(forced, beta / 2)} = ${formatSI(ib, 'A', 3)}`, `Rb = (Vsürücü − Vbe) / Ib = (${vdrive} V − ${vbe} V) / ${formatSI(ib, 'A', 3)} = ${formatSI(r, 'Ω', 4)}`, `Bir alt E24 değeri seç (daha fazla taban akımı = daha emin doyum): ${formatSI(std, 'Ω')}`],
    result: `${formatSI(std, 'Ω')}`, sources: [SRC.ohm, SRC.e24, 'BJT doyum kuralı (zorlanmış β ≈ 10)'], values: { r, std, ib },
  };
}

export function divider(vin: number, vout: number, iDiv: number): Calc {
  const rt = vin / iDiv, r2 = vout / iDiv, r1 = rt - r2;
  return {
    title: 'Gerilim bölücü',
    steps: [`Seçilen bölücü akımı: ${formatSI(iDiv, 'A')} → Rtoplam = Vin / I = ${formatSI(rt, 'Ω', 4)}`, `R2 = Vout / I = ${formatSI(r2, 'Ω', 4)}, R1 = Rtoplam − R2 = ${formatSI(r1, 'Ω', 4)}`, `E24: R1 ≈ ${formatSI(e24(r1, 'near'), 'Ω')}, R2 ≈ ${formatSI(e24(r2, 'near'), 'Ω')} → Vout = ${(vin * e24(r2, 'near') / (e24(r1, 'near') + e24(r2, 'near'))).toFixed(3)} V`, 'Bölücü yük direnci ≫ R2 değilse çıkış düşer (yük etkisi).'],
    result: `R1 = ${formatSI(e24(r1, 'near'), 'Ω')}, R2 = ${formatSI(e24(r2, 'near'), 'Ω')}`, sources: [SRC.ohm, SRC.e24], values: { r1, r2 },
  };
}

const MM2 = [0.14, 0.25, 0.34, 0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16];
const AWG: Record<number, string> = { 0.14: '≈ AWG 26', 0.25: '≈ AWG 24', 0.34: '≈ AWG 22', 0.5: '≈ AWG 20', 0.75: '≈ AWG 18', 1: '≈ AWG 17', 1.5: '≈ AWG 16', 2.5: '≈ AWG 14', 4: '≈ AWG 12', 6: '≈ AWG 10', 10: '≈ AWG 8', 16: '≈ AWG 6' };

export function wireSize(i: number, lengthM: number, volts: number, dropPct = 3, jmax = 4): Calc {
  const rho = 0.0172;
  const aTherm = i / jmax;
  const aDrop = (i * rho * 2 * lengthM) / ((volts * dropPct) / 100);
  const need = Math.max(aTherm, aDrop);
  const pick = MM2.find((a) => a >= need) ?? MM2[MM2.length - 1];
  const drop = (i * rho * 2 * lengthM) / pick;
  return {
    title: 'Kablo kesiti',
    steps: [`Isınma kriteri: A ≥ I / J = ${i} A / ${jmax} A/mm² = ${aTherm.toFixed(3)} mm²`, `Gerilim düşümü kriteri (gidiş+dönüş ${lengthM} m, ρ = ${rho} Ω·mm²/m, izin %${dropPct} of ${volts} V): A ≥ I·ρ·2L / ΔV = ${aDrop.toFixed(3)} mm²`, `Gereken ≥ ${need.toFixed(3)} mm² → standart kesit ${pick} mm² (${AWG[pick] ?? ''}); gerçek düşüm ≈ ${drop.toFixed(3)} V (%${((drop / volts) * 100).toFixed(2)})`],
    result: `${pick} mm² ${AWG[pick] ?? ''}`, sources: [SRC.wire, SRC.ohm],
    values: { aTherm, aDrop, pick },
  };
}

export function heatsink(P: number, tjmax: number, tamb: number, rjc: number, rcs = 0.5, margin = 10): Calc {
  const rsaReq = (tjmax - margin - tamb) / P - rjc - rcs;
  const options = (Object.entries(HEATSINKS) as [string, { rsa: number; label: string }][]).filter(([k]) => k !== 'none');
  const fit = options.find(([, h]) => h.rsa <= rsaReq);
  const fan = options.find(([, h]) => h.rsa * 0.4 <= rsaReq);
  return {
    title: 'Soğutucu seçimi',
    steps: [`Hedef Tj = Tj,max − güvenlik payı = ${tjmax} − ${margin} = ${tjmax - margin} °C (Tamb = ${tamb} °C, P = ${formatSI(P, 'W', 3)})`, `Toplam Rθ ≤ (Tj − Tamb) / P = ${((tjmax - margin - tamb) / P).toFixed(2)} K/W`, `Rθsa ≤ Rθtoplam − Rθjc − Rθcs = ${((tjmax - margin - tamb) / P).toFixed(2)} − ${rjc.toFixed(2)} − ${rcs} = ${rsaReq.toFixed(2)} K/W`, rsaReq <= 0 ? 'Soğutucu yetmez: güç kaybını azaltın (daha düşük RDS(on), daha yüksek gate gerilimi) veya paralel parça kullanın.' : fit ? `En küçük yeterli soğutucu: ${fit[1].label}` : fan ? `Doğal konveksiyonla yetmez; fan ile (×0.4): ${fan[1].label}` : 'Hazır soğutucuların hiçbiri yetmez (fan ile bile).'],
    result: rsaReq <= 0 ? 'soğutucu yetersiz — güç kaybını azaltın' : fit ? fit[1].label : fan ? `${fan[1].label} + fan` : 'yetersiz',
    sources: [SRC.thermal, 'Rθjc paket sınıfı tahmini'], values: { rsaReq },
  };
}

const PSU_STD = [0.1, 0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30];

export function psuSize(vnom: number, iLoad: number, margin = 1.25): Calc {
  const need = iLoad * margin;
  const pick = PSU_STD.find((x) => x >= need) ?? Math.ceil(need);
  return {
    title: 'Güç kaynağı boyutlandırma',
    steps: [`Toplam yük akımı (simülasyon): ${formatSI(iLoad, 'A', 3)} @ ${vnom} V → P = ${formatSI(iLoad * vnom, 'W', 3)}`, `%${Math.round((margin - 1) * 100)} güvenlik payı: ${formatSI(need, 'A', 3)}`, `Standart değer: ${vnom} V / ${pick} A (${formatSI(vnom * pick, 'W')})`, 'Kondansatör içeren devrelerde açılış (inrush) akımı daha yüksek olabilir; kaynağın akım limiti/soft-start özelliğini kontrol edin.'],
    result: `${vnom} V, ≥ ${pick} A`, sources: [SRC.power, SRC.sim], values: { need, pick },
  };
}

export function rippleCap(iLoad: number, fRipple: number, dV: number, kind: 'yarım dalga' | 'tam dalga'): Calc {
  const c = iLoad / (fRipple * dV);
  return {
    title: 'Filtre kondansatörü',
    steps: [`${kind} doğrultmada ripple frekansı f = ${fRipple} Hz`, `C ≈ I / (f · ΔVpp) = ${formatSI(iLoad, 'A')} / (${fRipple} Hz · ${dV} V) = ${formatSI(c, 'F', 3)}`, `Standart seriden bir üst değer; gerilim anma değeri ≥ 1.5 × tepe gerilim; ripple akımı (ESR) için kondansatör datasheet’ini kontrol edin.`],
    result: formatSI(c, 'F', 3), sources: [SRC.ripple], values: { c },
  };
}

export function rcTime(r: number, c: number): Calc {
  const tau = r * c;
  return { title: 'RC zaman sabiti', steps: [`τ = R·C = ${formatSI(r, 'Ω')} · ${formatSI(c, 'F')} = ${formatSI(tau, 's', 3)}`, `%63 → τ, %95 → 3τ = ${formatSI(3 * tau, 's', 3)}, %99 → 5τ = ${formatSI(5 * tau, 's', 3)}`], result: formatSI(tau, 's', 3), sources: ['RC üstel yanıt: v(t) = V(1 − e^(−t/τ))'], values: { tau } };
}

export interface MosReq { vsupply: number; iload: number; vgs: number; inductive: boolean; polarity: 'n' | 'p'; tamb: number }
export interface MosCandidate { def: ComponentDef; rds: number; loss: number; tj: number; ok: boolean; reasons: string[] }

/** Rank library MOSFETs for a switch: voltage/current derating, gate-drive feasibility, conduction loss and junction temperature. */
export function mosfetRank(req: MosReq, parts: ComponentDef[] = COMPONENTS): { calc: Calc; ranked: MosCandidate[]; rejected: MosCandidate[] } {
  const vMargin = req.inductive ? 2.0 : 1.5;
  const need = { vds: req.vsupply * vMargin, id: req.iload * 2 };
  const out: MosCandidate[] = [];
  for (const d of parts) {
    if (d.model !== (req.polarity === 'n' ? 'nmos' : 'pmos') || d.userMade) continue;
    const p = (k: string) => Number(d.params.find((q) => q.key === k)?.default);
    const vth = p('vth'), k = p('k'), vdsmax = p('vdsmax'), idmax = p('idmax'), vgsmax = p('vgsmax');
    const reasons: string[] = [];
    const vov = req.vgs - vth;
    const rds = vov > 0 ? 1 / (2 * k * vov) : Infinity;
    if (vdsmax < need.vds) reasons.push(`VDS ${vdsmax} V < gereken ${need.vds.toFixed(0)} V (${vMargin}× pay)`);
    if (idmax < need.id) reasons.push(`ID ${idmax} A < gereken ${need.id.toFixed(1)} A (2× pay)`);
    if (req.vgs > vgsmax) reasons.push(`Gate ${req.vgs} V > |VGS| maks. ${vgsmax} V`);
    if (vov < 1.0) reasons.push(`Gate sürüşü ${req.vgs} V, VGS(th) ≈ ${vth} V: yeterli aşırı sürüş yok`);
    const loss = req.iload * req.iload * rds;
    const comp = { id: 'x', type: d.type, ref: 'Q', x: 0, z: 0, rot: 0 as const, params: Object.fromEntries(d.params.map((q) => [q.key, q.default])) } as PlacedComponent;
    const spec = thermalSpec(d, comp);
    const rth = spec ? effectiveRth(spec, comp).rth : 62;
    const tj = req.tamb + loss * rth;
    if (spec && tj > spec.tjmax - 10 && Number.isFinite(tj)) reasons.push(`soğutucusuz Tj ≈ ${tj.toFixed(0)} °C (limit ${spec.tjmax} °C): soğutucu gerekir`);
    out.push({ def: d, rds, loss, tj, ok: reasons.length === 0, reasons });
  }
  const hardFail = (c: MosCandidate) => c.reasons.some((r) => !r.startsWith('soğutucusuz'));
  const ranked = out.filter((c) => !hardFail(c)).sort((a, b) => a.loss - b.loss);
  const rejected = out.filter(hardFail);
  return {
    ranked, rejected,
    calc: {
      title: 'MOSFET seçimi',
      steps: [`Gereksinim: VDS ≥ ${vMargin}×${req.vsupply} V = ${need.vds.toFixed(1)} V${req.inductive ? ' (endüktif yük → 2× pay)' : ''}, ID ≥ 2×${req.iload} A = ${need.id.toFixed(1)} A, gate sürüşü ${req.vgs} V`, 'Iletim kaybı: RDS(on) ≈ 1 / (2·K·(VGS − VGS(th))) (level-1 modelinden), P = I²·RDS(on), Tj = Tamb + P·Rθja', ranked.length ? `En iyi aday: ${ranked[0].def.name} (RDS(on) ≈ ${formatSI(ranked[0].rds, 'Ω', 3)}, P ≈ ${formatSI(ranked[0].loss, 'W', 3)}, soğutucusuz Tj ≈ ${ranked[0].tj.toFixed(0)} °C)` : 'Kütüphanede kriterleri sağlayan parça yok: gate sürüşünü artırın (sürücü/seviye kaydırıcı) veya daha uygun parça ekleyin.'],
      result: ranked.length ? ranked.slice(0, 3).map((c) => c.def.name).join(' > ') : 'uygun parça yok',
      sources: [SRC.library, SRC.thermal, 'MOSFET level-1 modeli'],
    },
  };
}
