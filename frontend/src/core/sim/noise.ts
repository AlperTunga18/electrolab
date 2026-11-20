import type { Circuit } from '../circuit/types';
import { getDef } from '../../library/components';
import { effectiveCircuit } from './faults';
import { Sim } from './mna';

/**
 * Gürültü tahmini (termal + saçma) — bir çıkış düğümünde, küçük sinyal süperpozisyonuyla.
 *
 * Yöntem: DC çözülür; her gürültü kaynağı (direnç: 4kT/R A²/Hz, diyot/LED/zener: 2q·I_DC A²/Hz) iki ucu
 * arasına bağlı birim akım kaynağı olarak Sim.acAt(f, {port}) ile enjekte edilir. Çıkış düğümündeki
 * gerilim Z(f) transempedansıdır; katkı PSD = |Z|²·S_i. Kaynaklar ilişkisiz varsayılır, güçler toplanır.
 *
 * SINIRLAR:
 *  - Devre yalnız dirençliyse (C/L yok) PSD frekanstan bağımsızdır: tek frekansta (1 Hz) çözülüp B ile çarpılır.
 *  - C/L varsa [fStart, fStop] aralığında log-ızgarada (20 nokta/dekad) sayısal entegrasyon yapılır;
 *    0 Hz'e kadar olan kısım ilk ızgara noktasındaki PSD ile düz kabul edilir.
 *  - 1/f (flicker) gürültüsü, BJT/MOSFET kanal gürültüsü, opamp giriş gürültüsü modellenmez.
 *    Transistör/opamp içeren devrelerde sonuç yalnız dirençlerin + diyotların katkısını yansıtır (eksik tahmin).
 *  - Saçma gürültü yalnız diyot/LED/zener'de (ileri DC akımından). BJT taban/kollektör saçması yok.
 *  - Cihaz küçük sinyal modeli Sim.acAt ile aynıdır (kavşak kapasitesi yok).
 *  - Çıkış, probe pininin bağlı olduğu düğümün topraka göre gerilimidir.
 */

export const K_B = 1.380649e-23;
export const Q_E = 1.602176634e-19;

export interface NoiseOptions {
  probe: { comp: string; pin: string };
  /** gürültü bant genişliği B (Hz); varsayılan 20 kHz */
  bandwidth?: number;
  /** bant alt kenarı (Hz); varsayılan 0 (yani bant 0..B). Aralık [fStart, fStart+B] */
  fStart?: number;
  /** sıcaklık (K); varsayılan 300 */
  temperature?: number;
}

export interface NoiseSource { comp: string; kind: 'thermal' | 'shot'; vrms: number }

export interface NoiseResult {
  perSource: NoiseSource[];
  totalVrms: number;
  bandwidth: number;
  /** 'flat' = tek frekans, 'integrated' = ızgara entegrasyonu */
  method: 'flat' | 'integrated';
}

export function noiseAnalysis(circuit: Circuit, o: NoiseOptions): NoiseResult {
  const B = o.bandwidth ?? 20e3;
  const f0 = o.fStart ?? 0, f1 = f0 + B;
  const T = o.temperature ?? 300;
  const faults = circuit.faults ?? {};
  const eff = effectiveCircuit(circuit, faults);
  const sim = new Sim(eff, { faults });
  sim.solveDC();
  const res = sim.results();
  const outNet = sim.netOf(o.probe.comp, o.probe.pin);

  interface Src { comp: string; kind: 'thermal' | 'shot'; a: number; b: number; si: number }
  const srcs: Src[] = [];
  for (const c of eff.components) {
    const m = getDef(c.type).model;
    if (m === 'resistor') {
      const r = Number(c.params.r);
      if (r > 0) srcs.push({ comp: c.id, kind: 'thermal', a: sim.netOf(c.id, '1'), b: sim.netOf(c.id, '2'), si: (4 * K_B * T) / r });
    } else if (m === 'diode' || m === 'led' || m === 'zener') {
      const i = Math.abs(res[c.id]?.i ?? 0);
      if (i > 0) srcs.push({ comp: c.id, kind: 'shot', a: sim.netOf(c.id, 'A'), b: sim.netOf(c.id, 'K'), si: 2 * Q_E * i });
    }
  }
  const reactive = eff.components.some((c) => { const m = getDef(c.type).model; return m === 'capacitor' || m === 'inductor'; });

  const zMag2 = (s: Src, f: number) => {
    const sol = sim.acAt(f, { port: { a: s.a, b: s.b } });
    const re = outNet > 0 ? sol.re[outNet - 1] : 0, im = outNet > 0 ? sol.im[outNet - 1] : 0;
    return re * re + im * im;
  };

  const perSource: NoiseSource[] = srcs.map((s) => {
    let v2: number;
    if (!reactive) {
      v2 = zMag2(s, 1) * s.si * B;
    } else {
      const fl = Math.max(f0, f1 * 1e-4);
      const n = Math.max(2, Math.ceil(Math.log10(f1 / fl) * 20) + 1);
      let prevF = fl, prevP = zMag2(s, fl);
      v2 = prevP * (fl - f0); // [f0, fl] düz
      for (let k = 1; k < n; k++) {
        const f = fl * Math.pow(f1 / fl, k / (n - 1));
        const p = zMag2(s, f);
        v2 += 0.5 * (prevP + p) * (f - prevF);
        prevF = f; prevP = p;
      }
      v2 *= s.si;
    }
    return { comp: s.comp, kind: s.kind, vrms: Math.sqrt(v2) };
  });
  const totalVrms = Math.sqrt(perSource.reduce((a, s) => a + s.vrms * s.vrms, 0));
  return { perSource, totalVrms, bandwidth: B, method: reactive ? 'integrated' : 'flat' };
}
