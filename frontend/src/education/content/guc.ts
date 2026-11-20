import { CircuitBuilder } from '../../core/circuit/builder';
import type { Circuit } from '../../core/circuit/types';
import type { Lesson, Probe, TranSpec } from '../types';

/**
 * Güç elektroniği ve ısı (guc-*) + Arıza bulma (ariza-*) dersleri.
 * Isıl sayılar src/core/thermal/thermal.ts içindeki TAHMİNİ Rθ değerlerine dayanır (Tamb = 25 °C varsayımı):
 * TO-220 MOSFET: Rθjc = 1.4, Rθja(serbest) = 62 K/W; küçük/orta/büyük soğutucu Rθsa = 22/8/3 K/W, Rθcs = 0.5 K/W, fan çarpanı 0.4.
 * Isıl modeli yalnızca DC probları ile test edilemez; ısıl aritmetik ders metninde gösterilir.
 */

const N = (comp: string, pin: string): Probe => ({ q: 'node', comp, pin });
const V = (comp: string): Probe => ({ q: 'v', comp });
const I = (comp: string): Probe => ({ q: 'i', comp });
const P = (comp: string): Probe => ({ q: 'p', comp });
const VAL = (comp: string, key: string): Probe => ({ q: 'val', comp, key });

// ------------------------------------------------------------------ devreler

/** guc-01: 12 V → R1 → toprak. */
const powerResistor = (r = 220, pmax = 1): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 12 }, -6, 0, 0, 'V1');
  b.add('resistor', { r, pmax }, 0, -3, 0, 'R1');
  b.add('ground', {}, 0, 4);
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/** guc-02 / ariza-04 ortak iskeleti: 12 V → RL → MOSFET(D) ; V2 → (RG) → gate ; S → toprak. */
const mosLoad = (type: string, vg: number, rl: number, pmax: number, rg = 0): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 12 }, -8, -3, 0, 'V1');
  b.add('dc_supply', { v: vg }, -8, 4, 0, 'V2');
  b.add('resistor', { r: rl, pmax }, 3, -4, 1, 'RL');
  b.add(type, {}, 3, 2, 0, 'Q1');
  b.add('ground', {}, 0, 8);
  b.chain('V1.P', 'RL.1'); b.chain('RL.2', 'Q1.D');
  if (rg > 0) { b.add('resistor', { r: rg }, -2, 4, 0, 'RG'); b.chain('V2.P', 'RG.1'); b.chain('RG.2', 'Q1.G'); } else b.chain('V2.P', 'Q1.G');
  b.chain('Q1.S', 'GND1.G'); b.chain('V1.N', 'GND1.G'); b.chain('V2.N', 'GND1.G');
  return b.circuit;
};

/** guc-03: Buck. Gate sürücüsü V2 (0..10 V kare) G–S arasında yüzer: bootstrap/gate sürücü entegresinin ideal karşılığı. */
const buck = (duty = 50): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 12 }, -10, 0, 0, 'V1');
  b.add('signal_gen', { wave: 'square', v: 5, amp: 5, freq: 20000, duty }, -4, 6, 0, 'V2');
  b.add('irfz44n', {}, -2, -3, 0, 'Q1');
  b.add('sb560', {}, 3, 3, 1, 'D1');
  b.add('inductor', { l: 220e-6, imax: 3 }, 4, -4, 0, 'L1');
  b.add('capacitor_el', { c: 47e-6, vmax: 25 }, 9, 0, 1, 'C1');
  b.add('resistor', { r: 5, pmax: 10 }, 13, 0, 1, 'RL');
  b.add('ground', {}, 4, 9);
  b.chain('V1.P', 'Q1.D'); b.chain('Q1.S', 'L1.1'); b.chain('Q1.S', 'D1.K'); b.chain('D1.A', 'GND1.G');
  b.chain('V2.P', 'Q1.G'); b.chain('V2.N', 'Q1.S');
  b.chain('L1.2', 'C1.1'); b.chain('C1.1', 'RL.1'); b.chain('C1.2', 'GND1.G'); b.chain('RL.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};
const BUCK_TRAN: TranSpec = { stop: 0.004, dt: 1e-6, stat: 'mean', skip: 0.6 };

/** guc-04: 12 V "akü" + 0.1 Ω kablo + 12 Ω yük; yük kısa devre arızasıyla gelir. */
const batteryShort = (shorted = true): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 12, ilimit: 20 }, -6, 0, 0, 'V1');
  b.add('resistor', { r: 0.1, pmax: 5 }, -1, -3, 0, 'RW');
  b.add('resistor', { r: 12, pmax: 25 }, 4, 0, 1, 'RL');
  b.add('ground', {}, 0, 4);
  b.chain('V1.P', 'RW.1'); b.chain('RW.2', 'RL.1'); b.chain('RL.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return shorted ? { ...b.circuit, faults: { RL: { kind: 'short' } } } : b.circuit;
};

