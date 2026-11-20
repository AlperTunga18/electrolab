import type { ComponentDef, PinDef, ParamDef, Rating } from './types';
import { CATALOG } from './catalog';
import { upgradeMcuBoards } from '../core/mcu/boards';

const pin = (id: string, label: string, x: number, z: number, y = 0.2): PinDef => ({ id, label, x, z, y });
const num = (key: string, label: string, unit: string, def: number, o: Partial<ParamDef> = {}): ParamDef => ({
  key, label, unit, type: 'number', default: def, si: o.si ?? unit !== '', ...o,
});
/** relay contact physics params (bounce / arc): generic typical values, see RYE in core/sim/mna.ts */
const RELAY_CONTACT_PARAMS: ParamDef[] = [
  num('bounce', 'Kontak sıçrama süresi (0 = yok)', 'ms', 2, { min: 0, max: 20, si: false }),
  num('nbounce', 'Sıçrama sayısı', '', 3, { min: 0, max: 8, si: false }),
  { key: 'arc', label: 'Kontak arkı', unit: '', type: 'boolean', default: true },
  num('warc', 'Kontak aşınma ark enerjisi sınırı (genel)', 'J', 20, { min: 0.01 }),
];
const rate = (label: string, unit: string, quantity: Rating['quantity'], paramKey: string): Rating => ({
  key: paramKey, label, unit, quantity, paramKey,
});

const ledColors = [
  { value: 'red', label: 'Kırmızı' },
  { value: 'yellow', label: 'Sarı' },
  { value: 'green', label: 'Yeşil' },
  { value: 'blue', label: 'Mavi' },
  { value: 'white', label: 'Beyaz' },
  { value: 'orange', label: 'Turuncu' },
  { value: 'ir', label: 'IR (940 nm)' },
  { value: 'uv', label: 'UV' },
];

const two = (a = '1', b = '2', x = 1): PinDef[] => [pin(a, a, -x, 0), pin(b, b, x, 0)];
const three = (a: string, b: string, c: string): PinDef[] => [pin(a, a, -0.5, 0), pin(b, b, 0, 0), pin(c, c, 0.5, 0)];

/**
 * Built-in generic library. Textbook/SPICE-class generic models, NOT specific manufacturer parts.
 * `missing` lists data we do not have, instead of pretending it exists.
 */
