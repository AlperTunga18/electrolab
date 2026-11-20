import { CircuitBuilder } from '../../core/circuit/builder';
import type { Circuit } from '../../core/circuit/types';
import type { Lesson } from '../types';

/** Elektriğin temelleri: 10 ders. Sayısal her söz (expects, quiz verify, challenge) çözücüyle testlerde doğrulanır. */

// ---------- Devreler ----------

/** Ders 1: 5 V kaynak + 1 kΩ + toprak */
const loop1 = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 5 }, -6, 0, 0, 'V1');
  b.add('resistor', { r: 1000 }, 0, -3, 0, 'R1');
  b.add('ground', {}, 0, 4, 0, 'GND1');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/** Ders 2: aynı 12 V üzerinde üç farklı direnç (paralel kollar) */
const ohm3 = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 12 }, -6, 0, 0, 'V1');
  b.add('resistor', { r: 1000 }, 0, 0, 1, 'R1');
  b.add('resistor', { r: 2200 }, 4, 0, 1, 'R2');
  b.add('resistor', { r: 4700 }, 8, 0, 1, 'R3');
  b.add('ground', {}, 4, 6, 0, 'GND1');
  b.chain('V1.P', 'R1.1', 'R2.1', 'R3.1');
  b.chain('R1.2', 'R2.2', 'R3.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/** Ders 2 challenge: tek direnç, akımı ayarla */
const ohmChallenge = (r: number): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 10 }, -6, 0, 0, 'V1');
  b.add('resistor', { r }, 0, -3, 0, 'R1');
  b.add('ground', {}, 0, 4, 0, 'GND1');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/** Ders 3: 9 V üzerinde 1 kΩ, 330 Ω, 100 Ω (hepsi 0,25 W) */
const power3 = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 9 }, -6, 0, 0, 'V1');
  b.add('resistor', { r: 1000, pmax: 0.25 }, 0, 0, 1, 'R1');
  b.add('resistor', { r: 330, pmax: 0.25 }, 4, 0, 1, 'R2');
  b.add('resistor', { r: 100, pmax: 0.25 }, 8, 0, 1, 'R3');
  b.add('ground', {}, 4, 6, 0, 'GND1');
  b.chain('V1.P', 'R1.1', 'R2.1', 'R3.1');
  b.chain('R1.2', 'R2.2', 'R3.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/** Ders 4: 12 V, 1k + 2,2k + 4,7k seri */
const series3 = (r1 = 1000, r2 = 2200, r3 = 4700): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 12 }, -6, 0, 0, 'V1');
  b.add('resistor', { r: r1 }, 0, -4, 1, 'R1');
  b.add('resistor', { r: r2 }, 0, 0, 1, 'R2');
  b.add('resistor', { r: r3 }, 0, 4, 1, 'R3');
  b.add('ground', {}, 5, 0, 0, 'GND1');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'R2.1'); b.chain('R2.2', 'R3.1'); b.chain('R3.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/** Ders 5: 10 V, 1k || 2k || 2k */
const parallel3 = (r1 = 1000, r2 = 2000, r3: number | null = 2000): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 10 }, -6, 0, 0, 'V1');
  b.add('resistor', { r: r1 }, 0, 0, 1, 'R1');
  b.add('resistor', { r: r2 }, 4, 0, 1, 'R2');
  if (r3 !== null) b.add('resistor', { r: r3 }, 8, 0, 1, 'R3');
  b.add('ground', {}, 4, 6, 0, 'GND1');
  b.chain('V1.P', 'R1.1', 'R2.1'); b.chain('R1.2', 'R2.2', 'GND1.G');
  if (r3 !== null) { b.chain('R2.1', 'R3.1'); b.chain('R2.2', 'R3.2'); }
  b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/** Ders 6: 10 V, R1 1k üst, R2 2k alt; SW1 ile 2k yük (başlangıçta açık) */
