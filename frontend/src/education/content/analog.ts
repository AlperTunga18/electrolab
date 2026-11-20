import { CircuitBuilder } from '../../core/circuit/builder';
import type { Circuit } from '../../core/circuit/types';
import type { Lesson } from '../types';

/* ---------- 1. Diyot ---------- */
const diodeLab = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 5 }, -7, 0, 0, 'V1');
  b.add('resistor', { r: 1000 }, -2, -4, 0, 'R1');
  b.add('diode', {}, 3, -4, 0, 'D1');
  b.add('resistor', { r: 1000 }, -2, 3, 0, 'R2');
  b.add('diode', {}, 3, 3, 2, 'D2');
  b.add('ground', {}, 6, 0, 0, 'GND1');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'D1.A'); b.chain('D1.K', 'GND1.G');
  b.chain('V1.P', 'R2.1'); b.chain('R2.2', 'D2.K'); b.chain('D2.A', 'GND1.G');
  b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/* ---------- 2. LED ---------- */
const ledLab = (r: number, vs = 5): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: vs }, -6, 0, 0, 'V1');
  b.add('resistor', { r }, -1, -3, 0, 'R1');
  b.add('led', { color: 'red' }, 4, -3, 0, 'D1');
  b.add('ground', {}, 0, 4, 0, 'GND1');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'D1.A'); b.chain('D1.K', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/* ---------- 3. Zener ---------- */
const zenerLab = (rs: number, rl: number, rsPmax = 0.25): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 9 }, -7, 0, 0, 'V1');
  b.add('resistor', { r: rs, pmax: rsPmax }, -2, -4, 0, 'RS');
  b.add('zener', { vz: 5.1 }, 3, 1, 1, 'DZ');
  b.add('resistor', { r: rl }, 8, 1, 1, 'RL');
  b.add('ground', {}, 3, 7, 0, 'GND1');
  b.chain('V1.P', 'RS.1'); b.chain('RS.2', 'DZ.K'); b.chain('RS.2', 'RL.1');
  b.chain('DZ.A', 'GND1.G'); b.chain('RL.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/* ---------- 4. Yarım dalga doğrultucu ---------- */
const rectLab = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('signal_gen', { wave: 'sine', amp: 10, freq: 50 }, -7, 0, 0, 'V1');
  b.add('diode', {}, -2, -3, 0, 'D1');
  b.add('capacitor_el', { c: 100e-6, vmax: 25 }, 3, 0, 1, 'C1');
  b.add('resistor', { r: 1000 }, 7, 0, 1, 'RL');
  b.add('ground', {}, 0, 4, 0, 'GND1');
  b.chain('V1.P', 'D1.A'); b.chain('D1.K', 'C1.1'); b.chain('C1.1', 'RL.1');
  b.chain('C1.2', 'GND1.G'); b.chain('RL.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/* ---------- 5. NPN anahtar ---------- */
const npnSwitchLab = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 5 }, -9, 0, 0, 'V1');
  b.add('dc_supply', { v: 5 }, -9, 6, 0, 'V2');
  b.add('resistor', { r: 10000 }, -3, 3, 0, 'RB');
  b.add('resistor', { r: 330 }, 3, -5, 1, 'RC');
  b.add('led', { color: 'green' }, 3, -1, 1, 'D1');
  b.add('npn', {}, 3, 3, 0, 'Q1');
  b.add('ground', {}, 1, 9, 0, 'GND1');
  b.chain('V2.P', 'RB.1'); b.chain('RB.2', 'Q1.B');
  b.chain('V1.P', 'RC.1'); b.chain('RC.2', 'D1.A'); b.chain('D1.K', 'Q1.C'); b.chain('Q1.E', 'GND1.G');
  b.chain('V1.N', 'GND1.G'); b.chain('V2.N', 'GND1.G');
  return b.circuit;
};
/** 12 V / 240 Ω yük (≈50 mA), 5 V mantık sürüşü; taban direnci parametre. */
const npnLoadLab = (rb: number): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 12 }, -9, -2, 0, 'V1');
  b.add('dc_supply', { v: 5 }, -9, 6, 0, 'V2');
  b.add('resistor', { r: rb }, -3, 3, 0, 'RB');
  b.add('resistor', { r: 240, pmax: 1 }, 3, -3, 1, 'RL');
  b.add('npn', {}, 3, 3, 0, 'Q1');
  b.add('ground', {}, 1, 9, 0, 'GND1');
  b.chain('V2.P', 'RB.1'); b.chain('RB.2', 'Q1.B');
  b.chain('V1.P', 'RL.1'); b.chain('RL.2', 'Q1.C'); b.chain('Q1.E', 'GND1.G');
  b.chain('V1.N', 'GND1.G'); b.chain('V2.N', 'GND1.G');
  return b.circuit;
};

/* ---------- 6. NPN aktif bölge ---------- */
const npnActiveLab = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 10 }, -8, 0, 0, 'V1');
  b.add('resistor', { r: 470000 }, -2, 3, 0, 'RB');
  b.add('resistor', { r: 1000 }, 3, -4, 1, 'RC');
  b.add('npn', { bf: 300 }, 3, 3, 0, 'Q1');
  b.add('ground', {}, 1, 8, 0, 'GND1');
  b.chain('V1.P', 'RB.1'); b.chain('RB.2', 'Q1.B');
  b.chain('V1.P', 'RC.1'); b.chain('RC.2', 'Q1.C'); b.chain('Q1.E', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/* ---------- 7. MOSFET anahtar ---------- */
const mosSwitchLab = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 12 }, -9, -2, 0, 'V1');
  b.add('dc_supply', { v: 3.3 }, -9, 6, 0, 'V2');
  b.add('resistor', { r: 12, pmax: 25 }, 2, -5, 1, 'R1');
  b.add('nmos_logic', {}, 2, 2, 0, 'Q1');
  b.add('resistor', { r: 12, pmax: 25 }, 8, -5, 1, 'R2');
  b.add('nmos_std', {}, 8, 2, 0, 'Q2');
  b.add('ground', {}, 4, 8, 0, 'GND1');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'Q1.D'); b.chain('Q1.S', 'GND1.G');
  b.chain('V1.P', 'R2.1'); b.chain('R2.2', 'Q2.D'); b.chain('Q2.S', 'GND1.G');
  b.chain('V2.P', 'Q1.G'); b.chain('V2.P', 'Q2.G');
  b.chain('V1.N', 'GND1.G'); b.chain('V2.N', 'GND1.G');
  return b.circuit;
};

/* ---------- 8. MOSFET ile yük sürme ---------- */
const mosDriveLab = (kind: 'nmos_logic' | 'nmos_std' = 'nmos_logic', pwm = true): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 12 }, -9, -3, 0, 'V1');
  if (pwm) b.add('signal_gen', { wave: 'square', v: 1.65, amp: 1.65, freq: 1000, duty: 50 }, -9, 6, 0, 'V2');
  else b.add('dc_supply', { v: 3.3 }, -9, 6, 0, 'V2');
  b.add('resistor', { r: 100 }, -3, 3, 0, 'RG');
  b.add('resistor', { r: 10000 }, 0, 6, 1, 'RPD');
  b.add('resistor', { r: 12, pmax: 25 }, 5, -4, 1, 'RL');
  b.add(kind, {}, 4, 2, 0, 'Q1');
  b.add('ground', {}, 2, 9, 0, 'GND1');
  b.chain('V2.P', 'RG.1'); b.chain('RG.2', 'Q1.G'); b.chain('Q1.G', 'RPD.1'); b.chain('RPD.2', 'GND1.G');
  b.chain('V1.P', 'RL.1'); b.chain('RL.2', 'Q1.D'); b.chain('Q1.S', 'GND1.G');
  b.chain('V1.N', 'GND1.G'); b.chain('V2.N', 'GND1.G');
  return b.circuit;
};

/* ---------- 9. RC filtreler ---------- */
const rcFilterLab = (c1 = 160e-9): Circuit => {
  const b = new CircuitBuilder();
  b.add('signal_gen', { wave: 'sine', amp: 1, freq: 1000 }, -8, 0, 0, 'V1');
  b.add('resistor', { r: 1000 }, -2, -5, 0, 'R1');
  b.add('capacitor', { c: c1 }, 3, -2, 1, 'C1');
  b.add('capacitor', { c: 160e-9 }, -2, 4, 0, 'C2');
  b.add('resistor', { r: 1000 }, 3, 7, 1, 'R2');
  b.add('ground', {}, 0, 10, 0, 'GND1');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'C1.1'); b.chain('C1.2', 'GND1.G');
  b.chain('V1.P', 'C2.1'); b.chain('C2.2', 'R2.1'); b.chain('R2.2', 'GND1.G');
  b.chain('V1.N', 'GND1.G');
  return b.circuit;
};
const rcChallengeLab = (c1: number): Circuit => {
  const b = new CircuitBuilder();
  b.add('signal_gen', { wave: 'sine', amp: 1, freq: 1000 }, -8, 0, 0, 'V1');
  b.add('resistor', { r: 1000 }, -2, -3, 0, 'R1');
  b.add('capacitor', { c: c1 }, 3, 0, 1, 'C1');
  b.add('ground', {}, 0, 6, 0, 'GND1');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'C1.1'); b.chain('C1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/* ---------- 10. Flyback ---------- */
const flybackLab = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 12 }, -10, 0, 0, 'V1');
  b.add('signal_gen', { wave: 'square', v: 2.5, amp: 2.5, freq: 500, duty: 50 }, -10, 8, 0, 'V2');
  // A kolu: diyotlu
  b.add('inductor', { l: 10e-3, imax: 2 }, -3, -6, 0, 'L1');
  b.add('resistor', { r: 12, pmax: 10 }, 2, -6, 0, 'R1');
  b.add('diode', {}, 5, -3, 1, 'D1');
  b.add('nmos_logic', {}, 5, 3, 0, 'Q1');
  // B kolu: diyotsuz
  b.add('inductor', { l: 10e-3, imax: 2 }, 9, -6, 0, 'L2');
  b.add('resistor', { r: 12, pmax: 10 }, 14, -6, 0, 'R2');
  b.add('nmos_logic', {}, 14, 3, 0, 'Q2');
  b.add('ground', {}, 9, 9, 0, 'GND1');
  b.chain('V1.P', 'L1.1'); b.chain('L1.2', 'R1.1'); b.chain('R1.2', 'Q1.D'); b.chain('Q1.S', 'GND1.G');
  b.chain('D1.A', 'Q1.D'); b.chain('D1.K', 'V1.P');
  b.chain('V1.P', 'L2.1'); b.chain('L2.2', 'R2.1'); b.chain('R2.2', 'Q2.D'); b.chain('Q2.S', 'GND1.G');
  b.chain('V2.P', 'Q1.G'); b.chain('V2.P', 'Q2.G'); b.chain('V1.N', 'GND1.G'); b.chain('V2.N', 'GND1.G');
  return b.circuit;
};