const CORE: ComponentDef[] = [
  {
    type: 'resistor', name: 'Direnç', nameEn: 'Resistor', category: 'passive', prefix: 'R', model: 'resistor',
    pins: two(),
    params: [num('r', 'Direnç', 'Ω', 1000, { min: 1e-3 }), num('tol', 'Tolerans', '%', 5, { min: 0, max: 50, si: false }), num('pmax', 'Anma gücü', 'W', 0.25, { min: 0.01 })],
    ratings: [rate('Anma gücü', 'W', 'power', 'pmax')],
    description: 'Akımı sınırlayan temel pasif eleman. V = I·R, P = V·I.',
    dataSource: 'generic-model',
    missing: ['üretici', 'model no', 'datasheet', 'ısıl direnç', 'sıcaklık katsayısı', 'footprint'],
    size: { w: 2.4, d: 0.6, h: 0.6 },
  },
  {
    type: 'capacitor', name: 'Kondansatör (seramik)', nameEn: 'Capacitor (ceramic)', category: 'passive', prefix: 'C', model: 'capacitor',
    pins: two('1', '2', 0.5),
    params: [num('c', 'Kapasite', 'F', 100e-9, { min: 1e-15 }), num('vmax', 'Anma gerilimi', 'V', 50, { min: 1 }), num('v0', 'Başlangıç gerilimi', 'V', 0), num('esr', 'ESR (seri direnç; 0 = ideal)', 'Ω', 0, { min: 0 })],
    ratings: [rate('Anma gerilimi', 'V', 'voltage', 'vmax')],
    description: 'Enerjiyi elektrik alanında depolar. i = C·dv/dt. Zaman sabiti τ = R·C.',
    dataSource: 'generic-model',
    missing: ['ESR', 'sızıntı akımı', 'DC-bias etkisi', 'datasheet', 'footprint'],
    size: { w: 1.2, d: 0.4, h: 1.2 },
  },
  {
    type: 'capacitor_el', name: 'Kondansatör (elektrolitik)', nameEn: 'Capacitor (electrolytic)', category: 'passive', prefix: 'C', model: 'capacitor',
    pins: [pin('1', '+', -0.5, 0), pin('2', '−', 0.5, 0)],
    params: [num('c', 'Kapasite', 'F', 100e-6, { min: 1e-12 }), num('vmax', 'Anma gerilimi', 'V', 25, { min: 1 }), num('v0', 'Başlangıç gerilimi', 'V', 0), num('esr', 'ESR (seri direnç; 0 = ideal)', 'Ω', 0, { min: 0 })],
    ratings: [rate('Anma gerilimi', 'V', 'voltage', 'vmax')],
    description: 'Polarize kondansatör. Ters bağlanırsa zarar görür (aşım uyarısı verilir).',
    dataSource: 'generic-model',
    missing: ['ESR', 'ripple akımı sınırı', 'sızıntı akımı', 'ömür modeli', 'datasheet'],
    size: { w: 1.4, d: 1.4, h: 2 },
  },
  {
    type: 'inductor', name: 'Bobin', nameEn: 'Inductor', category: 'passive', prefix: 'L', model: 'inductor',
    pins: two(),
    params: [num('l', 'Endüktans', 'H', 10e-3, { min: 1e-12 }), num('imax', 'Maks. akım', 'A', 1, { min: 1e-3 }),
      num('isat', 'Doyma akımı Isat (0 = doymaz)', 'A', 0, { min: 0 }), num('droppct', 'Isat’taki L düşüşü', '%', 30, { min: 1, max: 90, si: false })],
    ratings: [rate('Maks. akım', 'A', 'current', 'imax')],
    description: 'Enerjiyi manyetik alanda depolar. v = L·di/dt. Akım ani değişmez. Isat > 0 girilirse endüktans L(i) = L0/(1+(i/ik)²) ile doyar (genel model).',
    dataSource: 'generic-model',
    missing: ['DCR', 'doyma akımı değeri (Isat = 0: doyma yok sayılır)', 'SRF', 'datasheet'],
    size: { w: 2, d: 1, h: 1 },
  },
  {
    type: 'diode', name: 'Diyot (1N4148 sınıfı)', nameEn: 'Diode (1N4148-class)', category: 'semiconductor', prefix: 'D', model: 'diode',
    pins: [pin('A', 'A', -1, 0), pin('K', 'K', 1, 0)],
    params: [num('is', 'Is (doyma akımı)', 'A', 2.52e-9, { min: 1e-18 }), num('n', 'n (idealite)', '', 1.752, { min: 1, max: 3, si: false }),
      num('ifmax', 'Maks. ileri akım', 'A', 0.2, { min: 1e-3 }), num('vrmax', 'Maks. ters gerilim', 'V', 100, { min: 1 })],
    ratings: [rate('Maks. ileri akım', 'A', 'current', 'ifmax'), rate('Maks. ters gerilim', 'V', 'reverseVoltage', 'vrmax')],
    description: 'Akımı tek yönde geçirir. Shockley: I = Is·(e^(V/nVt) − 1).',
    dataSource: 'generic-model',
    missing: ['Rs (seri direnç)', 'kapasite', 'toparlanma süresi', 'datasheet'],
    size: { w: 2.2, d: 0.5, h: 0.5 },
  },
  {
    type: 'led', name: 'LED', nameEn: 'LED', category: 'semiconductor', prefix: 'D', model: 'led',
    pins: [pin('A', 'A (+)', -0.5, 0), pin('K', 'K (−)', 0.5, 0)],
    params: [{ key: 'color', label: 'Renk', unit: '', type: 'select', default: 'red', options: ledColors }, num('ifmax', 'Maks. ileri akım', 'A', 0.03, { min: 1e-3 })],
    ratings: [rate('Maks. ileri akım', 'A', 'current', 'ifmax')],
    description: 'Işık yayan diyot. Mutlaka seri dirençle kullanılır; parlaklık akımla orantılıdır.',
    dataSource: 'generic-model',
    missing: ['ışık şiddeti (mcd)', 'ters gerilim sınırı', 'datasheet'],
    size: { w: 0.8, d: 0.8, h: 1.2 },
  },
  {
    type: 'zener', name: 'Zener diyot', nameEn: 'Zener diode', category: 'semiconductor', prefix: 'D', model: 'zener',
    pins: [pin('A', 'A', -1, 0), pin('K', 'K', 1, 0)],
    params: [num('vz', 'Zener gerilimi', 'V', 5.1, { min: 1 }), num('pmax', 'Maks. güç', 'W', 0.5, { min: 0.01 })],
    ratings: [rate('Maks. güç', 'W', 'power', 'pmax')],
    description: 'Ters yönde Vz civarında iletime geçer; basit gerilim referansı/kıskaç.',
    dataSource: 'generic-model',
    missing: ['dinamik empedans', 'sıcaklık katsayısı', 'datasheet'],
    size: { w: 2.2, d: 0.5, h: 0.5 },
  },
  {
    type: 'npn', name: 'NPN transistör (BC547 sınıfı)', nameEn: 'NPN BJT (BC547-class)', category: 'semiconductor', prefix: 'Q', model: 'npn',
    pins: three('C', 'B', 'E'),
    params: [num('bf', 'βF (akım kazancı)', '', 300, { min: 10, max: 1000, si: false }), num('is', 'Is', 'A', 1.8e-14, { min: 1e-18 }),
      num('icmax', 'Maks. kolektör akımı', 'A', 0.1, { min: 1e-3 }), num('pmax', 'Maks. güç', 'W', 0.5, { min: 0.01 })],
    ratings: [rate('Maks. kolektör akımı', 'A', 'current', 'icmax'), rate('Maks. güç', 'W', 'power', 'pmax')],
    description: 'Akımla kontrol edilen anahtar/yükselteç. Ic ≈ β·Ib (aktif bölge); doyumda Vce ≈ 0.1–0.2 V.',
    dataSource: 'generic-model',
    missing: ['Early gerilimi', 'kapasiteler', 'Vceo/Vcbo sınırı', 'datasheet'],
    size: { w: 1.4, d: 1.2, h: 1.4 },
  },
  {
    type: 'pnp', name: 'PNP transistör (genel)', nameEn: 'PNP BJT (generic)', category: 'semiconductor', prefix: 'Q', model: 'pnp',
    pins: three('C', 'B', 'E'),
    params: [num('bf', 'βF (akım kazancı)', '', 200, { min: 10, max: 1000, si: false }), num('is', 'Is', 'A', 1.8e-14, { min: 1e-18 }),
      num('icmax', 'Maks. kolektör akımı', 'A', 0.1, { min: 1e-3 }), num('pmax', 'Maks. güç', 'W', 0.5, { min: 0.01 })],
    ratings: [rate('Maks. kolektör akımı', 'A', 'current', 'icmax'), rate('Maks. güç', 'W', 'power', 'pmax')],
    description: 'NPN’in tamamlayıcısı; emitör pozitif beslemeye bağlanır, taban düşürülünce iletir.',
    dataSource: 'generic-model',
    missing: ['Early gerilimi', 'kapasiteler', 'datasheet'],
    size: { w: 1.4, d: 1.2, h: 1.4 },
  },
  {
    type: 'nmos_logic', name: 'N-MOSFET (mantık seviyesi, genel)', nameEn: 'N-MOSFET (logic-level, generic)', category: 'semiconductor', prefix: 'Q', model: 'nmos',
    pins: three('G', 'D', 'S'),
    params: [num('vth', 'VGS(th)', 'V', 1.8, { min: 0.2, max: 6 }), num('k', 'K (Id=K·Vov² doyumda)', 'A/V²', 7, { min: 1e-3 }),
      num('lambda', 'λ', '1/V', 0.01, { min: 0, max: 0.2, si: false }), num('vgsmax', 'Maks. |VGS|', 'V', 16, { min: 1 }),
      num('vdsmax', 'Maks. VDS', 'V', 55, { min: 1 }), num('idmax', 'Maks. ID', 'A', 30, { min: 0.1 })],
    ratings: [rate('Maks. |VGS|', 'V', 'voltage', 'vgsmax'), rate('Maks. ID', 'A', 'current', 'idmax')],
    description: 'Gerilimle kontrol edilen anahtar. VGS > VGS(th) iletim başlar; tam iletim için VGS ≫ VGS(th) gerekir.',
    dataSource: 'generic-model',
    missing: ['Qg (gate charge)', 'kapasiteler', 'RDS(on) tablosu', 'SOA', 'ısıl direnç', 'datasheet'],
    size: { w: 1.6, d: 2.2, h: 2.2 },
  },
  {
    type: 'nmos_std', name: 'N-MOSFET (standart gate, genel)', nameEn: 'N-MOSFET (standard gate, generic)', category: 'semiconductor', prefix: 'Q', model: 'nmos',
    pins: three('G', 'D', 'S'),
    params: [num('vth', 'VGS(th)', 'V', 3.5, { min: 0.2, max: 8 }), num('k', 'K (Id=K·Vov² doyumda)', 'A/V²', 4, { min: 1e-3 }),
      num('lambda', 'λ', '1/V', 0.01, { min: 0, max: 0.2, si: false }), num('vgsmax', 'Maks. |VGS|', 'V', 20, { min: 1 }),
      num('vdsmax', 'Maks. VDS', 'V', 55, { min: 1 }), num('idmax', 'Maks. ID', 'A', 30, { min: 0.1 })],
    ratings: [rate('Maks. |VGS|', 'V', 'voltage', 'vgsmax'), rate('Maks. ID', 'A', 'current', 'idmax')],
    description: 'Yüksek eşikli MOSFET. 5 V gate sürüşü ile tam iletime geçmez — mikrodenetleyiciyle dikkat.',
    dataSource: 'generic-model',
    missing: ['Qg (gate charge)', 'kapasiteler', 'RDS(on) tablosu', 'SOA', 'ısıl direnç', 'datasheet'],
    size: { w: 1.6, d: 2.2, h: 2.2 },
  },
  {
    type: 'pmos', name: 'P-MOSFET (genel)', nameEn: 'P-MOSFET (generic)', category: 'semiconductor', prefix: 'Q', model: 'pmos',
    pins: three('G', 'D', 'S'),
    params: [num('vth', '|VGS(th)|', 'V', 2.5, { min: 0.2, max: 8 }), num('k', 'K', 'A/V²', 3, { min: 1e-3 }),
      num('lambda', 'λ', '1/V', 0.01, { min: 0, max: 0.2, si: false }), num('vgsmax', 'Maks. |VGS|', 'V', 20, { min: 1 }),
      num('vdsmax', 'Maks. |VDS|', 'V', 55, { min: 1 }), num('idmax', 'Maks. |ID|', 'A', 20, { min: 0.1 })],
    ratings: [rate('Maks. |VGS|', 'V', 'voltage', 'vgsmax'), rate('Maks. |ID|', 'A', 'current', 'idmax')],
    description: 'Yüksek taraf anahtarı. Source pozitif beslemeye bağlanır, gate source’un altına çekilince iletir.',
    dataSource: 'generic-model',
    missing: ['Qg', 'kapasiteler', 'SOA', 'ısıl direnç', 'datasheet'],
    size: { w: 1.6, d: 2.2, h: 2.2 },
  },
  {
    type: 'dc_supply', name: 'DC güç kaynağı', nameEn: 'DC supply', category: 'source', prefix: 'V', model: 'vsource',
    pins: [pin('P', '+', -0.5, 0), pin('N', '−', 0.5, 0)],
    params: [{ key: 'wave', label: 'Dalga', unit: '', type: 'select', default: 'dc', options: [{ value: 'dc', label: 'DC' }] },
      num('v', 'Gerilim', 'V', 5), num('ilimit', 'Akım limiti (uyarı)', 'A', 1, { min: 1e-3 })],
    ratings: [rate('Akım limiti', 'A', 'current', 'ilimit')],
    description: 'İdeal DC gerilim kaynağı. Akım limiti şimdilik yalnızca aşım uyarısı üretir, kaynağı sınırlamaz.',
    dataSource: 'generic-model',
    missing: ['iç direnç', 'CC modu', 'ripple'],
    size: { w: 3, d: 2, h: 1.6 },
  },
  {
    type: 'signal_gen', name: 'Fonksiyon jeneratörü', nameEn: 'Function generator', category: 'source', prefix: 'V', model: 'vsource',
    pins: [pin('P', 'OUT', -0.5, 0), pin('N', 'GND', 0.5, 0)],
    params: [{ key: 'wave', label: 'Dalga', unit: '', type: 'select', default: 'sine', options: [
      { value: 'sine', label: 'Sinüs' }, { value: 'square', label: 'Kare' }, { value: 'triangle', label: 'Üçgen' }] },
      num('v', 'DC ofset', 'V', 0), num('amp', 'Genlik (tepe; negatif = ters faz)', 'V', 5, { min: -1000 }), num('freq', 'Frekans', 'Hz', 1000, { min: 1e-3 }),
      num('duty', 'Doluluk (kare)', '%', 50, { min: 1, max: 99, si: false })],
    ratings: [],
    description: 'Sinüs / kare / üçgen dalga üreten ideal kaynak. Kare dalga + MOSFET = PWM deneyleri.',
    dataSource: 'generic-model',
    missing: ['çıkış empedansı (50 Ω)', 'bant genişliği sınırı'],
    size: { w: 3, d: 2, h: 1.6 },
  },
  {
    type: 'isource', name: 'DC akım kaynağı', nameEn: 'Current source', category: 'source', prefix: 'I', model: 'isource',
    pins: [pin('P', '+', -0.5, 0), pin('N', '−', 0.5, 0)],
    params: [num('i', 'Akım', 'A', 0.01)],
    ratings: [],
    description: 'İdeal akım kaynağı: P pininden devreye akım verir, N pininden geri çeker.',
    dataSource: 'generic-model',
    missing: ['uyum gerilimi sınırı'],
    size: { w: 2, d: 1.5, h: 1 },
  },
  {
    type: 'ground', name: 'Toprak (0 V referans)', nameEn: 'Ground (0 V reference)', category: 'reference', prefix: 'GND', model: 'ground',
    pins: [pin('G', 'GND', 0, 0)],
    params: [], ratings: [],
    description: 'Devrenin 0 V referans düğümü. Her simülasyon için en az bir toprak gerekir.',
    dataSource: 'generic-model',
    missing: [],
    size: { w: 1, d: 1, h: 0.6 },
  },
  {
    type: 'switch', name: 'Anahtar (SPST)', nameEn: 'Switch (SPST)', category: 'io', prefix: 'SW', model: 'switch',
    pins: two('1', '2', 0.5),
    params: [{ key: 'closed', label: 'Kapalı (iletimde)', unit: '', type: 'boolean', default: false }, num('imax', 'Kontak akım sınırı', 'A', 2, { min: 0.01 })],
    ratings: [rate('Kontak akımı', 'A', 'current', 'imax')],
    description: 'Kapalıyken ~1 mΩ, açıkken çok yüksek direnç. 3D’de çift tıklayarak aç/kapat.',
    dataSource: 'generic-model',
    missing: ['kontak sıçraması', 'ömür', 'datasheet'],
    size: { w: 1.6, d: 1, h: 1.2 },
  },
  {
    type: 'button', name: 'Buton (basmalı)', nameEn: 'Push button', category: 'io', prefix: 'SW', model: 'switch',
    pins: two('1', '2', 0.5),
    params: [{ key: 'closed', label: 'Basılı', unit: '', type: 'boolean', default: false }, num('imax', 'Kontak akım sınırı', 'A', 0.05, { min: 0.001 })],
    ratings: [rate('Kontak akımı', 'A', 'current', 'imax')],
    description: 'Basılıyken iletir. 3D’de çift tıklayarak bas/bırak.',
    dataSource: 'generic-model',
    missing: ['kontak sıçraması', 'ömür', 'datasheet'],
    size: { w: 1.2, d: 1.2, h: 1 },
  },
  {
    type: 'pot', name: 'Potansiyometre', nameEn: 'Potentiometer', category: 'passive', prefix: 'RV', model: 'pot',
    pins: three('A', 'W', 'B').map((p, i) => ({ ...p, x: (i - 1) * 1 })),
    params: [num('r', 'Toplam direnç', 'Ω', 10000, { min: 1 }), num('pos', 'Konum (0..1)', '', 0.5, { min: 0, max: 1, si: false }), num('pmax', 'Anma gücü', 'W', 0.25, { min: 0.01 })],
    ratings: [rate('Anma gücü', 'W', 'power', 'pmax')],
    description: 'Ayarlı gerilim bölücü. W (wiper) A–B arasında konuma göre gerilim verir.',
    dataSource: 'generic-model',
    missing: ['log eğriler', 'wiper direnci', 'datasheet'],
    size: { w: 2.2, d: 1.8, h: 1.6 },
  },
  {
    type: 'dc_motor', name: 'DC motor (fırçalı, 6 V, genel)', nameEn: 'DC motor (brushed, 6 V, generic)', category: 'motor', prefix: 'M', model: 'motor',
    pins: [pin('P', '+', -0.5, 0), pin('N', '−', 0.5, 0)],
    params: [
      num('r', 'Sargı direnci', 'Ω', 3, { min: 0.01 }), num('l', 'Sargı endüktansı', 'H', 1e-3, { min: 1e-6 }),
      num('ke', 'Ters-EMK sabiti ke (= kt)', 'V·s/rad', 4.5e-3, { min: 1e-5, si: false }), num('j', 'Rotor eylemsizliği J', 'kg·m²', 3e-7, { min: 1e-9 }),
      num('b', 'Viskoz sürtünme B', 'N·m·s', 3.6e-7, { min: 0, si: false }), num('tload', 'Yük torku (sabit)', 'N·m', 0, { min: 0, si: false }),
      num('vmax', 'Anma gerilimi', 'V', 9, { min: 0.5 }), num('imax', 'Sürekli akım sınırı', 'A', 0.5, { min: 0.01 }),
    ],
    ratings: [{ key: 'v', label: 'Anma gerilimi', unit: 'V', quantity: 'voltage', paramKey: 'vmax' }, { key: 'i', label: 'Sürekli akım', unit: 'A', quantity: 'current', paramKey: 'imax' }],
    description: 'Fırçalı DC motor: v = R·i + L·di/dt + ke·ω, J·dω/dt = kt·i − B·ω − Tyük. Kalkışta ω=0 → akım ≈ V/R (kalkış akımı).',
    dataSource: 'generic-model',
    missing: ['fırça/komütasyon gürültüsü', 'sıcaklığa bağlı direnç', 'doyma', 'üretici verisi'],
    size: { w: 3, d: 1.8, h: 1.8 },
    simModel: 'partial', simNote: 'Tipik 130 sınıfı küçük motor parametreleri (yaklaşık, ölçülmedi). Mekanik model: eylemsizlik + viskoz sürtünme + sabit yük torku.',
  },
  {
    type: 'fan_12v', name: 'Fan 12 V (DC motor eşdeğeri)', nameEn: 'Fan 12 V (DC-motor equivalent)', category: 'motor', prefix: 'FAN', model: 'motor',
    pins: [pin('P', '+', -0.5, 0), pin('N', '−', 0.5, 0)],
    params: [
      num('r', 'Eşdeğer sargı direnci', 'Ω', 30, { min: 0.1 }), num('l', 'Endüktans', 'H', 5e-3, { min: 1e-6 }),
      num('ke', 'ke (= kt)', 'V·s/rad', 0.033, { min: 1e-5, si: false }), num('j', 'Eylemsizlik J', 'kg·m²', 2e-5, { min: 1e-9 }),
      num('b', 'Sürtünme/hava yükü B', 'N·m·s', 1e-5, { min: 0, si: false }), num('tload', 'Yük torku', 'N·m', 0, { min: 0, si: false }),
      num('vmax', 'Anma gerilimi', 'V', 13.8, { min: 0.5 }), num('imax', 'Sürekli akım', 'A', 0.25, { min: 0.01 }),
    ],
    ratings: [{ key: 'v', label: 'Anma gerilimi', unit: 'V', quantity: 'voltage', paramKey: 'vmax' }, { key: 'i', label: 'Sürekli akım', unit: 'A', quantity: 'current', paramKey: 'imax' }],
    description: 'Bilgisayar fanı gibi 12 V’luk fan; fırçasız fanlar burada fırçalı DC motor eşdeğeri olarak yaklaşıklanmıştır (komütasyon elektroniği yok).',
    dataSource: 'generic-model',
    missing: ['fırçasız sürücü elektroniği', 'hava akışı/basınç eğrisi', 'üretici verisi'],
    size: { w: 3, d: 3, h: 1 },
    simModel: 'partial', simNote: 'Fırçalı DC motor eşdeğeri; hava yükü viskoz sürtünmeyle yaklaşıklanır, soğutma etkisi ısıl modele bağlı değildir.',
  },
  {
    type: 'stepper_2ph', name: 'Step motor (bipolar, 2 faz, NEMA17 sınıfı)', nameEn: 'Stepper motor (bipolar 2-phase, NEMA17 class)', category: 'motor', prefix: 'M', model: 'stepper',
    pins: [pin('A+', 'A+', -0.5, -0.5), pin('A-', 'A−', -0.5, 0.5), pin('B+', 'B+', 0.5, -0.5), pin('B-', 'B−', 0.5, 0.5)],
    params: [
      num('r', 'Faz direnci (her sargı)', 'Ω', 7.5, { min: 0.1 }), num('l', 'Faz endüktansı (her sargı)', 'H', 10e-3, { min: 1e-6 }),
      num('steps', 'Tam adım / devir', '', 200, { min: 4, max: 1000, si: false }),
      num('thold', 'Tutma torku (anma akımında, tek faz)', 'N·m', 0.2, { min: 1e-4, si: false }),
      num('irated', 'Anma faz akımı', 'A', 0.4, { min: 0.01 }),
      num('j', 'Rotor eylemsizliği', 'kg·m²', 5e-6, { min: 1e-9, si: false }), num('jload', 'Yük eylemsizliği', 'kg·m²', 0, { min: 0, si: false }),
      num('b', 'Viskoz sürtünme B', 'N·m·s', 2e-4, { min: 1e-6, si: false }), num('tload', 'Yük torku (sabit)', 'N·m', 0, { min: 0, si: false }),
    ],
    ratings: [rate('Anma faz akımı', 'A', 'current', 'irated')],
    description: 'Bipolar step motor: her faz v = R·i + L·di/dt + e, e_A = −Ke·ω·sin(Nr·θ), e_B = Ke·ω·cos(Nr·θ), Nr = adım/4. Tork Te = Ke(−iA·sin + iB·cos), J·dω/dt = Te − B·ω − Tyük, θ̇ = ω. Ke = Tutma/Ianma. A→B→−A→−B sırası rotoru adım başına 360°/adım ilerletir.',
    dataSource: 'generic-model',
    missing: ['detent (cogging) torku', 'manyetik doyma', 'harmonikler (sin/cos dışı tork)', 'mikroadım sürücü/kıyıcı (chopper) elektroniği', 'rezonans için ayrıntılı rotor-stator geometrisi', 'üretici verisi'],
    size: { w: 4.2, d: 4.2, h: 4 },
    simModel: 'partial', simNote: 'İki fazlı sinüsoidal ideal motor modeli (Ke = Tutma/Ianma). Parametreler tipik NEMA17 sınıfı, ölçülmedi. Detent ve doyma yok; adım kaçırma/aşırı yükte yaklaşık davranır.',
  },
  {
    type: 'servo_sg90', name: 'Servo (SG90 sınıfı, davranışsal)', nameEn: 'Hobby servo (SG90 class, behavioural)', category: 'motor', prefix: 'M', model: 'servo',
    pins: [pin('VCC', 'VCC', -0.5, 0), pin('GND', 'GND', 0, 0), pin('SIG', 'SIG', 0.5, 0)],
    params: [
      num('a0', 'Başlangıç açısı', '°', 90, { min: 0, max: 180, si: false }), num('speed', 'Maks. hız', '°/s', 600, { min: 10, si: false }),
      num('iidle', 'Boşta akım (4.8 V)', 'A', 0.01, { min: 1e-4 }), num('imove', 'Hareket akımı (4.8 V)', 'A', 0.25, { min: 1e-3 }),
      num('istall', 'Kilit/zorlanma akımı (4.8 V)', 'A', 0.65, { min: 1e-3 }),
      { key: 'blocked', label: 'Mil tutuluyor (kilitli)', unit: '', type: 'boolean', default: false },
      num('vmax', 'Maks. besleme', 'V', 6, { min: 3 }),
    ],
    ratings: [rate('Maks. besleme', 'V', 'voltage', 'vmax')],
    description: 'Hobi servosu, davranışsal model: SIG’deki 1–2 ms’lik darbe → hedef açı 0–180° (1.0 ms = 0°, 2.0 ms = 180°). Mil en fazla 600°/s ile hedefe gider (SG90 ≈ 0.1 s/60° @4.8 V). VCC–GND arasında direnç gibi davranan yük: boşta ~10 mA, hareket ~250 mA, kilitli ~650 mA (4.8 V’ta).',
    dataSource: 'generic-model',
    missing: ['dişli boşluğu ve yük torku/gerilim bağımlı hız', 'iç motor sürücüsü ve gerilim çökmesi (akım direnç gibi gerilimle orantılıdır)', 'darbe gelmezse zaman aşımı/gevşeme', 'SIG darbe genişliği dışında 20 ms çerçeve doğrulaması', 'üretici verisi'],
    size: { w: 2.3, d: 1.3, h: 2.3 },
    simModel: 'partial', simNote: 'Davranışsal model (iç devre yok). Akım değerleri tipik SG90 sınıfı, ölçülmedi. SIG girişi 100 kΩ ile GND’ye çekilir; eşik 1.5 V, çalışma için VCC–GND ≥ 3.5 V.',
  },
  {
    type: 'bldc_3ph', name: 'BLDC motor (3 faz, yıldız, trapez ters-EMK, genel)', nameEn: 'BLDC motor (3-phase, star, trapezoidal back-EMF, generic)', category: 'motor', prefix: 'M', model: 'bldc',
    pins: three('U', 'V', 'W'),
    params: [
      num('r', 'Faz direnci', 'Ω', 2, { min: 0.01 }), num('l', 'Faz endüktansı', 'H', 1e-3, { min: 1e-6 }),
      num('ke', 'Ters-EMK sabiti ke (faz, tepe; = kt)', 'V·s/rad', 0.01, { min: 1e-5, si: false }),
      num('pp', 'Kutup çifti sayısı', '', 4, { min: 1, max: 32, si: false }),
      num('j', 'Rotor eylemsizliği J', 'kg·m²', 2e-6, { min: 1e-9, si: false }), num('b', 'Viskoz sürtünme B', 'N·m·s', 2e-6, { min: 1e-9, si: false }),
      num('tload', 'Yük torku (sabit)', 'N·m', 0, { min: 0, si: false }),
      num('vmax', 'Anma gerilimi (hat-hat)', 'V', 16, { min: 0.5 }), num('imax', 'Sürekli faz akımı', 'A', 3, { min: 0.01 }),
    ],
    ratings: [{ key: 'v', label: 'Anma gerilimi', unit: 'V', quantity: 'voltage', paramKey: 'vmax' }, { key: 'i', label: 'Sürekli akım', unit: 'A', quantity: 'current', paramKey: 'imax' }],
    description: 'Fırçasız DC motor, yıldız bağlı 3 faz, nötr yüzer (çözücüde bilinmeyen). Faz: v_x − v_n = R·i + L·di/dt + e_x, e_x = ke·ω·trap(θe − k·120°) (±1 düz tepe 120°, 60° rampa), θe = pp·θ. Tork = Σ e_x·i_x / ω = ke·Σ trap_x·i_x (güç tutarlı). J·dω/dt = Te − B·ω − Tyük. Dışarıdan 3 yarım köprü (MOSFET/MCU pinleri) veya "BLDC sürücü (6 adım)" parçası ile sürülür. İki faz iletirken hat-hat ters-EMK = 2·ke·ω, kalkış akımı ≈ V/(2R).',
    dataSource: 'generic-model',
    missing: ['gerçek (ölçülmüş) ters-EMK dalga biçimi ve harmonikler', 'detent/cogging torku', 'manyetik doyma ve endüktansın rotor konumuna bağlılığı', 'demir/girdap kayıpları', 'sıcaklığa bağlı direnç', 'hall sensör çıkışları', 'üretici verisi'],
    size: { w: 3, d: 3, h: 2 },
    simModel: 'partial', simNote: 'Genel (tipik küçük dış rotorlu motor sınıfı) parametreler, ölçülmedi. Trapez ters-EMK idealdir; nötr yüzer; faz geçişlerinde akım sönümü sürücü serbest dönüş diyotlarıyla çözülür.',
  },
  {
    type: 'bldc_driver_6step', name: 'BLDC sürücü (6 adım, davranışsal ESC)', nameEn: 'BLDC driver (6-step, behavioural ESC)', category: 'motor', prefix: 'U', model: 'bldc_esc',
    pins: [pin('VCC', 'VCC', -1, -0.5), pin('SIG', 'SIG', -1, 0), pin('GND', 'GND', -1, 0.5), pin('U', 'U', 1, -0.5), pin('V', 'V', 1, 0), pin('W', 'W', 1, 0.5)],
    params: [
      num('iq', 'Boşta akım (5 V eşdeğeri)', 'A', 0.01, { min: 0, si: true }), num('vmin', 'Min. besleme', 'V', 5, { min: 1 }),
      num('adv', 'Komütasyon avansı', '°', 0, { min: -30, max: 30, si: false }),
      num('vmax', 'Maks. besleme', 'V', 16, { min: 3 }), num('imax', 'Sürekli akım', 'A', 5, { min: 0.1 }),
    ],
    ratings: [rate('Maks. besleme', 'V', 'voltage', 'vmax'), rate('Sürekli akım', 'A', 'current', 'imax')],
    description: 'Davranışsal 6 adım (trapez) BLDC sürücü. SIG = analog gaz 0–5 V (duty = V/5; 0.2 V altı kapalı/serbest, 5 V ve üzeri %100). Komütasyon, U/V/W’ye bağlı motorun elektriksel açısından alınır (hall’süz, ideal konum bilgisi). Her 60° dilimde bir faz üst (duty·Vcc ortalama), biri alt (GND), biri serbest (Hi-Z). Ortalama-değer modelidir: PWM dalgalanması yok; Vcc akımı = duty × faz akımı. Serbest dönüş diyotları vardır. Beklenen hız ≈ (duty·Vcc − 2R·I)/(2·ke).',
    dataSource: 'generic-model',
    missing: ['PWM anahtarlama dalgalanması ve anahtarlama kayıpları', 'gerçek sensörsüz ESC: kalkış rampası ve ters-EMK sıfır geçişi algılama', 'RC servo darbesi (1–2 ms) girişi: burada yalnızca analog gaz vardır', 'aşırı akım/ısı koruması', 'faz sırası otomatik uyumu (U/V/W motorla aynı sırada bağlanmalı)', 'üretici verisi'],
    size: { w: 3, d: 2, h: 0.8 },
    visual: { kind: 'board', color: '#1e3a8a', h: 0.5 },
    simModel: 'partial', simNote: 'Davranışsal model: ideal rotor konumu bilgisiyle komütasyon, ortalama değer çıkışlar (Ron = 20 mΩ), boşta akım ve SIG için 100 kΩ pull-down. Akım sınırı yok.',
  },
  {
    type: 'solenoid', name: 'Solenoid (elektromıknatıs, itme/çekme)', nameEn: 'Solenoid (electromagnet actuator)', category: 'motor', prefix: 'SOL', model: 'solenoid',
    pins: [pin('P', '+', -0.5, 0), pin('N', '−', 0.5, 0)],
    params: [
      num('r', 'Bobin direnci', 'Ω', 20, { min: 0.1 }), num('l0', 'Endüktans (plunger dışarıda) L0', 'H', 0.01, { min: 1e-6, si: false }),
      num('dl', 'Endüktans artışı ΔL (plunger içeride)', 'H', 0.03, { min: 0, si: false }),
      num('stroke', 'Strok', 'mm', 5, { min: 0.1, si: false }),
      num('k', 'Geri dönüş yayı k', 'N/m', 100, { min: 0, si: false }), num('f0', 'Yay ön yükü', 'N', 0.1, { min: 0, si: false }),
      num('m', 'Plunger kütlesi', 'kg', 0.02, { min: 1e-4, si: false }), num('b', 'Viskoz sürtünme', 'N·s/m', 0.5, { min: 0, si: false }),
      { key: 'jam', label: 'Plunger sıkışmış', unit: '', type: 'boolean', default: false },
      num('vmax', 'Anma gerilimi', 'V', 15, { min: 0.5 }), num('imax', 'Sürekli akım', 'A', 1, { min: 0.01 }),
    ],
    ratings: [{ key: 'v', label: 'Anma gerilimi', unit: 'V', quantity: 'voltage', paramKey: 'vmax' }, { key: 'i', label: 'Sürekli akım', unit: 'A', quantity: 'current', paramKey: 'imax' }],
    description: 'Solenoid: L(x) = L0 + ΔL·x/strok (plunger girdikçe artar), v = R·i + L·di/dt + i·(dL/dx)·ẋ (hareket ters-EMK’si → plunger hareket ederken akımda çukur/dip), F = ½·i²·dL/dx, m·ẍ = F − f0 − k·x − B·ẋ. Strok uçlarında tam esnek olmayan duruş (sekme yok). Gerilim kalkınca yay plunger’ı geri iter. Endüktif yük: flyback diyotu gerekir.',
    dataSource: 'generic-model',
    missing: ['demir çekirdek doygunluğu (L ve kuvvet i ile sınırlanmaz)', 'L(x) doğrusal varsayım (gerçekte konuma göre doğrusal değil)', 'girdap akımı/histerezis ve kalıntı mıknatıslık', 'strok ucunda sekme ve çarpma gürültüsü', 'sıcaklığa bağlı bobin direnci', 'üretici verisi'],
    size: { w: 3, d: 1.8, h: 1.8 },
    simModel: 'partial', simNote: 'Genel parametreler (12 V itme-çekme solenoid sınıfı, yaklaşık, ölçülmedi). DC/başlangıç çözümünde plunger kayıtlı konumda tutulur (kapalı-konum hesaplanmaz).',
  },
  {
    type: 'relay_5v', name: 'Röle 5 V (SPDT)', nameEn: 'Relay 5 V (SPDT)', category: 'io', prefix: 'K', model: 'relay',
    pins: [pin('C1', 'Bobin 1', -1, -0.5), pin('C2', 'Bobin 2', -1, 0.5), pin('COM', 'COM', 1, -1), pin('NO', 'NO', 1, 0), pin('NC', 'NC', 1, 1)],
    params: [
      num('rcoil', 'Bobin direnci', 'Ω', 70, { min: 1 }), num('lcoil', 'Bobin endüktansı', 'H', 0.15, { min: 1e-4, si: false }),
      num('vpull', 'Çekme gerilimi', 'V', 3.75, { min: 0.1 }), num('vdrop', 'Bırakma gerilimi', 'V', 0.5, { min: 0.05 }),
      num('top', 'Çekme gecikmesi', 's', 0.01, { min: 1e-4 }), num('trel', 'Bırakma gecikmesi', 's', 0.005, { min: 1e-4 }),
      num('vmaxcoil', 'Maks. bobin gerilimi', 'V', 7.5, { min: 1 }), num('imax', 'Kontak akım sınırı', 'A', 10, { min: 0.1 }),
      ...RELAY_CONTACT_PARAMS,
    ],
    ratings: [{ key: 'v', label: 'Bobin gerilimi', unit: 'V', quantity: 'voltage', paramKey: 'vmaxcoil' }, { key: 'i', label: 'Kontak akımı', unit: 'A', quantity: 'current', paramKey: 'imax' }],
    description: 'Elektromekanik röle: bobin akımı çekme eşiğini geçip gecikme süresi dolunca COM–NO kapanır, COM–NC açılır. Bobine paralel flyback diyotu gerekir.',
    dataSource: 'generic-model',
    missing: ['kontak sıçraması ve ark parametreleri (genel değerler)', 'kontak ömrü (gerçek)', 'üretici verisi'],
    size: { w: 3.2, d: 2.4, h: 2.4 },
    simModel: 'partial', simNote: 'Bobin R+L, çekme/bırakma eşiği ve gecikme modellenir; kontak direnci 50 mΩ. Kontak sıçraması (genel, rastgele ama tekrarlanabilir) ve ark kıskacı (~14 V, tipik/doğrulanmamış) modellenir; ark enerjisi kontak aşınması göstergesidir, gerçek kontak ömrü modeli yok.',
  },
  {
    type: 'relay_12v', name: 'Röle 12 V (SPDT)', nameEn: 'Relay 12 V (SPDT)', category: 'io', prefix: 'K', model: 'relay',
    pins: [pin('C1', 'Bobin 1', -1, -0.5), pin('C2', 'Bobin 2', -1, 0.5), pin('COM', 'COM', 1, -1), pin('NO', 'NO', 1, 0), pin('NC', 'NC', 1, 1)],
    params: [
      num('rcoil', 'Bobin direnci', 'Ω', 400, { min: 1 }), num('lcoil', 'Bobin endüktansı', 'H', 0.8, { min: 1e-4, si: false }),
      num('vpull', 'Çekme gerilimi', 'V', 9, { min: 0.1 }), num('vdrop', 'Bırakma gerilimi', 'V', 1.2, { min: 0.05 }),
      num('top', 'Çekme gecikmesi', 's', 0.01, { min: 1e-4 }), num('trel', 'Bırakma gecikmesi', 's', 0.005, { min: 1e-4 }),
      num('vmaxcoil', 'Maks. bobin gerilimi', 'V', 18, { min: 1 }), num('imax', 'Kontak akım sınırı', 'A', 10, { min: 0.1 }),
      ...RELAY_CONTACT_PARAMS,
    ],
    ratings: [{ key: 'v', label: 'Bobin gerilimi', unit: 'V', quantity: 'voltage', paramKey: 'vmaxcoil' }, { key: 'i', label: 'Kontak akımı', unit: 'A', quantity: 'current', paramKey: 'imax' }],
    description: '12 V bobinli SPDT röle (genel model).',
    dataSource: 'generic-model',
    missing: ['kontak sıçraması ve ark parametreleri (genel değerler)', 'kontak ömrü (gerçek)', 'üretici verisi'],
    size: { w: 3.2, d: 2.4, h: 2.4 },
    simModel: 'partial', simNote: 'Bobin R+L, eşikler ve gecikme modellenir; kontak sıçraması ve ark kıskacı genel (tipik, doğrulanmamış) değerlerle modellenir; gerçek kontak ömrü modeli yok.',
  },
  {
    type: 'transformer', name: 'Transformatör (genel)', nameEn: 'Transformer (generic)', category: 'passive', prefix: 'TR', model: 'transformer',
    pins: [pin('P1', 'P1', -1.5, -0.5), pin('P2', 'P2', -1.5, 0.5), pin('S1', 'S1', 1.5, -0.5), pin('S2', 'S2', 1.5, 0.5)],
    params: [
      num('l1', 'Primer endüktansı L1', 'H', 5, { min: 1e-4, si: false }), num('n', 'Sarım oranı n = Np/Ns', '', 10, { min: 0.01, si: false }),
      num('k', 'Kuplaj katsayısı k', '', 0.98, { min: 0.1, max: 1, si: false }), num('rp', 'Primer sargı direnci', 'Ω', 20, { min: 1e-3 }), num('rs', 'Sekonder sargı direnci', 'Ω', 0.2, { min: 1e-3 }),
      num('vmax', 'Maks. primer gerilimi (tepe)', 'V', 350, { min: 1 }),
    ],
    ratings: [{ key: 'v', label: 'Primer gerilimi (tepe)', unit: 'V', quantity: 'voltage', paramKey: 'vmax' }],
    description: 'İki sargılı transformatör: v1 = R1·i1 + L1·di1/dt + M·di2/dt. Primer ve sekonder galvanik olarak ayrıktır. 230 V/50 Hz simülasyonu yalnızca sanaldır; gerçek şebeke gerilimi hayati tehlike taşır.',
    dataSource: 'generic-model',
    missing: ['çekirdek doyması', 'histerezis / demir kaybı', 'sargı kapasitesi', 'ısıl model'],
    size: { w: 3.6, d: 2.6, h: 2.6 },
    simModel: 'partial', simNote: 'Lineer, doymayan çekirdek; L2 = L1/n², M = k·√(L1·L2). Demir kaybı, doyma ve sargı kapasitesi yok.',
  },
  {
    type: 'eload', name: 'Elektronik yük (CC / CR / CP)', nameEn: 'Electronic load (CC / CR / CP)', category: 'source', prefix: 'EL', model: 'eload',
    pins: [pin('P', '+', -0.5, 0), pin('N', '−', 0.5, 0)],
    params: [
      { key: 'mode', label: 'Mod', unit: '', type: 'select', default: 'cc', options: [{ value: 'cc', label: 'Sabit akım (CC)' }, { value: 'cr', label: 'Sabit direnç (CR)' }, { value: 'cp', label: 'Sabit güç (CP)' }] },
      num('i', 'Akım (CC)', 'A', 0.5, { min: 0 }), num('r', 'Direnç (CR)', 'Ω', 20, { min: 0.01 }), num('p', 'Güç (CP)', 'W', 5, { min: 0 }),
      num('pmax', 'Maks. güç', 'W', 150, { min: 1 }),
    ],
    ratings: [{ key: 'p', label: 'Maks. güç', unit: 'W', quantity: 'power', paramKey: 'pmax' }],
    description: 'Programlanabilir DC elektronik yük: kaynağın regülasyon, dalgalanma ve güç sınırı testleri için. CP modu girişte negatif direnç gibi davranır.',
    dataSource: 'generic-model',
    missing: ['slew rate', 'minimum çalışma gerilimi (CP: 0.5 V altında sabit akım)', 'ısıl model'],
    size: { w: 3, d: 2, h: 1.6 },
    simModel: 'partial', simNote: 'İdeal akım/direnç/güç çekici; CP modu 0.5 V altında akımı sınırlar.',
  },
];

