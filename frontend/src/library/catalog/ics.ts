import type { ComponentDef } from '../types';
import { icPart, sipIcPart } from '../factories';

/** Library-only ICs (no electrical model). Pin order follows the datasheet pin numbers 1..n. */

const DUAL_OPAMP = ['OUT1', 'IN1−', 'IN1+', 'V−/GND', 'IN2+', 'IN2−', 'OUT2', 'V+'];
const QUAD_GATE = ['1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3A', '3B', '4Y', '4A', '4B', 'VCC'];
const HEX_INV = ['1A', '1Y', '2A', '2Y', '3A', '3Y', 'GND', '4Y', '4A', '5Y', '5A', '6Y', '6A', 'VCC'];
const TI = 'Texas Instruments';
const NXP = 'Nexperia';

export const ICS: ComponentDef[] = [
  // ---------------------------------------------------------------- timers / op-amps / comparators
  icPart({
    mpn: 'NE555', mfr: TI, pkg: 'DIP-8', tags: ['timer', '555', 'osilatör', 'monostable', 'astable'],
    desc: 'Klasik 555 zamanlayıcı: kararlı/tek kararlı osilatör ve zamanlama devreleri için.',
    specs: { Besleme: '4.5–16 V', 'Çıkış akımı': '200 mA (kaynak/çekme)', 'Maks. frekans': '~500 kHz', Kanal: '1 zamanlayıcı' },
    pins: ['GND', 'TRIG', 'OUT', 'RESET', 'CTRL', 'THR', 'DIS', 'VCC'],
  }),
  icPart({
    mpn: 'LM555', mfr: TI, pkg: 'DIP-8', tags: ['timer', '555', 'osilatör'],
    desc: 'LM555 zamanlayıcı; NE555 ile aynı bacak düzenine sahip, hassas zamanlama sağlar.',
    specs: { Besleme: '4.5–16 V', 'Çıkış akımı': '200 mA', Kanal: '1 zamanlayıcı' },
    pins: ['GND', 'TRIG', 'OUT', 'RESET', 'CTRL', 'THR', 'DIS', 'VCC'],
  }),
  icPart({
    mpn: 'LM358', mfr: TI, pkg: 'DIP-8', tags: ['opamp', 'işlemsel yükselteç', 'tek besleme'],
    desc: 'Tek beslemeyle çalışabilen çift kanallı genel amaçlı işlemsel yükselteç.',
    specs: { Besleme: '3–32 V', Kanal: '2 op-amp', GBW: '~1 MHz', 'Giriş': 'GND dahil ortak mod' },
    pins: DUAL_OPAMP,
  }),
  icPart({
    mpn: 'LM324', mfr: TI, pkg: 'DIP-14', tags: ['opamp', 'işlemsel yükselteç', 'dörtlü'],
    desc: 'Tek beslemeyle çalışabilen dört kanallı genel amaçlı işlemsel yükselteç.',
    specs: { Besleme: '3–32 V', Kanal: '4 op-amp', GBW: '~1 MHz' },
    pins: ['OUT1', 'IN1−', 'IN1+', 'V+', 'IN2+', 'IN2−', 'OUT2', 'OUT3', 'IN3−', 'IN3+', 'GND', 'IN4+', 'IN4−', 'OUT4'],
  }),
  icPart({
    mpn: 'LM741', mfr: TI, pkg: 'DIP-8', tags: ['opamp', 'işlemsel yükselteç', 'klasik'],
    desc: 'Klasik tek kanallı genel amaçlı işlemsel yükselteç (simetrik besleme).',
    specs: { Besleme: '±5–±18 V', Kanal: '1 op-amp', GBW: '~1 MHz' },
    pins: ['OFFSET N1', 'IN−', 'IN+', 'V−', 'OFFSET N2', 'OUT', 'V+', 'NC'],
  }),
  icPart({
    mpn: 'TL072', mfr: TI, pkg: 'DIP-8', tags: ['opamp', 'JFET', 'ses'],
    desc: 'JFET girişli düşük gürültülü çift işlemsel yükselteç; ses uygulamalarında yaygındır.',
    specs: { Besleme: '±5–±18 V', Kanal: '2 op-amp', GBW: '3 MHz', Giriş: 'JFET' },
    pins: DUAL_OPAMP,
  }),
  icPart({
    mpn: 'TL082', mfr: TI, pkg: 'DIP-8', tags: ['opamp', 'JFET', 'ses'],
    desc: 'JFET girişli çift işlemsel yükselteç; TL072 ile aynı bacak düzeni.',
    specs: { Besleme: '±5–±18 V', Kanal: '2 op-amp', GBW: '4 MHz', Giriş: 'JFET' },
    pins: DUAL_OPAMP,
  }),
  icPart({
    mpn: 'NE5532', mfr: TI, pkg: 'DIP-8', tags: ['opamp', 'ses', 'düşük gürültü'],
    desc: 'Yüksek kaliteli ses uygulamaları için düşük gürültülü çift işlemsel yükselteç.',
    specs: { Besleme: '±3–±20 V', Kanal: '2 op-amp', GBW: '10 MHz', Gürültü: '5 nV/√Hz' },
    pins: DUAL_OPAMP,
  }),
  icPart({
    mpn: 'OP07', mfr: 'Analog Devices', pkg: 'DIP-8', tags: ['opamp', 'hassas', 'düşük ofset'],
    desc: 'Çok düşük ofset gerilimli hassas işlemsel yükselteç.',
    specs: { Besleme: '±3–±18 V', Kanal: '1 op-amp', 'Ofset (tipik)': '~30 µV' },
    pins: ['VOS TRIM', 'IN−', 'IN+', 'V−', 'NC', 'OUT', 'V+', 'VOS TRIM'],
  }),
  icPart({
    mpn: 'LM393', mfr: TI, pkg: 'DIP-8', tags: ['karşılaştırıcı', 'comparator', 'açık kolektör'],
    desc: 'Açık kolektör çıkışlı çift gerilim karşılaştırıcı.',
    specs: { Besleme: '2–36 V', Kanal: '2 karşılaştırıcı', Çıkış: 'açık kolektör' },
    pins: ['OUT1', 'IN1−', 'IN1+', 'GND', 'IN2+', 'IN2−', 'OUT2', 'VCC'],
  }),
  icPart({
    mpn: 'LM339', mfr: TI, pkg: 'DIP-14', tags: ['karşılaştırıcı', 'comparator', 'açık kolektör'],
    desc: 'Açık kolektör çıkışlı dörtlü gerilim karşılaştırıcı.',
    specs: { Besleme: '2–36 V', Kanal: '4 karşılaştırıcı', Çıkış: 'açık kolektör' },
    pins: ['OUT2', 'OUT1', 'VCC', 'IN1−', 'IN1+', 'IN2−', 'IN2+', 'IN3−', 'IN3+', 'IN4−', 'IN4+', 'GND', 'OUT4', 'OUT3'],
  }),
  icPart({
    mpn: 'LM386', mfr: TI, pkg: 'DIP-8', tags: ['ses', 'amplifikatör', 'düşük güç'],
    desc: 'Pil beslemeli uygulamalar için düşük gerilimli ses güç yükselteci.',
    specs: { Besleme: '4–12 V', 'Çıkış gücü': '~0.5 W', 'Kazanç': '20 (200 ile ayarlanabilir)' },
    pins: ['GAIN', 'IN−', 'IN+', 'GND', 'OUT', 'VS', 'BYPASS', 'GAIN'],
  }),

  // ---------------------------------------------------------------- regulators
  sipIcPart({
    mpn: 'LM7805', mfr: TI, pkg: 'TO-220', category: 'power', tags: ['regülatör', '5V', '78xx', 'lineer'],
    desc: 'Sabit +5 V çıkışlı üç bacaklı lineer gerilim regülatörü.',
    specs: { Çıkış: '5 V', 'Maks. akım': '1 A', Dropout: '~2 V', 'Maks. giriş': '35 V' },
    pins: ['IN', 'GND', 'OUT'],
  }),
  sipIcPart({
    mpn: 'LM7812', mfr: TI, pkg: 'TO-220', category: 'power', tags: ['regülatör', '12V', '78xx', 'lineer'],
    desc: 'Sabit +12 V çıkışlı üç bacaklı lineer gerilim regülatörü.',
    specs: { Çıkış: '12 V', 'Maks. akım': '1 A', Dropout: '~2 V', 'Maks. giriş': '35 V' },
    pins: ['IN', 'GND', 'OUT'],
  }),
  sipIcPart({
    mpn: 'LM7905', mfr: TI, pkg: 'TO-220', category: 'power', tags: ['regülatör', '-5V', '79xx', 'negatif'],
    desc: 'Sabit −5 V çıkışlı negatif lineer gerilim regülatörü (bacak düzeni 78xx ten farklıdır).',
    specs: { Çıkış: '−5 V', 'Maks. akım': '1 A', Dropout: '~2 V' },
    pins: ['GND', 'IN', 'OUT'],
  }),
  sipIcPart({
    mpn: 'LM7912', mfr: TI, pkg: 'TO-220', category: 'power', tags: ['regülatör', '-12V', '79xx', 'negatif'],
    desc: 'Sabit −12 V çıkışlı negatif lineer gerilim regülatörü (bacak düzeni 78xx ten farklıdır).',
    specs: { Çıkış: '−12 V', 'Maks. akım': '1 A', Dropout: '~2 V' },
    pins: ['GND', 'IN', 'OUT'],
  }),
  sipIcPart({
    mpn: 'LM317', mfr: TI, pkg: 'TO-220', category: 'power', tags: ['regülatör', 'ayarlanabilir', 'lineer'],
    desc: 'Dış iki dirençle ayarlanan pozitif lineer gerilim regülatörü.',
    specs: { Çıkış: '1.25–37 V', 'Maks. akım': '1.5 A', Vref: '1.25 V', Dropout: '~2 V' },
    pins: ['ADJ', 'OUT', 'IN'],
  }),
  sipIcPart({
    mpn: 'LM337', mfr: TI, pkg: 'TO-220', category: 'power', tags: ['regülatör', 'ayarlanabilir', 'negatif'],
    desc: 'Ayarlanabilir negatif lineer gerilim regülatörü (LM317 nin tamamlayıcısı, bacak sırası farklı).',
    specs: { Çıkış: '−1.25…−37 V', 'Maks. akım': '1.5 A', Vref: '−1.25 V' },
    pins: ['ADJ', 'IN', 'OUT'],
  }),
  sipIcPart({
    mpn: 'AMS1117-3.3', mfr: 'Advanced Monolithic Systems', pkg: 'SOT-223', category: 'power', tags: ['LDO', '3.3V', 'regülatör'],
    desc: '3.3 V sabit çıkışlı düşük dropout lineer regülatör; modül ve geliştirme kartlarında yaygın.',
    specs: { Çıkış: '3.3 V', 'Maks. akım': '1 A', Dropout: '~1.1 V', 'Maks. giriş': '15 V' },
    pins: ['GND/ADJ', 'OUT', 'IN'],
  }),
  sipIcPart({
    mpn: 'LM1117-3.3', mfr: TI, pkg: 'SOT-223', category: 'power', tags: ['LDO', '3.3V', 'regülatör'],
    desc: '3.3 V sabit çıkışlı düşük dropout lineer regülatör.',
    specs: { Çıkış: '3.3 V', 'Maks. akım': '0.8 A', Dropout: '~1.2 V', 'Maks. giriş': '15 V' },
    pins: ['GND/ADJ', 'OUT', 'IN'],
  }),
  sipIcPart({
    mpn: 'LD1117-3.3', mfr: 'STMicroelectronics', pkg: 'SOT-223', category: 'power', tags: ['LDO', '3.3V', 'regülatör'],
    desc: '3.3 V sabit çıkışlı düşük dropout lineer regülatör.',
    specs: { Çıkış: '3.3 V', 'Maks. akım': '0.8 A', Dropout: '~1.1 V', 'Maks. giriş': '15 V' },
    pins: ['GND/ADJ', 'OUT', 'IN'],
  }),
  sipIcPart({
    mpn: 'LM2596', mfr: TI, pkg: 'TO-263-5', category: 'power', h: 2.2, tags: ['buck', 'DC-DC', 'step-down', 'anahtarlamalı'],
    desc: '3 A çıkışlı 150 kHz anahtarlamalı step-down (buck) DC-DC dönüştürücü.',
    specs: { Giriş: '4.5–40 V', 'Maks. akım': '3 A', 'Anahtarlama frekansı': '150 kHz', Vref: '1.23 V (ayarlanabilir)' },
    pins: ['VIN', 'OUT', 'GND', 'FB', 'ON/OFF'],
  }),
  sipIcPart({
    mpn: 'LM2576', mfr: TI, pkg: 'TO-220-5', category: 'power', h: 2.2, tags: ['buck', 'DC-DC', 'step-down', 'anahtarlamalı'],
    desc: '3 A çıkışlı 52 kHz anahtarlamalı step-down (buck) DC-DC dönüştürücü.',
    specs: { Giriş: '7–40 V', 'Maks. akım': '3 A', 'Anahtarlama frekansı': '52 kHz' },
    pins: ['VIN', 'OUT', 'GND', 'FB', 'ON/OFF'],
  }),
  icPart({
    mpn: 'TP4056', mfr: 'NanJing Top Power', pkg: 'SOP-8', category: 'power', tags: ['şarj', 'Li-ion', 'charger', 'lityum'],
    desc: 'Tek hücreli Li-ion/LiPo piller için lineer şarj denetleyici (CC/CV).',
    specs: { Giriş: '4–8 V', 'Şarj akımı': 'maks. 1 A (PROG direnciyle)', 'Bitiş gerilimi': '4.2 V ±1.5 %' },
    pins: ['TEMP', 'PROG', 'GND', 'VCC', 'BAT', 'STDBY', 'CHRG', 'CE'],
  }),

  // ---------------------------------------------------------------- logic
  icPart({
    mpn: '74HC00', mfr: NXP, pkg: 'DIP-14', tags: ['lojik', 'NAND', '74HC'],
    desc: 'Dörtlü 2 girişli NAND kapısı.',
    specs: { Besleme: '2–6 V', Kapı: '4 × NAND2', 'Gecikme (tipik)': '~8 ns' },
    pins: QUAD_GATE,
  }),
  icPart({
    mpn: '74HC04', mfr: NXP, pkg: 'DIP-14', tags: ['lojik', 'NOT', 'evirici', '74HC'],
    desc: 'Altılı evirici (NOT) kapısı.',
    specs: { Besleme: '2–6 V', Kapı: '6 × NOT', 'Gecikme (tipik)': '~7 ns' },
    pins: HEX_INV,
  }),
  icPart({
    mpn: '74HC08', mfr: NXP, pkg: 'DIP-14', tags: ['lojik', 'AND', '74HC'],
    desc: 'Dörtlü 2 girişli AND kapısı.',
    specs: { Besleme: '2–6 V', Kapı: '4 × AND2' },
    pins: QUAD_GATE,
  }),
  icPart({
    mpn: '74HC14', mfr: NXP, pkg: 'DIP-14', tags: ['lojik', 'Schmitt', 'evirici', '74HC'],
    desc: 'Schmitt tetikleyici girişli altılı evirici; sinyal temizleme ve RC osilatör için.',
    specs: { Besleme: '2–6 V', Kapı: '6 × Schmitt NOT' },
    pins: HEX_INV,
  }),
  icPart({
    mpn: '74HC32', mfr: NXP, pkg: 'DIP-14', tags: ['lojik', 'OR', '74HC'],
    desc: 'Dörtlü 2 girişli OR kapısı.',
    specs: { Besleme: '2–6 V', Kapı: '4 × OR2' },
    pins: QUAD_GATE,
  }),
  icPart({
    mpn: '74HC74', mfr: NXP, pkg: 'DIP-14', tags: ['lojik', 'flip-flop', 'D tipi', '74HC'],
    desc: 'Preset ve clear girişli çift D tipi flip-flop.',
    specs: { Besleme: '2–6 V', Kanal: '2 D flip-flop', 'Maks. saat': '~50 MHz' },
    pins: ['1CLR', '1D', '1CLK', '1PRE', '1Q', '1Q̄', 'GND', '2Q̄', '2Q', '2PRE', '2CLK', '2D', '2CLR', 'VCC'],
  }),
  icPart({
    mpn: '74HC86', mfr: NXP, pkg: 'DIP-14', tags: ['lojik', 'XOR', '74HC'],
    desc: 'Dörtlü 2 girişli XOR kapısı.',
    specs: { Besleme: '2–6 V', Kapı: '4 × XOR2' },
    pins: QUAD_GATE,
  }),
  icPart({
    mpn: '74HC595', mfr: NXP, pkg: 'DIP-16', tags: ['kaydırmalı yazmaç', 'shift register', 'SPI', 'I/O genişletme'],
    desc: '8 bit seri girişli, paralel çıkışlı kaydırmalı yazmaç (çıkış mandallı, 3 durumlu).',
    specs: { Besleme: '2–6 V', 'Bit': '8', 'Maks. saat': '~25 MHz', Çıkış: '3 durumlu, mandallı' },
    pins: ['QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH', 'GND', 'QH′', 'SRCLR', 'SRCLK', 'RCLK', 'OE', 'SER', 'QA', 'VCC'],
  }),
  icPart({
    mpn: '74HC165', mfr: NXP, pkg: 'DIP-16', tags: ['kaydırmalı yazmaç', 'shift register', 'paralel giriş'],
    desc: '8 bit paralel girişli, seri çıkışlı kaydırmalı yazmaç; giriş genişletme için.',
    specs: { Besleme: '2–6 V', Bit: '8', 'Maks. saat': '~25 MHz' },
    pins: ['PL', 'CP', 'D4', 'D5', 'D6', 'D7', 'Q7̄', 'GND', 'Q7', 'DS', 'D0', 'D1', 'D2', 'D3', 'CE', 'VCC'],
  }),
  icPart({
    mpn: '74HC138', mfr: NXP, pkg: 'DIP-16', tags: ['dekoder', 'demux', '3-8'],
    desc: '3 girişten 8 çıkışa (aktif düşük) dekoder / demultiplexer.',
    specs: { Besleme: '2–6 V', Çıkış: '8, aktif düşük', Enable: '2 aktif düşük + 1 aktif yüksek' },
    pins: ['A0', 'A1', 'A2', 'E1', 'E2', 'E3', 'Y7', 'GND', 'Y6', 'Y5', 'Y4', 'Y3', 'Y2', 'Y1', 'Y0', 'VCC'],
  }),
  icPart({
    mpn: '74HC4051', mfr: NXP, pkg: 'DIP-16', tags: ['analog', 'multiplexer', '8:1', 'anahtar'],
    desc: '8 kanallı analog çoklayıcı / çoğullayıcı.',
    specs: { Besleme: '2–10 V (VCC−VEE)', Kanal: '8', 'Ron (tipik)': '~70 Ω @ 4.5 V' },
    pins: ['Y4', 'Y6', 'Z', 'Y7', 'Y5', 'E', 'VEE', 'GND', 'S2', 'S1', 'S0', 'Y3', 'Y0', 'Y1', 'Y2', 'VCC'],
  }),
  icPart({
    mpn: 'CD4017', mfr: TI, pkg: 'DIP-16', tags: ['sayıcı', 'dekad', 'CMOS', 'Johnson'],
    desc: 'On çıkışlı Johnson dekad sayıcı; LED kovalama ve sıralayıcı devreler için.',
    specs: { Besleme: '3–15 V', Çıkış: '10 dekodlu', 'Maks. saat': '~5 MHz @ 10 V' },
    pins: ['Q5', 'Q1', 'Q0', 'Q2', 'Q6', 'Q7', 'Q3', 'VSS', 'Q8', 'Q4', 'Q9', 'CO', 'CLK INH', 'CLK', 'RESET', 'VDD'],
  }),
  icPart({
    mpn: 'CD4066', mfr: TI, pkg: 'DIP-14', tags: ['analog', 'anahtar', 'CMOS', 'bilateral'],
    desc: 'Dörtlü iki yönlü CMOS analog anahtar.',
    specs: { Besleme: '3–15 V', Kanal: '4 anahtar', 'Ron (tipik)': '~125 Ω @ 10 V' },
    pins: ['1 I/O', '1 O/I', '2 O/I', '2 I/O', '2 CTRL', '3 CTRL', 'VSS', '3 I/O', '3 O/I', '4 O/I', '4 I/O', '4 CTRL', '1 CTRL', 'VDD'],
  }),
  icPart({
    mpn: 'CD4011', mfr: TI, pkg: 'DIP-14', tags: ['lojik', 'NAND', 'CMOS'],
    desc: 'Dörtlü 2 girişli CMOS NAND kapısı (geniş besleme aralığı).',
    specs: { Besleme: '3–15 V', Kapı: '4 × NAND2' },
    pins: ['1A', '1B', '1Y', '2Y', '2A', '2B', 'VSS', '3A', '3B', '3Y', '4Y', '4A', '4B', 'VDD'],
  }),
  icPart({
    mpn: '74HC245', mfr: NXP, pkg: 'DIP-20', tags: ['tampon', 'bus', 'çift yönlü', 'seviye'],
    desc: '8 bit çift yönlü 3 durumlu bus alıcı-verici (transceiver).',
    specs: { Besleme: '2–6 V', Bit: '8', Çıkış: '3 durumlu, ±6 mA' },
    pins: ['DIR', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'GND', 'B8', 'B7', 'B6', 'B5', 'B4', 'B3', 'B2', 'B1', 'OE', 'VCC'],
  }),
  icPart({
    mpn: '74HC4040', mfr: NXP, pkg: 'DIP-16', tags: ['sayıcı', 'ripple', '12 bit', 'bölücü'],
    desc: '12 kademeli ikili ripple sayıcı / frekans bölücü.',
    specs: { Besleme: '2–6 V', Kademe: '12 bit', 'Maks. saat': '~30 MHz' },
    pins: ['Q12', 'Q6', 'Q5', 'Q7', 'Q4', 'Q3', 'Q2', 'GND', 'Q1', 'CLK', 'MR', 'Q9', 'Q8', 'Q10', 'Q11', 'VCC'],
  }),

  // ---------------------------------------------------------------- drivers
  icPart({
    mpn: 'L293D', mfr: 'STMicroelectronics', pkg: 'DIP-16', tags: ['motor sürücü', 'H-köprü', 'DC motor'],
    desc: 'Dahili korumalı diyotlu çift H-köprü motor sürücü.',
    specs: { 'Motor beslemesi (VCC2)': '4.5–36 V', 'Mantık beslemesi (VCC1)': '4.5–7 V', 'Kanal başına akım': '600 mA (tepe 1.2 A)', Kanal: '4 yarım köprü' },
    pins: ['1,2EN', '1A', '1Y', 'GND', 'GND', '2Y', '2A', 'VCC2', '3,4EN', '3A', '3Y', 'GND', 'GND', '4Y', '4A', 'VCC1'],
  }),
  icPart({
    mpn: 'ULN2003A', mfr: TI, pkg: 'DIP-16', tags: ['Darlington', 'sürücü', 'röle', 'step motor'],
    desc: '7 kanallı Darlington transistör dizisi; röle, step motor ve LED sürmek için.',
    specs: { 'Çıkış gerilimi': 'maks. 50 V', 'Kanal akımı': '500 mA', Kanal: '7', 'Dahili diyot': 'var (COM)' },
    pins: ['1B', '2B', '3B', '4B', '5B', '6B', '7B', 'E', 'COM', '7C', '6C', '5C', '4C', '3C', '2C', '1C'],
  }),
  icPart({
    mpn: 'IR2104', mfr: 'Infineon', pkg: 'DIP-8', tags: ['MOSFET sürücü', 'yarım köprü', 'bootstrap'],
    desc: 'Yüksek ve alçak taraf MOSFET/IGBT sürücüsü (yarım köprü, bootstrap).',
    specs: { 'Besleme (VCC)': '10–20 V', 'Yüksek taraf': 'maks. 600 V', 'Çıkış akımı': '130 mA / 270 mA' },
    pins: ['VCC', 'IN', 'SD', 'COM', 'LO', 'VS', 'HO', 'VB'],
  }),
  icPart({
    mpn: 'TC4420', mfr: 'Microchip', pkg: 'DIP-8', tags: ['MOSFET sürücü', 'gate driver', 'tek kanal'],
    desc: '6 A tepe akımlı tek kanallı yüksek hızlı MOSFET gate sürücüsü.',
    specs: { Besleme: '4.5–18 V', 'Tepe çıkış akımı': '6 A', Kanal: '1' },
    pins: ['VDD', 'IN', 'NC', 'GND', 'GND', 'OUT', 'OUT', 'VDD'],
  }),

  // ---------------------------------------------------------------- ADC / memory
  icPart({
    mpn: 'MCP3008', mfr: 'Microchip', pkg: 'DIP-16', category: 'comm', tags: ['ADC', 'SPI', '10 bit', '8 kanal'],
    desc: '8 kanallı 10 bit SPI arayüzlü ADC.',
    specs: { Besleme: '2.7–5.5 V', Çözünürlük: '10 bit', Kanal: '8 tek uçlu / 4 diferansiyel', 'Örnekleme': '200 ksps @ 5 V', Arayüz: 'SPI' },
    pins: ['CH0', 'CH1', 'CH2', 'CH3', 'CH4', 'CH5', 'CH6', 'CH7', 'DGND', 'CS/SHDN', 'DIN', 'DOUT', 'CLK', 'AGND', 'VREF', 'VDD'],
  }),
  icPart({
    mpn: '24LC256', mfr: 'Microchip', pkg: 'DIP-8', tags: ['EEPROM', 'I2C', '256 Kbit'],
    desc: 'I²C arayüzlü 256 Kbit (32 KB) seri EEPROM.',
    specs: { Besleme: '2.5–5.5 V', Kapasite: '256 Kbit (32 KB)', Arayüz: 'I²C, 400 kHz', Adres: 'A0–A2 ile 8 cihaz' },
    pins: ['A0', 'A1', 'A2', 'VSS', 'SDA', 'SCL', 'WP', 'VCC'],
  }),
  icPart({
    mpn: '93C46', mfr: 'Microchip', pkg: 'DIP-8', tags: ['EEPROM', 'Microwire', '1 Kbit'],
    desc: 'Microwire arayüzlü 1 Kbit seri EEPROM.',
    specs: { Besleme: '2.5–5.5 V', Kapasite: '1 Kbit', Arayüz: 'Microwire' },
    pins: ['CS', 'CLK', 'DI', 'DO', 'VSS', 'ORG', 'NC', 'VCC'],
  }),
  icPart({
    mpn: '25LC256', mfr: 'Microchip', pkg: 'DIP-8', tags: ['EEPROM', 'SPI', '256 Kbit'],
    desc: 'SPI arayüzlü 256 Kbit (32 KB) seri EEPROM.',
    specs: { Besleme: '2.5–5.5 V', Kapasite: '256 Kbit (32 KB)', Arayüz: 'SPI, 10 MHz' },
    pins: ['CS', 'SO', 'WP', 'VSS', 'SI', 'SCK', 'HOLD', 'VCC'],
  }),

  // ---------------------------------------------------------------- optocouplers
  icPart({
    mpn: 'PC817', mfr: 'Sharp', pkg: 'DIP-4', tags: ['optokuplör', 'izolasyon', 'transistör çıkışlı'],
    desc: 'Transistör çıkışlı tek kanallı optokuplör; DC sinyal izolasyonu için.',
    specs: { 'LED Vf (tipik)': '1.2 V', 'CTR': '50–600 %', İzolasyon: '5 kV', 'Çıkış Vce': 'maks. 80 V' },
    pins: ['ANODE', 'CATHODE', 'EMITTER', 'COLLECTOR'],
  }),
  icPart({
    mpn: '4N35', mfr: 'Vishay', pkg: 'DIP-6', tags: ['optokuplör', 'izolasyon', 'baz çıkışlı'],
    desc: 'Baz çıkışlı transistör optokuplör.',
    specs: { 'CTR': '≥100 %', İzolasyon: '5 kV', 'Çıkış Vce': 'maks. 30 V' },
    pins: ['ANODE', 'CATHODE', 'NC', 'EMITTER', 'COLLECTOR', 'BASE'],
  }),
  icPart({
    mpn: 'MOC3021', mfr: 'Motorola / onsemi', pkg: 'DIP-6', tags: ['optokuplör', 'triyak', 'AC', 'sürücü'],
    desc: 'Sıfır geçiş olmayan triyak çıkışlı optokuplör; AC yük sürmek için.',
    specs: { 'LED tetik akımı': '≤15 mA', 'Çıkış gerilimi': '400 V', İzolasyon: '7.5 kV tepe' },
    pins: ['ANODE', 'CATHODE', 'NC', 'MT1', 'NC (SUBSTRATE)', 'MT2'],
  }),
  icPart({
    mpn: '6N137', mfr: 'Vishay', pkg: 'DIP-8', tags: ['optokuplör', 'yüksek hız', 'lojik'],
    desc: 'Yüksek hızlı (10 Mbit/s) lojik çıkışlı optokuplör.',
    specs: { Besleme: '4.5–5.5 V', Hız: '10 MBd', 'Çıkış': 'açık kolektör, enable girişli' },
    pins: ['NC', 'ANODE', 'CATHODE', 'NC', 'GND', 'VO', 'VE', 'VCC'],
  }),
  icPart({
    mpn: 'TLP250', mfr: 'Toshiba', pkg: 'DIP-8', tags: ['optokuplör', 'gate driver', 'MOSFET', 'IGBT'],
    desc: 'MOSFET/IGBT gate sürmek için izoleli optokuplör sürücü.',
    specs: { Besleme: '10–35 V', 'Çıkış akımı': '±1.5 A (tepe 2 A)', İzolasyon: '2.5 kV' },
    pins: ['NC', 'ANODE', 'CATHODE', 'NC', 'GND', 'VO (OUTPUT)', 'VO', 'VCC'],
  }),

  // ---------------------------------------------------------------- MCU / interface
  icPart({
    mpn: 'ATmega328P', mfr: 'Microchip', pkg: 'DIP-28', category: 'mcu', wide: false, tags: ['AVR', 'Arduino', 'mikrodenetleyici', '8 bit'],
    desc: 'Arduino Uno nun kalbi olan 8 bit AVR mikrodenetleyici.',
    specs: { Besleme: '1.8–5.5 V', Frekans: '20 MHz maks. (16 MHz tipik)', Flash: '32 KB', SRAM: '2 KB', EEPROM: '1 KB', 'G/Ç': '23', ADC: '6 kanal 10 bit' },
    pins: ['PC6/RESET', 'PD0/RXD', 'PD1/TXD', 'PD2/INT0', 'PD3/INT1', 'PD4', 'VCC', 'GND', 'PB6/XTAL1', 'PB7/XTAL2', 'PD5', 'PD6', 'PD7', 'PB0',
      'PB1', 'PB2/SS', 'PB3/MOSI', 'PB4/MISO', 'PB5/SCK', 'AVCC', 'AREF', 'GND', 'PC0/ADC0', 'PC1/ADC1', 'PC2/ADC2', 'PC3/ADC3', 'PC4/SDA', 'PC5/SCL'],
  }),
  icPart({
    mpn: 'ATtiny85', mfr: 'Microchip', pkg: 'DIP-8', category: 'mcu', tags: ['AVR', 'mikrodenetleyici', 'küçük', '8 bit'],
    desc: '8 bacaklı küçük 8 bit AVR mikrodenetleyici.',
    specs: { Besleme: '2.7–5.5 V', Frekans: '20 MHz maks.', Flash: '8 KB', SRAM: '512 B', EEPROM: '512 B', 'G/Ç': '6', ADC: '4 kanal 10 bit' },
    pins: ['PB5/RESET', 'PB3', 'PB4', 'GND', 'PB0/MOSI', 'PB1/MISO', 'PB2/SCK', 'VCC'],
  }),
  icPart({
    mpn: 'MAX485', mfr: 'Analog Devices', pkg: 'DIP-8', category: 'comm', tags: ['RS-485', 'alıcı-verici', 'seri'],
    desc: 'Yarım çift yönlü RS-485 alıcı-verici.',
    specs: { Besleme: '4.75–5.25 V', Hız: '2.5 Mbps', Düğüm: '32', Mod: 'yarım çift yönlü' },
    pins: ['RO', 'RE', 'DE', 'DI', 'GND', 'A', 'B', 'VCC'],
  }),
  icPart({
    mpn: 'MAX232', mfr: 'Analog Devices', pkg: 'DIP-16', category: 'comm', tags: ['RS-232', 'seviye dönüştürücü', 'UART'],
    desc: 'TTL/CMOS ile RS-232 arasında seviye dönüştüren, dahili şarj pompalı çift kanallı çevirici.',
    specs: { Besleme: '5 V', Kanal: '2 sürücü + 2 alıcı', Hız: '120 kbps' },
    pins: ['C1+', 'V+', 'C1−', 'C2+', 'C2−', 'V−', 'T2OUT', 'R2IN', 'R2OUT', 'T2IN', 'T1IN', 'R1OUT', 'R1IN', 'T1OUT', 'GND', 'VCC'],
  }),
  icPart({
    mpn: 'MCP2551', mfr: 'Microchip', pkg: 'DIP-8', category: 'comm', tags: ['CAN', 'alıcı-verici', 'otomotiv'],
    desc: 'Yüksek hızlı CAN bus alıcı-verici.',
    specs: { Besleme: '4.5–5.5 V', Hız: '1 Mbps', Düğüm: '112' },
    pins: ['TXD', 'VSS', 'VDD', 'RXD', 'VREF', 'CANL', 'CANH', 'RS'],
  }),
];