const FLY = { stop: 0.01, dt: 2.5e-6, stat: 'max' as const, skip: 0.1 };

export const ANALOG: Lesson[] = [
  /* ====================== 1 ====================== */
  {
    id: 'analog-01-diyot', track: 'analog', level: 'baslangic', title: 'Diyot: tek yönlü vana', minutes: 12,
    summary: 'Diyot ileri yönde ≈0.6–0.8 V düşümle iletir, ters yönde akımı keser. Seri direnç akımı belirler.',
    prerequisites: ['temel-02-ohm'],
    objectives: [
      'Diyotun ileri ve ters yön davranışını ölçerek ayırt edebilmek.',
      'İleri yön gerilim düşümünü (Vf ≈ 0.6–0.8 V) ve seri dirençle akım hesabını yapabilmek.',
      'Diyotun neden daima bir akım sınırlayıcıyla kullanıldığını açıklayabilmek.',
    ],
    theory: [
      { t: 'p', text: 'Diyot bir PN eklemidir. Anot (A) katoda (K) göre yaklaşık 0.6–0.7 V (silisyum) pozitif olunca iletir; ters yönde pratikte hiç akım geçirmez. İletimdeyken uçlarındaki gerilim akımla çok yavaş (logaritmik) değişir; bu yüzden "sabit ~0.7 V" modeli iyi bir ilk yaklaşımdır.' },
      { t: 'formula', text: 'I = Is · (e^(V / (n·Vt)) − 1)', note: 'Shockley denklemi; Vt ≈ 25.85 mV (oda sıcaklığı). Bu simülatörde 1N4148 sınıfı genel model: Is = 2.52 nA, n = 1.752.' },
      { t: 'formula', text: 'I = (Vs − Vf) / R', note: 'Diyot iletimdeyken seri direnç akımı belirler; diyot kendi başına akımı sınırlamaz.' },
      { t: 'warn', text: 'Diyodu doğrudan kaynağa bağlarsanız (direnç yok) akım üstel olarak artar ve eklem ısınıp yanar. Bu modelde de "Maks. ileri akım" (0.2 A) aşılır.' },
      { t: 'p', text: 'Simülatör notu: model genel bir Shockley diyodudur; seri direnç (Rs), eklem kapasitesi ve toparlanma süresi yoktur. Vf akıma bağlı olarak 0.6–0.8 V arasında kalır.' },
    ],
    calc: [
      { title: 'İleri yön akımı', formula: 'I = (Vs − Vf) / R', working: 'Vs = 5 V, Vf ≈ 0.65 V, R = 1 kΩ → I = (5 − 0.65) / 1000 ≈ 4.35 mA' },
      { title: 'Ters yönde diyot gerilimi', formula: 'Vd = −Vs (akım ≈ 0)', working: 'Ters bağlı D2 üzerinde akım ≈ 0 → R2 üzerinde düşüm yok → diyot uçlarında −5 V' },
    ],
    build: diodeLab,
    steps: [
      'Çalıştır / DC çöz’e basın. Üstteki kol ileri (D1), alttaki kol ters (D2) bağlıdır.',
      'D1’i Inspector’da seçip gerilimine bakın: ≈0.65 V mi? R1 akımını okuyun (≈4.35 mA).',
      'D2 koluna bakın: R2 üzerinde akım ve gerilim düşümü var mı? D2 uçlarındaki gerilim kaç volt?',
      'V1’i 3 V, sonra 10 V yapın: D1 gerilimi neredeyse değişmez, akım değişir. Neden?',
      'R1’i 10 Ω yapın: akım limiti aşar mı? Aşım uyarısını okuyun.',
    ],
    expects: [
      { label: 'D1 ileri gerilimi', probe: { q: 'v', comp: 'D1' }, value: 0.65, tol: { abs: 0.1 }, unit: 'V' },
      { label: 'İleri kol akımı (R1)', probe: { q: 'i', comp: 'R1' }, value: 0.00435, tol: { rel: 0.1 }, unit: 'A' },
      { label: 'Ters kol akımı (R2)', probe: { q: 'i', comp: 'R2' }, value: 0, tol: { abs: 1e-6 }, unit: 'A' },
      { label: 'D2 ters gerilimi', probe: { q: 'v', comp: 'D2' }, value: -5, tol: { abs: 0.01 }, unit: 'V' },
    ],
    mistakes: [
      'Diyodu dirençsiz bağlamak: akım yalnızca kaynağın gücüne bağlı kalır, parça yanar.',
      'Anot/katot yönünü karıştırmak: çizgili uç katottur, akım A → K yönünde geçer.',
      'Vf’nin kesin 0.7 V olduğunu sanmak: akıma ve sıcaklığa göre 0.6–0.8 V arası değişir (LED’lerde 1.8–3.3 V).',
    ],
    faults: [
      { title: 'D1 açık devre', how: 'Inspector → Arıza laboratuvarı → D1 → Açık devre.', symptom: 'R1 akımı 0 olur; D1 uçlarında kaynağın tamamı (5 V) görünür.' },
      { title: 'D2 kısa devre (eklem delinmesi)', how: 'D2 → Kısa devre.', symptom: 'Ters kol da iletir: R2 akımı ≈ 5 mA, D2 gerilimi ≈ 0 V.' },
    ],
    quiz: [
      { id: 'q1', q: 'Silisyum diyot ileri yönde iletirken uçlarında yaklaşık kaç volt ölçülür?', options: ['0.0 V', '0.6–0.8 V', '5 V', 'Kaynak gerilimi kadar'], answer: 1, explain: 'İletimde eklem gerilimi sabit sayılacak kadar yavaş değişir: silisyumda 0.6–0.8 V.' },
      { id: 'q2', q: 'Diyot ters bağlandığında R2 üzerindeki gerilim düşümü nedir?', options: ['5 V', '0.7 V', '≈ 0 V', '2.5 V'], answer: 2, explain: 'Ters yönde akım ≈ 0 olduğu için V = I·R ≈ 0; kaynağın tamamı diyot uçlarında görünür.' },
      { id: 'q3', q: 'Diyotu neden seri direnç olmadan kaynağa bağlamamalıyız?', options: ['Direnç ışık verir', 'Akım üstel artar, diyot aşırı akımdan zarar görür', 'Diyot gerilimi artar', 'Diyot ters iletir'], answer: 1, explain: 'Vf neredeyse sabit olduğundan akımı yalnızca dış devre (direnç) sınırlayabilir.' },
      { id: 'q4', q: 'R1 kolundaki akım kaç amperdir?', answer: 0.00435, tol: 0.1, unit: 'A', explain: 'I = (5 − 0.65) / 1 kΩ ≈ 4.35 mA.', verify: { probe: { q: 'i', comp: 'R1' } } },
    ],
  },

  /* ====================== 2 ====================== */
  {
    id: 'analog-02-led-direnci', track: 'analog', level: 'baslangic', title: 'LED ve akım sınırlama direnci', minutes: 12,
    summary: 'LED için R = (Vs − Vf) / If hesabı; yanlış direnç parlaklığı azaltır veya akım limitini aşar.',
    prerequisites: ['analog-01-diyot'],
    objectives: [
      'Verilen kaynak, Vf ve hedef If için sınırlama direncini hesaplayabilmek.',
      'Direnç değerinin LED akımına etkisini ve limit aşımını (30 mA) gözlemleyebilmek.',
      'Standart E24 direnç değeri seçip gerçek akımı doğrulayabilmek.',
    ],
    theory: [
      { t: 'p', text: 'LED, ışık yayan bir diyottur; renge göre Vf ≈ 1.8 V (kırmızı) – 3.3 V (mavi/beyaz). Parlaklık akımla orantılıdır, gerilimle değil. LED’in kendi iç direnci küçük olduğundan akımı dış bir seri direnç belirler.' },
      { t: 'formula', text: 'R = (Vs − Vf) / If', note: 'Örnek: Vs = 5 V, Vf ≈ 1.9 V, If = 20 mA → R = 155 Ω; en yakın standart değer 150 Ω.' },
      { t: 'formula', text: 'PR = If² · R', note: 'Direncin harcadığı güç; 0.25 W direnç için bolca yeterli.' },
      { t: 'warn', text: 'Direnç çok küçükse (örn. 10 Ω) akım LED’in sınırını (bu modelde 30 mA) kat kat aşar; gerçekte LED kısa sürede yanar. Simülatörde aşım uyarısı ve hasar modeli bunu gösterir.' },
      { t: 'p', text: 'Simülatör notu: LED genel Shockley modelidir; Vf rengine göre sabit bir tablodan ayarlanır, akımla küçük değişir. Üretici verisi yoktur.' },
    ],
    calc: [
      { title: 'Direnç seçimi', formula: 'R = (Vs − Vf) / If', working: '(5 − 1.9) / 0.020 = 155 Ω → 150 Ω seçilir' },
      { title: 'Gerçek akım', formula: 'I = (Vs − Vf) / R', working: '(5 − 1.9) / 150 ≈ 20.7 mA (limit 30 mA altında)' },
      { title: 'Direnç gücü', formula: 'P = I²·R', working: '(0.0207)² · 150 ≈ 64 mW < 250 mW' },
    ],
    build: () => ledLab(150),
    steps: [
      'DC çöz’e basın. D1’in akımını ve gerilimini Inspector’dan okuyun.',
      'R1’i 47 Ω yapın: akım ≈ 66 mA olur; limit aşımı uyarısını görün.',
      'R1’i 1 kΩ yapın: akım ≈ 3 mA; LED sönük kalır.',
      'V1’i 12 V yapın ve R1’i hesaplayarak yeniden seçin (hedef 20 mA).',
    ],
    expects: [
      { label: 'LED akımı', probe: { q: 'i', comp: 'D1' }, value: 0.0207, tol: { rel: 0.1 }, unit: 'A' },
      { label: 'LED Vf', probe: { q: 'v', comp: 'D1' }, value: 1.9, tol: { abs: 0.15 }, unit: 'V' },
      { label: 'Direnç gerilimi', probe: { q: 'v', comp: 'R1' }, value: 3.1, tol: { abs: 0.15 }, unit: 'V' },
    ],
    mistakes: [
      'Direnci hiç koymamak veya çok küçük seçmek: akım limiti aşılır.',
      'Vf’yi hesaba katmadan R = Vs / If almak: akım hedefin altında kalır (5/0.02 = 250 Ω → ≈ 12 mA).',
      'Direnci LED’in katot tarafına koymanın sorun olduğunu sanmak: seri devrede sırası fark etmez.',
    ],
    faults: [
      { title: 'R1 değeri kayması (−90 %)', how: 'R1 → Değer kayması → −90 %.', symptom: 'Direnç ≈ 15 Ω olur; LED akımı ≈ 200 mA, limit aşımı uyarısı ve hasar.' },
      { title: 'D1 açık devre', how: 'D1 → Açık devre.', symptom: 'Akım 0; direnç üzerinde gerilim düşümü kaybolur, D1 uçlarında 5 V ölçülür.' },
    ],
    quiz: [
      { id: 'q1', q: 'LED parlaklığını asıl olarak ne belirler?', options: ['Besleme gerilimi', 'LED’den geçen akım', 'Direncin rengi', 'Ortam sıcaklığı'], answer: 1, explain: 'LED akımla çalışan bir elemandır; ışık şiddeti akımla orantılıdır.' },
      { id: 'q2', q: '9 V kaynak, Vf = 2 V, hedef 20 mA için hesaplanan direnç kaçtır?', options: ['100 Ω', '350 Ω', '450 Ω', '1 kΩ'], answer: 1, explain: 'R = (9 − 2) / 0.02 = 350 Ω; en yakın standart 330 Ω veya 390 Ω.' },
      { id: 'q3', q: 'Direnç yerine 10 Ω koyarsak ne olur?', options: ['LED daha parlak ama güvenli yanar', 'Akım ≈ 300 mA olur ve limit çok aşılır', 'LED söner', 'Hiçbir şey değişmez'], answer: 1, explain: '(5 − 2)/10 = 300 mA, LED’in 30 mA sınırının 10 katı.' },
      { id: 'q4', q: '150 Ω ile LED akımı kaç amperdir?', answer: 0.0207, tol: 0.1, unit: 'A', explain: 'I = (5 − 1.9) / 150 ≈ 20.7 mA.', verify: { probe: { q: 'i', comp: 'D1' } } },
    ],
    challenge: {
      id: 'c1', title: '9 V ile güvenli LED',
      goal: '9 V kaynakla çalışan LED’in akımını 10–25 mA arasına getirin (R1 değerini değiştirin).',
      hints: ['R = (9 − 1.9) / 0.02 ≈ 355 Ω.', 'Başlangıçtaki 100 Ω akımı ≈ 70 mA yapar.', 'Standart değer olarak 330 Ω veya 390 Ω seçin.'],
      start: () => ledLab(100, 9),
      solution: () => ledLab(390, 9),
      checks: [{ label: 'LED akımı', probe: { q: 'i', comp: 'D1' }, min: 0.010, max: 0.025, unit: 'A' }],
    },
    safety: 'Gerçek LED’leri sınırlama direnci olmadan bataryaya bağlamayın; LED ve gözünüz zarar görebilir.',
  },

  /* ====================== 3 ====================== */
  {
    id: 'analog-03-zener', track: 'analog', level: 'baslangic', title: 'Zener ile gerilim kıskacı ve regülatör', minutes: 15,
    summary: 'Ters yönde Vz civarında iletime geçen zener, seri dirençle basit bir paralel regülatör oluşturur.',
    prerequisites: ['analog-02-led-direnci'],
    objectives: [
      'Zener diyotun ters yönde kıskaç/referans olarak çalışmasını açıklamak.',
      'Seri direnç RS ve yük RL için zener akımını ve çıkış gerilimini hesaplayabilmek.',
      'Yük çok ağır olduğunda regülasyonun neden bozulduğunu görebilmek.',
    ],
    theory: [
      { t: 'p', text: 'Zener diyot ters yönde Vz değerinde "diz" yapıp iletime geçer ve uçlarındaki gerilimi yaklaşık Vz’de tutar. Doğru çalışması için sürekli ters akımla beslenmesi gerekir; bunu seri direnç RS sağlar.' },
      { t: 'formula', text: 'Iz = (Vs − Vz)/RS − Vz/RL', note: 'Zener akımı = toplam akım − yük akımı. Iz > 0 olmalıdır (kıskaç aktif).' },
      { t: 'formula', text: 'Pz = Vz · Iz', note: 'Zener gücü maks. güç (0.5 W) altında kalmalıdır.' },
      { t: 'warn', text: 'Yük akımı arttıkça Iz azalır; Iz sıfıra düşerse zener iletimden çıkar ve çıkış gerilimi Vz’nin altına düşer (regülasyon kaybı). RS’yi en kötü durum (en ağır yük, en düşük Vs) için hesaplayın.' },
      { t: 'p', text: 'Simülatör notu: zener genel Shockley + ters kırılma modelidir; dinamik empedans ve sıcaklık katsayısı gerçek zenerden farklıdır, Vout yük/besleme ile gerçekte biraz daha fazla değişir.' },
    ],
    calc: [
      { title: 'Toplam akım', formula: 'I = (Vs − Vz) / RS', working: '(9 − 5.1) / 220 ≈ 17.7 mA' },
      { title: 'Yük akımı', formula: 'IL = Vz / RL', working: '5.1 / 1000 = 5.1 mA' },
      { title: 'Zener akımı ve gücü', formula: 'Iz = I − IL; Pz = Vz·Iz', working: 'Iz = 17.7 − 5.1 = 12.6 mA; Pz = 5.1 · 0.0126 ≈ 64 mW' },
    ],
    build: () => zenerLab(220, 1000),
    steps: [
      'DC çöz’e basın. Çıkış düğümünün (RL üstü) gerilimini ve zener akımını okuyun.',
      'V1’i 12 V yapın: çıkış neredeyse sabit kalır, RS akımı artar.',
      'RL’yi 150 Ω yapın: çıkış gerilimi 5.1 V’tan düşer. Zener akımına bakın.',
      'DZ’yi ters yerine ileri yöne çevirin (döndürün): çıkış ≈ 0.7 V’a kıskaçlanır.',
    ],
    expects: [
      { label: 'Çıkış gerilimi', probe: { q: 'node', comp: 'RL', pin: '1' }, value: 5.1, tol: { abs: 0.25 }, unit: 'V' },
      { label: 'Zener akımı (A→K yönünde; ters akım negatif işaretli)', probe: { q: 'i', comp: 'DZ' }, value: -0.0126, tol: { rel: 0.1 }, unit: 'A' },
      { label: 'RS akımı', probe: { q: 'i', comp: 'RS' }, value: 0.0177, tol: { rel: 0.06 }, unit: 'A' },
    ],
    mistakes: [
      'Zener’i ileri yönde bağlayıp Vz bekleme: ileri yönde normal diyot gibi 0.7 V verir.',
      'RS’yi çok büyük seçmek: yük akımı zener akımını tüketir, regülasyon biter.',
      'Zener gücünü hesaplamamak: yük kalkarsa tüm akım zenerden geçer (Pz = Vz·I).',
    ],
    faults: [
      { title: 'DZ açık devre', how: 'DZ → Açık devre.', symptom: 'Regülasyon kaybolur: çıkış RS/RL bölücüsüne iner (9·1k/1.22k ≈ 7.4 V).' },
      { title: 'RL açık devre (yük yok)', how: 'RL → Açık devre.', symptom: 'Tüm akım zenerden geçer: Iz ≈ 17.7 mA, Pz ≈ 90 mW; çıkış 5.1 V’ta kalır.' },
    ],
    quiz: [
      { id: 'q1', q: 'Zener regülatörde zener nasıl bağlanır?', options: ['İleri yönde, seri', 'Ters yönde, yüke paralel', 'Ters yönde, yüke seri', 'Yüke paralel, ileri yönde'], answer: 1, explain: 'Zener ters yönde, çıkış düğümü ile toprak arasına (yüke paralel) bağlanır ve Vz’de kıskaç yapar.' },
      { id: 'q2', q: 'Yük direnci çok küçülürse (ağır yük) ne olur?', options: ['Çıkış gerilimi artar', 'Iz sıfıra iner, çıkış Vz’nin altına düşer', 'Zener yanar', 'Değişmez'], answer: 1, explain: 'Yük akımı RS’den gelen akımın tamamını çekerse zener iletimden çıkar.' },
      { id: 'q3', q: 'Aşağıdakilerden hangisi zenerin güvenli çalışması için şarttır?', options: ['Pz < Pmax', 'Iz = 0', 'Vs < Vz', 'RS = 0'], answer: 0, explain: 'Zener gücü Vz·Iz maks. güç değerini aşmamalıdır.' },
      { id: 'q4', q: 'Zenerin A→K yönündeki akımı kaç amperdir? (Zener ters yönde iletir; işaret negatiftir.)', answer: -0.0126, tol: 0.1, unit: 'A', explain: 'Ters yönde Iz = (9 − 5.1)/220 − 5.1/1000 ≈ 12.6 mA geçer; A→K tanımına göre −12.6 mA.', verify: { probe: { q: 'i', comp: 'DZ' } } },
    ],
    challenge: {
      id: 'c1', title: 'Ağır yükte regülasyonu kurtar',
      goal: 'RL = 150 Ω yükte çıkışı 4.8–5.4 V arasında tutun ve zener gücünü 0.5 W altında bırakın (RS’yi değiştirin; RS gücü için pmax’ı artırın).',
      hints: ['Yük akımı 5.1/150 = 34 mA; RS bundan fazlasını geçirmeli.', 'Hedef toplam akım ≈ 80 mA → RS ≈ (9 − 5.1)/0.08 ≈ 47 Ω.', 'RS gücü ≈ 0.08² · 47 ≈ 0.3 W: pmax’ı 1 W yapın.'],
      start: () => zenerLab(220, 150),
      solution: () => zenerLab(47, 150, 1),
      checks: [
        { label: 'Çıkış gerilimi', probe: { q: 'node', comp: 'RL', pin: '1' }, min: 4.8, max: 5.4, unit: 'V' },
        { label: 'Zener gücü', probe: { q: 'p', comp: 'DZ' }, max: 0.5, unit: 'W' },
      ],
    },
  },

  /* ====================== 4 ====================== */
  {
    id: 'analog-04-yarim-dalga', track: 'analog', level: 'baslangic', title: 'Yarım dalga doğrultucu ve filtre kondansatörü', minutes: 18,
    summary: 'Diyot AC’nin yalnızca bir yarısını geçirir; kondansatör tepe değeri tutar, ripple C ile küçülür.',
    prerequisites: ['analog-01-diyot', 'temel-08-rc'],
    objectives: [
      'Yarım dalga doğrultucunun çıkış dalga biçimini ve tepe değerini (Vp − Vf) açıklamak.',
      'Filtre kondansatörünün ripple’a etkisini ΔV ≈ I / (f·C) ile hesaplamak.',
      'Osiloskopta giriş ve çıkışı birlikte izleyip ripple’ı ölçmek.',
    ],
    theory: [
      { t: 'p', text: 'Diyot yalnızca giriş, çıkış gerilimini Vf kadar aştığında iletir. Kondansatör bu kısa iletim aralığında tepe değere şarj olur; diyot kesimdeyken yükü kondansatör besler ve gerilim yavaşça düşer. Bu düşüme ripple denir.' },
      { t: 'formula', text: 'Vout,tepe ≈ Vp − Vf', note: '10 V tepe, Vf ≈ 0.7 V → ≈ 9.3 V.' },
      { t: 'formula', text: 'ΔV ≈ I_yük / (f · C) = Vp / (R · f · C)', note: 'Yarım dalgada boşalma süresi ≈ T = 1/f. Tam dalgada ripple yarıya iner (frekans 2f).' },
      { t: 'warn', text: 'Kondansatör şarj olurken diyottan kısa ve yüksek akım darbeleri geçer (dolum ≫ yük akımı). Büyük C’de bu darbeler diyot maks. akımını aşabilir. Elektrolitik kondansatörü ters bağlamayın.' },
      { t: 'p', text: 'Simülatör notu: diyot genel modeldir (toparlanma süresi, ESR ve kondansatör sızıntısı yok); ripple ve tepe değerleri tran istatistikleriyle (max / pp) ölçülür.' },
    ],
    calc: [
      { title: 'Tepe gerilim', formula: 'Vp − Vf', working: '10 − 0.7 ≈ 9.3 V' },
      { title: 'Yük akımı', formula: 'I ≈ Vtepe / R', working: '9.3 / 1000 ≈ 9.3 mA' },
      { title: 'Ripple', formula: 'ΔV = I / (f·C)', working: '0.0093 / (50 · 100 µF) = 1.86 V (üstel azalma nedeniyle gerçek ≈ 1.7 V)' },
    ],
    build: rectLab, speed: 1,
    steps: [
      'Hız çarpanını 1 yapın; Çalıştır’a basın.',
      'Osiloskopta V1 çıkışını (D1.A) ve C1.1 düğümünü birlikte seçin.',
      'Çıkışın tepe değerini ve dalgalanmasını (pp) okuyun: tepe ≈ 9.3 V mi?',
      'C1’i 10 µF yapın: ripple yaklaşık 10 kat büyür. 470 µF ile deneyin.',
      'RL’yi 330 Ω yapın: yük akımı artınca ripple nasıl değişir?',
    ],
    expects: [
      { label: 'Çıkış tepe gerilimi', probe: { q: 'node', comp: 'C1', pin: '1' }, value: 9.3, tol: { abs: 0.25 }, unit: 'V', tran: { stop: 0.2, dt: 1e-4, stat: 'max', skip: 0.5 } },
      { label: 'Ripple (tepeden tepeye)', probe: { q: 'node', comp: 'C1', pin: '1' }, value: 1.7, tol: { rel: 0.25 }, unit: 'V', tran: { stop: 0.2, dt: 1e-4, stat: 'pp', skip: 0.5 } },
    ],
    mistakes: [
      'Tepe değeri 10 V sanmak: diyot düşümü (≈ 0.7 V) unutulur.',
      'Ripple’ı azaltmak için R’yi küçültmek: yük akımı artar, ripple de artar. Azaltmak için C büyütülür.',
      'Elektrolitik kondansatörü ters bağlamak: ters polarite uyarısı verir, gerçekte patlayabilir.',
    ],
    faults: [
      { title: 'C1 kapasite kaybı (%80)', how: 'C1 → Kapasite kaybı → %80.', symptom: 'C ≈ 20 µF’a düşer; ripple ≈ 5 kat artar (≈ 6–7 V pp), çıkış testere dişine döner.' },
      { title: 'D1 açık devre', how: 'D1 → Açık devre.', symptom: 'Çıkış 0 V kalır; kondansatör hiç şarj olmaz.' },
    ],
    quiz: [
      { id: 'q1', q: '10 V tepe, Vf = 0.7 V ile yarım dalga doğrultucu çıkışı filtre kondansatöründe kaç volt tepeye ulaşır?', options: ['10 V', '9.3 V', '7.07 V', '5 V'], answer: 1, explain: 'Tepe = Vp − Vf = 10 − 0.7 = 9.3 V.' },
      { id: 'q2', q: 'Ripple’ı yarıya indirmek için ne yapılır?', options: ['C’yi yarıya indirmek', 'C’yi iki katına çıkarmak', 'R’yi iki katına çıkarmak yetmez, ters etki yapar', 'Diyotu değiştirmek'], answer: 1, explain: 'ΔV = I/(f·C): C iki katına çıkınca ripple yarıya iner (R’yi büyütmek de akımı azaltarak yardım eder).' },
      { id: 'q3', q: 'Diyot ne zaman iletir?', options: ['Her zaman', 'Giriş, kondansatör gerilimini Vf kadar aştığında', 'Giriş negatifken', 'Yalnızca t = 0’da'], answer: 1, explain: 'Diyot yalnızca anot gerilimi katottan büyükken (≈ 0.7 V fazla) iletir; bu kısa bir tepe aralığıdır.' },
      { id: 'q4', q: 'Kararlı durumda çıkış gerilimi tepe değeri (V) nedir?', answer: 9.3, tol: 0.05, unit: 'V', explain: 'Tepe ≈ 10 − 0.7 = 9.3 V.', verify: { probe: { q: 'node', comp: 'C1', pin: '1' }, tran: { stop: 0.2, dt: 1e-4, stat: 'max', skip: 0.5 } } },
    ],
  },

  /* ====================== 5 ====================== */
  {
    id: 'analog-05-npn-anahtar', track: 'analog', level: 'baslangic', title: 'NPN transistör anahtar: taban direnci ve doyum', minutes: 20,
    summary: 'Küçük taban akımı büyük kolektör akımını anahtarlar; doyumda Vce(sat) ≈ 0.1–0.2 V olur.',
    prerequisites: ['analog-02-led-direnci'],
    objectives: [
      'Transistörün anahtar olarak kesim ve doyum durumlarını ayırt etmek.',
      'Kolektör akımından taban direncini hesaplamak (zorlanmış β ≈ 10).',
      'Vce(sat) ve Vbe değerlerini ölçmek; aşırı sürmenin gerekçesini anlamak.',
    ],
    theory: [
      { t: 'p', text: 'NPN transistör, taban–emitör eklemine akan küçük Ib ile kolektör–emitör yolundan geçen Ic’yi kontrol eder. Aktif bölgede Ic = β·Ib; anahtarlamada ise taban, β·Ib > Ic gerekeni verecek kadar sürülür ve transistör doyuma girer: Vce ≈ 0.1–0.2 V, transistör "kapalı anahtar" gibi davranır.' },
      { t: 'formula', text: 'Ic = (Vcc − Vf_yük − Vce(sat)) / RC', note: 'LED yük için: Vf_LED ≈ 2 V.' },
      { t: 'formula', text: 'Ib ≥ Ic / β_zorlanmış  (β_zorlanmış ≈ 10)', note: 'Datasheet β’sı (örn. 300) değil, güvenli doyum için 10 civarı kullanılır.' },
      { t: 'formula', text: 'RB = (Vin − Vbe) / Ib,  Vbe ≈ 0.7 V' },
      { t: 'warn', text: 'Taban direnci yoksa Vbe 0.7 V’ta kıskaçlanır ve akım yalnızca kaynağın direnciyle sınırlanır: taban eklemi yanar. Taban akımı da yük akımına eklenerek emitörden çıkar.' },
      { t: 'p', text: 'Simülatör notu: BJT Ebers-Moll modelidir, Early etkisi (Vce ile β değişimi) ve kapasiteler yoktur. Stres modeli Ic ve P limitlerini (0.1 A, 0.5 W) denetler.' },
    ],
    calc: [
      { title: 'Taban akımı', formula: 'Ib = (Vin − Vbe) / RB', working: '(5 − 0.7) / 10 kΩ = 0.43 mA' },
      { title: 'Kolektör akımı (LED, 330 Ω)', formula: 'Ic = (5 − 2.0 − 0.1) / 330', working: '≈ 8.8 mA' },
      { title: 'Doyum kontrolü', formula: 'β_zorlanmış = Ic / Ib', working: 'Ic / Ib = 8.8 / 0.43 ≈ 20 > 10 → taban yeterince (β·Ib = 129 mA ≫ 8.8 mA) sürülüyor ⇒ doyum' },
      { title: 'Güçlü yük örneği', formula: 'RB = (5 − 0.7) / (Ic/10)', working: 'Ic = 50 mA → Ib = 5 mA → RB ≈ 860 Ω → 680 Ω seçilir' },
    ],
    build: npnSwitchLab,
    steps: [
      'DC çöz’e basın: LED yanar. Q1 için Vbe, Vce, Ic, Ib değerlerini okuyun.',
      'Vce(sat)’ın 0.3 V altında olduğunu doğrulayın (doyum).',
      'RB’yi 100 kΩ yapın: Ib = 43 µA, β·Ib ≈ 13 mA; Ic hâlâ yük sınırına yakın mı? RB’yi 1 MΩ yapınca Vce ne olur?',
      'V2’yi 0 V yapın: kesim — Ic ≈ 0, Vce ≈ 5 V.',
    ],
    expects: [
      { label: 'Taban akımı', probe: { q: 'val', comp: 'Q1', key: 'ib' }, value: 0.00043, tol: { rel: 0.1 }, unit: 'A' },
      { label: 'Vbe', probe: { q: 'val', comp: 'Q1', key: 'vbe' }, value: 0.7, tol: { abs: 0.1 }, unit: 'V' },
      { label: 'Vce (doyum)', probe: { q: 'val', comp: 'Q1', key: 'vce' }, value: 0.1, tol: { abs: 0.2 }, unit: 'V' },
      { label: 'Kolektör akımı', probe: { q: 'val', comp: 'Q1', key: 'ic' }, value: 0.0088, tol: { rel: 0.1 }, unit: 'A' },
    ],
    mistakes: [
      'Taban direncini unutmak: taban eklemi diyot gibi iletir, aşırı akım akar.',
      'RB’yi datasheet β’sına göre hesaplamak: doyum garanti olmaz; β_zorlanmış ≈ 10 kullanın.',
      'Yükü emitör tarafına koymak: Vbe artık Vin − Ic·RE ile belirlenir, anahtar değil izleyici olur.',
    ],
    faults: [
      { title: 'RB açık devre', how: 'RB → Açık devre.', symptom: 'Taban akımı 0; transistör kesimde, LED söner, Vce ≈ 5 V.' },
      { title: 'Q1 C–E kısa devre', how: 'Q1 → Kısa devre.', symptom: 'LED sürekli yanar; V2 = 0 yapılınca bile Ic ≈ 9 mA kalır.' },
      { title: 'RB değer kayması (+%900)', how: 'RB → Değer kayması → +900 %.', symptom: 'RB = 100 kΩ: Ib ≈ 43 µA, β·Ib ≈ 13 mA hâlâ 8.8 mA yük akımının üstünde; transistör doyumun sınırında kalır, Vce biraz artar. RB’yi 1 MΩ’a çıkarırsanız aktif bölgeye düşer, LED sönükleşir.' },
    ],
    quiz: [
      { id: 'q1', q: 'Anahtar olarak doyuma sokulmuş transistörde Vce yaklaşık nedir?', options: ['Vcc', 'Vcc / 2', '≈ 0.1–0.2 V', '0.7 V'], answer: 2, explain: 'Doyumda C–E yolu kapalı anahtar gibidir: Vce(sat) ≈ 0.1–0.2 V.' },
      { id: 'q2', q: 'Güvenli doyum için tipik taban akımı kuralı nedir?', options: ['Ib = Ic', 'Ib ≥ Ic / 10', 'Ib = Ic · β', 'Ib = 0'], answer: 1, explain: 'β_zorlanmış ≈ 10 ile hesaplanır: sıcaklık ve parça farklarına karşı doyum garanti olur.' },
      { id: 'q3', q: 'Transistör kesimdeyken Vce yaklaşık kaç volttur?', options: ['≈ 0 V', '≈ 0.7 V', '≈ Vcc', 'Negatif'], answer: 2, explain: 'Kesimde Ic ≈ 0 olduğundan yük/LED üzerinde düşüm yoktur; Vce ≈ Vcc.' },
      { id: 'q4', q: 'Devrede taban akımı kaç amperdir?', answer: 0.00043, tol: 0.1, unit: 'A', explain: 'Ib = (5 − 0.7)/10 kΩ ≈ 0.43 mA.', verify: { probe: { q: 'val', comp: 'Q1', key: 'ib' } } },
      { id: 'q5', q: '50 mA yük için doyum amacıyla yaklaşık kaç mA taban akımı gerekir?', answer: 0.005, tol: 0.05, unit: 'A', explain: 'Ib = Ic / 10 = 50 mA / 10 = 5 mA.' },
    ],
    challenge: {
      id: 'c1', title: '50 mA’lık yükü doyuma sür',
      goal: '12 V / 240 Ω yükü 5 V mantık sinyaliyle anahtarlayın: Vce < 0.3 V ve yük akımı 40–55 mA olmalı (RB’yi seçin).',
      hints: ['Ic ≈ 12/240 = 50 mA → Ib ≥ 5 mA.', 'RB = (5 − 0.7)/5 mA ≈ 860 Ω.', '680 Ω seçin; başlangıçtaki 100 kΩ transistörü aktif bölgede bırakır.'],
      start: () => npnLoadLab(100000),
      solution: () => npnLoadLab(680),
      checks: [
        { label: 'Vce(sat)', probe: { q: 'val', comp: 'Q1', key: 'vce' }, max: 0.3, unit: 'V' },
        { label: 'Yük akımı', probe: { q: 'i', comp: 'RL' }, min: 0.04, max: 0.055, unit: 'A' },
      ],
    },
    faultHunt: {
      id: 'f1', title: 'LED yanmıyor',
      symptom: 'V2 = 5 V uygulanmış ama LED hiç yanmıyor. Q1 sağlam olabilir; hangi parçada ne arıza var?',
      circuit: npnSwitchLab,
      hidden: { RB: { kind: 'open' } },
      hints: ['Q1’in Vbe değerine bakın: 0 V civarı mı?', 'Taban akımı (Ib) sıfırsa nedeni tabanı besleyen yolda arayın.', 'RB’nin iki ucu arasındaki gerilimi ölçün: 5 V görüyorsanız yol kopuktur.'],
      answer: { comp: 'RB', kind: 'open' },
      explain: 'RB açık olduğunda taban akımı 0 olur, Ic = 0, LED söner; RB uçları arasında V2’nin tamamı (5 V) görünür.',
      telltale: { q: 'i', comp: 'RC' },
    },
  },

  /* ====================== 6 ====================== */
  {
    id: 'analog-06-npn-aktif', track: 'analog', level: 'baslangic', title: 'NPN aktif bölge ve akım kazancı', minutes: 15,
    summary: 'Aktif bölgede Ic = β·Ib: transistör akım yükselteci gibi çalışır, Vce yük direnciyle belirlenir.',
    prerequisites: ['analog-05-npn-anahtar', 'temel-06-bolucu'],
    objectives: [
      'Aktif bölge ile doyum bölgesini Vce ve Ic/Ib oranına bakarak ayırt etmek.',
      'β değerini ölçüp Ic = β·Ib ile kolektör akımını tahmin etmek.',
      'β değişince Ic ve Vce’nin nasıl değiştiğini (β’ya bağımlı kutuplama zayıflığını) görmek.',
    ],
    theory: [
      { t: 'p', text: 'Taban akımı küçük tutulursa (β·Ib, doyum akımından küçük kalırsa) transistör doyuma girmez; Vce ≈ Vcc − Ic·RC gibi ara bir değerde durur. Bu aktif bölgedir ve Ic Ib ile orantılıdır.' },
      { t: 'formula', text: 'Ic = β · Ib', note: 'β = hFE, bu modelde βF parametresi (300).' },
      { t: 'formula', text: 'Vce = Vcc − Ic · RC', note: 'Aktif bölgenin şartı: Vce > Vce(sat) ≈ 0.2 V.' },
      { t: 'formula', text: 'Ib = (Vcc − Vbe) / RB', note: 'Sabit taban akımı ile kutuplama.' },
      { t: 'warn', text: 'Tek dirençle kutuplamada Ic doğrudan β’ya bağlıdır; β parçadan parçaya 2–3 kat değişir. Bu yüzden gerçek yükselteçlerde emitör direnci/geri besleme kullanılır.' },
      { t: 'p', text: 'Simülatör notu: modelde Early etkisi yoktur; aktif bölgede Ic, Vce’ye pratik olarak bağlı değildir (ideal akım kaynağı gibi). Gerçekte Vce arttıkça Ic biraz artar.' },
    ],
    calc: [
      { title: 'Taban akımı', formula: 'Ib = (Vcc − Vbe) / RB', working: '(10 − 0.65) / 470 kΩ ≈ 19.9 µA' },
      { title: 'Kolektör akımı', formula: 'Ic = β·Ib', working: '300 × 19.9 µA ≈ 5.97 mA' },
      { title: 'Kolektör gerilimi', formula: 'Vce = Vcc − Ic·RC', working: '10 − 5.97 mA · 1 kΩ ≈ 4.0 V → aktif bölge' },
    ],
    build: npnActiveLab,
    steps: [
      'DC çöz’e basın: Q1 için Ib, Ic ve β (Ic/Ib) değerlerini okuyun.',
      'Vce’nin ≈ 4 V olduğunu doğrulayın; doyum değil, aktif bölge.',
      'Q1’in β parametresini 100 yapın: Ic ≈ 2 mA, Vce ≈ 8 V olur. β = 600 yapınca ne olur?',
      'RB’yi 100 kΩ yapın: β·Ib çok büyür, Vce ≈ 0.1 V (doyum): Ic artık β·Ib değil yük tarafından sınırlanır.',
    ],
    expects: [
      { label: 'Taban akımı', probe: { q: 'val', comp: 'Q1', key: 'ib' }, value: 1.99e-5, tol: { rel: 0.1 }, unit: 'A' },
      { label: 'Kolektör akımı', probe: { q: 'val', comp: 'Q1', key: 'ic' }, value: 0.00597, tol: { rel: 0.1 }, unit: 'A' },
      { label: 'Akım kazancı', probe: { q: 'val', comp: 'Q1', key: 'beta' }, value: 300, tol: { rel: 0.05 }, unit: '' },
      { label: 'Vce', probe: { q: 'val', comp: 'Q1', key: 'vce' }, value: 4.0, tol: { abs: 0.5 }, unit: 'V' },
    ],
    mistakes: [
      'Ic = β·Ib formülünü doyumda uygulamak: doyumda Ic yük tarafından sınırlanır, β·Ib’den küçüktür.',
      'β’yı sabit sanmak: parçadan parçaya ve sıcaklıkla değişir.',
      'Vbe’yi hesaba katmamak: küçük Vcc’de Ib hatalı çıkar.',
    ],
    faults: [
      { title: 'RB değer kayması (−%50)', how: 'RB → Değer kayması → −50 %.', symptom: 'Ib iki katına çıkar (≈ 40 µA), Ic ≈ 12 mA → Vcc − 12 V < 0: transistör doyuma girer, Vce ≈ 0.2 V.' },
      { title: 'Q1 C–E kaçak (10 kΩ)', how: 'Q1 → Kaçak akım → 10 kΩ.', symptom: 'Ic’ye ek kaçak akımı eklenir; Vce biraz düşer ve β görünür değeri yükselir.' },
    ],
    quiz: [
      { id: 'q1', q: 'Aktif bölgede Ic ile Ib arasındaki ilişki nedir?', options: ['Ic = Ib', 'Ic = β·Ib', 'Ic = Ib / β', 'Ic Ib’den bağımsız'], answer: 1, explain: 'Aktif bölgede kolektör akımı taban akımının β katıdır.' },
      { id: 'q2', q: 'β = 100 olursa (diğer her şey aynı) Vce yaklaşık kaç volt olur?', options: ['≈ 2 V', '≈ 4 V', '≈ 8 V', '≈ 10 V'], answer: 2, explain: 'Ic = 100 · 19.9 µA ≈ 2 mA → Vce = 10 − 2 = 8 V.' },
      { id: 'q3', q: 'Hangi durumda transistör doyumdadır?', options: ['Vce ≈ Vcc', 'Vce ≈ 0.1–0.2 V ve Ic < β·Ib', 'Ib = 0', 'Vbe = 0'], answer: 1, explain: 'Doyumda Vce çok küçük kalır ve Ic yük tarafından sınırlandığından β·Ib’den küçük çıkar.' },
      { id: 'q4', q: 'Devrede kolektör akımı kaç amperdir?', answer: 0.00597, tol: 0.1, unit: 'A', explain: 'Ic = 300 · 19.9 µA ≈ 5.97 mA.', verify: { probe: { q: 'val', comp: 'Q1', key: 'ic' } } },
    ],
  },

  /* ====================== 7 ====================== */
  {
    id: 'analog-07-mosfet-anahtar', track: 'analog', level: 'orta', title: 'MOSFET anahtar: VGS(th), mantık seviyeli ve standart gate', minutes: 18,
    summary: 'MOSFET gerilimle sürülür; VGS eşiğin yeterince üstünde olmalı. RDS(on) ≈ 1/(2K·(VGS − Vth)).',
    prerequisites: ['analog-05-npn-anahtar'],
    objectives: [
      'VGS(th) kavramını ve mantık seviyeli ile standart MOSFET farkını açıklamak.',
      'Doğrusal (triyot) bölgede RDS(on) değerini hesaplamak ve VDS = ID·RDS(on) ile ısı gücünü bulmak.',
      '3.3 V gate sürüşünde standart MOSFET’in neden tam iletmediğini göstermek.',
    ],
    theory: [
      { t: 'p', text: 'N-MOSFET, VGS eşik gerilimini (VGS(th)) aştıktan sonra drain–source kanalı oluşturur. Anahtar olarak kullanılırken amaç doğrusal (omik) bölgede çalışmaktır: VDS küçük, kanal küçük bir direnç RDS(on) gibi davranır. Bunun için VGS ≫ VGS(th) olmalıdır.' },
      { t: 'formula', text: 'Vov = VGS − VGS(th)', note: 'Aşırı sürüş gerilimi. Vov ≤ 0 → kesim.' },
      { t: 'formula', text: 'RDS(on) ≈ 1 / (2·K·Vov)  (küçük VDS)', note: 'Bu modelde ID(doyum) = K·Vov², triyotta ID = K(2·Vov·VDS − VDS²).' },
      { t: 'formula', text: 'P = ID² · RDS(on)', note: 'Anahtarın ısıl kaybı; RDS(on) küçüldükçe azalır.' },
      { t: 'warn', text: '3.3 V mantıklı bir MCU’yu standart (VGS(th) ≈ 3.5 V) MOSFET’e bağlamak transistörü açmaz; 5 V’ta bile Vov küçük kalırsa RDS(on) yükselir ve MOSFET ısınır. MCU için "mantık seviyeli" parça seçin.' },
      { t: 'p', text: 'Simülatör notu: seviye-1 MOSFET modeli; gate kapasitesi (Qg), RDS(on)–sıcaklık ve SOA yoktur. Gate, DC’de akım çekmez.' },
    ],
    calc: [
      { title: 'Mantık seviyeli MOSFET (Vth = 1.8 V, K = 7)', formula: 'Vov = 3.3 − 1.8; RDS(on) = 1/(2·K·Vov)', working: 'Vov = 1.5 V → RDS(on) ≈ 1/(2·7·1.5) ≈ 48 mΩ; ID ≈ 12/12.05 ≈ 1 A; VDS ≈ 48 mV; P ≈ 48 mW' },
      { title: 'Standart MOSFET (Vth = 3.5 V)', formula: 'Vov = 3.3 − 3.5 < 0', working: 'Vov = −0.2 V → kesim: ID ≈ 0, VDS ≈ 12 V (anahtar açılmaz)' },
      { title: '5 V ile standart MOSFET', formula: 'RDS(on) = 1/(2·4·1.5)', working: 'Vov = 1.5 V → RDS(on) ≈ 83 mΩ (iletir ama mantık seviyeliden zayıftır)' },
    ],
    build: mosSwitchLab,
    steps: [
      'DC çöz’e basın. Q1 (mantık) ve Q2 (standart) için VGS, VDS, ID değerlerini okuyun.',
      'V2’yi 5 V yapın: Q2 artık iletir mi? VDS ve ID’ye bakın.',
      'V2’yi yavaş yavaş 1.8 V’tan 4 V’a kadar artırıp Q1 ve Q2 akımlarını karşılaştırın.',
      'Q1’in VGS(th) parametresini 3.5 V yapın: davranış Q2 ile aynılaşır.',
    ],
    expects: [
      { label: 'Q1 (mantık) VDS', probe: { q: 'val', comp: 'Q1', key: 'vds' }, value: 0.05, tol: { abs: 0.06 }, unit: 'V' },
      { label: 'Q1 yük akımı', probe: { q: 'val', comp: 'Q1', key: 'id' }, value: 1.0, tol: { rel: 0.05 }, unit: 'A' },
      { label: 'Q2 (standart) VDS', probe: { q: 'val', comp: 'Q2', key: 'vds' }, value: 12, tol: { rel: 0.02 }, unit: 'V' },
      { label: 'Q2 akımı (kesim)', probe: { q: 'val', comp: 'Q2', key: 'id' }, value: 0, tol: { abs: 1e-3 }, unit: 'A' },
    ],
    mistakes: [
      'MOSFET’i VGS = VGS(th) ile açık sanmak: eşikte akım çok küçüktür, tam iletim için Vov ≫ 0 gerekir.',
      'Mantık seviyesini bilmeden standart MOSFET’i MCU’ya bağlamak.',
      'Gate’i boşta bırakmak: gate yüzer, MOSFET rastgele açılıp kapanır (bkz. sonraki ders).',
    ],
    faults: [
      { title: 'Q1 gate hasarı (G–S kısa)', how: 'Q1 → Gate hasarı (G–S kısa).', symptom: 'Gate kaynağa çekilir: VGS ≈ 0, MOSFET kesimde; V2 kaynağı da yüklenir (ideal kaynakta akım çeker).' },
      { title: 'Q1 D–S kısa devre', how: 'Q1 → Kısa devre.', symptom: 'VDS ≈ 0 ve ID ≈ 1 A; gate kontrolü kaybolur, yük sürekli enerjili.' },
    ],
    quiz: [
      { id: 'q1', q: '3.3 V gate sürüşü ile hangi MOSFET iletir?', options: ['VGS(th) = 1.8 V olan mantık seviyeli', 'VGS(th) = 3.5 V olan standart', 'İkisi de', 'İkisi de iletmez'], answer: 0, explain: 'Vov > 0 olmalı: 3.3 > 1.8 (iletir), 3.3 < 3.5 (kesimde kalır).' },
      { id: 'q2', q: 'RDS(on) neyi gösterir?', options: ['Gate direnci', 'İletimdeki D–S direnci', 'Kesimdeki D–S direnci', 'Kaynak iç direnci'], answer: 1, explain: 'Anahtar kapalıyken kanalın küçük omik direncidir; ısıl kaybı P = I²·RDS(on) belirler.' },
      { id: 'q3', q: 'Aşırı sürüş (Vov) arttıkça RDS(on) ne olur?', options: ['Artar', 'Azalır', 'Değişmez', 'Sonsuz olur'], answer: 1, explain: 'RDS(on) ≈ 1/(2·K·Vov): Vov arttıkça direnç azalır, ısı kaybı küçülür.' },
      { id: 'q4', q: 'Mantık seviyeli Q1’in yük akımı kaç amperdir?', answer: 1.0, tol: 0.05, unit: 'A', explain: 'ID ≈ 12 V / (12 Ω + 48 mΩ) ≈ 1 A.', verify: { probe: { q: 'val', comp: 'Q1', key: 'id' } } },
    ],
  },

  /* ====================== 8 ====================== */
  {
    id: 'analog-08-mosfet-yuk', track: 'analog', level: 'orta', title: 'MOSFET ile yük sürme: gate direnci ve pulldown', minutes: 20,
    summary: 'PWM ile yük sürerken gate direnci kenarları yumuşatır, pulldown gate’i açılışta/kopukken kapalı tutar.',
    prerequisites: ['analog-07-mosfet-anahtar'],
    objectives: [
      'MOSFET ile düşük taraftan yük sürmeyi (low-side) kurmak ve PWM ortalamasını hesaplamak.',
      'Gate seri direnci (RG) ve gate pulldown (RPD) görevlerini açıklamak.',
      'Gate kopuk/kayıp sinyalde yükün neden istemsiz çalışabileceğini göstermek.',
    ],
    theory: [
      { t: 'p', text: 'Düşük taraf (low-side) anahtarlamada yük kaynağın artısı ile MOSFET drain’i arasındadır; MOSFET source’u toprağa bağlıdır. Gate’e 0 / 3.3 V kare dalga uygulandığında yük ortalama olarak doluluk (duty) oranında enerjilenir.' },
      { t: 'formula', text: 'Ortalama akım = duty · Vkaynak / RL', note: '%50 duty, 12 V / 12 Ω → 0.5 A ortalama (1 A tepe).' },
      { t: 'formula', text: 'τg = RG · Ciss', note: 'Gate direnci gate kapasitesiyle RC oluşturur: kenar hızını yavaşlatır, zil/pik ve EMI’yi azaltır, MCU pinini korur.' },
      { t: 'formula', text: 'RPD ≈ 10 kΩ', note: 'Gate–source arasına pulldown: sürücü pin yüksek empedanslıyken (reset, boot) gate’i 0 V’ta tutar; MOSFET kapalı kalır.' },
      { t: 'warn', text: 'RG çok küçük ise sürücü pininden büyük anlık akım çekilir; RG çok büyükse geçiş yavaşlar ve MOSFET doğrusal bölgede uzun kalıp ısınır. Pulldown olmayan gate yüzer ve yük kontrolsüz açılabilir.' },
      { t: 'p', text: 'Simülatör notu: modelde gate kapasitesi (Ciss/Qg) yoktur; bu yüzden RG, kenar hızını değiştirmez ve DC’de gate akımı sıfır olduğundan RG üzerinde düşüm olmaz. RG’nin etkisi bu simülatörde gösterilemez; yalnızca açık devre arızası ve pulldown davranışı gözlenir.' },
    ],
    calc: [
      { title: 'Tepe akım', formula: 'I = Vkaynak / (RL + RDS(on))', working: '12 / (12 + 0.05) ≈ 1.0 A' },
      { title: 'Ortalama akım', formula: 'Iort = duty · I', working: '0.5 · 1.0 A = 0.5 A' },
      { title: 'Gate sürüşü', formula: 'VGS = Vsürücü · RPD / (RG + RPD)', working: '3.3 · 10k / (100 + 10k) ≈ 3.27 V (DC’de gate akımı 0 ise 3.3 V)' },
    ],
    build: () => mosDriveLab('nmos_logic', true), speed: 0.01,
    steps: [
      'Hız çarpanını 0.01 yapıp Çalıştır’a basın; osiloskopta gate ve drain düğümlerini seçin.',
      'Gate ve drain’in aynı frekansta, birbirinin tersi yönde değiştiğini izleyin (gate yüksek → drain ≈ 0 V).',
      'V2 duty değerini %25 / %75 yapın: ortalama yük akımı nasıl değişir?',
      'RG’yi 1 kΩ yapın: DC ve tran sonuçlarında bir fark gözleniyor mu? (Modelde gate kapasitesi yok.)',
      'Ardından V2’yi kaldırın (kaynağı silin/devre dışı bırakın) ve gate gerilimini görün: RPD gate’i 0 V’a çeker.',
    ],
    expects: [
      { label: 'Ortalama yük akımı (%50 duty)', probe: { q: 'i', comp: 'RL' }, value: 0.5, tol: { rel: 0.07 }, unit: 'A', tran: { stop: 0.01, dt: 5e-6, stat: 'mean', skip: 0.1 } },
      { label: 'Gate tepe gerilimi', probe: { q: 'node', comp: 'Q1', pin: 'G' }, value: 3.3, tol: { rel: 0.03 }, unit: 'V', tran: { stop: 0.01, dt: 5e-6, stat: 'max', skip: 0.1 } },
      { label: 'Drain tepe gerilimi (kapalı)', probe: { q: 'node', comp: 'Q1', pin: 'D' }, value: 12, tol: { rel: 0.03 }, unit: 'V', tran: { stop: 0.01, dt: 5e-6, stat: 'max', skip: 0.1 } },
      { label: 'Drain en düşük gerilimi (iletimde)', probe: { q: 'node', comp: 'Q1', pin: 'D' }, value: 0.05, tol: { abs: 0.06 }, unit: 'V', tran: { stop: 0.01, dt: 5e-6, stat: 'min', skip: 0.1 } },
    ],
    mistakes: [
      'Gate’i bağlı bırakmayıp pulldown koymamak: gate yüzer, yük rastgele çalışabilir.',
      'RG = 0 ile hızlı sürmek: pik akım, zil ve EMI. Gerçekte RG = 10–100 Ω kullanılır.',
      'Standart MOSFET’i 3.3 V MCU ile sürmek (bkz. önceki ders).',
    ],
    faults: [
      { title: 'RG açık devre', how: 'RG → Açık devre.', symptom: 'Gate sürücüden kopar; RPD gate’i 0 V’a çeker, MOSFET kapalı kalır, yük akımı 0 olur.' },
      { title: 'RPD kısa devre', how: 'RPD → Kısa devre.', symptom: 'Gate toprağa çekilir (RG üzerinden sürücü yüklenir); MOSFET hiç açılmaz.' },
      { title: 'Q1 gate hasarı', how: 'Q1 → Gate hasarı (G–S kısa).', symptom: 'VGS ≈ 0; yük çalışmaz, sürücü kaynağı RG üzerinden yüklenir.' },
    ],
    quiz: [
      { id: 'q1', q: 'Gate pulldown direncinin görevi nedir?', options: ['Yük akımını sınırlamak', 'Sürücü yokken gate’i 0 V’ta tutup MOSFET’i kapalı bırakmak', 'Gate gerilimini artırmak', 'Drain’i korumak'], answer: 1, explain: 'Gate yüksek empedansta kalırsa yüzer; pulldown onu tanımlı 0 V seviyesine bağlar.' },
      { id: 'q2', q: 'Gate seri direnci (RG) gerçekte neyi yapar?', options: ['Yük akımını azaltır', 'Gate kapasitesiyle RC oluşturup kenarları yumuşatır ve sürücü akımını sınırlar', 'VDS’i azaltır', 'Hiçbir şey'], answer: 1, explain: 'τ = RG·Ciss; geçiş hızı, pik akım ve zil bu direnç ile ayarlanır.' },
      { id: 'q3', q: '%25 duty’de 12 V / 12 Ω yükün ortalama akımı yaklaşık nedir?', options: ['0.25 A', '0.5 A', '1 A', '2 A'], answer: 0, explain: 'Tepe 1 A × duty 0.25 = 0.25 A.' },
      { id: 'q4', q: '%50 duty’de yük akımının ortalaması kaç amperdir?', answer: 0.5, tol: 0.07, unit: 'A', explain: 'Iort = 0.5 · 1 A = 0.5 A.', verify: { probe: { q: 'i', comp: 'RL' }, tran: { stop: 0.01, dt: 5e-6, stat: 'mean', skip: 0.1 } } },
    ],
    challenge: {
      id: 'c1', title: '3.3 V ile 12 Ω yükü sür',
      goal: '3.3 V gate sürüşü ile yük akımı ≥ 0.9 A ve MOSFET VDS < 0.3 V olacak şekilde Q1’i uygun tiple değiştirin.',
      hints: ['Standart MOSFET’in eşiği 3.5 V: 3.3 V ile kesimde kalır.', 'Mantık seviyeli tipte (nmos_logic) eşik 1.8 V.', 'Q1’i nmos_logic ile değiştirin.'],
      start: () => mosDriveLab('nmos_std', false),
      solution: () => mosDriveLab('nmos_logic', false),
      checks: [
        { label: 'Yük akımı', probe: { q: 'i', comp: 'RL' }, min: 0.9, unit: 'A' },
        { label: 'VDS', probe: { q: 'val', comp: 'Q1', key: 'vds' }, max: 0.3, unit: 'V' },
      ],
    },
    faultHunt: {
      id: 'f1', title: 'Yük çalışmıyor',
      symptom: 'Sürücü 3.3 V verir ama 12 Ω yük çalışmıyor; MOSFET’in kendisi sağlam görünüyor. Sorun nerede?',
      circuit: () => mosDriveLab('nmos_logic', false),
      hidden: { RG: { kind: 'open' } },
      hints: ['Gate düğümünün gerilimini ölçün: 3.3 V mu?', 'Gate 0 V ise sürücüden gate’e giden yolu inceleyin.', 'RG’nin iki ucundaki gerilimler farklıysa direnç yolu açıktır.'],
      answer: { comp: 'RG', kind: 'open' },
      explain: 'RG açık olduğundan sürücü gate’e ulaşamaz; pulldown gate’i 0 V’a çeker, MOSFET kesimde kalır ve yük akımı 0 olur.',
      telltale: { q: 'i', comp: 'RL' },
    },
  },

  /* ====================== 9 ====================== */
  {
    id: 'analog-09-rc-filtre', track: 'analog', level: 'orta', title: 'RC alçak ve yüksek geçiren filtre', minutes: 20,
    summary: 'RC filtre fc = 1/(2πRC) frekansında −3 dB (0.707) verir; alçak geçiren yüksekleri, yüksek geçiren alçakları keser.',
    prerequisites: ['temel-08-rc'],
    objectives: [
      'Alçak geçiren (LP) ve yüksek geçiren (HP) RC filtrelerin kesim frekansını hesaplamak.',
      'Kesim frekansında genliğin 0.707 katına (−3 dB) düştüğünü ölçmek.',
      'İstenen bir frekansta hedef zayıflamayı sağlayacak C değerini seçmek.',
    ],
    theory: [
      { t: 'p', text: 'Alçak geçiren filtrede (seri R, paralel C) çıkış kondansatörden alınır; yüksek frekanslarda kondansatör empedansı küçüldüğü için çıkış zayıflar. Yüksek geçiren filtrede (seri C, paralel R) çıkış dirençten alınır; düşük frekanslar kondansatörden geçemez.' },
      { t: 'formula', text: 'fc = 1 / (2π · R · C)', note: 'R = 1 kΩ, C = 160 nF → fc ≈ 995 Hz.' },
      { t: 'formula', text: '|H_LP| = 1 / √(1 + (f/fc)²)', note: 'f = fc → 0.707 (−3 dB); f = 2fc → 0.447; f = 0.1fc → ≈ 1.' },
      { t: 'formula', text: '|H_HP| = (f/fc) / √(1 + (f/fc)²)', note: 'f = fc → 0.707; f ≪ fc → ≈ f/fc.' },
      { t: 'warn', text: 'Filtre çıkışına yük bağlanırsa (R yük ≈ R) kesim frekansı ve kazanç değişir; ölçümde osiloskop probu (10 MΩ) ihmal edilebilir ama gerçek yük edilemez.' },
      { t: 'p', text: 'Simülatör notu: ideal kaynak ve ideal R/C; ölçüm tran istatistikleriyle (max = tepe genlik) yapılır. Sürekli rejim için ilk %50 atlanır (skip).' },
    ],
    calc: [
      { title: 'Kesim frekansı', formula: 'fc = 1 / (2π·R·C)', working: '1 / (2π · 1000 · 160e-9) ≈ 995 Hz' },
      { title: '1 kHz’te LP kazancı', formula: '|H| = 1/√(1 + (f/fc)²)', working: 'f/fc = 1000/995 ≈ 1.005 → |H| ≈ 0.705 → çıkış tepesi ≈ 0.705 V (giriş 1 V)' },
      { title: '1 kHz’te HP kazancı', formula: '|H| = (f/fc)/√(1 + (f/fc)²)', working: '1.005 / 1.419 ≈ 0.708 → çıkış tepesi ≈ 0.71 V' },
    ],
    build: () => rcFilterLab(), speed: 0.01,
    steps: [
      'Hız çarpanını 0.01 yapın; Çalıştır’a basın. Osiloskopta giriş (V1.P), LP çıkış (C1.1) ve HP çıkış (R2.1) düğümlerini seçin.',
      'Kaynak frekansı 1 kHz (≈ fc): iki çıkış da ≈ 0.7 V tepe, faz farkı ±45°.',
      'Frekansı 100 Hz yapın: LP ≈ 1 V (geçer), HP ≈ 0.1 V (zayıf). 10 kHz’te tersini gözleyin.',
      'C1’i 320 nF yapın: LP kesim frekansı yarıya iner; 1 kHz’te genlik ≈ 0.45 V olur.',
    ],
    expects: [
      { label: 'LP çıkış tepe genliği (1 kHz)', probe: { q: 'node', comp: 'C1', pin: '1' }, value: 0.705, tol: { abs: 0.04 }, unit: 'V', tran: { stop: 0.02, dt: 5e-6, stat: 'max', skip: 0.5 } },
      { label: 'HP çıkış tepe genliği (1 kHz)', probe: { q: 'node', comp: 'R2', pin: '1' }, value: 0.708, tol: { abs: 0.04 }, unit: 'V', tran: { stop: 0.02, dt: 5e-6, stat: 'max', skip: 0.5 } },
      { label: 'LP çıkış RMS', probe: { q: 'node', comp: 'C1', pin: '1' }, value: 0.5, tol: { abs: 0.03 }, unit: 'V', tran: { stop: 0.02, dt: 5e-6, stat: 'rms', skip: 0.5 } },
    ],
    mistakes: [
      'fc’yi yalnızca RC çarpımının tersi (1/RC) sanmak: 2π unutulur, kesim 6.28 kat hatalı çıkar.',
      'Kesim frekansını "çıkışın sıfıra gittiği" nokta sanmak: kesimde genlik 0.707’dir; azalma yavaştır (−20 dB/dekad).',
      'Çıkışı yüklemek: alçak geçiren filtreyi düşük dirençli yüke bağlamak kazancı düşürür.',
    ],
    faults: [
      { title: 'C1 kapasite kaybı (%50)', how: 'C1 → Kapasite kaybı → %50.', symptom: 'LP’nin fc değeri ≈ 2 kHz’e kayar; 1 kHz’te çıkış ≈ 0.9 V olur (filtre işlevi azalır).' },
      { title: 'C1 açık devre', how: 'C1 → Açık devre.', symptom: 'LP kolu filtre etkisini yitirir: çıkış girişi aynen izler (≈ 1 V tepe).' },
    ],
    quiz: [
      { id: 'q1', q: 'Kesim frekansında genlik giriş genliğinin kaç katıdır?', options: ['0.5', '0.707', '0.9', '0.1'], answer: 1, explain: 'f = fc’de |H| = 1/√2 ≈ 0.707 (−3 dB).' },
      { id: 'q2', q: 'R = 1 kΩ, C = 160 nF için fc yaklaşık kaç Hz’dir?', options: ['160 Hz', '995 Hz', '6.28 kHz', '100 kHz'], answer: 1, explain: 'fc = 1/(2π·1000·160e-9) ≈ 995 Hz.' },
      { id: 'q3', q: 'Yüksek geçiren filtrede çıkış nereden alınır?', options: ['Kondansatör uçlarından', 'Direnç uçlarından (kondansatör seridedir)', 'Kaynaktan', 'Topraktan'], answer: 1, explain: 'HP’de C seridedir, çıkış R üzerinden alınır: düşük frekanslar C’de kalır.' },
      { id: 'q4', q: '1 kHz’te LP filtre çıkışının tepe genliği (V) nedir?', answer: 0.705, tol: 0.05, unit: 'V', explain: 'fc ≈ 995 Hz → |H| ≈ 0.705.', verify: { probe: { q: 'node', comp: 'C1', pin: '1' }, tran: { stop: 0.02, dt: 5e-6, stat: 'max', skip: 0.5 } } },
    ],
    challenge: {
      id: 'c1', title: '1 kHz’i yaklaşık yarıya indir',
      goal: '1 kHz, 1 V tepe girişte LP çıkış tepesini 0.40–0.49 V arasına indirin (C1 değerini değiştirin; R = 1 kΩ).',
      hints: ['|H| = 0.45 için f/fc = 2 → fc ≈ 500 Hz.', 'C = 1/(2π·R·fc) ≈ 320 nF.', 'Başlangıçtaki 160 nF yalnızca 0.7 V verir.'],
      start: () => rcChallengeLab(160e-9),
      solution: () => rcChallengeLab(320e-9),
      checks: [{ label: 'LP çıkış tepesi (1 kHz)', probe: { q: 'node', comp: 'C1', pin: '1' }, min: 0.40, max: 0.49, unit: 'V', tran: { stop: 0.02, dt: 5e-6, stat: 'max', skip: 0.5 } }],
    },
  },

  /* ====================== 10 ====================== */
  {
    id: 'analog-10-flyback', track: 'analog', level: 'orta', title: 'Serbest dönüş (flyback) diyotu: bobin yükünü korumak', minutes: 20,
    summary: 'Bobin akımı aniden kesilirse v = L·di/dt çok büyük bir gerilim pikine yol açar; diyot bu akıma yol verir.',
    prerequisites: ['analog-08-mosfet-yuk', 'analog-01-diyot'],
    objectives: [
      'Bobin akımının anlık değişemeyeceğini ve kesilince "endüktif tepme" (inductive kick) oluştuğunu açıklamak.',
      'Flyback diyotunun yönünü (kaynağa göre ters) ve akım yolunu çizmek.',
      'VDS tepe gerilimini diyotlu ve diyotsuz devrede ölçüp karşılaştırmak.',
    ],
    theory: [
      { t: 'p', text: 'Bobin akımı enerji depoladığı için ani değişemez: v = L·di/dt. MOSFET bobin akımını aniden kestiğinde di/dt çok büyük olur ve bobin akımı sürdürmek için drain düğümünü çok yüksek gerilime çeker. Gerçekte bu gerilim MOSFET’in çığ (avalanche) sınırına kadar çıkar ve parçayı öldürür; röle, motor, solenoid sürerken klasik arıza nedenidir.' },
      { t: 'formula', text: 'v_L = L · di/dt', note: 'Akım ΔI kadar çok kısa Δt’de kesilirse v_L = L·ΔI/Δt.' },
      { t: 'formula', text: 'Vdrain,tepe ≈ Vcc + Vf', note: 'Flyback diyotu (katot Vcc’ye, anot drain’e) iletime girer ve bobin akımını Vcc hattına geri döndürür.' },
      { t: 'warn', text: 'Diyotun yönü önemlidir: katot + beslemeye bağlanır (bobine paralel, normalde ters yönde). Diyot ters bağlanırsa normal çalışmada kısa devre olur. Diyot, bobin akımını sönümleyene kadar iletir; sönümleme süresi L/R ile uzar.' },
      { t: 'p', text: 'Simülatör notu: transient çözücü ideal bobin ve kesilen MOSFET kullanır; kesilen yolun sızıntısı (gmin = 1e-12 S) nedeniyle diyotsuz devrede drain gerilimi binlerce volta çıkar. Bu tepe değeri adım boyutuna (dt) bağlıdır: önemli olan büyüklük mertebesidir. Gerçekte MOSFET’in VDS(max) = 55 V sınırı aşılır ve çığ/hasar oluşur. Simülatör, VDS aşımını ayrıca raporlamaz.' },
    ],
    calc: [
      { title: 'Bobin akımı (tepe)', formula: 'I = (Vcc/R)·(1 − e^(−t/τ)), τ = L/R', working: 'τ = 10 mH / 12 Ω = 0.83 ms; t = 1 ms → I ≈ 1 · (1 − e^−1.2) ≈ 0.70 A' },
      { title: 'Depolanan enerji', formula: 'E = ½ · L · I²', working: '0.5 · 10 mH · (0.7)² ≈ 2.5 mJ' },
      { title: 'Diyotlu devrede drain tepesi', formula: 'Vcc + Vf', working: '12 + 0.7 ≈ 12.9 V' },
    ],
    build: flybackLab, speed: 0.01,
    steps: [
      'Hız çarpanını 0.01 yapın; Çalıştır’a basın. Osiloskopta Q1.D (diyotlu) ve Q2.D (diyotsuz) düğümlerini seçin.',
      'Q1.D’nin ≈ 12–13 V’ta sınırlı kaldığını, Q2.D’de ise çok büyük pikler olduğunu görün (ölçeği büyütün).',
      'D1’i tersine çevirin: diyotlu kolda da pik görünür. Neden?',
      'L değerini 20 mH yapın: akım ve enerji artar, ancak diyotlu kolda VDS yine ≈ 12.9 V’ta kalır.',
    ],
    expects: [
      { label: 'Diyotlu kol Q1 drain tepesi', probe: { q: 'node', comp: 'Q1', pin: 'D' }, value: 12.9, tol: { abs: 0.6 }, unit: 'V', tran: FLY },
      { label: 'Diyotsuz kol Q2 drain tepesi (büyüklük mertebesi)', probe: { q: 'node', comp: 'Q2', pin: 'D' }, value: 3000, tol: { abs: 2800 }, unit: 'V', tran: FLY },
      { label: 'Bobin tepe akımı (L1)', probe: { q: 'i', comp: 'L1' }, value: 0.75, tol: { rel: 0.12 }, unit: 'A', tran: FLY },
    ],
    mistakes: [
      'Flyback diyotunu unutmak veya yanlış yönde bağlamak: tepme gerilimi anahtarı yok eder.',
      'Diyodu anahtara paralel bağlamak: bobine paralel olmalıdır.',
      'Yalnızca "kısa süre" olduğu için pikin zararsız sanılması: enerji küçük olsa bile gerilim, yarıiletkenin kırılma sınırını aşar.',
    ],
    faults: [
      { title: 'D1 açık devre', how: 'D1 → Açık devre.', symptom: 'Diyotlu kol diyotsuz gibi davranır: Q1.D piki ≈ binlerce volta çıkar (modelde).' },
      { title: 'D1 kısa devre', how: 'D1 → Kısa devre.', symptom: 'Drain doğrudan Vcc’ye bağlanır: bobin atlanır, MOSFET açılınca Vcc’yi neredeyse doğrudan toprağa çeker; çok büyük Q1 akımı ve limit (ID) aşımı.' },
    ],
    quiz: [
      { id: 'q1', q: 'Bobin akımı aniden kesilirse ne olur?', options: ['Gerilim sıfır olur', 'Bobin akımı sürdürmek için çok yüksek gerilim üretir', 'Akım iki katına çıkar', 'Bobin kısa devre olur'], answer: 1, explain: 'v = L·di/dt: di/dt çok büyükse v çok büyüktür; bobin akımı sürdürmek ister.' },
      { id: 'q2', q: 'Flyback diyotu nasıl bağlanır?', options: ['Bobine paralel, katot Vcc tarafında (normalde ters yönlü)', 'Bobine seri, ileri yönde', 'MOSFET’e paralel', 'Toprakla Vcc arasına, ileri yönde'], answer: 0, explain: 'Normal çalışmada ters biaslıdır; anahtar açılınca bobin akımı diyottan Vcc’ye döner.' },
      { id: 'q3', q: 'Diyotlu devrede drain tepe gerilimi ne olur?', options: ['≈ Vcc + 0.7 V', '≈ 10·Vcc', '≈ 0 V', '≈ Vcc − 0.7 V'], answer: 0, explain: 'Diyot iletime girdiğinde drain düğümünü Vcc + Vf’de kıskaçlar.' },
      { id: 'q4', q: 'Diyotlu kolda drain tepe gerilimi kaç volttur?', answer: 12.9, tol: 0.06, unit: 'V', explain: 'Vcc + Vf ≈ 12 + 0.7 ≈ 12.9 V.', verify: { probe: { q: 'node', comp: 'Q1', pin: 'D' }, tran: FLY } },
    ],
    safety: 'Gerçek devrede endüktif yükü (röle, motor, solenoid) yarıiletkenle sürerken flyback diyotu şarttır. Yüksek enerjili bobinleri kesmek kıvılcım ve parça patlamasına yol açabilir; gerçek ölçümde gözlük kullanın.',
  },
];