/**
 * I2C / SPI chips with behavioural models. Their pins are high-impedance in the solver; the behaviour comes from the MCU bus layer
 * (core/mcu/bus.ts) and is TRANSACTION-LEVEL: register maps/protocols yes, bit timing, clock stretching and bus capacitance no.
 * I2C needs external pull-ups on SDA/SCL; without them the chip is NACKed (diagnostic "SDA/SCL pull-up yok").
 */
const BUS_MISSING = ['bit-seviyesi zamanlama (işlem düzeyi model: START/adres/bayt/STOP tek parça)', 'SCL clock stretching', 'hat kapasitesi / yükselme süresi', 'çoklu master / arbitrasyon'];
const BUS_NOTE = 'Davranışsal, işlem düzeyinde model: pinler çözücüde yüksek empedanslı; protokol MCU bus katmanından gelir. Bit düzeyi zamanlama simüle edilmez.';
const i2cAddr = (base: number, n: number): ParamDef => ({
  key: 'addr', label: 'I2C adresi', unit: '', type: 'select', default: base,
  options: Array.from({ length: n }, (_, i) => ({ value: base + i, label: `0x${(base + i).toString(16).toUpperCase()}` })),
});

const BUSDEV: ComponentDef[] = [
  {
    type: 'busdev_tmp102', name: 'TMP102 sınıfı I2C sıcaklık sensörü', nameEn: 'TMP102-class I2C temperature sensor', category: 'sensor', prefix: 'U', model: 'busdev',
    pins: [pin('VCC', 'VCC', -0.75, 0), pin('GND', 'GND', -0.25, 0), pin('SDA', 'SDA', 0.25, 0), pin('SCL', 'SCL', 0.75, 0)],
    params: [num('temp', 'Ortam sıcaklığı', '°C', 25, { min: -55, max: 127, si: false }), i2cAddr(0x48, 4)],
    ratings: [],
    description: 'TMP102 register haritası: gösterge 0 = sıcaklık (12 bit, 0.0625 °C/LSB, sola yaslı 16 bit), 1 = config (0x60A0), 2 = T_LOW, 3 = T_HIGH. Sıcaklık "Ortam sıcaklığı" parametresinden gelir ve dönüşüm hızında (varsayılan 4 Hz) örneklenir. SDA/SCL için dış pull-up gerekir.',
    dataSource: 'generic-model',
    missing: [...BUS_MISSING, 'ALERT pini ve karşılaştırıcı/kesme modu', 'genişletilmiş 13 bit mod', 'ADD0 pini (adres parametre olarak seçilir)', 'öz-ısınma / ısıl gecikme', 'doğruluk (±0.5 °C) ve ofset', 'üretici verisi'],
    size: { w: 1.6, d: 0.8, h: 0.4 },
    visual: { kind: 'box', color: '#1e3a8a', h: 0.4 },
    simModel: 'partial', simNote: BUS_NOTE + ' Besleme eşiği ≥ 1.4 V.',
    busdev: { kind: 'tmp102', bus: 'i2c', pins: { vcc: 'VCC', gnd: 'GND', sda: 'SDA', scl: 'SCL' } },
  },
  {
    type: 'busdev_24c02', name: '24C02 sınıfı I2C EEPROM (256 B)', nameEn: '24C02-class I2C EEPROM (256 B)', category: 'ic', prefix: 'U', model: 'busdev',
    pins: [pin('VCC', 'VCC', -0.75, 0), pin('GND', 'GND', -0.25, 0), pin('SDA', 'SDA', 0.25, 0), pin('SCL', 'SCL', 0.75, 0)],
    params: [i2cAddr(0x50, 8)],
    ratings: [],
    description: '256 baytlık seri EEPROM: 8 baytlık sayfa yazma (sayfa içinde roll-over), STOP ile başlayan 5 ms iç yazma çevrimi (bu sürede adresine NACK verir: ACK polling), sıralı okuma 256’da başa sarar. Silinmiş bayt = 0xFF. SDA/SCL için dış pull-up gerekir.',
    dataSource: 'generic-model',
    missing: [...BUS_MISSING, 'WP (yazma koruma) pini: her zaman yazılabilir', 'A0–A2 pinleri (adres parametre olarak seçilir)', 'yazma/silme ömrü ve veri saklama', 'besleme kesilmesinde yarım yazma', 'üretici verisi'],
    size: { w: 1.6, d: 0.8, h: 0.4 },
    visual: { kind: 'ic', color: '#18181b', h: 0.4 },
    simModel: 'partial', simNote: BUS_NOTE + ' İçerik MCU sıfırlamasında korunur, simülasyon yeniden başlatılınca silinir. Besleme eşiği ≥ 1.7 V.',
    busdev: { kind: 'eeprom24c02', bus: 'i2c', pins: { vcc: 'VCC', gnd: 'GND', sda: 'SDA', scl: 'SCL' } },
  },
  {
    type: 'busdev_mcp3008', name: 'MCP3008 sınıfı SPI ADC (8 kanal, 10 bit)', nameEn: 'MCP3008-class SPI ADC (8 ch, 10 bit)', category: 'ic', prefix: 'U', model: 'busdev',
    pins: [
      ...['CH0', 'CH1', 'CH2', 'CH3', 'CH4', 'CH5', 'CH6', 'CH7'].map((n, i) => pin(n, n, -1.5, (i - 3.5) * 0.5)),
      ...['DGND', 'CS', 'DIN', 'DOUT', 'CLK', 'AGND', 'VREF', 'VDD'].map((n, i) => pin(n, n, 1.5, (i - 3.5) * 0.5)),
    ],
    params: [],
    ratings: [],
    description: '8 kanal 10 bit SAR ADC, SPI: 3 baytlık çerçeve {0x01, SGL/DIFF+kanal<<4, x}; kod = ⌊1024·Vgiriş/VREF⌋ (0–1023), girişler AGND’ye göre. Diferansiyel çiftler CH0/1, 2/3, 4/5, 6/7. CS GND’ye bağlıysa her zaman seçili, bir MCU pinine bağlıysa o pin LOW iken seçili.',
    dataSource: 'generic-model',
    missing: [...BUS_MISSING.filter((m) => !m.includes('I2C')), 'örnekleme-tutma süresi ve kaynak empedansı hatası', 'DNL/INL, ofset, kazanç hatası', 'hizalanmamış (17 saat) çerçeveler: yalnızca standart 3 baytlık çerçeve', 'saat hızı sınırları', 'üretici verisi'],
    size: { w: 2.4, d: 4.4, h: 0.5 },
    visual: { kind: 'ic', color: '#18181b', h: 0.5 },
    simModel: 'partial', simNote: BUS_NOTE + ' Giriş gerilimi seçili kanal düğümünden okunur (ideal örnekleme). Besleme eşiği ≥ 2.7 V; VREF AGND’ye göre ≥ 0.1 V olmalı.',
    busdev: { kind: 'mcp3008', bus: 'spi', pins: { vcc: 'VDD', gnd: 'DGND', agnd: 'AGND', vref: 'VREF', clk: 'CLK', mosi: 'DIN', miso: 'DOUT', cs: 'CS', ch0: 'CH0', ch1: 'CH1', ch2: 'CH2', ch3: 'CH3', ch4: 'CH4', ch5: 'CH5', ch6: 'CH6', ch7: 'CH7' } },
  },
];