/** ariza-01: 5 V → R1 → LED. rev = LED ters bağlı. */
const ledCircuit = (rev = false, r = 150): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 5 }, -6, 0, 0, 'V1');
  b.add('resistor', { r }, -1, -3, 0, 'R1');
  b.add('led', { color: 'red' }, 4, -3, 0, 'D1');
  b.add('ground', {}, 0, 4);
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', rev ? 'D1.K' : 'D1.A'); b.chain(rev ? 'D1.A' : 'D1.K', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/** ariza-02: 10 V, R1 = 10 kΩ, R2 değişken. */
const dividerCircuit = (r2 = 10000): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 10 }, -6, 0, 0, 'V1');
  b.add('resistor', { r: 10000 }, 0, -3, 1, 'R1');
  b.add('resistor', { r: r2 }, 0, 3, 1, 'R2');
  b.add('ground', {}, 5, 0);
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'R2.1'); b.chain('R2.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/** ariza-03: NPN anahtar; taban direnci rb. */
const npnSwitch = (rb = 10000): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 5 }, -8, 0, 0, 'V1');
  b.add('resistor', { r: rb }, -3, 3, 0, 'R1');
  b.add('resistor', { r: 330 }, 3, -4, 1, 'R2');
  b.add('led', { color: 'green' }, 3, -1, 1, 'D1');
  b.add('bc547b', {}, 3, 3, 0, 'Q1');
  b.add('ground', {}, 0, 7);
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'Q1.B');
  b.chain('V1.P', 'R2.1'); b.chain('R2.2', 'D1.A'); b.chain('D1.K', 'Q1.C'); b.chain('Q1.E', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/** ariza-05: DC 12 V + 2 V tepe 100 Hz dalgalanma (düzensiz besleme) → 4.7 Ω kablo → C1 → 47 Ω yük. */
const filterCircuit = (c = 4.7e-3): Circuit => {
  const b = new CircuitBuilder();
  b.add('signal_gen', { wave: 'sine', v: 12, amp: 2, freq: 100 }, -7, 0, 0, 'V1');
  b.add('resistor', { r: 4.7, pmax: 2 }, -2, -3, 0, 'RS');
  b.add('capacitor_el', { c, vmax: 25, v0: 10.9 }, 3, 0, 1, 'C1');
  b.add('resistor', { r: 47, pmax: 5 }, 7, 0, 1, 'RL');
  b.add('ground', {}, 0, 4);
  b.chain('V1.P', 'RS.1'); b.chain('RS.2', 'C1.1'); b.chain('C1.1', 'RL.1'); b.chain('C1.2', 'GND1.G'); b.chain('RL.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};
const RIPPLE_TRAN: TranSpec = { stop: 0.1, dt: 100e-6, stat: 'pp', skip: 0.5 };

/** ariza-06: 12 V → SW1 (açık) → 47 Ω lamba. jumper = anahtarı köprüleyen unutulmuş tel. */
const switchLamp = (jumper = false): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 12 }, -6, 0, 0, 'V1');
  b.add('switch', { closed: false }, -2, -3, 0, 'SW1');
  b.add('resistor', { r: 47, pmax: 5 }, 4, 0, 1, 'RL');
  b.add('ground', {}, 0, 4);
  b.chain('V1.P', 'SW1.1'); b.chain('SW1.2', 'RL.1'); b.chain('RL.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  if (jumper) b.wire('V1.P', 'RL.1');
  return b.circuit;
};

// ------------------------------------------------------------------ dersler

export const GUC: Lesson[] = [
  // ===================================================================== GÜÇ ŞERİDİ
  {
    id: 'guc-01-guc-kaybi-isinma', track: 'guc', level: 'baslangic', minutes: 12,
    title: 'Güç kaybı ve ısınma: P = I²R ve Tj',
    summary: 'Direnç üzerinde harcanan gücü hesapla, anma gücüyle karşılaştır ve ısıl dirençle kavşak sıcaklığını tahmin et.',
    objectives: [
      'P = V·I = I²·R = V²/R bağıntılarını bir dirençte ölçümle doğrulamak.',
      'Direncin anma gücü (pmax) ile gerçek harcanan gücü karşılaştırıp güvenlik payını yorumlamak.',
      'Kararlı hal sıcaklığını Tj = Tamb + P·Rθ ile tahmin etmek.',
    ],
    theory: [
      { t: 'p', text: 'Bir direnç elektrik enerjisini ısıya çevirir. Birim zamanda ısıya dönüşen enerji güçtür ve watt (W) ile ölçülür. Aynı güç parçanın sıcaklığını yükseltir; sıcaklık yükseldikçe çevreye ısı akışı artar ve bir noktada üretilen ısı ile atılan ısı dengelenir (kararlı hal).' },
      { t: 'formula', text: 'P = V·I = I²·R = V²/R', note: 'Sabit gerilimde R küçüldükçe güç artar; sabit akımda R büyüdükçe güç artar.' },
      { t: 'formula', text: 'Tj = Tamb + P·Rθja', note: 'Rθja: kavşaktan ortama ısıl direnç (K/W). Birim: her watt için kaç derece yükselme.' },
      { t: 'p', text: 'Bu simülatörde dirençler için Rθ, anma gücünden tahmin edilir: Rθ = (Tmax − 25 °C) / pmax. 1 W’lık bir direnç için (155 − 25)/1 = 130 K/W. Bu gerçek bir üretici verisi değil, parça sınıfından türetilmiş tahmindir; eğilimleri görmek içindir, tasarımı onaylamak için kullanılamaz.' },
      { t: 'warn', text: 'Anma gücünün tam değerinde çalıştırmak ömrü kısaltır. Pratik kural: sürekli çalışmada anma gücünün en fazla %50–60’ını kullan. Isı yükselince boya kararır, kart yanar ve yakındaki parçalar zarar görür.' },
    ],
    calc: [
      { title: 'Akım', formula: 'I = V / R', working: 'I = 12 V / 220 Ω = 54.5 mA' },
      { title: 'Güç', formula: 'P = V·I = V²/R', working: 'P = 12 V × 54.5 mA = 0.655 W   (kontrol: 12² / 220 = 0.655 W)' },
      { title: 'Anma gücüne oran', formula: 'P / pmax', working: '0.655 W / 1 W = %65 → sürekli çalışma için sınırda; yarım güç kuralının üstünde' },
      { title: 'Kavşak sıcaklığı', formula: 'Tj = Tamb + P·Rθ,  Rθ = (155 − 25)/pmax', working: 'Rθ = 130 K/W;  Tj = 25 + 0.655 × 130 = 110 °C (sınır 155 °C)' },
    ],
    build: () => powerResistor(220, 1),
    steps: [
      'Devreyi çöz (DC çözüm). R1 üzerindeki akımı ve gerilimi Ölçümler sekmesinde oku: 12 V ve ≈ 54.5 mA olmalı.',
      'R1’in absorbe ettiği gücü (p) oku ve P = V·I hesabınla karşılaştır: ≈ 0.655 W.',
      'R1’i seçip pmax değerini 0.25 W yap ve tekrar çöz. Güç aynı kalır ama oran %262 olur; Isıl görünümde parçanın kritik/hasar sınıfına geçtiğini gör.',
      'pmax’ı 1 W’a geri al. R1 değerini 330 Ω yap: güç ≈ 0.44 W’a düşer. 100 Ω yap: güç 1.44 W’a çıkar.',
    ],
    expects: [
      { label: 'R1 akımı', probe: I('R1'), value: 0.054545, unit: 'A' },
      { label: 'R1 gerilimi', probe: V('R1'), value: 12, unit: 'V' },
      { label: 'R1 gücü', probe: P('R1'), value: 0.6545, unit: 'W' },
    ],
    mistakes: [
      'Gücü hesaplarken akımı mA ile bırakıp V·I çarpmak (54.5 mA = 0.0545 A olmalı).',
      'Anma gücünü "eşik" sanmak: parça anma gücünde de çalışır ama çok sıcak olur; güvenli tasarım payı bırakır.',
      'P = V²/R formülünde V’yi direnç üzerindeki değil kaynak gerilimi almak (seri devrelerde farklıdır).',
      'Isıl direncin yalnızca parçaya değil montaj ve hava akışına da bağlı olduğunu unutmak; kapalı kutuda gerçek Tj bu tahminden yüksek olur.',
    ],
    faults: [
      { title: 'Direnç değeri kayması (yaşlanma / yanlış renk kodu)', how: 'R1 → Arıza laboratuvarı → "Değer kayması" → −50 %', symptom: 'R yarıya iner: akım ve güç iki katına çıkar (0.109 A, 1.31 W): anma gücü aşılır.' },
      { title: 'Kısa devre (direnç yerine kısa)', how: 'R1 → Arıza laboratuvarı → "Kısa devre"', symptom: 'Akım yalnızca ideal kaynak ile ~1 mΩ ile belirlenir: gerçek dünyada sigortayı attırır, güç kaynağını zorlar.' },
    ],
    quiz: [
      { id: 'q1', q: 'R1 üzerinde harcanan güç kaç watt? (12 V, 220 Ω)', answer: 0.6545, tol: 0.03, unit: 'W', explain: 'P = V²/R = 144 / 220 = 0.655 W. Simülatördeki absorbe güç probu aynı sonucu verir.', verify: { probe: P('R1') } },
      { id: 'q2', q: 'Aynı gerilimde direnç değeri yarıya inerse güç ne olur?', options: ['Yarıya iner', 'Değişmez', 'İki katına çıkar', 'Dört katına çıkar'], answer: 2, explain: 'P = V²/R; V sabitken R yarıya inerse P iki katına çıkar. Bu yüzden daha küçük direnç daha çok ısınır.' },
      { id: 'q3', q: 'Aynı dirençten geçen akım iki katına çıkarsa harcanan güç kaç katına çıkar?', options: ['2 katına', '4 katına', '8 katına', 'Değişmez'], answer: 1, explain: 'P = I²·R: akım iki katına çıkınca güç 2² = 4 katına çıkar.' },
      { id: 'q4', q: 'Rθ = 130 K/W olan bir direnç 0.65 W harcarsa ortam 25 °C iken kavşak sıcaklığı kaç °C olur?', answer: 109.5, tol: 0.03, unit: '°C', explain: 'Tj = 25 + 0.65 × 130 = 109.5 °C. (Lab devresinde 0.655 W ile 110 °C.)' },
      { id: 'q5', q: 'Sürekli çalışma için 0.25 W’lık bir dirençten en fazla yaklaşık ne kadar güç harcamak makul?', options: ['0.25 W’ın tamamı', 'Yaklaşık 0.12–0.15 W', '0.5 W', 'Güç sınırı yoktur'], answer: 1, explain: 'Yarım güç kuralı: anma gücünün %50–60’ı ile çalışmak ısıyı ve yaşlanmayı azaltır.' },
    ],
    challenge: {
      id: 'c-guc01', title: 'Direnci serinlet',
      goal: 'R1 gücünü 0.5 W’ın altına indir ama devreden en az 30 mA akım geçmeye devam etsin.',
      hints: ['P = V²/R: gücü azaltmak için R’yi büyüt.', 'R ≥ 144/0.5 = 288 Ω gerekir; akım için R ≤ 12/0.03 = 400 Ω olmalı.', 'Standart değer olarak 330 Ω dene: P ≈ 0.44 W, I ≈ 36 mA.'],
      start: () => powerResistor(220, 1),
      checks: [
        { label: 'R1 gücü', probe: P('R1'), max: 0.5, unit: 'W' },
        { label: 'R1 akımı', probe: I('R1'), min: 0.03, unit: 'A' },
      ],
      solution: () => powerResistor(330, 1),
    },
    safety: 'Güç dirençleri ve yakınındaki parçalar tehlikeli derecede sıcak olabilir; gerçek devrede çalışırken dokunmadan önce soğumasını bekle. Bu simülatör şebeke gerilimini (230 V AC) modellemez; şebeke ile yapılan gerçek çalışmalar ölümcül tehlike taşır ve yalnızca yetkili kişilerce, yalıtımlı ekipmanla yapılmalıdır. Isıl değerler tahmindir; gerçek tasarımda üretici verisine bak.',
  },

  {
    id: 'guc-02-mosfet-iletim-kaybi', track: 'guc', level: 'orta', minutes: 18, prerequisites: ['guc-01-guc-kaybi-isinma'],
    title: 'MOSFET iletim kaybı, soğutucu ve fan',
    summary: 'MOSFET tam iletimde RDS(on) üzerinden P = I²·RDS harcar; yetersiz gate sürüşünde kayıp onlarca kat artar. Isıl direnç zincirini ve soğutucu/fan etkisini hesapla.',
    objectives: [
      'Tam iletimdeki MOSFET’in RDS(on) değerini VDS/ID ölçümüyle bulmak ve P = I²·RDS ile kaybı hesaplamak.',
      'Gate gerilimi düşünce kaybın neden büyüdüğünü (doyum bölgesine kayma) açıklamak.',
      'Tj = Tamb + P·(Rθjc + Rθcs + Rθsa) zincirini soğutucu ve fan için hesaplamak.',
    ],
    theory: [
      { t: 'p', text: 'Güç MOSFET’i anahtar olarak iyice iletime sokulduğunda (VGS ≫ VGS(th)) drain–source arası küçük bir direnç gibi davranır: RDS(on). Yükten geçen akım bu dirençte P = ID²·RDS(on) ısı üretir. IRFZ44N için üretici RDS(on) ≈ 17.5 mΩ @ VGS = 10 V verir; kütüphanedeki Level-1 modeli bu değeri ve tipik eşik gerilimini kullanarak K parametresini türetir.' },
      { t: 'formula', text: 'P_iletim = ID² · RDS(on) = VDS · ID', note: 'Tam iletimde VDS çok küçüktür (100 mV mertebesi), bu yüzden kayıp küçüktür.' },
      { t: 'p', text: 'Gate gerilimi yetersizse MOSFET doyum (aktif) bölgesinde kalır: VDS büyür, aynı akımda kayıp onlarca kat artar. En sık hata: mikrodenetleyici 3.3/5 V ile standart (yüksek eşikli) MOSFET sürmek.' },
      { t: 'formula', text: 'Tj = Tamb + P · (Rθjc + Rθcs + Rθsa)', note: 'Soğutucu varsa seri zincir; fan Rθsa’yı çarpan 0.4 ile küçültür (bu simülatörün tahmini).' },
      { t: 'p', text: 'Simülatör TO-220 MOSFET için tahmini değerler kullanır: Rθjc = 1.4 K/W, soğutucusuz serbest havada Rθja = 62 K/W, Tj,max = 175 °C; Rθcs = 0.5 K/W; soğutucu Rθsa: küçük 22, orta 8, büyük 3 K/W; fan Rθsa ve serbest hava direncini ×0.4 yapar. Bunlar paket sınıfı tahminidir, üretici verisi değildir.' },
      { t: 'warn', text: 'Tj ≥ Tj,max olduğunda parça hasar görür (kalıcı açık/kısa devre). Hasar modeli yalnızca sıcaklık sınırını denetler; gerçekte SOA, anahtarlama kayıpları ve termal kaçak da vardır ve burada modellenmez.' },
    ],
    calc: [
      { title: 'RDS(on) ölçümü', formula: 'RDS(on) = VDS / ID', working: 'VDS = 0.174 V, ID = 9.85 A → RDS(on) = 17.7 mΩ (katalog: 17.5 mΩ)' },
      { title: 'İletim kaybı', formula: 'P = ID² · RDS(on)', working: 'P = 9.85² × 0.0177 = 1.72 W' },
      { title: 'Soğutucusuz Tj', formula: 'Tj = 25 + P·Rθja', working: 'Tj = 25 + 1.72 × 62 = 131.6 °C (limit 175 °C)' },
      { title: 'Soğutuculu Tj', formula: 'Rθ = 1.4 + 0.5 + Rθsa', working: 'Küçük (Rθ=23.9): 66 °C · Orta (9.9): 42 °C · Büyük (4.9): 33 °C · Büyük+fan (3.1): 30 °C' },
      { title: 'Zayıf sürüş (VGS = 6 V)', formula: 'Aynı yük, VDS yükselir', working: 'VDS = 0.42 V, ID = 9.65 A → P = 4.07 W: kayıp 2.4 kat; Tj(serbest) = 25 + 4.07×62 = 277 °C > 175 °C → hasar' },
    ],
    build: () => mosLoad('irfz44n', 10, 1.2, 150),
    steps: [
      'DC çöz. Q1 için VDS, ID ve güç değerlerini oku: ≈ 0.174 V, 9.85 A, 1.72 W. RDS(on) = VDS/ID ile 17.7 mΩ bul.',
      'Q1’i seçip Isıl görünümü aç; soğutucusuz Tj ≈ 132 °C olmalı. Sonra sırayla küçük, orta, büyük soğutucu ve fan ekle; Tj düşüşünü ders hesabınla karşılaştır.',
      'V2’yi 10 V’tan 6 V’a düşür ve tekrar çöz: VDS ≈ 0.42 V, güç ≈ 4.07 W. Soğutucusuz Tj sınırı aşar; hasar uygula açıksa parçanın arızalandığını gör.',
      'V2’yi 10 V’a geri al. Q1 tipini "N-MOSFET (standart gate, genel)" yapıp V2 = 4 V dene: bu, challenge’ın başlangıç devresine yakındır.',
    ],
    expects: [
      { label: 'Q1 VDS', probe: VAL('Q1', 'vds'), value: 0.1744, unit: 'V' },
      { label: 'Q1 ID', probe: VAL('Q1', 'id'), value: 9.855, unit: 'A' },
      { label: 'Q1 gücü', probe: P('Q1'), value: 1.7186, unit: 'W' },
    ],
    mistakes: [
      'RDS(on) değerini her gate geriliminde sabit sanmak: katalog değeri VGS = 10 V içindir, düşük VGS’te RDS çok artar.',
      'Mantık seviyeli olmayan MOSFET’i 3.3/5 V ile sürüp "iletiyor ama ısınıyor" demek: doyumda kalmıştır.',
      'Isıl hesapta Rθcs (yalıtım/macun) ve soğutucuyu unutmak; yalnızca Rθjc ile hesaplamak Tj’yi olduğundan düşük gösterir.',
      'Soğutucunun ısıl kütlesinin (Cth) zamanla ısınmayı yavaşlattığını unutup kararlı hali anlık sanmak.',
    ],
    faults: [
      { title: 'Zayıf gate sürüşü', how: 'V2 gerilimini 4–6 V’a düşür (veya Q1’i standart gate tipine çevir)', symptom: 'VDS yükselir, MOSFET onlarca kat fazla ısınır; yük akımı da düşebilir.' },
      { title: 'D–S kaçak', how: 'Q1 → Arıza laboratuvarı → "D–S kaçak" → 10 Ω', symptom: 'Paralel 10 Ω kaçak yolu açılır; kapalı durumda bile akım akar.' },
      { title: 'Soğutucu/fan eksik', how: 'Q1 → Isıl → soğutucu "Yok", fan kapalı', symptom: 'Aynı güçte Tj en yüksek değerine çıkar (serbest hava Rθja = 62 K/W).' },
    ],
    quiz: [
      { id: 'q1', q: 'Lab devresinde Q1 kaç amper akım taşıyor?', answer: 9.855, tol: 0.03, unit: 'A', explain: 'VGS = 10 V’ta MOSFET doyuma değil tam iletime gider; akım yük tarafından belirlenir: ≈ 12 V / (1.2 Ω + RDS) = 9.85 A.', verify: { probe: VAL('Q1', 'id') } },
      { id: 'q2', q: 'Q1 kaç watt harcıyor?', answer: 1.7186, tol: 0.03, unit: 'W', explain: 'P = ID² · RDS(on) = 9.85² × 0.0177 = 1.72 W (veya VDS·ID = 0.174 × 9.85).', verify: { probe: P('Q1') } },
      { id: 'q3', q: 'Soğutucusuz Tj için 1.72 W ve Rθja = 62 K/W ile ne bulursun? (Tamb = 25 °C)', answer: 131.6, tol: 0.03, unit: '°C', explain: 'Tj = 25 + 1.72 × 62 = 131.6 °C: sınır 175 °C’ın altında ama 105 K ısınma yüksektir.' },
      { id: 'q4', q: 'Büyük soğutucu (Rθsa = 3 K/W) ve fan (×0.4) birlikte toplam Rθja kaç K/W olur?', options: ['1.4 + 0.5 + 3 = 4.9', '1.4 + 0.5 + 1.2 = 3.1', '3 × 0.4 = 1.2', '62 × 0.4 = 24.8'], answer: 1, explain: 'Soğutuculu durumda Rθ = Rθjc + Rθcs + Rθsa(×0.4 fan) = 1.4 + 0.5 + 1.2 = 3.1 K/W.' },
      { id: 'q5', q: 'VGS’yi 10 V’tan 6 V’a düşürünce MOSFET kaybı neden artar?', options: ['Akım çok artar', 'RDS(on) büyür, VDS yükselir', 'Yük gücü azalır, MOSFET soğur', 'Drain gerilimi sıfırlanır'], answer: 1, explain: 'Daha düşük VGS’te kanal daha dirençli olur; aynı akımda VDS ve P = VDS·ID artar.' },
    ],
    challenge: {
      id: 'c-guc02', title: 'MOSFET’i serinlet: gate gerilimini yükselt',
      goal: 'Standart gate MOSFET 4 V ile sürülüyor ve ≈ 6 W harcıyor. Yük akımını (≥ 1.8 A) koruyarak Q1 gücünü 0.5 W’ın altına indir.',
      hints: ['Q1 doyumda çalışıyor: VDS ≈ 5.7 V. Gate geriliminin eşiğin (3.5 V) çok üstüne çıkması gerekir.', 'V2’yi 10 V yap: VDS ≈ 0.04 V, P ≈ 0.08 W.', 'Alternatif: Q1 yerine mantık seviyeli N-MOSFET (VGS(th) = 1.8 V) kullanmak.'],
      start: () => mosLoad('nmos_std', 4, 6, 50),
      checks: [
        { label: 'Q1 gücü', probe: P('Q1'), max: 0.5, unit: 'W' },
        { label: 'Yük akımı (Q1 ID)', probe: VAL('Q1', 'id'), min: 1.8, unit: 'A' },
      ],
      solution: () => mosLoad('nmos_std', 10, 6, 50),
    },
    safety: 'Güç MOSFET’leri ve soğutucuları çalışırken 100 °C’yi aşabilir; yanık tehlikesi vardır. Gerçek devrede önce kondansatörleri boşalt, soğutucu üzerindeki parçaların gövde (drain) potansiyelinde olduğunu unutma. Bu simülatör şebeke gerilimini modellemez; şebekeden beslenen güç devreleri üzerinde çalışmak yaşamsal tehlike taşır. Isıl direnç ve Tj değerleri paket sınıfından tahmin edilmiştir.',
  },

  {
    id: 'guc-03-buck-donusturucu', track: 'guc', level: 'ileri', minutes: 25, prerequisites: ['guc-02-mosfet-iletim-kaybi'],
    title: 'Buck dönüştürücü fikri: MOSFET + diyot + bobin + kondansatör',
    summary: 'Kare dalga ile sürülen bir MOSFET, bobin ve serbest dolaşım diyotu ile 12 V girişi D·Vin kadar bir gerilime düşürür; verimli step-down dönüşümün temeli.',
    objectives: [
      'Buck dönüştürücüde Vout ≈ D·Vin bağıntısını ve diyot/RDS düşümünün etkisini açıklamak.',
      'Bobin akımının ortalama değerini ve dalgalanmasını (ΔI) hesaplamak; çıkış kondansatörünün rolünü yorumlamak.',
      'Kayıpların nerede oluştuğunu (diyot, RDS) ve neden doğrusal regülatörden daha verimli olduğunu açıklamak.',
    ],
    theory: [
      { t: 'p', text: 'Buck dönüştürücü, giriş gerilimini bir anahtarla hızlıca açıp kapayarak (PWM) bobin ve kondansatörle ortalama değerine süzer. Anahtar açıkken bobin akımı artar ve enerji depolar; anahtar kapanınca bobin akımını sürdürmek ister, bu akım serbest dolaşım diyotundan akar. Çıkış kondansatörü dalgalanmayı yumuşatır.' },
      { t: 'formula', text: 'Vout ≈ D · Vin   (ideal),   Vout ≈ D·(Vin − VDS) − (1 − D)·Vf', note: 'D = açık kalma oranı (duty). Ölçülen değer diyot düşümü yüzünden bir miktar daha düşüktür.' },
      { t: 'formula', text: 'ΔIL = (Vin − Vout) · D · T / L,    ΔVout ≈ ΔIL / (8 · f · C)', note: 'T = 1/f anahtarlama periyodu. Büyük L ve büyük f dalgalanmayı azaltır.' },
      { t: 'p', text: 'Bu labda gate sürücüsü V2, G–S arasına bağlı yüzen bir 0..10 V kare dalga kaynağıdır. Yüksek taraf N-MOSFET’te kaynak ucu anahtar düğümünde (SW) gezindiği için gerçek devrede bootstrap kondansatörü veya gate sürücü entegresi gerekir; simülatörde bunun ideal karşılığı kullanıldı. 20 kHz, L = 220 µH, C = 47 µF, yük 5 Ω, D = %50.' },
      { t: 'warn', text: 'Gerçek dönüştürücüde anahtarlama kayıpları, gate yükü, diyot ters toparlanma, bobin doyması ve ESR çok önemlidir; bu simülatörde yoktur. Bobin akımı kesilirse (diyot yok/açık) yüksek gerilim sıçraması MOSFET’i öldürür. Ayrıca verim bu ideal modelde olduğundan çok daha iyi görünür.' },
    ],
    calc: [
      { title: 'İdeal çıkış', formula: 'Vout = D · Vin', working: 'D = 0.5, Vin = 12 V → 6 V' },
      { title: 'Diyot düşümü ile', formula: 'Vout ≈ D·Vin − (1−D)·Vf', working: 'Vf ≈ 0.5 V (SB560): 6 − 0.5×0.5 = 5.75 V   (simülatör: 5.74 V)' },
      { title: 'Çıkış akımı', formula: 'Iout = Vout / RL', working: '5.74 / 5 = 1.15 A   (bobin ortalama akımı da bu)' },
      { title: 'Bobin akım dalgalanması', formula: 'ΔIL = (Vin − Vout)·D·T / L', working: 'T = 50 µs: (12 − 5.74) × 0.5 × 50 µs / 220 µH = 0.71 A tepe-tepe' },
      { title: 'Kayıplar (ideal anahtarlama)', formula: 'P_diyot = (1−D)·Vf·IL;  P_MOS = D·IL²·RDS', working: 'P_diyot = 0.5×0.50×1.15 = 0.29 W;  P_MOS = 0.5×1.15²×0.0177 = 0.012 W' },
    ],
    build: () => buck(50),
    speed: 0.0005,
    steps: [
      'Hız çarpanını çok düşük tut (örn. 0.0005). Çalıştır ve osiloskopta SW düğümü (Q1 source) ile çıkış (C1 + ucu) gerilimini birlikte izle: SW düğümü 12 V ile ~ −0.5 V arasında kare dalga yapar, çıkış ≈ 5.7 V civarında kalır.',
      'Osiloskopta L1 akımını izle: testere dişi biçimli, ortalama ≈ 1.15 A, tepe-tepe ≈ 0.7 A.',
      'V2 doluluk oranını (duty) %25 yap: çıkış ≈ 2.7 V; %75 yap: ≈ 9 V. Vout’un D ile doğrusal değiştiğini gör.',
      'D1’i dene: diyodu 1N4007 (Vf ≈ 0.93 V) ile değiştir; çıkış düşer, diyot kaybı artar. Verimde Schottky’nin farkını yorumla.',
    ],
    expects: [
      { label: 'Ortalama çıkış gerilimi (C1)', probe: N('C1', '1'), value: 5.738, tran: BUCK_TRAN, unit: 'V' },
      { label: 'Ortalama bobin akımı (L1)', probe: I('L1'), value: 1.1466, tran: BUCK_TRAN, unit: 'A' },
      { label: 'Çıkış dalgalanması (tepe-tepe)', probe: N('C1', '1'), value: 0.1344, tran: { ...BUCK_TRAN, stat: 'pp' }, tol: { rel: 0.1 }, unit: 'V' },
      { label: 'Ortalama diyot gücü (D1)', probe: P('D1'), value: 0.2886, tran: BUCK_TRAN, tol: { rel: 0.05 }, unit: 'W' },
    ],
    mistakes: [
      'Vout = D·Vin formülünü diyot/anahtar düşümü olmadan tam doğru sanmak: Vf yaklaşık %5 hata yaratır.',
      'Ölçümü ilk milisaniyelerde (geçici rejim) almak: LC filtresi salınım yapar; ortalamayı oturmuş kısımdan al (skip).',
      'Bobini doyma akımının üstünde kullanmak: gerçekte L çöker ve akım sınırsız artar (bu simülatörde doyma modeli yoktur).',
      'Diyotu ters bağlamak veya unutmak: anahtar kapanınca bobin akımına yol kalmaz.',
    ],
    faults: [
      { title: 'Serbest dolaşım diyotu açık', how: 'D1 → Arıza laboratuvarı → "Açık devre"', symptom: 'Bobin akımı kesilince yol kalmaz: gerçekte SW düğümünde yıkıcı gerilim sıçraması; çıkış ortalaması anlamlı biçimde değişir.' },
      { title: 'Çıkış kondansatörü kapasite kaybı', how: 'C1 → Arıza laboratuvarı → "Kapasite kaybı" → %80', symptom: 'Çıkış dalgalanması (ripple) belirgin biçimde artar.' },
      { title: 'Bobin kısa devre', how: 'L1 → Arıza laboratuvarı → "Kısa devre"', symptom: 'Akımı sınırlayan endüktans kalmaz; akım dalgalanması ve diyot/MOSFET akımı çok artar.' },
    ],
    quiz: [
      { id: 'q1', q: 'Vin = 12 V, D = %25 için ideal Vout kaç volt?', answer: 3, tol: 0.01, unit: 'V', explain: 'Vout = D·Vin = 0.25 × 12 = 3 V (ideal; diyot düşümü bunu ~0.4 V düşürür).' },
      { id: 'q2', q: 'Simülatörde ölçülen ortalama çıkış gerilimi kaç volt?', answer: 5.738, tol: 0.03, unit: 'V', explain: 'Ideal 6 V’tan diyot düşümü ((1−D)·Vf ≈ 0.25 V) çıkar: ≈ 5.74 V.', verify: { probe: N('C1', '1'), tran: BUCK_TRAN } },
      { id: 'q3', q: 'Ortalama bobin akımı kaç amper?', answer: 1.1466, tol: 0.03, unit: 'A', explain: 'Çıkış kondansatörü ortalama akım taşımaz; bobin akımının ortalaması yük akımıdır: 5.74 V / 5 Ω = 1.15 A.', verify: { probe: I('L1'), tran: BUCK_TRAN } },
      { id: 'q4', q: 'Buck dönüştürücü doğrusal regülatöre göre neden daha verimlidir?', options: ['Daha büyük kondansatör kullanır', 'Anahtar ya tam iletimde ya tam kesimde olduğundan fazla gücü ısı olarak yakmaz', 'Çıkışı yükseltir', 'Girişi kısa devre eder'], answer: 1, explain: 'Anahtar tam açık (VDS ≈ 0) veya tam kapalı (I = 0) olduğundan P = V·I küçük kalır; doğrusal regülatör fark gerilimini sürekli ısıya çevirir.' },
      { id: 'q5', q: 'Anahtarlama frekansı iki katına çıkarılırsa (diğer her şey aynı) bobin akımı dalgalanması ΔIL nasıl değişir?', options: ['İki katına çıkar', 'Yarıya düşer', 'Değişmez', 'Dört katına çıkar'], answer: 1, explain: 'ΔIL = (Vin − Vout)·D·T/L ve T = 1/f: frekans iki katına çıkınca T yarıya iner, ΔIL yarıya düşer.' },
    ],
    safety: 'Gerçek dönüştürücülerde bobin ve kondansatörler enerji depolar: kapattıktan sonra bile kondansatör şarjlı kalabilir; çıkıştaki kısa devre yüksek akım üretir. Ayarlı kaynak ve osiloskop topraklarını doğru bağla. Bu simülatör şebeke gerilimini modellemez; şebekeden çalışan (AC–DC) güç katı yapımı yaşamsal tehlike taşır. Modeldeki ideal sürücü, anahtarlama kaybı yokluğu ve genel Level-1 MOSFET gerçek verimi olduğundan iyi gösterir.',
  },

  {
    id: 'guc-04-pil-aku-guvenligi', track: 'guc', level: 'orta', minutes: 15,
    title: 'Pil/akü güvenliği ve kısa devre',
    summary: 'Bir akü kısa devre edildiğinde akımı yalnızca kablo ve iç direnç sınırlar: yüzlerce amper ve kilowatt’lar. Sigorta ve koruma devresi neden şart?',
    objectives: [
      'Kısa devrede akımın I = V / R_toplam ile belirlendiğini ve kablo gücünün P = I²·R olduğunu hesaplamak.',
      'Sigorta ve koruma devrelerinin gerekliliğini gerekçelendirmek.',
      'Li-ion pillerin termal kaçak (thermal runaway) riskini niteliksel olarak açıklamak.',
    ],
    theory: [
      { t: 'p', text: 'İdeal bir gerilim kaynağı kısa devrede sonsuz akım verir; gerçek pil ise iç direnci (kurşun-asit ≈ 10–50 mΩ, Li-ion hücre ≈ 20–80 mΩ) ve kablo direnciyle sınırlıdır. Bu yüzden 12 V’luk küçük bir akü bile yüzlerce amper akıtabilir.' },
      { t: 'formula', text: 'I_kısa = V / (R_iç + R_kablo + R_temas)', note: 'Bu labda R_iç ihmal edilmiş, R_kablo = 0.1 Ω eşdeğer direnç alınmıştır.' },
      { t: 'formula', text: 'P_kablo = I² · R_kablo', note: '119 A × 119 A × 0.1 Ω ≈ 1.4 kW: kablo saniyeler içinde kızarır, yalıtım erir.' },
      { t: 'p', text: 'Güvenli sistemler: kaynağa yakın sigorta (veya devre kesici), kablo kesiti ve yalıtımı akıma uygun seçilir. Li-ion/LiPo için ayrıca BMS (aşırı akım, aşırı/düşük gerilim, aşırı sıcaklık koruması) şarttır. Kısa devre, fiziksel hasar, aşırı şarj veya ısı, hücre içinde ekzotermik reaksiyonu tetikleyebilir.' },
      { t: 'warn', text: 'Termal kaçak (Li-ion): iç sıcaklık eşik değerin üstüne çıkınca hücre kendi kendini ısıtan zincir reaksiyonuna girer; ısı yeni reaksiyonlar başlatır, gaz çıkar, yangın ve patlama oluşabilir ve söndürmek çok zordur. Hasarlı, şişmiş veya ısınan pili kullanma/şarj etme, kısa devre yaptırma; metal takı/anahtar ile aynı cepte taşıma.' },
      { t: 'warn', text: 'Simülatör sınırı: kaynak ideal; iç direnç, kapasite, sıcaklık ve termal kaçak modeli yoktur. Burada hesaplanan 119 A gerçekte iç direnç yüzünden daha düşük olurdu (ör. 50 mΩ ile 80 A), ama yine yıkıcıdır.' },
    ],
    calc: [
      { title: 'Normal çalışma', formula: 'I = V / (R_kablo + R_yük)', working: 'I = 12 / (0.1 + 12) = 0.99 A,  P_kablo = 0.99² × 0.1 = 0.098 W (sorun yok)' },
      { title: 'Kısa devre akımı', formula: 'I = V / (R_kablo + R_kısa)', working: 'R_kısa ≈ 1 mΩ: I = 12 / (0.1 + 0.001) = 118.8 A' },
      { title: 'Kablodaki güç', formula: 'P = I²·R', working: 'P = 118.8² × 0.1 = 1411 W (kablo anma gücü 5 W → 282 katı)' },
      { title: 'Sigorta seçimi', formula: 'I_sigorta ≈ 1.25–1.5 × I_normal ve kablo akım taşıma kapasitesinin altında', working: 'Yük 1 A → 2 A sigorta: kısa devrede 118 A / 2 A = 59 kat fazla akım, sigorta milisaniyeler içinde atar' },
    ],
    build: () => batteryShort(true),
    steps: [
      'Devre yüke kısa devre arızası ile gelir (RL: kısa). DC çöz: RW üzerindeki akımı ve gücü oku: ≈ 118.8 A ve ≈ 1.41 kW. Kaynak akımı da aynıdır.',
      'RL’i seçip Arıza laboratuvarından arızayı kaldır: akım ≈ 0.99 A’e iner, kablo gücü ≈ 0.1 W olur. Kısa devrenin etkisini karşılaştır.',
      'RW’yu 0.05 Ω ve 0.5 Ω yap, arızayı tekrar ekle: akımın I = 12/(R+0.001) ile nasıl değiştiğini hesapla ve ölç.',
      'Hasar uygula açıkken RW’nin (5 W) ve kaynak akım limiti uyarısının (20 A) aşıldığını Arızalar sekmesinde gör.',
    ],
    expects: [
      { label: 'Kablo (RW) akımı', probe: I('RW'), value: 118.8, unit: 'A' },
      { label: 'Kablo (RW) gücü', probe: P('RW'), value: 1411.6, unit: 'W' },
      { label: 'Yük (RL) gerilimi', probe: V('RL'), value: 0.1188, tol: { rel: 0.05 }, unit: 'V' },
    ],
    mistakes: [
      'Sigortayı kablonun yük tarafına değil kaynaktan uzağa koymak: kaynak–sigorta arası kablo korumasız kalır.',
      'Çok yüksek amperli sigorta takmak: kablo erir ama sigorta atmaz.',
      'Pilin "sadece 12 V olduğu için tehlikesiz" olduğunu sanmak: düşük gerilim yine yüzlerce amper ve yangın demektir.',
      'Li-ion pili koruma devresi (BMS) olmadan ve uygun şarj cihazı olmadan şarj etmek.',
    ],
    faults: [
      { title: 'Yük kısa devresi', how: 'RL → Arıza laboratuvarı → "Kısa devre"', symptom: 'Akım 0.99 A’den 118.8 A’e çıkar; kablo gücü 0.1 W’tan 1.4 kW’a.' },
      { title: 'Kablo temas direnci artışı', how: 'RW → "Değer kayması" → +400 % (0.5 Ω)', symptom: 'Normal yükte kablo (0.5 Ω × 1 A² = 0.5 W) ısınır, yükte gerilim düşer; sıkışık/oksitli klemens belirtisi.' },
    ],
    quiz: [
      { id: 'q1', q: 'Lab devresinde kısa devre akımı kaç amper?', answer: 118.8, tol: 0.03, unit: 'A', explain: 'I = V/(R_kablo + R_kısa) = 12 / 0.101 = 118.8 A; yalnızca kablo direnci sınırlar.', verify: { probe: I('RW') } },
      { id: 'q2', q: 'Kısa devrede 0.1 Ω’luk kabloda harcanan güç kaç watt?', answer: 1411.6, tol: 0.03, unit: 'W', explain: 'P = I²·R = 118.8² × 0.1 ≈ 1411 W: kablo saniyeler içinde kızarır.', verify: { probe: P('RW') } },
      { id: 'q3', q: '12 V kaynak 0.05 Ω iç direnç + 0.1 Ω kablo ile kısa devre edilirse akım yaklaşık kaç amper?', answer: 80, tol: 0.03, unit: 'A', explain: 'I = 12 / (0.05 + 0.1) = 80 A.' },
      { id: 'q4', q: 'Aşağıdakilerden hangisi kısa devre koruması için DOĞRUDUR?', options: ['Sigorta yük tarafına değil kaynağa yakın konur', 'Kalın sigorta hep daha güvenlidir', 'Düşük gerilimde sigorta gerekmez', 'Pili kısa devre ederek test etmek güvenlidir'], answer: 0, explain: 'Sigorta kaynağa yakın olmalı ki kablonun tamamı korunsun; değeri kablo ve yük akımına göre seçilir.' },
      { id: 'q5', q: 'Li-ion hücrede termal kaçak için hangisi doğrudur?', options: ['Yalnızca şarj sırasında olur', 'Isı yeni ısı üreten zincir reaksiyonunu tetikler; yangın ve patlama oluşabilir', 'Soğuk havada başlar', 'Yalnızca 5 V altında olur'], answer: 1, explain: 'Kısa devre, aşırı şarj veya fiziksel hasar hücre ısısını eşiğin üstüne çıkarırsa pozitif geri besleme ile ısı kontrolden çıkar.' },
    ],
    safety: 'Gerçek pil ve akülerle kısa devre deneyi yapma: yangın, patlama, asit/elektrolit sıçraması ve ağır yanık tehlikesi vardır. Li-ion/LiPo pilleri yalnızca koruma devresiyle ve uygun şarj cihazıyla kullan; şişmiş, ezilmiş veya ısınan pilleri güvenli şekilde (metal kap, kum) ayır ve geri dönüşüme ver. Kondansatörler şarjlı kalabilir ve boşalırken ark yapabilir. Bu simülatör şebeke gerilimini (230 V AC) modellemez; şebeke ile çalışmak ölümcüldür. Simülatörde kaynak ideal, iç direnç/kapasite/termal kaçak yoktur.',
  },

  // ===================================================================== ARIZA ŞERİDİ
  {
    id: 'ariza-01-led-yanmiyor', track: 'ariza', level: 'baslangic', minutes: 12,
    title: 'Arıza: LED yanmıyor',
    summary: 'LED devresi çalışmıyor: besleme, toprak, düğüm gerilimleri ve akım yönüne bakarak sistemli arıza bulma.',
    objectives: [
      'Yanmayan LED devresini ölçüm sırası (besleme → toprak → düğümler → akım yönü) ile incelemek.',
      'Açık devre direnç ile ters bağlı LED’in ölçümde nasıl ayırt edildiğini söylemek.',
      'Sağlam referans değerlerle (≈ 20 mA, LED’de ≈ 1.9 V) karşılaştırarak arızayı bulmak.',
    ],
    theory: [
      { t: 'p', text: 'Sistemli arıza bulma tahmin etmek yerine ölçmektir. Sıra: (1) Besleme gerilimi var mı? (2) Toprak/dönüş yolu sağlam mı? (3) Her düğümde beklenen gerilim var mı? (4) Akım doğru yönde ve beklenen değerde mi? Beklenen değer sağlam devrenin hesabından gelir; sapma arızanın yerini gösterir.' },
      { t: 'formula', text: 'I_LED = (Vcc − Vf) / R,   Vf(kırmızı) ≈ 1.9 V', note: '5 V ve 150 Ω ile: (5 − 1.9)/150 ≈ 20 mA.' },
      { t: 'p', text: 'Açık bir direnç akımı sıfırlar; direncin iki ucu arasında tüm besleme gerilimi (5 V) görülür ve LED’in anodu ≈ 0 V kalır. Ters bağlı LED de akım geçirmez ama bu kez direnç üzerinde gerilim yoktur ve besleme gerilimi LED üzerinde ters olarak görünür. İki durum voltmetreyle kolayca ayrılır.' },
      { t: 'warn', text: 'Güç açıkken devreyi tahminle değiştirme; önce ölç. Ters bağlı LED’in ters gerilim dayanımı düşüktür (genelde ≈ 5 V). Yeni LED takarken akım sınırlama direncini mutlaka kullan.' },
    ],
    calc: [
      { title: 'Beklenen akım', formula: 'I = (Vcc − Vf) / R', working: 'I = (5 − 1.90) / 150 = 20.7 mA' },
      { title: 'Direnç gerilimi', formula: 'V_R = I·R', working: 'V_R = 20.7 mA × 150 Ω = 3.10 V;  LED anodu = 5 − 3.10 = 1.90 V' },
      { title: 'R açıkken', formula: 'I = 0', working: 'V_R1 = 5 V (tüm gerilim açık direnç üzerinde), anot = 0 V' },
    ],
    build: () => ledCircuit(false, 150),
    steps: [
      'Sağlam devreyi çöz: besleme 5 V, LED akımı ≈ 20.7 mA, LED anot gerilimi ≈ 1.9 V olmalı. Bunları not et (referans).',
      'Arıza avı: R1’e "Açık devre" arızası ekle (veya aşağıdaki Arıza avını başlat). Önce V1 gerilimini, sonra toprağı, sonra R1 ve D1 uçlarındaki gerilimleri ölç: R1 üzerinde 5 V, D1 anodu 0 V.',
      'Aynı belirtiyi LED’i ters bağlayarak üret: R1 üzerinde gerilim ≈ 0 V, D1 üzerinde −5 V’a yakın değer görürsün. Hangi ölçümün hangi arızaya işaret ettiğini yaz.',
      'Challenge’da ters bağlı LED’li devreyi düzelt ve akımı 8–25 mA aralığına getir.',
    ],
    expects: [
      { label: 'LED akımı', probe: I('D1'), value: 0.020656, unit: 'A' },
      { label: 'LED anot gerilimi', probe: N('D1', 'A'), value: 1.9017, unit: 'V' },
      { label: 'R1 gerilimi', probe: V('R1'), value: 3.098, unit: 'V' },
    ],
    mistakes: [
      'LED’in bozuk olduğunu varsayıp hemen değiştirmek: önce besleme ve akım yolunu ölç.',
      'Voltmetreyi sadece LED’e bağlayıp yorum yapmak: referans değerle karşılaştırmak için direnç ve toprak da ölçülmeli.',
      'Ters bağlı LED ile açık direnci karıştırmak: açık dirençte R üzerinde tam besleme gerilimi vardır.',
      'Akım ölçmek için ampermetreyi paralel bağlamak (seri bağlanmalıdır).',
    ],
    faults: [
      { title: 'Seri direnç açık', how: 'R1 → Arıza laboratuvarı → "Açık devre"', symptom: 'LED söner: akım 0, R1 gerilimi 5 V, LED anodu 0 V.' },
      { title: 'LED açık (yanmış)', how: 'D1 → Arıza laboratuvarı → "Açık devre"', symptom: 'Akım 0; R1 üzerinde 0 V, anot düğümü 5 V’a çıkar.' },
      { title: 'LED kısa devre', how: 'D1 → "Kısa devre"', symptom: 'LED söner (üzerinde ≈ 0 V), akım yalnızca R ile sınırlanır: 5 V/150 Ω = 33 mA.' },
    ],
    quiz: [
      { id: 'q1', q: 'Sağlam devrede LED akımı kaç amper?', answer: 0.020656, tol: 0.03, unit: 'A', explain: '(5 − 1.9) / 150 ≈ 20.7 mA. Bu, arızalı devrenin karşılaştırma referansıdır.', verify: { probe: I('D1') } },
      { id: 'q2', q: 'Sağlam devrede R1 üzerinde kaç volt ölçülür?', answer: 3.098, tol: 0.03, unit: 'V', explain: 'V_R1 = 5 − Vf = 5 − 1.9 = 3.1 V. R1 açık olsaydı bu 5 V okunurdu.', verify: { probe: V('R1') } },
      { id: 'q3', q: 'LED yanmıyor, R1 üzerinde 5 V, LED anodunda 0 V ölçülüyor. En olası arıza?', options: ['R1 açık devre', 'LED kısa devre', 'Besleme yok', 'LED ters bağlı'], answer: 0, explain: 'Açık direnç akımı keser ve besleme gerilimi açık uçlar arasında görünür; LED anodu toprağa doğru 0 V’ta kalır.' },
      { id: 'q4', q: 'Ters bağlı LED’de en belirgin ölçüm hangisidir?', options: ['R1 üzerinde 5 V', 'R1 üzerinde ≈ 0 V, LED üzerinde ters yönde ≈ 5 V', 'LED üzerinde 1.9 V', 'Besleme gerilimi 0 V'], answer: 1, explain: 'Ters LED akım geçirmez: direnç üzerinde gerilim düşmez, besleme LED üzerinde ters olarak kalır.' },
      { id: 'q5', q: 'Arıza bulmada doğru ölçüm sırası hangisidir?', options: ['Önce LED’i değiştir', 'Besleme → toprak → düğüm gerilimleri → akım yönü', 'Rastgele ölç', 'Önce direnci sök'], answer: 1, explain: 'Sistemli sıra, sorunu kademe kademe daraltır ve gereksiz parça değiştirmeyi önler.' },
    ],
    challenge: {
      id: 'c-ariza01', title: 'Ters bağlı LED’i düzelt',
      goal: 'LED ters bağlanmış. Devreyi düzelt: LED akımı 8 mA ile 25 mA arasında olsun.',
      hints: ['LED’in anot (A) ucu pozitif tarafa, katot (K) toprağa bakmalı.', 'R1 ile D1’in bağlantılarını değiştir: R1.2 → D1.A ve D1.K → GND.', 'Direnç 150 Ω kalabilir: akım ≈ 20.7 mA.'],
      start: () => ledCircuit(true, 150),
      checks: [{ label: 'LED akımı', probe: I('D1'), min: 0.008, max: 0.025, unit: 'A' }],
      solution: () => ledCircuit(false, 150),
    },
    faultHunt: {
      id: 'h-ariza01', title: 'LED yanmıyor: sebebi bul',
      symptom: '5 V ile beslenen LED devresinde LED hiç yanmıyor. Besleme sağlam.',
      circuit: () => ledCircuit(false, 150),
      hidden: { R1: { kind: 'open' } },
      hints: ['Önce LED akımını ölç: 0 mı?', 'R1 ve D1 üzerindeki gerilimlere bak: hangisi tüm 5 V’u üzerinde taşıyor?', 'R1’in iki ucu arasında 5 V varsa, o parçadan akım geçmiyor demektir.'],
      answer: { comp: 'R1', kind: 'open' },
      explain: 'R1 iç bağlantısı kopmuş (açık devre). Akım yolu kesildiği için LED akımı 0’dır; R1 üzerinde 5 V, LED anodunda 0 V ölçülür. Sağlam devrede akım ≈ 20.7 mA’dir.',
      telltale: I('D1'),
    },
  },

  {
    id: 'ariza-02-bolucu-yanlis-cikis', track: 'ariza', level: 'baslangic', minutes: 12,
    title: 'Arıza: gerilim bölücü yanlış çıkış veriyor',
    summary: 'Çıkış 5 V olması gerekirken 6.9 V okunuyor: değeri kaymış/yanlış takılmış direnci düğüm geriliminden bul.',
    objectives: [
      'Vout = Vin·R2/(R1+R2) formülünden beklenen düğüm gerilimini hesaplamak.',
      'Ölçülen gerilimi beklenen değerle karşılaştırıp hangi direncin sapmış olabileceğini çıkarmak.',
      'Direnç kayması (drift) arızasını ölçümle doğrulamak.',
    ],
    theory: [
      { t: 'p', text: 'Gerilim bölücüde çıkış, iki direncin oranına bağlıdır. Oran bozulursa çıkış kayar. Bunun üç yaygın sebebi: yanlış değer takılmış (renk kodu yanlış okunmuş), direncin yaşlanıp değerinin kayması ve çıkışa bağlı yükün bölücüyü bozmasıdır.' },
      { t: 'formula', text: 'Vout = Vin · R2 / (R1 + R2)', note: '10 V, R1 = R2 = 10 kΩ → 5 V.' },
      { t: 'formula', text: 'R2 = R1 · Vout / (Vin − Vout)', note: 'Ölçülen Vout’tan R2’nin gerçek değerini geri hesaplar.' },
      { t: 'p', text: 'Ölçülen Vout = 6.875 V ise R2 = 10k × 6.875/3.125 = 22 kΩ: bu yaygın bir E12 değeridir ve renk kodu (kırmızı-kırmızı-turuncu) 10k (kahverengi-siyah-turuncu) ile karıştırılabilir. Direnç bölücüde R1 sapmış olsaydı da çıkış kayardı; hangi direnç olduğuna her direnç üzerindeki gerilim düşümüyle karar verilir (seri akım aynı olduğundan).' },
      { t: 'warn', text: 'Voltmetre iç direnci büyüktür, ama yüksek empedanslı bölücüde (MΩ) ölçüm yükü bile çıkışı bozabilir; ölçümden önce kaynak gerilimini de doğrula.' },
    ],
    calc: [
      { title: 'Beklenen çıkış', formula: 'Vout = Vin·R2/(R1+R2)', working: 'Vout = 10 × 10k/(10k+10k) = 5.00 V' },
      { title: 'Bölücü akımı', formula: 'I = Vin/(R1+R2)', working: 'I = 10 / 20k = 0.50 mA' },
      { title: 'Arızalıda (R2 = 22k)', formula: 'Vout = 10 × 22k/32k', working: 'Vout = 6.875 V (+%37.5), I = 0.3125 mA' },
      { title: 'R2’yi geri hesapla', formula: 'R2 = R1·Vout/(Vin − Vout)', working: 'R2 = 10k × 6.875/3.125 = 22 kΩ' },
    ],
    build: () => dividerCircuit(10000),
    steps: [
      'Sağlam bölücüyü çöz: R1–R2 orta düğümü 5.00 V, akım 0.5 mA olmalı.',
      'Arıza avında orta düğümü ve R1 ile R2 üzerindeki gerilimleri ölç: R1 üzerinde daha az, R2 üzerinde daha çok gerilim çıkarsa R2 büyümüştür.',
      'R2’ye "Değer kayması" ekle (+%120 = 22 kΩ) ve beklenen değerlerini hesaplamanla karşılaştır.',
      'Challenge’da R2 = 22 kΩ ile gelen devreyi düzelt: çıkış 5 V ± %2 olsun.',
    ],
    expects: [
      { label: 'Orta düğüm gerilimi (R2.1)', probe: N('R2', '1'), value: 5, unit: 'V' },
      { label: 'Bölücü akımı (R1)', probe: I('R1'), value: 0.0005, unit: 'A' },
    ],
    mistakes: [
      'R1 ve R2’yi karıştırmak: çıkış R2 (toprağa bakan) üzerindeki gerilimdir.',
      'Çıkış gerilimini topraktan değil başka bir düğüme göre ölçmek.',
      'Arızalı bölücü için "direnç yanmıştır" demek: kayma çoğu zaman renk/değer hatasıdır; direnci ölçmeden hüküm verme.',
      'Direnç tolerans (%5) kaynaklı küçük sapmayı arıza sanmak: 5 V ± 0.13 V normaldir.',
    ],
    faults: [
      { title: 'R2 değer kayması', how: 'R2 → Arıza laboratuvarı → "Değer kayması" → +120 %', symptom: 'Orta düğüm 5 V’tan 6.875 V’a çıkar, bölücü akımı 0.31 mA.' },
      { title: 'R1 değer kayması', how: 'R1 → "Değer kayması" → −50 %', symptom: 'R1 5 kΩ olur: Vout = 10×10/15 = 6.67 V.' },
      { title: 'R2 açık', how: 'R2 → "Açık devre"', symptom: 'Akım 0; orta düğüm 10 V’a çıkar (R1 üzerinde 0 V).' },
    ],
    quiz: [
      { id: 'q1', q: 'Sağlam bölücünün orta düğüm gerilimi kaç volt?', answer: 5, tol: 0.03, unit: 'V', explain: 'Vout = 10 × 10k/20k = 5 V.', verify: { probe: N('R2', '1') } },
      { id: 'q2', q: 'Çıkış 6.875 V ölçülüyor (Vin = 10 V, R1 = 10 kΩ). R2 kaç kΩ?', answer: 22, tol: 0.03, unit: 'kΩ', explain: 'R2 = R1·Vout/(Vin − Vout) = 10k × 6.875/3.125 = 22 kΩ.' },
      { id: 'q3', q: 'Aynı gerilimde R1 ve R2 üzerindeki gerilim eşit bulunmuyorsa ne söylenebilir?', options: ['Akım farklıdır', 'Dirençlerin değerleri eşit değildir', 'Kaynak bozuktur', 'Toprak yoktur'], answer: 1, explain: 'Seri devrede akım aynı; V = I·R olduğundan farklı gerilim, farklı direnç demektir.' },
      { id: 'q4', q: 'Orta düğüm 10 V (besleme gerilimi) okunuyorsa en olası arıza?', options: ['R2 açık devre', 'R1 kısa devre', 'R2 açık veya R1 kısa devre', 'Besleme düşük'], answer: 2, explain: 'Orta düğümün 10 V olması R1 üzerinde 0 V düşmesi demek; R2 açıksa akım yoktur, R1 kısaysa R2 tüm gerilimi alır.' },
      { id: 'q5', q: 'Sağlam bölücünün çektiği akım kaç mA?', answer: 0.5, tol: 0.03, unit: 'mA', explain: 'I = 10 V / 20 kΩ = 0.5 mA.' },
    ],
    challenge: {
      id: 'c-ariza02', title: 'Bölücüyü 5 V’a ayarla',
      goal: 'R2 yanlış değerde (22 kΩ). Orta düğüm gerilimini 4.9–5.1 V arasına getir.',
      hints: ['Vout = Vin·R2/(R1+R2); R1 = 10 kΩ ve Vin = 10 V iken 5 V için R2 = R1 gerekir.', 'R2’yi 10 kΩ yap.', 'Alternatif olarak R1’i 22 kΩ yapabilirsin: 10 × 22/44 = 5 V.'],
      start: () => dividerCircuit(22000),
      checks: [{ label: 'Orta düğüm gerilimi', probe: N('R2', '1'), min: 4.9, max: 5.1, unit: 'V' }],
      solution: () => dividerCircuit(10000),
    },
    faultHunt: {
      id: 'h-ariza02', title: 'Bölücü çıkışı yanlış',
      symptom: 'Orta düğüm 5 V olması gerekirken 6.9 V okunuyor. Besleme 10 V, R1 doğru görünüyor.',
      circuit: () => dividerCircuit(10000),
      hidden: { R2: { kind: 'drift', amount: 120 } },
      hints: ['R1 ve R2 üzerindeki gerilimleri ayrı ayrı ölç.', 'Hangi direnç üzerindeki gerilim beklenenden büyük?', 'Direnç değerini ölçülen gerilimlerden geri hesapla: R2 = R1·Vout/(Vin − Vout).'],
      answer: { comp: 'R2', kind: 'drift' },
      explain: 'R2 değeri 10 kΩ yerine 22 kΩ (değer kayması / yanlış değer). Oran bozulduğu için orta düğüm 6.875 V okunur. R2 = 10k × 6.875/3.125 = 22 kΩ.',
      telltale: N('R2', '1'),
    },
  },

  {
    id: 'ariza-03-transistor-anahtar', track: 'ariza', level: 'orta', minutes: 15,
    title: 'Arıza: transistör anahtar iletmiyor',
    summary: 'NPN transistörle LED sürülüyor ama LED yanmıyor. Taban akımı, Vbe ve Vce ölçümleriyle taban direnci / C–E arızasını ayırt et.',
    objectives: [
      'Doyumdaki NPN anahtar için beklenen Vbe ≈ 0.7 V, Vce ≈ 0.05–0.2 V ve Ic değerlerini hesaplamak.',
      'Vbe ve Vce ölçümlerinden "taban akımı yok" ile "C–E kısa" arızalarını ayırmak.',
      'Doyum için taban akımı gereksinimini (Ib ≥ Ic/β·2–5) uygulamak.',
    ],
    theory: [
      { t: 'p', text: 'NPN transistör anahtar olarak: taban akımı yeterliyse (doyum) kolektör–emitör arası küçük gerilim (Vce ≈ 0.1–0.2 V) düşer ve yük akımı akar. Taban akımı yoksa transistör kesimdedir: Ic ≈ 0 ve Vce ≈ besleme gerilimidir.' },
      { t: 'formula', text: 'Ib = (Vcc − Vbe) / Rb,   Ic(max) = (Vcc − Vf_LED − Vce) / Rc,   Ic ≤ β·Ib', note: 'Doyum için Ib ≥ Ic/β’nın birkaç katı olmalıdır.' },
      { t: 'p', text: 'Arıza ayrımı: Vbe ≈ 0.7 V ve Vce ≈ 0 ise sağlam. Vbe ≈ 0 ve Vce ≈ Vcc−Vf ise taban akımı yok (Rb açık, buton/kontak yok, taban kopuk). Vce ≈ 0 ama taban sürülmüyorken (Vbe ≈ 0) yük akıyorsa C–E kısadır; yük her zaman yanar.' },
      { t: 'warn', text: 'Simülatörde BC547B genel Ebers-Moll modelidir (Vceo, kapasite yok). Gerçek parçada β büyük değişir; doyum için hesaplanan taban akımını bol tut.' },
    ],
    calc: [
      { title: 'Taban akımı', formula: 'Ib = (Vcc − Vbe)/Rb', working: 'Ib = (5 − 0.70)/10k = 0.43 mA' },
      { title: 'Kolektör akımı', formula: 'Ic = (Vcc − Vf − Vce)/Rc', working: 'Ic = (5 − 2.1 − 0.05)/330 ≈ 8.8 mA   (simülatör: 8.78 mA)' },
      { title: 'Doyum kontrolü', formula: 'β_zorunlu = Ic/Ib', working: '8.78 mA / 0.43 mA ≈ 20 ≪ β(290): güçlü doyum, Vce = 0.045 V' },
      { title: 'Rb açık iken', formula: 'Ib = 0 → Ic ≈ 0', working: 'Vbe ≈ 0 V, Vce ≈ 4.07 V, LED akımı 0' },
    ],
    build: () => npnSwitch(10000),
    steps: [
      'Sağlam devreyi çöz: Ic ≈ 8.8 mA, Vbe ≈ 0.70 V, Vce ≈ 0.045 V. Bunlar referansındır.',
      'Arıza avında önce V1 ve R2’de gerilimi, sonra Q1.B (taban) düğümünü ölç: taban ≈ 0 V ise taban yolunda kopukluk vardır.',
      'R1’i bir ucundan "Açık devre" yap: LED söner, Vce ≈ 4 V. Ardından R1’i geri getir, Q1’e "C–E kısa" arızası ekle: LED yanar ama taban sürmesinden bağımsız.',
      'Challenge’da R1 = 1 MΩ ile başla: transistör doyuma ulaşmıyor, Ic ≈ 1.3 mA. R1’i düşür.',
    ],
    expects: [
      { label: 'Q1 kolektör akımı', probe: VAL('Q1', 'ic'), value: 0.00878, unit: 'A' },
      { label: 'Q1 Vce', probe: VAL('Q1', 'vce'), value: 0.0449, tol: { rel: 0.1, abs: 0.005 }, unit: 'V' },
      { label: 'Q1 Vbe', probe: VAL('Q1', 'vbe'), value: 0.7019, unit: 'V' },
    ],
    mistakes: [
      'Yalnızca LED’e bakıp transistörü suçlamak: taban akımı ve taban direncini ölçmeden hüküm verme.',
      'Taban akımını "Ic/β" kadar bırakmak: aktif bölgede kalıp ısınır; 2–5 kat fazla Ib ver.',
      'Vce’yi ölçerken toprak referansını yanlış almak (emitör topraklı değilse Vce ≠ düğüm gerilimi).',
      'C–E kısa arızasını "iletiyor" diye sağlam saymak: taban sürülmezken de iletiyorsa arıza vardır.',
    ],
    faults: [
      { title: 'Taban direnci açık', how: 'R1 → Arıza laboratuvarı → "Açık devre"', symptom: 'Taban akımı 0: Vbe ≈ 0, Vce ≈ 4 V, LED sönük.' },
      { title: 'C–E kısa', how: 'Q1 → "Kısa devre"', symptom: 'Taban sürülmese de yük akar; Vce ≈ 0, LED her zaman yanar.' },
      { title: 'C–E kaçak', how: 'Q1 → "C–E kaçak" → 10 kΩ', symptom: 'Kesimde bile küçük akım: LED hafif yanar.' },
    ],
    quiz: [
      { id: 'q1', q: 'Sağlam devrede Ic kaç mA’dir?', answer: 0.00878, tol: 0.03, unit: 'A', explain: 'Ic ≈ (5 − 2.1 − 0.05)/330 ≈ 8.8 mA.', verify: { probe: VAL('Q1', 'ic') } },
      { id: 'q2', q: 'Sağlam devrede Vbe kaç volt?', answer: 0.7019, tol: 0.03, unit: 'V', explain: 'Silisiyum BJT’de iletimdeki Vbe ≈ 0.65–0.75 V’tur.', verify: { probe: VAL('Q1', 'vbe') } },
      { id: 'q3', q: 'LED yanmıyor, Vbe ≈ 0 V ve Vce ≈ 4 V. En olası arıza?', options: ['C–E kısa', 'Taban yolunda açık devre (R1 açık)', 'LED kısa', 'Besleme fazla'], answer: 1, explain: 'Taban akımı yoksa Vbe ≈ 0 ve transistör kesimdedir: Vce yük üzerinden besleme gerilimine yakındır.' },
      { id: 'q4', q: 'Taban sürülmüyorken LED yanıyor ve Vce ≈ 0. En olası arıza?', options: ['R1 açık', 'Q1 C–E kısa', 'Toprak yok', 'LED ters'], answer: 1, explain: 'Taban akımı olmadan iletim, C–E arasında kısa devre (veya şiddetli kaçak) olduğunu gösterir.' },
      { id: 'q5', q: 'Doyum için gereken en az β nedir (Ic = 8.8 mA, Ib = 0.43 mA)?', answer: 20.5, tol: 0.05, explain: 'β_gerekli = Ic/Ib = 8.78 / 0.43 ≈ 20; gerçek β 290 olduğundan güçlü doyum vardır.' },
    ],
    challenge: {
      id: 'c-ariza03', title: 'Transistörü doyuma sok',
      goal: 'Taban direnci çok büyük (1 MΩ); transistör doyuma ulaşmıyor. Vce ≤ 0.3 V ve Ic ≥ 5 mA olacak şekilde düzelt.',
      hints: ['Ib = (5 − 0.7)/Rb; Ic ≈ 8 mA için Ib en az 0.03 mA gerekir ama doyum için bol tut.', 'Rb ≈ 10 kΩ → Ib = 0.43 mA.', 'Çok küçük Rb (ör. 100 Ω) kaynağı ve tabanı gereksiz zorlar.'],
      start: () => npnSwitch(1e6),
      checks: [
        { label: 'Vce', probe: VAL('Q1', 'vce'), max: 0.3, unit: 'V' },
        { label: 'Ic', probe: VAL('Q1', 'ic'), min: 0.005, unit: 'A' },
      ],
      solution: () => npnSwitch(10000),
    },
    faultHunt: {
      id: 'h-ariza03', title: 'Transistör anahtar çalışmıyor',
      symptom: '5 V’a bağlı NPN anahtar LED’i sürmüyor; LED hiç yanmıyor.',
      circuit: () => npnSwitch(10000),
      hidden: { R1: { kind: 'open' } },
      hints: ['Taban (B) düğümündeki gerilimi ölç: ≈ 0.7 V olmalıydı.', 'Taban 0 V ve Vce ≈ 4 V ise taban akımı yok demektir.', 'Taban akımının geldiği yolda hangi parça var?'],
      answer: { comp: 'R1', kind: 'open' },
      explain: 'Taban direnci R1 kopuk (açık devre): taban akımı yok, transistör kesimde, Vce ≈ 4 V ve LED akımı 0. Sağlam devrede Ic ≈ 8.8 mA, Vbe = 0.70 V.',
      telltale: I('D1'),
    },
  },

  {
    id: 'ariza-04-mosfet-gate-surusu', track: 'ariza', level: 'orta', minutes: 18,
    title: 'Arıza: MOSFET yüke akıtmıyor / yetersiz gate sürüşü',
    summary: 'Gate hasarı (G–S kısa) ve zayıf gate sürüşü: MOSFET’in yük akımı ve VGS ölçümleriyle gate sürüş arızalarını tanı.',
    objectives: [
      'Sağlam gate sürüşünde VGS = gate kaynağı, VDS ≈ 0 olduğunu doğrulamak.',
      'Gate oksidi hasarının (G–S kısa) VGS ≈ 0 ve gate direncinde ısınma ile nasıl göründüğünü açıklamak.',
      'Eşik gerilimi yüksek MOSFET’in düşük gate geriliminde neden yüksek güç harcadığını göstermek.',
    ],
    theory: [
      { t: 'p', text: 'MOSFET gate gerilimiyle sürülür, gate akımı ideal olarak sıfırdır. Gate ile source arasındaki oksit çok ince ve hassastır: statik deşarj veya aşırı VGS oksiti deler (G–S kısa). Bunun sonucu: gate kaynağı kısa devre görür, VGS ≈ 0 olur ve MOSFET iletmez. Gate sürücü kaynağı seri gate direnci üzerinden akım çeker ve bu direnç ısınır.' },
      { t: 'formula', text: 'P_RG = V_gate² / RG', note: '10 V ve 100 Ω: 1 W: 0.25 W’lık gate direnci ısınır.' },
      { t: 'p', text: 'İkinci arıza türü yetersiz sürüştür: yüksek eşikli (3.5 V) MOSFET 4 V gate ile doyumda kalır (VDS ≈ 5.7 V, ≈ 6 W) ve çok ısınır; bunun nedeni parça arızası değil yanlış parça/yanlış sürüş gerilimidir. Çözüm mantık seviyeli MOSFET veya daha yüksek gate gerilimi.' },
      { t: 'warn', text: 'Gate hasarlı MOSFET’i değiştirirken önce sürücüyü (kısa devreyi) de kontrol et: sebep devrede kalırsa yeni parça da bozulur. Elle tutarken statik koruma kullan. Bu simülatörde "G–S kısa" bir hasar modelidir; gerçek gate yükü ve ESD davranışı yoktur.' },
    ],
    calc: [
      { title: 'Sağlam tam iletim', formula: 'VGS = Vgate, ID ≈ V/RL', working: 'VGS = 10 V, ID = 12/6 = 2 A → ID = 1.99 A, VDS = 0.038 V, P_Q = 0.077 W' },
      { title: 'G–S kısa', formula: 'VGS ≈ Vgate·(Rkısa/(RG+Rkısa))', working: 'VGS ≈ 0.0001 V → ID ≈ 0, VDS ≈ 12 V' },
      { title: 'Gate direnci gücü', formula: 'P = V²/RG', working: 'P_RG = 10²/100 = 1.0 W (anma 0.25 W → aşılır)' },
      { title: 'Zayıf sürüş (4 V, std)', formula: 'Doyum: ID = K·Vov²', working: 'Vov = 0.5 V → ID ≈ 1.06 A, VDS ≈ 5.66 V, P ≈ 5.98 W' },
    ],
    build: () => mosLoad('nmos_std', 10, 6, 10, 100),
    steps: [
      'Sağlam devreyi çöz: VGS ≈ 10 V, ID ≈ 1.99 A, VDS ≈ 0.04 V ve P_Q ≈ 0.08 W olmalı.',
      'Arıza avında önce V2’yi, sonra RG üzerindeki gerilimi ölç: RG’de 10 V’a yakın gerilim ve VGS ≈ 0 ise gate kısadır; RG ısınır.',
      'Q1’e "Gate hasarı (G–S kısa)" arızası ekle: ID ≈ 0, VDS ≈ 12 V; yük hiç akım almaz.',
      'Arızayı kaldır, V2’yi 4 V yap: bu kez yük akar ama Q1 ≈ 6 W harcar. Isıl görünümde farkı gör; challenge’da çözümünü uygula.',
    ],
    expects: [
      { label: 'Q1 VGS', probe: VAL('Q1', 'vgs'), value: 10, unit: 'V' },
      { label: 'Q1 ID', probe: VAL('Q1', 'id'), value: 1.9936, unit: 'A' },
      { label: 'Q1 VDS', probe: VAL('Q1', 'vds'), value: 0.0384, tol: { rel: 0.1, abs: 0.005 }, unit: 'V' },
    ],
    mistakes: [
      'MOSFET’i yalnızca drain–source ölçümüyle "bozuk" ilan etmek: önce gate gerilimini (VGS) ölç.',
      'Seri gate direncini kaldırıp sürücüyü doğrudan gate’e bağlamak: arıza anında sürücü zarar görür.',
      'Gate hasarlı MOSFET’i değiştirip arızanın sebebini (ESD, aşırı VGS) bulmamak.',
      'Mantık seviyeli olmayan MOSFET’i 3.3/5 V ile sürüp "ısınıyor, arızalı" demek.',
    ],
    faults: [
      { title: 'Gate hasarı (G–S kısa)', how: 'Q1 → Arıza laboratuvarı → "Gate hasarı (G–S kısa)"', symptom: 'VGS ≈ 0, ID ≈ 0, yük çalışmaz; RG’de 1 W harcanır ve ısınır.' },
      { title: 'D–S kısa', how: 'Q1 → "Kısa devre"', symptom: 'Yük her zaman çalışır; gate sürüşünden bağımsız.' },
      { title: 'Yetersiz gate gerilimi', how: 'V2 = 4 V (std MOSFET)', symptom: 'MOSFET ≈ 6 W harcar ve çok ısınır (soğutucusuz hasar).' },
    ],
    quiz: [
      { id: 'q1', q: 'Sağlam devrede Q1 VGS kaç volt?', answer: 10, tol: 0.03, unit: 'V', explain: 'Gate akımı ≈ 0 olduğu için RG üzerinde düşüm yok: VGS = V2 = 10 V.', verify: { probe: VAL('Q1', 'vgs') } },
      { id: 'q2', q: 'Sağlam devrede yük akımı kaç amper?', answer: 1.9936, tol: 0.03, unit: 'A', explain: 'Tam iletimde ID ≈ 12 V/(6 Ω + RDS) ≈ 2 A.', verify: { probe: VAL('Q1', 'id') } },
      { id: 'q3', q: 'Gate oksidi deldi (G–S kısa). RG üzerinde kaç watt harcanır (V2 = 10 V, RG = 100 Ω)?', answer: 1, tol: 0.03, unit: 'W', explain: 'P = V²/R = 100/100 = 1 W; 0.25 W’lık direnç aşırı ısınır.' },
      { id: 'q4', q: 'VGS ≈ 0 V, ID = 0, RG üzerinde ≈ 10 V ölçülüyor. En olası arıza?', options: ['D–S kısa', 'Gate oksidi hasarı (G–S kısa)', 'Yük açık', 'Besleme yüksek'], answer: 1, explain: 'RG’de gerilim düşmesi gate yolunda akım demektir; VGS ≈ 0 olduğundan gate source’a çekilmiştir.' },
      { id: 'q5', q: 'Standart gate MOSFET’i 4 V gate ile sürünce hangi sorun oluşur?', options: ['Çok düşük kayıp', 'Doyumda kalır: VDS büyür, MOSFET çok ısınır', 'MOSFET kesimde kalır, yük 0', 'Gate yanar'], answer: 1, explain: 'Eşik 3.5 V; Vov = 0.5 V ile kanal zayıf iletir, akım yük sınırlamasından önce doyar ve VDS ≈ 5.7 V’ta ≈ 6 W harcanır.' },
    ],
    challenge: {
      id: 'c-ariza04', title: 'MOSFET’i serinlet: doğru parçayı seç',
      goal: 'Standart gate MOSFET 4 V ile sürülüyor ve ≈ 6 W harcıyor. Q1’in gücünü 1 W’ın altına indir; yük akımı ≥ 1.8 A kalsın.',
      hints: ['4 V gate eşiğin (3.5 V) hemen üstünde: doyumda kalır.', 'Q1’i VGS(th) = 1.8 V olan "N-MOSFET (mantık seviyesi, genel)" ile değiştir (nmos_logic).', 'Alternatif: V2’yi yükselt (≥ 5 V).'],
      start: () => mosLoad('nmos_std', 4, 6, 10, 100),
      checks: [
        { label: 'Q1 gücü', probe: P('Q1'), max: 1, unit: 'W' },
        { label: 'Yük akımı', probe: VAL('Q1', 'id'), min: 1.8, unit: 'A' },
      ],
      solution: () => mosLoad('nmos_logic', 4, 6, 10, 100),
    },
    faultHunt: {
      id: 'h-ariza04', title: 'MOSFET yükü sürmüyor',
      symptom: 'Yük çalışmıyor (akım yok), gate sürücüsü 10 V veriyor ve gate direnci (RG) çok sıcak.',
      circuit: () => mosLoad('nmos_std', 10, 6, 10, 100),
      hidden: { Q1: { kind: 'gateShort' } },
      hints: ['Q1’in VGS değerini ölç: 10 V olması gerekirken ne okuyorsun?', 'RG üzerindeki gerilim düşümü gate yolundan akım aktığını gösterir.', 'VGS ≈ 0 ise gate source’a çekilmiş demektir: gate oksidi mi?'],
      answer: { comp: 'Q1', kind: 'gateShort' },
      explain: 'Gate oksidi delinmiş (G–S kısa): gate source’a çekildiği için VGS ≈ 0 olur, MOSFET iletmez, yük akımı 0’dır ve RG üzerinde V²/R = 1 W harcanır.',
      telltale: VAL('Q1', 'vgs'),
    },
  },

  {
    id: 'ariza-05-kondansator-filtre', track: 'ariza', level: 'orta', minutes: 18,
    title: 'Arıza: kondansatör filtre görevini yapmıyor',
    summary: 'Besleme hattındaki dalgalanma (ripple) filtre kondansatörü bozulunca artar. Kapasite kaybı ve açık devre arızalarını ripple ve enerji ölçümüyle ayırt et.',
    objectives: [
      'Filtre kondansatörünün dalgalanmayı nasıl azalttığını (XC = 1/(2πfC)) hesaplamak.',
      'Kapasite kaybı veya açık devre durumunda dalgalanmanın artışını ölçmek.',
      'DC’de kondansatörün sağlamlığını enerji/yük ölçümüyle sınamak.',
    ],
    theory: [
      { t: 'p', text: 'Filtre kondansatörü yüke paralel bağlanır ve AC bileşeni topraklayarak çıkıştaki dalgalanmayı azaltır. Seri direnç (kablo, kaynak iç direnci) ile birlikte alçak geçiren filtre oluşturur. Kapasite azalırsa veya kondansatör açılırsa filtre görevini yapamaz ve ripple artar.' },
      { t: 'formula', text: 'XC = 1 / (2π·f·C)', note: '100 Hz, 4.7 mF: XC = 0.34 Ω. Kaynak direnci 4.7 Ω’a göre çok küçük: dalgalanma ≈ 15 kat bastırılır.' },
      { t: 'formula', text: 'Ripple_çıkış ≈ Ripple_giriş · XC / √(Rs² + XC²)', note: 'Yaklaşık değer; yük direnci Rs’ye göre büyük kabul edilir.' },
      { t: 'p', text: 'DC çözümde kondansatör açık devredir; bu yüzden tek başına açık devre arızasını DC voltmetre göstermez. Dalgalanmayı ölçmek için zamana bağlı ölçüm (osiloskop) gerekir. Bu derste kondansatörün depoladığı enerji E = ½·C·V² probu da gösterilir: kapasite kaybı DC gerilimini değiştirmediği halde enerjiyi aynı oranda düşürür (laboratuvarda LCR metre ölçümünün karşılığı).' },
      { t: 'warn', text: 'Elektrolitik kondansatör ömrü sınırlıdır: ısı ve ripple akımı ile ESR artar, kapasite azalır. Şişmiş/kokan kondansatör değiştirilmelidir. Kondansatörleri üzerinde çalışmadan önce boşalt; büyük kondansatörler ciddi akım verebilir. Bu simülatörde ESR ve sızıntı modeli yoktur.' },
    ],
    calc: [
      { title: 'Kondansatör empedansı', formula: 'XC = 1/(2πfC)', working: 'f = 100 Hz, C = 4.7 mF: XC = 1/(2π × 100 × 0.0047) = 0.34 Ω' },
      { title: 'DC çalışma noktası', formula: 'Vdc = Vin·RL/(Rs+RL)', working: '12 × 47/(4.7+47) = 10.91 V' },
      { title: 'Filtreli dalgalanma (tepe-tepe)', formula: 'Vpp ≈ 2·Vgenlik·XC/√(Rs²+XC²)', working: '4 V × 0.34/4.71 = 0.29 V (simülatör: 0.295 V)' },
      { title: 'Depolanan enerji', formula: 'E = ½·C·V²', working: '½ × 4.7 mF × 10.91² = 0.28 J. %90 kapasite kaybında 0.028 J' },
    ],
    build: () => filterCircuit(4.7e-3),
    speed: 0.01,
    steps: [
      'Sağlam devreyi çöz: C1 düğümü DC ≈ 10.91 V. Osiloskopta C1 + ucunu izle: 100 Hz ve ≈ 0.3 V tepe-tepe dalgalanma görürsün.',
      'C1’e "Kapasite kaybı" ekle (%90): DC gerilim değişmez (10.9 V) ama dalgalanma ≈ 2.3 V tepe-tepe’ye çıkar.',
      'C1’e "Açık devre" ekle: dalgalanma ≈ 3.6 V (kondansatör yokmuş gibi). Enerji probu bu durumda tanımsızdır.',
      'Challenge’da C1 = 100 nF ile başla: dalgalanmayı 0.5 V’un altına indirmek için kapasiteyi artır.',
    ],
    expects: [
      { label: 'DC gerilim (C1)', probe: N('C1', '1'), value: 10.909, unit: 'V' },
      { label: 'Dalgalanma tepe-tepe (C1)', probe: N('C1', '1'), value: 0.295, tran: RIPPLE_TRAN, tol: { rel: 0.1 }, unit: 'V' },
      { label: 'Depolanan enerji (C1)', probe: VAL('C1', 'energy'), value: 0.2797, unit: 'J' },
    ],
    mistakes: [
      'Filtre arızasını DC voltmetreyle aramak: DC gerilim değişmez, dalgalanma osiloskopla görülür.',
      'Yalnızca kapasitenin yazılı değerine güvenmek: elektrolitiklerde yaşlanmayla kapasite %50’ye düşebilir.',
      'Kondansatörü ters polarite veya anma geriliminin üstünde kullanmak (1.5×’ı aşan gerilim parçayı yok eder).',
      'Çok küçük kondansatörle "ripple hâlâ var" diye regülatörü suçlamak.',
    ],
    faults: [
      { title: 'Kapasite kaybı (yaşlanma)', how: 'C1 → Arıza laboratuvarı → "Kapasite kaybı" → 90 %', symptom: 'DC aynı kalır; ripple 0.3 V’tan ≈ 2.3 V’a çıkar, depolanan enerji %90 düşer.' },
      { title: 'Açık devre (kopuk bacak)', how: 'C1 → "Açık devre"', symptom: 'Ripple ≈ 3.6 V tepe-tepe, filtre yok.' },
      { title: 'Kaçak akım', how: 'C1 → "Kaçak akım" → 1 kΩ', symptom: 'DC gerilim düşer (paralel 1 kΩ), kondansatör ısınır.' },
    ],
    quiz: [
      { id: 'q1', q: 'Sağlam devrede C1 düğümünün DC gerilimi kaç volt?', answer: 10.909, tol: 0.03, unit: 'V', explain: 'DC’de kondansatör açık devre: 12 V × 47/(4.7 + 47) = 10.91 V.', verify: { probe: N('C1', '1') } },
      { id: 'q2', q: 'C1’de depolanan enerji kaç joule?', answer: 0.2797, tol: 0.03, unit: 'J', explain: 'E = ½·C·V² = 0.5 × 4.7e-3 × 10.91² = 0.28 J.', verify: { probe: VAL('C1', 'energy') } },
      { id: 'q3', q: 'C1 kapasitesi %90 düşerse DC gerilim ne olur?', options: ['Çok düşer', 'Neredeyse değişmez', 'Sıfırlanır', 'Artar'], answer: 1, explain: 'DC’de kondansatör akım geçirmez; bu yüzden kapasite kaybı DC gerilimi değiştirmez, yalnızca AC filtrelemeyi bozar.' },
      { id: 'q4', q: '100 Hz’de 4.7 mF kondansatörün empedansı yaklaşık kaç ohm?', answer: 0.34, tol: 0.03, unit: 'Ω', explain: 'XC = 1/(2π·100·0.0047) = 0.339 Ω.' },
      { id: 'q5', q: 'Filtre arızasını bulmak için en uygun ölçüm hangisi?', options: ['DC voltmetre', 'Osiloskopla dalgalanma (AC bileşen) ölçümü', 'Direnç ölçümü', 'Güç hesabı'], answer: 1, explain: 'Dalgalanma zamana bağlı bir olaydır; kondansatör arızası DC gerilimde belli olmaz, osiloskop veya LCR metre gerekir.' },
    ],
    challenge: {
      id: 'c-ariza05', title: 'Filtreyi onar: dalgalanmayı bastır',
      goal: 'Filtre kondansatörü 100 nF; hat dalgalanması ≈ 3.6 V tepe-tepe. C1 değerini artırarak C1 düğümündeki dalgalanmayı 0.5 V’un altına indir.',
      hints: ['XC = 1/(2πfC): kapasite büyüdükçe empedans düşer.', 'Hedef: XC ≪ 4.7 Ω (kaynak direnci). 100 Hz’de C ≥ 2 mF gerekir.', 'C1 = 4.7 mF dene (anma gerilimi 25 V, hat 12 V: uygun).'],
      start: () => filterCircuit(100e-9),
      checks: [{ label: 'Dalgalanma tepe-tepe', probe: N('C1', '1'), max: 0.5, tran: RIPPLE_TRAN, unit: 'V' }],
      solution: () => filterCircuit(4.7e-3),
    },
    faultHunt: {
      id: 'h-ariza05', title: 'Filtre çalışmıyor',
      symptom: 'Besleme hattında dalgalanma çok arttı (2 V civarı tepe-tepe) ama DC gerilim doğru (≈ 10.9 V).',
      circuit: () => filterCircuit(4.7e-3),
      hidden: { C1: { kind: 'capLoss', amount: 90 } },
      hints: ['DC gerilim doğruysa kaynak ve seri direnç sağlam görünür; AC bileşene bak.', 'Kondansatörün depoladığı enerjiyi (½CV²) sağlam referansla karşılaştır.', 'Enerji %90 düşük çıkıyorsa kapasite azalmıştır.'],
      answer: { comp: 'C1', kind: 'capLoss' },
      explain: 'C1 kapasitesi %90 azalmış (yaşlanma/kuruma): 4.7 mF yerine 0.47 mF. DC gerilim aynı kalır ama depolanan enerji 0.28 J’dan 0.028 J’a düşer ve dalgalanma ≈ 2.3 V’a çıkar.',
      telltale: VAL('C1', 'energy'),
    },
  },

  {
    id: 'ariza-06-yapisik-kontak-multimetre', track: 'ariza', level: 'orta', minutes: 15,
    title: 'Arıza: yapışık anahtar / kontak ve multimetre mantığı',
    summary: 'Anahtar açıkken lamba yanıyor. Düğüm gerilimlerini ölçüp beklenenle karşılaştırarak yapışık (kaynak olmuş) kontağı bul.',
    objectives: [
      'Açık anahtarın uçları arasında besleme gerilimi, kapalı anahtarda ≈ 0 V beklemeyi uygulamak.',
      'Multimetreyle düğüm gerilimlerini ölçüp beklenen değerle karşılaştırarak arıza çıkarımı yapmak.',
      'Yapışık kontak ile kablo/atlama telini ayırt etmek.',
    ],
    theory: [
      { t: 'p', text: 'Multimetre mantığı: her ölçümün bir beklentisi olmalı. Açık bir anahtarın iki ucu arasında kaynak gerilimi (burada 12 V) ölçülür; kapalı anahtarın uçları arasında ise ≈ 0 V. Yük tarafında anahtar açıkken 0 V, kapalıyken yaklaşık kaynak gerilimi beklenir. Beklenenle ölçülen çelişirse arıza oradadır.' },
      { t: 'formula', text: 'V_anahtar = V_besleme − V_yük,   I = V_yük / R_yük', note: 'Anahtar açık: I = 0, V_anahtar = V_besleme. Anahtar kapalı: V_anahtar ≈ 0.' },
      { t: 'p', text: 'Yapışık (welded) kontak: yüksek akım veya kıvılcım kontakları kaynaklayıp kapalı bırakır. Belirti: anahtar "açık" konumdayken bile yük çalışır, anahtar uçları arasında ≈ 0 V ölçülür. Bu, anahtarı atlayan bir tel (köprü) ile aynı ölçümü verir; fark yalnızca anahtar çıkarıldığında (güç kapalıyken süreklilik) anlaşılır.' },
      { t: 'p', text: 'Sistemli ölçüm sırası: (1) besleme (V1 uçları) ≈ 12 V; (2) toprak/dönüş yolu: yük alt ucu ≈ 0 V; (3) anahtarın iki ucu ve yük ucu düğüm gerilimleri; (4) yükten geçen akımın yönü ve değeri.' },
      { t: 'warn', text: 'Gerçek kontak arızalarında yük akımı kontak anma değerinin 2 katını aştığında kontaklar kaynaklanır (bu simülatörün hasar eşiği). Endüktif yüklerde söndürme (diyot/RC snubber) kullan, kontak ömrü için anma değerini aşma. Şebeke devrelerinde bu tür kontak arızaları ölümcül olabilir; bu simülatör şebekeyi modellemez.' },
    ],
    calc: [
      { title: 'Anahtar açık (sağlam)', formula: 'I = 0,  V_yük = 0,  V_anahtar = 12 V', working: 'Lamba söner; anahtarın iki ucu arasında 12 V ölçülür' },
      { title: 'Anahtar kapalı', formula: 'I = V/R', working: 'I = 12/47 = 0.255 A,  P_lamba = 12²/47 = 3.06 W (5 W anma altında)' },
      { title: 'Yapışık kontak (açık konumda)', formula: 'V_anahtar ≈ 0.255 A × 1 mΩ = 0.26 mV', working: 'Lamba yanar: V_yük ≈ 12 V, I ≈ 0.255 A' },
    ],
    build: () => switchLamp(false),
    steps: [
      'Anahtar açıkken çöz: SW1 uçları arasında 12 V, lamba (RL) ucunda ≈ 0 V olmalı. Bunlar referansındır.',
      'Arıza avında SW1 uçları arasını ölç: ≈ 0 V mu? Lamba ucunda gerilim var mı? Anahtar açık görünüyorsa kontak yapışmıştır.',
      'SW1’e "Yapışık kontak" arızası ekle: lamba yanar, SW1 üzerinde ≈ 0 V görürsün. Aynı belirtiyi bir köprü teli ile üret (challenge başlangıç devresi) ve farkı yorumla.',
      'Challenge’da anahtarı köprüleyen unutulmuş telin kaldırılmasını sağla: anahtar açıkken lamba 0.5 V’un altında olsun.',
    ],
    expects: [
      { label: 'SW1 uçları arası gerilim (açık)', probe: V('SW1'), value: 12, unit: 'V' },
      { label: 'Lamba ucu gerilimi (RL.1)', probe: N('RL', '1'), value: 0, tol: { abs: 0.01 }, unit: 'V' },
    ],
    mistakes: [
      'Anahtarı yalnızca gözle "açık" görüp yük ucunu ölçmemek: ölçüm yoksa arıza yoktur varsayımı yapılır.',
      'Multimetreyi yanlış kademede kullanmak (akım kademesinde gerilim ölçmek kısa devre yaratır).',
      'Yapışık kontak ile atlama telini aynı sanmak: kontak yapışması parça arızasıdır, atlama teli kablolama hatasıdır.',
      'Güç açıkken anahtarın direncini (süreklilik) ölçmek: önce enerjiyi kes.',
    ],
    faults: [
      { title: 'Yapışık kontak', how: 'SW1 → Arıza laboratuvarı → "Yapışık kontak (hep kapalı)"', symptom: 'Anahtar açık konumda bile lamba yanar; SW1 uçları ≈ 0 V.' },
      { title: 'Açık kalan kontak', how: 'SW1 → "Kontak açık kalır"', symptom: 'Anahtar kapalıyken bile lamba yanmaz; SW1 üzerinde 12 V.' },
      { title: 'Aralıklı temas', how: 'SW1 → "Aralıklı temas" → 5 Hz', symptom: 'Lamba titrer: ölçüm değerleri zamanla değişir.' },
    ],
    quiz: [
      { id: 'q1', q: 'Sağlam devrede anahtar açıkken SW1 uçları arasında kaç volt ölçülür?', answer: 12, tol: 0.03, unit: 'V', explain: 'Açık anahtardan akım geçmez; lamba üzerinde gerilim düşmez, tüm 12 V anahtar uçlarındadır.', verify: { probe: V('SW1') } },
      { id: 'q2', q: 'Anahtar açık, lamba yanıyor ve SW1 uçları arasında ≈ 0 V ölçülüyor. Sebep?', options: ['Besleme düşük', 'Kontak yapışmış veya anahtar atlanmış', 'Lamba kısa', 'Toprak kopuk'], answer: 1, explain: 'Anahtar uçları arasında gerilim yok ve akım akıyor; anahtar iletiyordur (yapışık ya da köprülenmiş).' },
      { id: 'q3', q: 'Anahtar kapalıyken lamba gücü kaç watt? (12 V, 47 Ω)', answer: 3.06, tol: 0.03, unit: 'W', explain: 'P = V²/R = 144/47 = 3.06 W.' },
      { id: 'q4', q: 'Yapışık kontak ile atlama telini ayırmak için en güvenli yöntem?', options: ['Gücü açık tutup kontağı kıvırmak', 'Enerjiyi kesip anahtarda süreklilik ölçmek veya anahtarı çıkarmak', 'Lambayı çıkarmak', 'Kaynağı artırmak'], answer: 1, explain: 'Enerji kesilmişken anahtar bağlantısı ölçülür: tel varsa çıkarıldığında süreklilik sürer, kontak yapışıksa anahtar tek başına iletir.' },
      { id: 'q5', q: 'Sistemli multimetre ölçüm sırası hangisidir?', options: ['Besleme, toprak, düğüm gerilimleri, akım', 'Yalnızca yük', 'Önce parça değiştir', 'Rasgele ölç'], answer: 0, explain: 'Besleme ve toprak doğrulanmadan düğüm gerilimlerinden çıkarım yapılamaz; her ölçüm önceki ölçümün sonucuna dayanır.' },
    ],
    challenge: {
      id: 'c-ariza06', title: 'Unutulmuş köprüyü bul',
      goal: 'Anahtarı bir tel köprülüyor, anahtar açıkken lamba yanıyor. Köprüyü kaldır: SW1 uçları ≥ 11 V, lamba ucu ≤ 0.5 V olsun.',
      hints: ['Anahtar açıkken lamba yanıyorsa V1+ ile lamba arasında anahtardan bağımsız bir yol vardır.', 'V1.P ile RL.1’i doğrudan birleştiren teli bul.', 'Teli sil: devre sağlam referans haline döner.'],
      start: () => switchLamp(true),
      checks: [
        { label: 'SW1 gerilimi (açık)', probe: V('SW1'), min: 11, unit: 'V' },
        { label: 'Lamba ucu gerilimi', probe: N('RL', '1'), max: 0.5, unit: 'V' },
      ],
      solution: () => switchLamp(false),
    },
    faultHunt: {
      id: 'h-ariza06', title: 'Anahtar açık ama lamba yanıyor',
      symptom: 'SW1 açık konumda ama lamba yanıyor ve ısınıyor.',
      circuit: () => switchLamp(false),
      hidden: { SW1: { kind: 'welded' } },
      hints: ['SW1 uçları arasındaki gerilimi ölç: açık anahtarda 12 V olmalıydı.', 'Ölçüm ≈ 0 V ise anahtar iletiyordur.', 'Anahtar açık konumda ama iletiyorsa kontaklara ne olmuş olabilir?'],
      answer: { comp: 'SW1', kind: 'welded' },
      explain: 'SW1 kontakları kaynaklanıp yapışmış (welded): fiziksel olarak açık konumda bile kontak iletir. SW1 üzerinde ≈ 0 V, lamba akımı 0.255 A’dir. Sağlam anahtarda uçlar arasında 12 V ve akım 0 olmalıydı.',
      telltale: V('SW1'),
    },
  },
];