const divider = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 10 }, -6, 0, 0, 'V1');
  b.add('resistor', { r: 1000 }, 0, -3, 1, 'R1');
  b.add('resistor', { r: 2000 }, 0, 3, 1, 'R2');
  b.add('switch', { closed: false }, 4, 0, 0, 'SW1');
  b.add('resistor', { r: 2000 }, 8, 3, 1, 'RL');
  b.add('ground', {}, 4, 8, 0, 'GND1');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'R2.1'); b.chain('R2.2', 'GND1.G');
  b.chain('R2.1', 'SW1.1'); b.chain('SW1.2', 'RL.1'); b.chain('RL.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/** Ders 6 faultHunt: yüksüz bölücü */
const dividerPlain = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 10 }, -6, 0, 0, 'V1');
  b.add('resistor', { r: 1000 }, 0, -3, 1, 'R1');
  b.add('resistor', { r: 2000 }, 0, 3, 1, 'R2');
  b.add('ground', {}, 5, 0, 0, 'GND1');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'R2.1'); b.chain('R2.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/** Ders 6 challenge: 5 V → 3,3 V */
const dividerChallenge = (r1: number, r2: number): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 5 }, -6, 0, 0, 'V1');
  b.add('resistor', { r: r1 }, 0, -3, 1, 'R1');
  b.add('resistor', { r: r2 }, 0, 3, 1, 'R2');
  b.add('ground', {}, 5, 0, 0, 'GND1');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'R2.1'); b.chain('R2.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/** Ders 7: 5 V, 10k pot (konum 0,3), W ucunda 100k yük */
const potCircuit = (r = 10000, pos = 0.3): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 5 }, -6, 0, 0, 'V1');
  b.add('pot', { r, pos }, 0, 0, 0, 'RV1');
  b.add('resistor', { r: 100000 }, 6, 3, 1, 'R1');
  b.add('ground', {}, 3, 8, 0, 'GND1');
  b.chain('V1.P', 'RV1.A'); b.chain('RV1.B', 'GND1.G'); b.chain('RV1.W', 'R1.1'); b.chain('R1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/** Ders 8: 5 V, 1k, 100 µF (başlangıçta boş) */
const rcCircuit = (r = 1000, c = 100e-6): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 5 }, -6, 0, 0, 'V1');
  b.add('resistor', { r }, 0, -3, 0, 'R1');
  b.add('capacitor_el', { c, vmax: 16, v0: 0 }, 5, 0, 1, 'C1');
  b.add('ground', {}, 0, 4, 0, 'GND1');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'C1.1'); b.chain('C1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/** Ders 9: 10 V, 100 Ω, 100 mH */
const rlCircuit = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 10 }, -6, 0, 0, 'V1');
  b.add('resistor', { r: 100 }, 0, -3, 0, 'R1');
  b.add('inductor', { l: 0.1 }, 5, 0, 1, 'L1');
  b.add('ground', {}, 0, 4, 0, 'GND1');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'L1.1'); b.chain('L1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/** Ders 10: 100 Hz, 5 V tepe sinüs + RC alçak geçiren (1 kΩ, 1,6 µF → fc ≈ 99,5 Hz) */
const acRc = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('signal_gen', { wave: 'sine', v: 0, amp: 5, freq: 100 }, -6, 0, 0, 'V1');
  b.add('resistor', { r: 1000 }, 0, -3, 0, 'R1');
  b.add('capacitor', { c: 1.6e-6, vmax: 50 }, 5, 0, 1, 'C1');
  b.add('ground', {}, 0, 4, 0, 'GND1');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'C1.1'); b.chain('C1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

// ---------- Geçici hal tanımları ----------
const RC_T = { stop: 0.5, dt: 2e-4 };
const RL_T = { stop: 0.006, dt: 2e-6 };
const AC_T = { stop: 0.05, dt: 2e-5 };

export const TEMEL: Lesson[] = [
  // =====================================================================
  {
    id: 'temel-01-voltaj-akim-toprak',
    track: 'temel',
    level: 'baslangic',
    title: 'Voltaj, akım ve toprak referansı',
    summary: 'Gerilimin iki nokta arasındaki fark, akımın ise yük akışı olduğunu; toprağın 0 V referansı olduğunu en basit devrede ölçerek öğrenin.',
    minutes: 10,
    objectives: [
      'Gerilimi (V) iki nokta arasındaki potansiyel farkı olarak tanımlamak.',
      'Akımı (A) birim zamanda geçen yük miktarı olarak yorumlamak ve kapalı bir çevrim gerektiğini açıklamak.',
      'Toprak (0 V referans) sembolünün neden gerekli olduğunu ve “düğüm gerilimi”nin nasıl okunduğunu göstermek.',
    ],
    theory: [
      { t: 'p', text: 'Gerilim, iki nokta arasındaki elektriksel potansiyel farkıdır; bir noktanın “tek başına” voltajı yoktur, daima bir referansa göre söylenir. Devrede bu referansı toprak sembolü belirler ve 0 V kabul edilir. Simülatör de her devrede en az bir toprak ister.' },
      { t: 'p', text: 'Akım, bir kesitten birim zamanda geçen yük miktarıdır: 1 A = saniyede 1 coulomb. Akımın akabilmesi için kaynağın artı ucundan başlayıp eksi ucuna dönen kapalı bir yol gerekir. Yol herhangi bir yerde kesilirse (açık devre) akım her yerde sıfır olur.' },
      { t: 'formula', text: 'I = Q / t', note: 'I: akım (A), Q: yük (C), t: süre (s)' },
      { t: 'formula', text: 'V_AB = V_A − V_B', note: 'Gerilim, iki düğüm geriliminin farkıdır; toprağa göre ölçülen değerler “düğüm gerilimi” olur.' },
      { t: 'warn', text: 'Akım ölçerken devreyi açıp ölçü aletini seriye, gerilim ölçerken iki noktaya paralele bağlarsınız. Karıştırmak (gerçek hayatta ampermetreyi paralele bağlamak) kısa devre yaratır.' },
    ],
    calc: [
      { title: 'Düğüm gerilimleri', formula: 'V_düğüm = V_nokta − V_toprak', working: 'Kaynağın artı ucu 5 V, toprak 0 V. R1’in üst ucu 5 V, alt ucu 0 V; R1 üzerindeki gerilim 5 − 0 = 5 V.' },
      { title: 'Devre akımı', formula: 'I = V / R (Ohm kanunu ön izleme)', working: 'I = 5 V / 1000 Ω = 0,005 A = 5 mA' },
    ],
    build: loop1,
    steps: [
      'Devre yüklenince “Çalıştır” (veya “DC çöz”) düğmesine basın; tüm düğüm gerilimleri hesaplanır.',
      'V1’in artı ucundaki (R1.1) düğüm gerilimine bakın: 5 V olmalı. R1’in alt ucundaki (toprağa bağlı) düğüm 0 V’tur.',
      'R1’i seçip Inspector’da akımını ve uçları arasındaki gerilimi okuyun: 5 V ve 5 mA.',
      '3D sahnede R1’e çift tıklayarak parçayı yakından inceleyin; ardından V1’in gerilimini 9 V yapıp akımın 9 mA olduğunu görün.',
      'Toprak sembolünü silmeyi deneyin: referans olmadığı için çözüm uyarı verir. Geri ekleyin.',
    ],
    expects: [
      { label: 'Kaynağa bağlı uçta düğüm gerilimi', probe: { q: 'node', comp: 'R1', pin: '1' }, value: 5, unit: 'V', tol: { rel: 0.01 } },
      { label: 'Toprağa bağlı uçta düğüm gerilimi', probe: { q: 'node', comp: 'R1', pin: '2' }, value: 0, unit: 'V', tol: { abs: 1e-3 } },
      { label: 'R1 üzerindeki gerilim', probe: { q: 'v', comp: 'R1' }, value: 5, unit: 'V', tol: { rel: 0.01 } },
      { label: 'Devre akımı', probe: { q: 'i', comp: 'R1' }, value: 0.005, unit: 'A', tol: { rel: 0.02 } },
    ],
    mistakes: [
      'Toprak koymayı unutmak: referans yoksa gerilimler anlamsızdır ve simülasyon çözülemez.',
      '“Gerilim akar” demek: akan şey akımdır; gerilim iki nokta arasındaki farktır.',
      'Gerilimi tek bir noktaya ait sanmak: her ölçüm bir referansa (çoğunlukla toprak) göredir.',
    ],
    faults: [
      { title: 'Açık devre', how: 'R1’yi seçin → Arıza laboratuvarı → Açık devre', symptom: 'Çevrim kopar: R1 akımı 0 A olur. Direncin iki ucu arasındaki gerilim ise kaynak gerilimine (≈5 V) eşit kalır, çünkü tüm gerilim açıklığa düşer.' },
      { title: 'Kısa devre', how: 'R1’yi seçin → Arıza laboratuvarı → Kısa devre', symptom: 'R1 ~1 mΩ olur: akım yüzlerce amperlik değere fırlar (kaynak akım limiti aşım uyarısı verir) ve R1 uçları arasında gerilim neredeyse 0 V olur.' },
    ],
    quiz: [
      { id: 'q1', q: 'Toprak (0 V referans) neden gereklidir?', options: ['Gerilimler bir referansa göre tanımlanır', 'Akımı artırmak için', 'Kaynağı korumak için', 'Direnci soğutmak için'], answer: 0, explain: 'Gerilim iki nokta arasındaki farktır; ortak bir referans seçilmezse düğüm gerilimlerinden söz edilemez.' },
      { id: 'q2', q: 'Devrede R1’in üst ucundaki düğüm gerilimi kaç volttur?', answer: 5, unit: 'V', tol: 0.02, explain: 'Üst uç doğrudan V1’in artı ucuna bağlıdır; toprak 0 V olduğundan düğüm gerilimi 5 V’tur.', verify: { probe: { q: 'node', comp: 'R1', pin: '1' } } },
      { id: 'q3', q: 'R1 üzerinden geçen akım kaç amperdir? (A cinsinden yazın)', answer: 0.005, unit: 'A', tol: 0.03, explain: 'I = V/R = 5 V / 1000 Ω = 0,005 A (5 mA).', verify: { probe: { q: 'i', comp: 'R1' } } },
      { id: 'q4', q: 'Kapalı çevrim kesilirse (R1 açık devre) akıma ne olur?', options: ['Her yerde sıfır olur', 'Kaynak tarafında artar', 'Yalnızca R1’de sıfır olur', 'Değişmez'], answer: 0, explain: 'Seri tek bir yol vardır; yol kopunca akım devrenin her noktasında sıfırdır.' },
    ],
  },

  // =====================================================================
  {
    id: 'temel-02-ohm',
    track: 'temel',
    level: 'baslangic',
    title: 'Ohm kanunu: V = I·R',
    summary: 'Aynı gerilim altında üç farklı direncin farklı akım çektiğini ölçün; V, I ve R arasındaki ilişkiyi ve doğrusal yapıyı görün.',
    minutes: 12,
    prerequisites: ['temel-01-voltaj-akim-toprak'],
    objectives: [
      'Ohm kanunuyla V, I ve R’den herhangi birini diğer ikisinden hesaplamak.',
      'Sabit gerilimde akımın dirençle ters orantılı olduğunu ölçümle doğrulamak.',
      'Birimleri (V, A, Ω ve kΩ/mA önekleri) doğru dönüştürmek.',
    ],
    theory: [
      { t: 'p', text: 'Ohmik bir iletkende (direnç) uçları arasındaki gerilim, içinden geçen akımla doğru orantılıdır; orantı sabiti direnç değeridir. Gerilim sabitken direnç büyürse akım küçülür.' },
      { t: 'formula', text: 'V = I · R', note: 'I = V / R,  R = V / I' },
      { t: 'p', text: 'Aynı kaynağa bağlı üç kolun her birinin üzerinde tam kaynak gerilimi bulunur; akımlar ise dirençlerle ters orantılı olarak ayrılır. Bu laboratuvar devresi tam olarak bunu gösterir.' },
      { t: 'warn', text: 'Ohm kanunu yalnızca direnç gibi doğrusal elemanlar içindir. Diyot ve LED gibi elemanlarda akım gerilimle doğrusal artmaz; “R = V/I” orada yalnızca o çalışma noktasındaki anlık oranı verir.' },
    ],
    calc: [
      { title: 'Üç kolun akımı', formula: 'I = V / R', working: 'I1 = 12 / 1000 = 12 mA;  I2 = 12 / 2200 ≈ 5,45 mA;  I3 = 12 / 4700 ≈ 2,55 mA' },
      { title: 'Direnç iki katına çıkarsa', formula: 'I ∝ 1 / R', working: 'R1 = 1 kΩ → 2 kΩ olursa akım 12 mA’den 6 mA’e yarıya düşer.' },
    ],
    build: ohm3,
    steps: [
      '“Çalıştır”a basın. R1, R2, R3 üzerindeki gerilimin hepsinin 12 V olduğunu Inspector’dan doğrulayın.',
      'Her direncin akımını okuyun ve I·R çarpımının 12 V’a eşit olduğunu hesaplayın (ör. 5,45 mA × 2,2 kΩ).',
      'R1’in değerini Inspector’dan 2000 Ω yapın; akımın 6 mA’e düştüğünü görün. Eski değere (1000 Ω) döndürün.',
      'V1 gerilimini 24 V yapın: tüm akımlar ikiye katlanır (doğrusal ilişki). Tekrar 12 V yapın.',
      'Aşağıdaki “Meydan okuma”yı deneyin: 10 V ile ~5 mA akıtan direnci seçin.',
    ],
    expects: [
      { label: 'R1 akımı (1 kΩ)', probe: { q: 'i', comp: 'R1' }, value: 0.012, unit: 'A', tol: { rel: 0.02 } },
      { label: 'R2 akımı (2,2 kΩ)', probe: { q: 'i', comp: 'R2' }, value: 12 / 2200, unit: 'A', tol: { rel: 0.02 } },
      { label: 'R3 akımı (4,7 kΩ)', probe: { q: 'i', comp: 'R3' }, value: 12 / 4700, unit: 'A', tol: { rel: 0.02 } },
      { label: 'R3 üzerindeki gerilim', probe: { q: 'v', comp: 'R3' }, value: 12, unit: 'V', tol: { rel: 0.01 } },
    ],
    mistakes: [
      'kΩ değerini Ω gibi hesaba katmak (1 kΩ = 1000 Ω): akımı 1000 kat yanlış bulursunuz.',
      'Akımı mA, gerilimi V, direnci kΩ yazıp birimleri karıştırmak. V/kΩ = mA birleşimi pratik bir kısayoldur.',
      'Direnç büyüdükçe akımın da büyüdüğünü sanmak: gerilim sabitken ters orantılıdır.',
    ],
    faults: [
      { title: 'Değer kayması', how: 'R2’yi seçin → Arıza laboratuvarı → Değer kayması (%) → 100', symptom: 'R2 iki katına (4,4 kΩ) çıkar; R2 akımı 5,45 mA’den ≈2,73 mA’e düşer, R1 ve R3 etkilenmez.' },
      { title: 'Açık devre', how: 'R3’ü seçin → Arıza laboratuvarı → Açık devre', symptom: 'R3 akımı 0 A olur; R1 ve R2 aynı kalır çünkü kaynak gerilimi hâlâ 12 V’tur.' },
    ],
    quiz: [
      { id: 'q1', q: 'Gerilim sabitken direnç iki katına çıkarsa akım ne olur?', options: ['Yarıya düşer', 'İki katına çıkar', 'Aynı kalır', 'Dört katına çıkar'], answer: 0, explain: 'I = V/R; R iki katına çıkınca I yarıya iner.' },
      { id: 'q2', q: 'R2 (2,2 kΩ) üzerinden geçen akım kaç amperdir?', answer: 12 / 2200, unit: 'A', tol: 0.02, explain: 'I = 12 V / 2200 Ω ≈ 5,45 mA = 0,00545 A.', verify: { probe: { q: 'i', comp: 'R2' } } },
      { id: 'q3', q: '9 V’luk bir pil 450 Ω’luk dirençten kaç amper akıtır?', answer: 0.02, unit: 'A', tol: 0.02, explain: 'I = 9 / 450 = 0,02 A = 20 mA.' },
      { id: 'q4', q: 'Bir dirençten 2 mA geçerken uçları arasında 6 V ölçülüyor. Direnç kaç kΩ’dur?', options: ['3 kΩ', '12 kΩ', '0,33 kΩ', '8 kΩ'], answer: 0, explain: 'R = V/I = 6 V / 2 mA = 3 kΩ.' },
    ],
    challenge: {
      id: 'c1',
      title: '5 mA akıtan direnç',
      goal: '10 V’luk kaynakla tek bir dirençten yaklaşık 5 mA akıtın (4,5–5,5 mA).',
      hints: ['R = V / I formülünü kullanın.', '10 V / 5 mA = ?', 'Direnç değerini Inspector’dan 2000 Ω yapın.'],
      start: () => ohmChallenge(220),
      solution: () => ohmChallenge(2000),
      checks: [
        { label: 'R1 akımı 4,5–5,5 mA', probe: { q: 'i', comp: 'R1' }, min: 0.0045, max: 0.0055, unit: 'A' },
      ],
    },
  },

  // =====================================================================
  {
    id: 'temel-03-guc-anma',
    track: 'temel',
    level: 'baslangic',
    title: 'Güç ve direnç anma gücü',
    summary: 'P = V·I = I²R = V²/R ilişkisini ölçün; direncin anma gücünün (pmax) aşılmasının ne anlama geldiğini görün.',
    minutes: 12,
    prerequisites: ['temel-02-ohm'],
    objectives: [
      'Elektriksel gücü üç eşdeğer formülle hesaplamak.',
      'Direncin bu gücü ısıya çevirdiğini ve anma gücünün (pmax) neden önemli olduğunu açıklamak.',
      'Anma gücü aşıldığında simülatörün verdiği uyarıyı yorumlamak.',
    ],
    theory: [
      { t: 'p', text: 'Direnç üzerinde harcanan elektriksel güç tamamen ısıya dönüşür. Güç, gerilim ile akımın çarpımıdır ve Ohm kanunuyla diğer iki biçimde yazılabilir.' },
      { t: 'formula', text: 'P = V · I = I² · R = V² / R', note: 'P: watt (W). 1 W = 1 V·A' },
      { t: 'p', text: 'Her direncin bir anma gücü (pmax) vardır; bu değerin üstünde sürekli çalıştırılırsa aşırı ısınır, değeri kayar ve sonunda yanar. Uygulamada yük gücünü anma gücünün kabaca yarısının altında tutmak iyi bir güvenlik payıdır.' },
      { t: 'warn', text: 'Güç gerilimin karesiyle artar: gerilim iki katına çıkarsa sabit dirençte güç dört katına çıkar. Küçük bir 0,25 W direnç 9 V’ta 100 Ω ile çalıştırılırsa 0,81 W ısıtır.' },
    ],
    calc: [
      { title: '1 kΩ direnç', formula: 'P = V² / R', working: 'P1 = 9² / 1000 = 81 / 1000 = 0,081 W (anmanın %32’si)' },
      { title: '330 Ω direnç', formula: 'P = V² / R', working: 'P2 = 81 / 330 ≈ 0,245 W (anmaya çok yakın, %98)' },
      { title: '100 Ω direnç', formula: 'P = V² / R', working: 'P3 = 81 / 100 = 0,81 W > 0,25 W: anma gücü yaklaşık 3,2 kat aşılıyor.' },
    ],
    build: power3,
    steps: [
      '“Çalıştır”a basın. R1, R2, R3’ün güçlerini Inspector’dan okuyun.',
      'Her direnç için P = V·I hesabını elle yapıp Inspector değeriyle karşılaştırın.',
      'R3’ün anma gücünün (0,25 W) aşıldığına dair uyarıyı arayın (Inspector / uyarı listesi) ve nedenini yorumlayın.',
      'R3’ü 330 Ω, ardından 1 kΩ yapın; güç düşer ve uyarı kaybolur. Sonra pmax’ı 1 W yaparak 100 Ω’un güvenli hale geldiğini görün.',
      'V1’i 18 V yapın: tüm güçlerin 4 katına çıktığını doğrulayın.',
    ],
    expects: [
      { label: 'R1 gücü (1 kΩ)', probe: { q: 'p', comp: 'R1' }, value: 0.081, unit: 'W', tol: { rel: 0.02 } },
      { label: 'R2 gücü (330 Ω)', probe: { q: 'p', comp: 'R2' }, value: 81 / 330, unit: 'W', tol: { rel: 0.02 } },
      { label: 'R3 gücü (100 Ω)', probe: { q: 'p', comp: 'R3' }, value: 0.81, unit: 'W', tol: { rel: 0.02 } },
    ],
    mistakes: [
      'Anma gücünü yalnızca direnç değerine bakarak seçmek: asıl belirleyici gerilim ve akımdır.',
      'P = V·I’yı I²R ile karıştırıp akım yerine gerilimi karelemek.',
      'Anma gücünün tam sınırında çalıştırmak: direnç ısınır, değeri kayar; her zaman pay bırakın.',
    ],
    faults: [
      { title: 'Değer kayması', how: 'R2’yi seçin → Arıza laboratuvarı → Değer kayması (%) → −50', symptom: 'R2 165 Ω’a düşer; gücü 0,245 W’tan ≈0,49 W’a çıkar ve 0,25 W’lık anma gücünü aşar.' },
      { title: 'Açık devre', how: 'R3’ü seçin → Arıza laboratuvarı → Açık devre', symptom: 'R3 gücü 0 W olur; devrenin toplam gücü 1,137 W’tan ≈0,33 W’a iner.' },
    ],
    quiz: [
      { id: 'q1', q: '20 mA akım geçen 100 Ω’luk dirençte kaç W güç harcanır?', options: ['0,04 W', '2 W', '0,2 W', '0,4 W'], answer: 0, explain: 'P = I²R = (0,02)² × 100 = 0,0004 × 100 = 0,04 W.' },
      { id: 'q2', q: 'R1 (1 kΩ) 9 V altında kaç watt güç harcar?', answer: 0.081, unit: 'W', tol: 0.02, explain: 'P = V²/R = 81 / 1000 = 0,081 W.', verify: { probe: { q: 'p', comp: 'R1' } } },
      { id: 'q3', q: 'Bu devrede hangi direnç 0,25 W anma gücünü aşıyor?', options: ['R3 (100 Ω)', 'R1 (1 kΩ)', 'R2 (330 Ω)', 'Hiçbiri'], answer: 0, explain: 'R3 0,81 W harcar; R2 0,245 W ile sınırda ama altında; R1 0,081 W ile güvenli.' },
      { id: 'q4', q: 'Gerilim iki katına çıkarsa sabit bir dirençte güç kaç kat artar?', options: ['4 kat', '2 kat', '8 kat', 'Değişmez'], answer: 0, explain: 'P = V²/R olduğundan gerilimin karesiyle artar: 2² = 4.' },
    ],
    safety: 'Gerçek hayatta anma gücü aşılan bir direnç çok ısınır, yanık kokusu çıkarır ve devre kartını yakabilir. Uyguladığınız gerçek gücü hesaplayın ve anma gücünün en az iki katı değerde direnç seçin.',
  },

  // =====================================================================
  {
    id: 'temel-04-seri-devre',
    track: 'temel',
    level: 'baslangic',
    title: 'Seri devre ve Kirchhoff gerilim kanunu',
    summary: 'Seri bağlı dirençlerde toplam direnci, ortak akımı, gerilim paylaşımını ve KVL’yi ölçüp doğrulayın.',
    minutes: 15,
    prerequisites: ['temel-02-ohm'],
    objectives: [
      'Seri bağlı dirençlerin toplam direncini hesaplamak.',
      'Seri devrede akımın her elemanda aynı olduğunu ve gerilimin dirençle orantılı paylaşıldığını göstermek.',
      'Kirchhoff gerilim kanununu (KVL) kapalı çevrimde uygulamak.',
    ],
    theory: [
      { t: 'p', text: 'Elemanlar uç uca eklenip tek bir yol oluşturuyorsa seridir. Tek yol olduğu için aynı akım hepsinden geçer; kaynak gerilimi ise dirençler arasında paylaşılır.' },
      { t: 'formula', text: 'R_top = R1 + R2 + R3', note: 'Seri direnç toplanır.' },
      { t: 'formula', text: 'ΣV = 0   (KVL)  ⇒  V_kaynak = V1 + V2 + V3', note: 'Kapalı çevrimde gerilim yükselmeleri ile düşüşleri toplamı sıfırdır.' },
      { t: 'formula', text: 'V_k = V · R_k / R_top', note: 'Gerilim paylaşımı: büyük direnç büyük gerilim düşümü alır.' },
      { t: 'warn', text: 'Seri devrede tek bir eleman açık devre olursa tüm çevrimde akım kesilir; bu yüzden eski seri ışık dizilerinde tek lamba bozulunca hepsi söner.' },
    ],
    calc: [
      { title: 'Toplam direnç', formula: 'R_top = R1 + R2 + R3', working: '1000 + 2200 + 4700 = 7900 Ω' },
      { title: 'Ortak akım', formula: 'I = V / R_top', working: 'I = 12 / 7900 ≈ 1,519 mA' },
      { title: 'Gerilim düşümleri', formula: 'V_k = I · R_k', working: 'V1 ≈ 1,52 V,  V2 ≈ 3,34 V,  V3 ≈ 7,14 V' },
      { title: 'KVL kontrolü', formula: 'V1 + V2 + V3 = V_kaynak', working: '1,519 + 3,342 + 7,139 = 12,0 V ✓' },
    ],
    build: () => series3(),
    steps: [
      '“Çalıştır”a basın. R1, R2, R3 akımlarının aynı olduğunu Inspector’dan doğrulayın (≈1,52 mA).',
      'Her direncin gerilim düşümünü okuyun ve toplamının 12 V olduğunu (KVL) kontrol edin.',
      'R1–R2 bağlantısındaki ve R2–R3 bağlantısındaki düğüm gerilimlerini okuyun: 10,48 V ve 7,14 V.',
      'R2’nin değerini 4400 Ω yapın; akımın düştüğünü, R2’nin gerilim payının arttığını izleyin. Eski değere dönün.',
      '“Meydan okuma” ve “Arıza avı”nı deneyin.',
    ],
    expects: [
      { label: 'Ortak (seri) akım', probe: { q: 'i', comp: 'R1' }, value: 12 / 7900, unit: 'A', tol: { rel: 0.02 } },
      { label: 'R2 gerilim düşümü', probe: { q: 'v', comp: 'R2' }, value: 12 * 2200 / 7900, unit: 'V', tol: { rel: 0.02 } },
      { label: 'R3 gerilim düşümü', probe: { q: 'v', comp: 'R3' }, value: 12 * 4700 / 7900, unit: 'V', tol: { rel: 0.02 } },
      { label: 'R1–R2 düğümü', probe: { q: 'node', comp: 'R2', pin: '1' }, value: 12 - 12 * 1000 / 7900, unit: 'V', tol: { rel: 0.02 } },
    ],
    mistakes: [
      'Seri dirençlerin gerilimini eşit sanmak: gerilim dirençle orantılı paylaşılır, akım eşittir.',
      'Toplam direnç yerine tek direnç değerini kullanarak akımı hesaplamak.',
      'KVL’de işaretleri unutmak: kaynak yükselmesi, dirençler düşüştür.',
    ],
    faults: [
      { title: 'Açık devre', how: 'R2’yi seçin → Arıza laboratuvarı → Açık devre', symptom: 'Tüm akımlar 0 A olur. Kaynak gerilimi açıklığa düşer: R2 uçları arasında ≈12 V ölçülür, R1 ve R3 üzerinde 0 V kalır.' },
      { title: 'Kısa devre', how: 'R3’ü seçin → Arıza laboratuvarı → Kısa devre', symptom: 'R3 üzerindeki gerilim ≈0 V olur; toplam direnç 3,2 kΩ’a düşer ve akım 1,52 mA’den ≈3,75 mA’e çıkar.' },
    ],
    quiz: [
      { id: 'q1', q: 'Seri devrede hangi büyüklük tüm elemanlarda aynıdır?', options: ['Akım', 'Gerilim', 'Güç', 'Direnç'], answer: 0, explain: 'Tek yol olduğundan aynı akım her elemandan geçer.' },
      { id: 'q2', q: 'R2 üzerindeki gerilim düşümü kaç volttur?', answer: 12 * 2200 / 7900, unit: 'V', tol: 0.02, explain: 'V2 = I·R2 = (12/7900) × 2200 ≈ 3,34 V.', verify: { probe: { q: 'v', comp: 'R2' } } },
      { id: 'q3', q: 'Toplam direnç kaç ohmdur?', answer: 7900, unit: 'Ω', tol: 0.01, explain: 'Seri dirençler toplanır: 1000 + 2200 + 4700 = 7900 Ω.' },
      { id: 'q4', q: 'KVL’ye göre V1 + V2 + V3 toplamı neye eşittir?', options: ['Kaynak gerilimine (12 V)', 'Sıfıra', 'Akıma', 'En büyük dirençteki gerilime'], answer: 0, explain: 'Kapalı çevrimde kaynak yükselmesi dirençlerdeki düşüşlerin toplamına eşittir.' },
      { id: 'q5', q: 'R3 üzerindeki gerilim kaç volttur?', answer: 12 * 4700 / 7900, unit: 'V', tol: 0.02, explain: 'V3 = 12 × 4700 / 7900 ≈ 7,14 V; en büyük direnç en büyük gerilimi alır.', verify: { probe: { q: 'v', comp: 'R3' } } },
    ],
    challenge: {
      id: 'c1',
      title: '2 mA akım, R2 üzerinde 4 V',
      goal: '12 V’luk seri devrede toplam akımı yaklaşık 2 mA, R2’nin gerilimini yaklaşık 4 V yapacak değerleri seçin.',
      hints: ['Toplam direnç R_top = 12 V / 2 mA = 6 kΩ olmalı.', 'R2 = 4 V / 2 mA = 2 kΩ.', 'R1 + R3 toplamı 4 kΩ olmalı, örneğin 1 kΩ + 3 kΩ.'],
      start: () => series3(1000, 1000, 1000),
      solution: () => series3(1000, 2000, 3000),
      checks: [
        { label: 'Akım 1,9–2,1 mA', probe: { q: 'i', comp: 'R1' }, min: 0.0019, max: 0.0021, unit: 'A' },
        { label: 'R2 gerilimi 3,8–4,2 V', probe: { q: 'v', comp: 'R2' }, min: 3.8, max: 4.2, unit: 'V' },
      ],
    },
    faultHunt: {
      id: 'fh1',
      title: 'Seride fazla akım',
      symptom: '12 V’luk 1 kΩ + 2,2 kΩ + 4,7 kΩ seri devrede akım 1,52 mA olmalı, ama ölçülen çok yüksek. Hangi direnç arızalı?',
      circuit: () => series3(),
      hidden: { R3: { kind: 'short' } },
      hints: ['Seri devrede akım, bir direnç “devre dışı” kalınca artar.', 'Hangi direncin uçları arasında gerilim neredeyse yok?', 'Üç direncin gerilimlerini tek tek ölçün.'],
      answer: { comp: 'R3', kind: 'short' },
      explain: 'R3 kısa devre olunca toplam direnç 3,2 kΩ’a iner, akım 12/3200 ≈ 3,75 mA olur ve R3’ün uçlarında ≈0 V ölçülür. Kısa devre en çok bu semptomla bulunur: bir elemanda gerilim yok, akım beklenenden fazla.',
      telltale: { q: 'i', comp: 'R1' },
    },
  },

  // =====================================================================
  {
    id: 'temel-05-paralel-devre',
    track: 'temel',
    level: 'baslangic',
    title: 'Paralel devre ve Kirchhoff akım kanunu',
    summary: 'Paralel kollarda eşdeğer direnci, ortak gerilimi, akım paylaşımını ve KCL’yi ölçerek öğrenin.',
    minutes: 15,
    prerequisites: ['temel-04-seri-devre'],
    objectives: [
      'Paralel bağlı dirençlerin eşdeğer direncini hesaplamak.',
      'Her kolda aynı gerilimin bulunduğunu ve akımın kollara ters orantılı paylaşıldığını göstermek.',
      'Kirchhoff akım kanununu (KCL) bir düğümde uygulamak.',
    ],
    theory: [
      { t: 'p', text: 'Elemanların her iki ucu aynı iki düğüme bağlıysa paraleldir. Her kolda aynı gerilim vardır; kaynaktan çekilen toplam akım kolların akımlarının toplamıdır.' },
      { t: 'formula', text: '1 / R_eş = 1/R1 + 1/R2 + 1/R3', note: 'Eşdeğer direnç, en küçük koldan da küçüktür.' },
      { t: 'formula', text: 'ΣI_giren = ΣI_çıkan   (KCL)', note: 'Bir düğüme giren akımlar toplamı çıkanlara eşittir: I_top = I1 + I2 + I3.' },
      { t: 'warn', text: 'Paralele kol ekledikçe toplam direnç düşer ve kaynaktan çekilen akım artar. Fazla kol eklemek kaynağı veya kabloyu aşırı yükleyebilir.' },
    ],
    calc: [
      { title: 'Eşdeğer direnç', formula: '1/R_eş = 1/R1 + 1/R2 + 1/R3', working: '1/1000 + 1/2000 + 1/2000 = 0,002 S ⇒ R_eş = 500 Ω' },
      { title: 'Toplam akım', formula: 'I = V / R_eş', working: 'I = 10 / 500 = 20 mA' },
      { title: 'Kol akımları ve KCL', formula: 'I_k = V / R_k', working: 'I1 = 10 mA, I2 = 5 mA, I3 = 5 mA; 10 + 5 + 5 = 20 mA ✓' },
    ],
    build: () => parallel3(),
    steps: [
      '“Çalıştır”a basın ve her direncin üzerindeki gerilimin 10 V olduğunu görün.',
      'Kol akımlarını okuyun: 10, 5 ve 5 mA. Toplamı 20 mA’dir; bu kaynak akımıdır (V1).',
      'R3’ü silmek yerine Arıza laboratuvarı ile açık devre yapın; kaynak akımının 15 mA’e düştüğünü, R1 ve R2’nin değişmediğini gözleyin.',
      'R2’yi 1 kΩ yapın: R_eş değişir; yeni toplam akımı önce hesaplayıp sonra ölçün.',
      '“Meydan okuma”yı çözün.',
    ],
    expects: [
      { label: 'R1 kol akımı', probe: { q: 'i', comp: 'R1' }, value: 0.01, unit: 'A', tol: { rel: 0.02 } },
      { label: 'R2 kol akımı', probe: { q: 'i', comp: 'R2' }, value: 0.005, unit: 'A', tol: { rel: 0.02 } },
      { label: 'R3 kol akımı', probe: { q: 'i', comp: 'R3' }, value: 0.005, unit: 'A', tol: { rel: 0.02 } },
      { label: 'Kaynak akımı (KCL toplamı)', probe: { q: 'i', comp: 'V1' }, value: 0.02, unit: 'A', tol: { rel: 0.02 } },
    ],
    mistakes: [
      'Paralel dirençleri seri gibi toplamak: eşdeğer direnç her zaman en küçük dirençten küçüktür.',
      '1/R_eş hesabında tersini almayı unutmak (0,002 S ≠ 0,002 Ω).',
      'Paralelde gerilimin paylaşıldığını sanmak: gerilim aynıdır, akım paylaşılır.',
    ],
    faults: [
      { title: 'Açık devre', how: 'R3’ü seçin → Arıza laboratuvarı → Açık devre', symptom: 'R3 akımı 0 A; kaynak akımı 20 mA’den 15 mA’e düşer, R1 ve R2 kolları aynı kalır.' },
      { title: 'Kısa devre', how: 'R2’yi seçin → Arıza laboratuvarı → Kısa devre', symptom: 'Kaynak neredeyse kısa devre olur: akım çok büyür, uyarı oluşur ve diğer kollarda da gerilim çöker/aşım uyarısı çıkar.' },
    ],
    quiz: [
      { id: 'q1', q: 'Paralel devrede hangi büyüklük tüm kollarda aynıdır?', options: ['Gerilim', 'Akım', 'Direnç', 'Güç'], answer: 0, explain: 'Tüm kolların uçları aynı iki düğüme bağlıdır; aynı gerilim uygulanır.' },
      { id: 'q2', q: 'R3 koluna kaç amper akım düşer?', answer: 0.005, unit: 'A', tol: 0.02, explain: 'I3 = 10 V / 2000 Ω = 5 mA = 0,005 A.', verify: { probe: { q: 'i', comp: 'R3' } } },
      { id: 'q3', q: '1 kΩ ve 1 kΩ paralel bağlanırsa eşdeğer direnç kaç ohmdur?', options: ['500 Ω', '2000 Ω', '1000 Ω', '250 Ω'], answer: 0, explain: 'Eşit iki direnç paralelde yarıya iner: (1000×1000)/(1000+1000) = 500 Ω.' },
      { id: 'q4', q: 'Bu devrenin eşdeğer direnci kaç ohmdur?', answer: 500, unit: 'Ω', tol: 0.01, explain: '1/R = 1/1000 + 1/2000 + 1/2000 = 0,002 S ⇒ R = 500 Ω.' },
      { id: 'q5', q: 'KCL’ye göre kaynak akımı kol akımlarıyla nasıl ilişkilidir?', options: ['Kol akımlarının toplamına eşittir', 'Kol akımlarının farkına eşittir', 'En büyük kol akımına eşittir', 'Sıfırdır'], answer: 0, explain: 'Düğüme giren akım, çıkan akımların toplamına eşittir: I = I1 + I2 + I3.' },
    ],
    challenge: {
      id: 'c1',
      title: '40 mA toplam akım',
      goal: '10 V’luk kaynaktan yaklaşık 40 mA çeken iki paralel direnç düzenleyin (37–43 mA).',
      hints: ['Gereken eşdeğer direnç R_eş = 10 V / 40 mA = 250 Ω.', 'İki eşit direnç paralelde yarıya iner.', 'R1 ve R2’yi 500 Ω yapın.'],
      start: () => parallel3(1000, 1000, null),
      solution: () => parallel3(500, 500, null),
      checks: [
        { label: 'Kaynak akımı 37–43 mA', probe: { q: 'i', comp: 'V1' }, min: 0.037, max: 0.043, unit: 'A' },
      ],
    },
  },

  // =====================================================================
  {
    id: 'temel-06-bolucu',
    track: 'temel',
    level: 'baslangic',
    title: 'Gerilim bölücü ve yük etkisi',
    summary: 'İki dirençle girişten istenen gerilimi türetin; çıkışa bir yük bağlanınca gerilimin neden düştüğünü ölçün.',
    minutes: 18,
    prerequisites: ['temel-04-seri-devre', 'temel-05-paralel-devre'],
    objectives: [
      'Gerilim bölücü formülüyle çıkış gerilimini hesaplamak.',
      'Bir hedef gerilim için R1 ve R2 oranını seçmek.',
      'Çıkışa bağlanan yükün çıkış gerilimini düşürdüğünü hesaplayıp ölçmek.',
    ],
    theory: [
      { t: 'p', text: 'İki seri direncin ortak düğümünden çıkış alınırsa, giriş gerilimi dirençlerin oranında bölünür. Sensör okuma, referans üretme ve seviye uydurma gibi işlerde çok kullanılır.' },
      { t: 'formula', text: 'V_out = V_in · R2 / (R1 + R2)', note: 'R1 üstte (girişe), R2 altta (toprağa) bağlıdır.' },
      { t: 'p', text: 'Bu formül çıkışa hiçbir şey bağlı değilken doğrudur. Bir yük direnci R_L bağlanırsa R2 ile paralel olur ve alt kol küçülür; çıkış gerilimi düşer.' },
      { t: 'formula', text: 'V_out(yüklü) = V_in · (R2 ∥ R_L) / (R1 + R2 ∥ R_L)', note: 'R2 ∥ R_L = R2·R_L / (R2 + R_L)' },
      { t: 'warn', text: 'Gerilim bölücü bir güç kaynağı değildir. Yük akımı bölücü akımına yaklaşırsa çıkış ciddi çöker; yük direnci R2’nin en az 10 katı olmalıdır ya da bölücü yerine regülatör kullanılmalıdır.' },
    ],
    calc: [
      { title: 'Yüksüz çıkış', formula: 'V_out = V_in · R2 / (R1 + R2)', working: '10 · 2000 / (1000 + 2000) = 6,667 V' },
      { title: 'Bölücü akımı', formula: 'I = V_in / (R1 + R2)', working: '10 / 3000 = 3,33 mA' },
      { title: '2 kΩ yük bağlanınca', formula: 'R2 ∥ R_L = R2·R_L/(R2+R_L)', working: '2000·2000/4000 = 1000 Ω; V_out = 10 · 1000/(1000 + 1000) = 5,00 V' },
    ],
    build: divider,
    steps: [
      '“Çalıştır”a basın. SW1 açıkken R1–R2 ortak düğüm gerilimi 6,67 V olmalıdır.',
      'R1 ve R2 akımlarının eşit (3,33 mA) olduğunu görün; yük kolundan akım geçmiyor.',
      '3D sahnede SW1’e çift tıklayarak kapatın (veya Inspector’dan “Kapalı”): 2 kΩ yük devreye girer, çıkış gerilimi 5,0 V’a düşer.',
      'RL’yi 20 kΩ yapın: çıkış ≈6,5 V’a yaklaşır (hafif yük, az çökme). RL’yi 200 Ω yapın: çıkış 1,5 V’un altına çöker.',
      '“Meydan okuma” ve “Arıza avı”nı çözün.',
    ],
    expects: [
      { label: 'Yüksüz çıkış gerilimi', probe: { q: 'node', comp: 'R2', pin: '1' }, value: 20 / 3, unit: 'V', tol: { rel: 0.01 } },
      { label: 'R1 akımı (bölücü akımı)', probe: { q: 'i', comp: 'R1' }, value: 0.010 / 3, unit: 'A', tol: { rel: 0.02 } },
      { label: 'R1 gerilim düşümü', probe: { q: 'v', comp: 'R1' }, value: 10 / 3, unit: 'V', tol: { rel: 0.02 } },
    ],
    mistakes: [
      'Yükün çıkışı çökerttiğini hesaba katmamak: formül yalnızca yüksüz durum içindir.',
      'R1 ve R2’yi formülde ters koymak: çıkış toprağa bağlı direncin (R2) oranıdır.',
      'Çok küçük dirençler seçip gereksiz akım ve ısı üretmek; ya da çok büyük seçip yükten dolayı kararsız çıkış almak.',
    ],
    faults: [
      { title: 'Alt direnç açık', how: 'R2’yi seçin → Arıza laboratuvarı → Açık devre', symptom: 'Çıkış girişe yükselir: ortak düğüm ≈10 V olur (yük yoksa), bölücü akımı 0 A’e düşer.' },
      { title: 'Üst direnç açık', how: 'R1’i seçin → Arıza laboratuvarı → Açık devre', symptom: 'Çıkış 0 V’a düşer: R2 toprağa çeker ve hiçbir akım sağlanmaz.' },
    ],
    quiz: [
      { id: 'q1', q: 'R1 = 1 kΩ, R2 = 2 kΩ ve girişi 10 V olan yüksüz bölücünün çıkışı kaç volttur?', answer: 20 / 3, unit: 'V', tol: 0.02, explain: 'V_out = 10 × 2000/3000 ≈ 6,67 V.', verify: { probe: { q: 'node', comp: 'R2', pin: '1' } } },
      { id: 'q2', q: 'Çıkışa yük bağlanınca çıkış gerilimi genellikle ne olur?', options: ['Düşer', 'Yükselir', 'Aynı kalır', 'Sıfırlanır'], answer: 0, explain: 'Yük R2 ile paralel olur ve alt kolun direncini düşürür; çıkış gerilimi azalır.' },
      { id: 'q3', q: 'Yük (2 kΩ) bağlanınca çıkış kaç volt olur?', answer: 5, unit: 'V', tol: 0.02, explain: 'R2 ∥ RL = 1 kΩ; V_out = 10 · 1000/(1000+1000) = 5 V.' },
      { id: 'q4', q: '5 V girişten 2,5 V üretmek için R1 ve R2 nasıl olmalı?', options: ['R1 = R2', 'R1 = 2·R2', 'R2 = 2·R1', 'R2 = 0'], answer: 0, explain: 'V_out = V_in·R2/(R1+R2) = V_in/2 olması için R1 = R2 olmalıdır.' },
    ],
    challenge: {
      id: 'c1',
      title: '5 V’tan 3,3 V üret',
      goal: 'Gerilim bölücüyü 5 V girişten yaklaşık 3,3 V (3,2–3,4 V) çıkış verecek şekilde düzenleyin; bölücü akımı 5 mA’i geçmesin.',
      hints: ['V_out/V_in = R2/(R1+R2) = 3,3/5 = 0,66.', 'R2 = 1 kΩ seçerseniz R1 yaklaşık 515 Ω olmalı.', 'Standart değerlerden R1 = 510 Ω, R2 = 1 kΩ deneyin.'],
      start: () => dividerChallenge(1000, 1000),
      solution: () => dividerChallenge(510, 1000),
      checks: [
        { label: 'Çıkış 3,2–3,4 V', probe: { q: 'node', comp: 'R2', pin: '1' }, min: 3.2, max: 3.4, unit: 'V' },
        { label: 'Bölücü akımı ≤ 5 mA', probe: { q: 'i', comp: 'R1' }, max: 0.005, unit: 'A' },
      ],
    },
    faultHunt: {
      id: 'fh1',
      title: 'Çıkış girişe eşit',
      symptom: '10 V’luk 1 kΩ / 2 kΩ bölücünün çıkışı 6,67 V olmalı, fakat ölçülen değer girişe (≈10 V) yakın. Arızalı direnci bulun.',
      circuit: dividerPlain,
      hidden: { R2: { kind: 'open' } },
      hints: ['Çıkış girişe eşitse alt kolda akım yok demektir.', 'Bölücü akımını ölçün: 0 A mı?', 'Çıkışı toprağa bağlayan direnç hangisi?'],
      answer: { comp: 'R2', kind: 'open' },
      explain: 'R2 açık devre olunca çıkış düğümü toprağa bağlanamaz ve R1 üzerinden girişe çekilir; akım 0 A olduğu için R1’de gerilim düşümü yoktur ve çıkış ≈10 V olur.',
      telltale: { q: 'node', comp: 'R2', pin: '1' },
    },
  },

  // =====================================================================
  {
    id: 'temel-07-potansiyometre',
    track: 'temel',
    level: 'baslangic',
    title: 'Potansiyometre: ayarlı gerilim bölücü',
    summary: 'Potansiyometrenin A–W–B uçlarını ve konumuna göre W geriliminin nasıl değiştiğini; yükleme etkisini inceleyin.',
    minutes: 15,
    prerequisites: ['temel-06-bolucu'],
    objectives: [
      'Potansiyometreyi iki dirençten oluşan ayarlı bir gerilim bölücü olarak modellemek.',
      'Wiper (W) gerilimini konumdan hesaplamak.',
      'Hafif bir yükün W gerilimini nasıl etkilediğini görmek.',
    ],
    theory: [
      { t: 'p', text: 'Potansiyometre üç uçlu bir dirençtir: A ve B dirençli elemanın uçlarıdır, W (wiper, orta uç) elemanın üzerinde kayan temaştır. W’nin konumu elemanı iki direnç parçasına böler: A–W ve W–B.' },
      { t: 'p', text: 'Bu simülatörde “konum” (pos) A’dan W’ye olan kesirdir (0…1). A uç gerilimin üst ucuna, B toprağa bağlıysa W gerilimi aşağıdaki gibidir.' },
      { t: 'formula', text: 'R_AW = pos · R,   R_WB = (1 − pos) · R', note: 'R: potun toplam direnci.' },
      { t: 'formula', text: 'V_W = V_üst · (1 − pos)   (yüksüz)', note: 'pos = 0 iken W, A ucundadır (V_üst); pos = 1 iken B ucundadır (0 V).' },
      { t: 'warn', text: 'W ucuna bağlanan yük, W–B parçasıyla paralel olur ve çıkışı düşürür. Yük direnci pot direncinin en az 10 katı olmalıdır; bu devrede 100 kΩ yük, 10 kΩ pot için “hafif” sayılır.' },
    ],
    calc: [
      { title: 'Parça dirençleri (pos = 0,3)', formula: 'R_AW = pos·R,  R_WB = (1−pos)·R', working: 'R_AW = 3 kΩ,  R_WB = 7 kΩ' },
      { title: 'Yüksüz W gerilimi', formula: 'V_W = V·(1−pos)', working: '5 · 0,7 = 3,50 V' },
      { title: '100 kΩ yükle', formula: 'R_WB ∥ R_L = 7k·100k/(107k) ≈ 6,542 kΩ', working: 'V_W = 5 · 6,542 / (3 + 6,542) ≈ 3,43 V (yüksüze göre ≈%2 düşük)' },
    ],
    build: () => potCircuit(),
    steps: [
      '“Çalıştır”a basın. W ucundaki gerilim ≈3,43 V olmalıdır.',
      'RV1’i seçip konum (pos) değerini 0, 0,5 ve 1 yapın; W gerilimi sırasıyla ≈5 V, ≈2,5 V ve ≈0 V olur.',
      'Konum 0,3 iken R1 yük direncini 10 kΩ’a düşürün; W geriliminin 3,5 V’tan belirgin biçimde sapmasını gözlemleyin. 100 kΩ’a geri döndürün.',
      'Pot toplam direncini 1 kΩ yapıp pot akımının 10 kat arttığını görün: aynı gerilim, çok daha fazla ısınma.',
      '“Meydan okuma”yı çözün.',
    ],
    expects: [
      { label: 'W gerilimi (pos = 0,3, 100 kΩ yük)', probe: { q: 'node', comp: 'RV1', pin: 'W' }, value: 3.428, unit: 'V', tol: { rel: 0.01 } },
      { label: 'Pot üst ucu (A) gerilimi', probe: { q: 'node', comp: 'RV1', pin: 'A' }, value: 5, unit: 'V', tol: { rel: 0.01 } },
      { label: 'Pot alt ucu (B) gerilimi', probe: { q: 'node', comp: 'RV1', pin: 'B' }, value: 0, unit: 'V', tol: { abs: 1e-3 } },
    ],
    mistakes: [
      'A ve B uçlarını gerilim kaynağına, W’yi çıkışa bağlamak yerine W’yi kaynağa bağlamak.',
      'Yükü hesaba katmamak: W ucu yüksüz değilse gerilim formülden küçük çıkar.',
      'Çok düşük dirençli pot seçip gereksiz akım çekmek.',
    ],
    faults: [
      { title: 'Yük kısa devre', how: 'R1’i seçin → Arıza laboratuvarı → Kısa devre', symptom: 'W ucu toprağa çekilir: W gerilimi ≈0 V olur, pot A–W parçasından fazladan akım geçer.' },
      { title: 'Pot değer kayması', how: 'RV1’i seçin → Arıza laboratuvarı → Değer kayması (%) → 30', symptom: 'Pot oranı değişmediğinden W gerilimi neredeyse aynı kalır (≈3,41 V), ancak pot akımı yaklaşık %23 azalır.' },
    ],
    quiz: [
      { id: 'q1', q: 'W gerilimini (yüklü) kaç volt ölçersiniz?', answer: 3.428, unit: 'V', tol: 0.02, explain: 'Yüksüz 3,5 V olan çıkış, 100 kΩ yükle W–B parçası 6,54 kΩ’a düştüğünden ≈3,43 V olur.', verify: { probe: { q: 'node', comp: 'RV1', pin: 'W' } } },
      { id: 'q2', q: 'Bu simülatörde pos = 1 iken (A üstte, B toprakta) W gerilimi ne olur?', options: ['≈0 V', 'Kaynak gerilimi', 'Yarısı', 'Tanımsız'], answer: 0, explain: 'pos A’dan W’ye olan kesirdir; pos = 1 iken W, B ucundadır, yani toprak seviyesinde.' },
      { id: 'q3', q: 'Pot konumu 0,5 olsaydı yüksüz W gerilimi kaç volt olurdu?', answer: 2.5, unit: 'V', tol: 0.02, explain: 'V_W = 5 · (1 − 0,5) = 2,5 V.' },
      { id: 'q4', q: 'Potun W ucuna düşük dirençli bir yük bağlamak ne yapar?', options: ['W gerilimini düşürür', 'W gerilimini artırır', 'Potu kısa devre yapar', 'Hiçbir şey yapmaz'], answer: 0, explain: 'Yük W–B parçasına paralel olur ve toplam alt direnci düşürür; çıkış küçülür.' },
    ],
    challenge: {
      id: 'c1',
      title: '2 V çıkış, düşük akım',
      goal: 'W ucundan yaklaşık 2 V (1,9–2,1 V) üretin ve pottan geçen akımı 1 mA’in altında tutun. Başlangıçta pot 1 kΩ ve ortada.',
      hints: ['Akımı düşürmek için pot toplam direncini 10 kΩ yapın.', 'V_W ≈ 5·(1−pos) olduğundan pos ≈ 0,6 gerekir.', 'RV1: r = 10000, pos = 0,6.'],
      start: () => potCircuit(1000, 0.5),
      solution: () => potCircuit(10000, 0.6),
      checks: [
        { label: 'W gerilimi 1,9–2,1 V', probe: { q: 'node', comp: 'RV1', pin: 'W' }, min: 1.9, max: 2.1, unit: 'V' },
        { label: 'Pot akımı ≤ 1 mA', probe: { q: 'i', comp: 'RV1' }, max: 0.001, unit: 'A' },
      ],
    },
  },

  // =====================================================================
  {
    id: 'temel-08-rc',
    track: 'temel',
    level: 'baslangic',
    title: 'Kondansatör şarj/deşarj ve RC zaman sabiti',
    summary: 'Direnç üzerinden şarj olan kondansatörün gerilim eğrisini, τ = R·C zaman sabitini ve 5τ kuralını ölçün.',
    minutes: 20,
    prerequisites: ['temel-02-ohm'],
    objectives: [
      'Kondansatörün gerilimi ani değiştirmediğini, üstel bir eğriyle şarj olduğunu açıklamak.',
      'τ = R·C zaman sabitini hesaplayıp %63,2 ve %99 kuralını uygulamak.',
      'Osiloskop/grafikte şarj eğrisini okumak.',
    ],
    theory: [
      { t: 'p', text: 'Kondansatör enerjiyi elektrik alanında depolar. Akımı i = C·dv/dt ile ilişkilidir: gerilim ani değişemez, çünkü bu sonsuz akım gerektirirdi. Seri dirençle şarj edilirse gerilim üstel olarak kaynak gerilimine yaklaşır.' },
      { t: 'formula', text: 'v_C(t) = V · (1 − e^(−t/τ))', note: 'Şarj: boş kondansatör, kaynak V.' },
      { t: 'formula', text: 'τ = R · C', note: 't = τ’da gerilim V’nin %63,2’sine, 3τ’da %95’ine, 5τ’da %99,3’üne ulaşır.' },
      { t: 'formula', text: 'v_C(t) = V0 · e^(−t/τ)', note: 'Deşarj: başlangıç V0 gerilimli kondansatör dirençten boşalır.' },
      { t: 'formula', text: 'i(t) = (V/R) · e^(−t/τ)', note: 'Şarj akımı t = 0’da en büyüktür (V/R) ve sıfıra gider.' },
      { t: 'warn', text: 'Elektrolitik kondansatörler polarizedir: ters bağlanırsa zarar görür. Ayrıca anma gerilimi (vmax) üzerinde çalıştırılmamalıdır.' },
    ],
    calc: [
      { title: 'Zaman sabiti', formula: 'τ = R·C', working: 'τ = 1000 Ω × 100 µF = 0,1 s' },
      { title: 't = τ’da gerilim', formula: 'v = V(1 − e⁻¹)', working: 'v = 5 × 0,632 = 3,16 V' },
      { title: 't = 3τ’da gerilim', formula: 'v = V(1 − e⁻³)', working: 'v = 5 × 0,950 = 4,75 V' },
      { title: 'İlk akım', formula: 'I0 = V/R', working: 'I0 = 5 V / 1 kΩ = 5 mA' },
    ],
    build: () => rcCircuit(),
    speed: 0.1,
    steps: [
      '“Çalıştır”a basın (kondansatör boş başlar). Hız 0,1× olduğundan şarj eğrisini canlı izleyebilirsiniz.',
      'Osiloskopa C1 gerilimini ve R1 akımını bağlayın. t = 0,1 s (τ) civarında C1 geriliminin yaklaşık 3,16 V olduğunu okuyun.',
      'R1 akımının başlangıçta 5 mA olup üstel olarak düştüğünü gözleyin.',
      'C1’i 47 µF yapın: τ 47 ms olur, eğri iki kat hızlı yükselir. Eski değere (100 µF) dönün.',
      'Deşarjı görmek için V1’i 0 V ve C1’in başlangıç gerilimini (v0) 5 V yapıp çalıştırın: gerilim aynı τ ile sıfıra iner.',
      '“Meydan okuma”yı çözün.',
    ],
    expects: [
      { label: 'v_C t = τ = 0,1 s', probe: { q: 'v', comp: 'C1' }, tran: { ...RC_T, stat: 'final', at: 0.1 }, value: 5 * (1 - Math.exp(-1)), unit: 'V', tol: { rel: 0.02 } },
      { label: 'v_C t = 3τ = 0,3 s', probe: { q: 'v', comp: 'C1' }, tran: { ...RC_T, stat: 'final', at: 0.3 }, value: 5 * (1 - Math.exp(-3)), unit: 'V', tol: { rel: 0.02 } },
      { label: 'v_C t = 5τ = 0,5 s', probe: { q: 'v', comp: 'C1' }, tran: { ...RC_T, stat: 'final' }, value: 5 * (1 - Math.exp(-5)), unit: 'V', tol: { rel: 0.01 } },
      { label: 'Maksimum şarj akımı', probe: { q: 'i', comp: 'R1' }, tran: { ...RC_T, stat: 'max' }, value: 0.005, unit: 'A', tol: { rel: 0.03 } },
    ],
    mistakes: [
      'Kondansatörün t = τ’da dolduğunu sanmak: o anda %63,2’dedir; dolmuş saymak için ≈5τ beklenir.',
      'τ hesabında birimleri karıştırmak (µF → 10⁻⁶ F).',
      'Elektrolitik kondansatörü ters bağlamak.',
    ],
    faults: [
      { title: 'Kapasite kaybı', how: 'C1’i seçin → Arıza laboratuvarı → Kapasite kaybı (%) → 50', symptom: 'C1 efektif 50 µF olur: τ 50 ms’e düşer, eğri iki kat hızlı yükselir; t = 0,1 s’de gerilim 4,32 V’a ulaşır.' },
      { title: 'Kaçak akım', how: 'C1’i seçin → Arıza laboratuvarı → Kaçak akım → 10000 Ω', symptom: 'Kondansatör paralel 10 kΩ kaçak direnciyle boşalır: gerilim 5 V yerine yaklaşık 4,55 V’ta durur (R1 ile kaçak direnç bir bölücü oluşturur).' },
    ],
    quiz: [
      { id: 'q1', q: 'R = 1 kΩ, C = 100 µF için τ kaç saniyedir?', answer: 0.1, unit: 's', tol: 0.02, explain: 'τ = RC = 1000 × 100×10⁻⁶ = 0,1 s.' },
      { id: 'q2', q: 't = 0,2 s (2τ) anında C1 gerilimi kaç volttur?', answer: 5 * (1 - Math.exp(-2)), unit: 'V', tol: 0.02, explain: 'v = 5(1 − e⁻²) ≈ 4,32 V.', verify: { probe: { q: 'v', comp: 'C1' }, tran: { ...RC_T, stat: 'final', at: 0.2 } } },
      { id: 'q3', q: 'Kondansatör ne zaman yaklaşık tam dolmuş sayılır?', options: ['≈5τ sonra', '≈1τ sonra', '≈0,5τ sonra', 'Asla dolmaz'], answer: 0, explain: '5τ’da gerilim son değerin %99,3’üne ulaşmıştır; pratikte dolmuş kabul edilir.' },
      { id: 'q4', q: 'Aynı R ile kapasiteyi iki katına çıkarırsak şarj süresi ne olur?', options: ['İki katına çıkar', 'Yarıya düşer', 'Aynı kalır', 'Dört katına çıkar'], answer: 0, explain: 'τ = RC; C iki katına çıkınca τ da iki katına çıkar.' },
      { id: 'q5', q: 'Şarj başladığı anda (t = 0) devre akımı kaç amperdir?', answer: 0.005, unit: 'A', tol: 0.03, explain: 'Boş kondansatör kısa devre gibi davranır: I = V/R = 5/1000 = 5 mA.', verify: { probe: { q: 'i', comp: 'R1' }, tran: { ...RC_T, stat: 'max' } } },
    ],
    challenge: {
      id: 'c1',
      title: 'τ = 50 ms yap, ilk akımı sınırla',
      goal: 'Kondansatör geriliminin t = 50 ms’de yaklaşık 3,16 V’a (3,0–3,32 V) ulaşmasını sağlayın ve başlangıç akımını 5,5 mA’in altında tutun.',
      hints: ['3,16 V, 5 V’un %63,2’sidir: t = τ olmalı, yani τ = 50 ms.', 'İlk akım V/R ≤ 5,5 mA ⇒ R ≥ 910 Ω olmalı.', 'R = 1 kΩ tutup C’yi 50 µF yapın.'],
      start: () => rcCircuit(1000, 100e-6),
      solution: () => rcCircuit(1000, 50e-6),
      checks: [
        { label: 'v_C(50 ms) 3,0–3,32 V', probe: { q: 'v', comp: 'C1' }, tran: { stop: 0.3, dt: 2e-4, stat: 'final', at: 0.05 }, min: 3.0, max: 3.32, unit: 'V' },
        { label: 'Başlangıç akımı ≤ 5,5 mA', probe: { q: 'i', comp: 'R1' }, tran: { stop: 0.3, dt: 2e-4, stat: 'max' }, max: 0.0055, unit: 'A' },
      ],
    },
  },

  // =====================================================================
  {
    id: 'temel-09-bobin-rl',
    track: 'temel',
    level: 'orta',
    title: 'Bobin ve RL devresi: τ = L/R',
    summary: 'Seri dirençle beslenen bobinin akımının neden anında değil üstel arttığını, zaman sabiti L/R’yi ve kararlı hali ölçün.',
    minutes: 20,
    prerequisites: ['temel-08-rc'],
    objectives: [
      'Bobin akımının ani değişemediğini ve v = L·di/dt ilişkisini açıklamak.',
      'RL zaman sabiti τ = L/R’yi hesaplamak ve akım yükselişini yorumlamak.',
      'DC kararlı halde bobinin kısa devre gibi davrandığını göstermek.',
    ],
    theory: [
      { t: 'p', text: 'Bobin enerjiyi manyetik alanda depolar. Uçlarındaki gerilim akımın değişim hızıyla orantılıdır; bu yüzden akım ani sıçrayamaz. Seri dirençle beslenirse akım üstel olarak V/R değerine yaklaşır.' },
      { t: 'formula', text: 'v_L = L · di/dt' },
      { t: 'formula', text: 'i(t) = (V/R) · (1 − e^(−t/τ)),   τ = L / R', note: 't = τ’da akım son değerin %63,2’sine ulaşır.' },
      { t: 'formula', text: 'v_L(t) = V · e^(−t/τ)', note: 'Anahtarlama anında bobin gerilimi kaynak gerilimine eşittir, sonra sıfıra iner.' },
      { t: 'warn', text: 'Akımı taşıyan bir bobinin devresi ani açılırsa di/dt çok büyür ve çok yüksek gerilim üretir (ters EMK). Gerçek devrelerde röle/motor bobinlerine söndürme diyotu konur.' },
    ],
    calc: [
      { title: 'Zaman sabiti', formula: 'τ = L / R', working: 'τ = 0,1 H / 100 Ω = 1 ms' },
      { title: 'Kararlı hal akımı', formula: 'I_∞ = V / R', working: 'I = 10 V / 100 Ω = 100 mA' },
      { title: 't = τ’da akım', formula: 'i = I_∞(1 − e⁻¹)', working: 'i = 100 mA × 0,632 = 63,2 mA' },
      { title: 't = τ’da bobin gerilimi', formula: 'v_L = V·e⁻¹', working: 'v_L = 10 × 0,368 = 3,68 V' },
    ],
    build: rlCircuit,
    speed: 0.01,
    steps: [
      'Hız 0,01× olarak ayarlıdır (τ yaklaşık 0,1 s gerçek zamana yayılır). “Çalıştır”a basın.',
      'Osiloskopa L1 akımını ve L1 gerilimini bağlayın. Akımın 0’dan başlayıp yaklaşık 100 mA’e üstel olarak yükseldiğini görün.',
      'L1 geriliminin başlangıçta ≈10 V olduğunu ve sıfıra indiğini gözleyin: kararlı halde bobin kısa devre gibidir.',
      't = 1 ms’de akım ≈63 mA’dir. R1’i 200 Ω yapın: τ 0,5 ms’e düşer, son akım 50 mA olur.',
      '“DC çöz” ile kararlı hali görün: L1 gerilimi ≈0 V, akım 100 mA.',
    ],
    expects: [
      { label: 'Kararlı hal akımı (DC)', probe: { q: 'i', comp: 'L1' }, value: 0.1, unit: 'A', tol: { rel: 0.01 } },
      { label: 'Kararlı hal bobin gerilimi (DC)', probe: { q: 'v', comp: 'L1' }, value: 0, unit: 'V', tol: { abs: 1e-3 } },
      { label: 'Akım t = τ = 1 ms', probe: { q: 'i', comp: 'L1' }, tran: { ...RL_T, stat: 'final', at: 0.001 }, value: 0.1 * (1 - Math.exp(-1)), unit: 'A', tol: { rel: 0.02 } },
      { label: 'Bobin gerilimi t = τ', probe: { q: 'v', comp: 'L1' }, tran: { ...RL_T, stat: 'final', at: 0.001 }, value: 10 * Math.exp(-1), unit: 'V', tol: { rel: 0.03 } },
      { label: 'Akım t = 6 ms', probe: { q: 'i', comp: 'L1' }, tran: { ...RL_T, stat: 'final' }, value: 0.1 * (1 - Math.exp(-6)), unit: 'A', tol: { rel: 0.01 } },
    ],
    mistakes: [
      'Bobin akımının ani sıçrayabileceğini düşünmek: akım süreklidir.',
      'RL zaman sabitini L·R diye yazmak: doğrusu L/R’dir (R büyüdükçe τ küçülür).',
      'DC kararlı halde bobinin gerilim düşürdüğünü sanmak: ideal bobinde DC’de v ≈ 0.',
    ],
    faults: [
      { title: 'Direnç değer kayması', how: 'R1’i seçin → Arıza laboratuvarı → Değer kayması (%) → 100', symptom: 'R1 200 Ω olur: τ = 0,5 ms’e iner ve kararlı hal akımı 100 mA yerine 50 mA olur.' },
      { title: 'Bobin kısa devre', how: 'L1’i seçin → Arıza laboratuvarı → Kısa devre', symptom: 'Bobin devreden fiilen çıkar: akım yükselme eğrisi olmadan hemen ≈100 mA’e (V/R) çıkar.' },
    ],
    quiz: [
      { id: 'q1', q: 'L = 100 mH ve R = 100 Ω için τ kaç saniyedir?', answer: 0.001, unit: 's', tol: 0.02, explain: 'τ = L/R = 0,1 / 100 = 1 ms = 0,001 s.' },
      { id: 'q2', q: 't = 2 ms (2τ) anında bobin akımı kaç amperdir?', answer: 0.1 * (1 - Math.exp(-2)), unit: 'A', tol: 0.02, explain: 'i = 0,1 × (1 − e⁻²) ≈ 0,0865 A.', verify: { probe: { q: 'i', comp: 'L1' }, tran: { ...RL_T, stat: 'final', at: 0.002 } } },
      { id: 'q3', q: 'DC kararlı halde ideal bobin nasıl davranır?', options: ['Kısa devre gibi', 'Açık devre gibi', 'Direnç gibi', 'Kondansatör gibi'], answer: 0, explain: 'di/dt = 0 olduğundan v_L = 0; bobin tel gibi akım geçirir.' },
      { id: 'q4', q: 'R artarsa RL devresinin zaman sabiti τ = L/R ne olur?', options: ['Küçülür', 'Büyür', 'Değişmez', 'Sıfır olur'], answer: 0, explain: 'τ = L/R; R büyüdükçe τ azalır.' },
      { id: 'q5', q: 'L = 50 mH, R = 250 Ω için τ kaç saniyedir?', answer: 0.0002, unit: 's', tol: 0.02, explain: 'τ = 0,05 / 250 = 0,2 ms.' },
    ],
  },

  // =====================================================================
  {
    id: 'temel-10-ac-sinus-rc-filtre',
    track: 'temel',
    level: 'orta',
    title: 'AC temelleri: sinüs, RMS, frekans ve RC alçak geçiren',
    summary: 'Sinüs dalganın tepe, tepeden tepeye, RMS ve frekansını ölçün; RC alçak geçiren filtrenin kesim frekansında nasıl davrandığını görün.',
    minutes: 25,
    prerequisites: ['temel-08-rc'],
    objectives: [
      'Sinüs dalgayı tepe, tepeden tepeye, RMS ve frekansla tanımlamak.',
      'Sinüsün RMS değerini V_tepe/√2 ile hesaplamak.',
      'RC alçak geçiren filtrenin kesim frekansını (f_c) hesaplayıp çıkış genliğini yorumlamak.',
    ],
    theory: [
      { t: 'p', text: 'Alternatif akım (AC) zamanla yön ve değer değiştirir. Sinüs dalga v(t) = V_p·sin(2πft) ile tanımlanır; V_p tepe değeri, f frekanstır (Hz = saniyedeki periyot sayısı). Tepeden tepeye gerilim V_pp = 2·V_p’dir.' },
      { t: 'formula', text: 'V_rms = V_p / √2 ≈ 0,707 · V_p', note: 'RMS, aynı dirençte aynı ısıyı üreten eşdeğer DC gerilimdir.' },
      { t: 'formula', text: 'T = 1 / f', note: 'T: periyot (s)' },
      { t: 'p', text: 'RC alçak geçiren filtre: direnç seri, kondansatör çıkışta toprağa bağlıdır. Kondansatörün reaktansı frekansla azalır, yüksek frekanslar toprağa kaçar. Kesim frekansında çıkış genliği girişin 1/√2 (≈%70,7) katıdır ve faz 45° geridedir.' },
      { t: 'formula', text: 'f_c = 1 / (2π · R · C)', note: 'Genlik oranı: |H| = 1 / √(1 + (f/f_c)²)' },
      { t: 'warn', text: 'Şebeke gerilimi “230 V” RMS değeridir; tepe değeri ≈325 V’tur. Gerçek şebekeyle deney yapmayın, yalnızca simülatörde çalışın.' },
    ],
    calc: [
      { title: 'Sinüs değerleri', formula: 'V_pp = 2V_p,  V_rms = V_p/√2', working: 'V_p = 5 V ⇒ V_pp = 10 V,  V_rms = 5/1,414 = 3,54 V' },
      { title: 'Periyot', formula: 'T = 1/f', working: 'f = 100 Hz ⇒ T = 10 ms' },
      { title: 'Kesim frekansı', formula: 'f_c = 1/(2πRC)', working: 'f_c = 1 / (2π · 1000 · 1,6×10⁻⁶) ≈ 99,5 Hz' },
      { title: 'Çıkış genliği (f = 100 Hz)', formula: '|H| = 1/√(1 + (f/f_c)²)', working: '|H| = 1/√(1 + 1,01) ≈ 0,705 ⇒ V_çıkış,tepe ≈ 3,53 V' },
    ],
    build: acRc,
    speed: 0.05,
    steps: [
      'Hız 0,05× olarak ayarlıdır. “Çalıştır”a basın ve osiloskopta V1 (giriş) ile C1 (çıkış) gerilimlerini birlikte görüntüleyin.',
      'Girişin tepesini (5 V), tepeden tepeye (10 V) ve periyodunu (10 ms) osiloskop imleçleriyle okuyun; frekans 100 Hz’dir.',
      'Çıkışın tepe değerini okuyun: ≈3,5 V (girişin %70,5’i) ve çıkışın girişe göre geride kaldığını görün.',
      'V1 frekansını 10 Hz yapın: çıkış neredeyse girişle aynı (≈5 V). 1 kHz yapın: çıkış ≈0,5 V’a düşer.',
      'Frekansı tekrar 100 Hz’e getirin ve R1 ya da C1’i değiştirip f_c’nin nasıl kaydığını hesaplayın.',
    ],
    expects: [
      { label: 'Giriş tepe değeri', probe: { q: 'v', comp: 'V1' }, tran: { ...AC_T, stat: 'max' }, value: 5, unit: 'V', tol: { rel: 0.01 } },
      { label: 'Giriş tepeden tepeye', probe: { q: 'v', comp: 'V1' }, tran: { ...AC_T, stat: 'pp' }, value: 10, unit: 'V', tol: { rel: 0.01 } },
      { label: 'Giriş RMS', probe: { q: 'v', comp: 'V1' }, tran: { ...AC_T, stat: 'rms' }, value: 5 / Math.SQRT2, unit: 'V', tol: { rel: 0.02 } },
      { label: 'Giriş frekansı', probe: { q: 'v', comp: 'V1' }, tran: { ...AC_T, stat: 'freq' }, value: 100, unit: 'Hz', tol: { rel: 0.02 } },
      { label: 'Çıkış tepesi (f ≈ f_c)', probe: { q: 'v', comp: 'C1' }, tran: { ...AC_T, stat: 'max', skip: 0.6 }, value: 5 / Math.sqrt(1 + (100 / 99.47) ** 2), unit: 'V', tol: { rel: 0.04 } },
    ],
    mistakes: [
      'Tepe değeri RMS ile karıştırmak: 5 V tepe, 3,54 V RMS’tir.',
      'V_pp’yi tepe sanmak: V_pp, tepenin iki katıdır.',
      'RC filtrenin kesim frekansında çıkışın yarıya düştüğünü düşünmek: gerilim 1/√2 (≈0,707) katına, güç ise yarıya düşer.',
    ],
    faults: [
      { title: 'Kondansatör açık devre', how: 'C1’i seçin → Arıza laboratuvarı → Açık devre', symptom: 'Çıkışta filtreleme kalmaz: çıkış genliği girişle aynı (≈5 V tepe) görünür.' },
      { title: 'Kondansatör kısa devre', how: 'C1’i seçin → Arıza laboratuvarı → Kısa devre', symptom: 'Çıkış toprağa çekilir: C1 üzerinde gerilim ≈0 V’tur.' },
    ],
    quiz: [
      { id: 'q1', q: 'Tepe değeri 5 V olan sinüsün tepeden tepeye gerilimi kaç volttur?', answer: 10, unit: 'V', tol: 0.02, explain: 'V_pp = 2·V_p = 10 V.', verify: { probe: { q: 'v', comp: 'V1' }, tran: { ...AC_T, stat: 'pp' } } },
      { id: 'q2', q: 'Aynı sinüsün RMS değeri kaç volttur?', answer: 5 / Math.SQRT2, unit: 'V', tol: 0.02, explain: 'V_rms = V_p/√2 = 5/1,414 ≈ 3,54 V.', verify: { probe: { q: 'v', comp: 'V1' }, tran: { ...AC_T, stat: 'rms' } } },
      { id: 'q3', q: 'RC alçak geçiren filtrenin kesim frekansı hangi formülle bulunur?', options: ['f_c = 1/(2πRC)', 'f_c = 2πRC', 'f_c = R/C', 'f_c = 1/(R+C)'], answer: 0, explain: 'f_c = 1/(2πRC); R veya C büyürse f_c düşer.' },
      { id: 'q4', q: 'Kesim frekansında çıkış genliği girişin yaklaşık kaçta kaçıdır?', options: ['≈%70,7 (1/√2)', '%50', '%100', '%10'], answer: 0, explain: 'f = f_c iken |H| = 1/√2 ≈ 0,707; bu noktaya −3 dB noktası denir.' },
      { id: 'q5', q: 'Frekans kesim frekansının çok üstüne çıkarsa çıkış ne olur?', options: ['Çok zayıflar', 'Büyür', 'Aynı kalır', 'DC’ye döner'], answer: 0, explain: 'Kondansatör yüksek frekansta düşük reaktans gösterir ve sinyali toprağa kaçırır; genlik f ile ters orantılı azalır.' },
    ],
  },
];