/** Live registry: core generic models + catalog parts + user-made parts. */
export const COMPONENTS: ComponentDef[] = [...CORE, ...BUSDEV, ...CATALOG];
upgradeMcuBoards(COMPONENTS);
const byType = new Map<string, ComponentDef>();
for (const c of COMPONENTS) {
  if (byType.has(c.type)) throw new Error(`Yinelenen bileşen tipi: ${c.type}`);
  byType.set(c.type, c);
}

export const getDef = (type: string): ComponentDef => {
  const d = byType.get(type);
  if (!d) throw new Error(`Bilinmeyen bileşen tipi: ${type}`);
  return d;
};
export const hasDef = (type: string): boolean => byType.has(type);

export const defaultParams = (type: string): Record<string, number | string | boolean> =>
  Object.fromEntries(getDef(type).params.map((p) => [p.key, p.default]));

export function registerComponent(def: ComponentDef): void {
  const i = COMPONENTS.findIndex((c) => c.type === def.type);
  if (i >= 0) COMPONENTS[i] = def; else COMPONENTS.push(def);
  byType.set(def.type, def);
}

// ---- user-made parts (localStorage) ----
const LS_USER = 'electrolab.userParts';
export const loadUserParts = (): ComponentDef[] => {
  try { return JSON.parse(localStorage.getItem(LS_USER) ?? '[]') as ComponentDef[]; } catch { return []; }
};
export function saveUserPart(def: ComponentDef): void {
  const all = loadUserParts().filter((c) => c.type !== def.type);
  all.push(def);
  localStorage.setItem(LS_USER, JSON.stringify(all));
  registerComponent(def);
}
export function deleteUserPart(type: string): void {
  localStorage.setItem(LS_USER, JSON.stringify(loadUserParts().filter((c) => c.type !== type)));
  const i = COMPONENTS.findIndex((c) => c.type === type);
  if (i >= 0) COMPONENTS.splice(i, 1);
  byType.delete(type);
}
try { for (const u of loadUserParts()) registerComponent(u); } catch { /* no storage (tests) */ }
