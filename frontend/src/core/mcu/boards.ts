import type { ComponentDef } from '../../library/types';
import type { McuBoardSpec } from './types';

/**
 * Electrical/firmware specs for the boards the simulator can really run firmware on.
 * Output resistances are approximations derived from datasheet VOH/VOL-at-current figures; they are NOT measured values.
 * Boards not listed here stay "library only" (pinout + datasheet info, no electrical model).
 */

const num = (n: string): number | null => { const m = /^D(\d+)/.exec(n); return m ? Number(m[1]) : null; };

interface Built { spec: McuBoardSpec; simNote: string }

function avr(def: ComponentDef, o: { analogBase: number; nAnalog: number; pwm: number[]; inputOnly?: number[]; ledNum: number; sda: number; scl: number; intPins: number[]; spi?: McuBoardSpec['spi'] }): Built {
  const pinMap: Record<number, string> = {};
  const constants: Record<string, number> = { LED_BUILTIN: o.ledNum, SDA: o.sda, SCL: o.scl };
  for (const p of def.pins) {
    const d = num(p.id);
    if (d !== null) pinMap[d] = p.id;
    const a = /^A(\d+)/.exec(p.id);
    if (a) { const n = o.analogBase + Number(a[1]); pinMap[n] = p.id; constants[`A${a[1]}`] = n; }
  }
  const sup = (pin: string, v: number, rout: number, imax: number, label: string) => def.pins.some((p) => p.id === pin) ? [{ pin, v, rout, imax, label }] : [];
  const spec: McuBoardSpec = {
    family: 'avr', vcc: 5, intBits: 16, cpuHz: 16e6, adcBits: 10, adcVref: 5,
    pinMap, constants, pwmPins: o.pwm, pwmHz: 490, intPins: o.intPins, spi: o.spi,
    adcPins: Array.from({ length: o.nAnalog }, (_, i) => o.analogBase + i), inputOnly: o.inputOnly ?? [],
    rOutHigh: 40, rOutLow: 40, rPullup: 35000, imaxPin: 0.04, vInMargin: 0.5,
    brownoutV: 2.7, // ATmega328P BOD level, typical, doğrulanmadı (fuse-dependent)
    supplies: [...sup('5V', 5, 0.3, 0.5, '5V (USB)'), ...sup('3V3', 3.3, 2, 0.05, '3V3 (regülatör, ≤50 mA)')],
    gnd: def.pins.filter((p) => p.label === 'GND').map((p) => p.id),
    notes: ['GPIO: pin başına 20 mA önerilen, 40 mA mutlak maksimum; tüm pinler toplam ~200 mA.', 'Giriş eşikleri: VIH ≥ 0.6·VCC, VIL ≤ 0.3·VCC.', 'D0/D1 USB-seri ile paylaşılır.'],
  };
  return { spec, simNote: 'GPIO = Thevenin kaynağı (~40 Ω); 5V pini USB’den (≤500 mA) beslenen ideal kaynak olarak modellenir. Sketch yorumlayıcısında harici kesme (attachInterrupt), Wire (I2C master) ve SPI (master) İŞLEM DÜZEYİNDE modellenir (bit zamanlaması yok; I2C için dış pull-up gerekir); zamanlayıcı kesmeleri/slave modu yok. HEX modunda TWI/SPI avr8js çevre birimleri aynı bus katmanına bağlıdır.' };
}

function esp32(def: ComponentDef): Built {
  const special: Record<string, number> = { VP: 36, VN: 39, TX0: 1, RX0: 3, TX2: 17, RX2: 16 };
  const pinMap: Record<number, string> = {};
  for (const p of def.pins) { const n = special[p.id] ?? num(p.id); if (n !== null && n !== undefined) pinMap[n] = p.id; }
  const adc = [36, 39, 34, 35, 32, 33, 4, 0, 2, 15, 13, 12, 14, 27, 25, 26].filter((n) => pinMap[n]);
  const inputOnly = [34, 35, 36, 39].filter((n) => pinMap[n]);
  const spec: McuBoardSpec = {
    family: 'esp32', vcc: 3.3, intBits: 32, cpuHz: 240e6, adcBits: 12, adcVref: 3.3,
    pinMap, constants: { LED_BUILTIN: 2, SDA: 21, SCL: 22, TX: 1, RX: 3, A0: 36, A3: 39, A4: 32, A5: 33, A6: 34, A7: 35, A10: 4, A11: 0, A12: 2, A13: 15, A14: 13, A15: 12, A16: 14, A17: 27, A18: 25, A19: 26 },
    pwmPins: Object.keys(pinMap).map(Number).filter((n) => !inputOnly.includes(n)), pwmHz: 1000, spi: { mosi: 23, miso: 19, sck: 18, ss: 5 },
    adcPins: adc, inputOnly, rOutHigh: 30, rOutLow: 30, rPullup: 45000, imaxPin: 0.04, vInMargin: 0.3,
    brownoutV: 2.43, // ESP32 brownout detector default, typical, doğrulanmadı
    supplies: [{ pin: '3V3', v: 3.3, rout: 1, imax: 0.6, label: '3V3 (LDO)' }, { pin: 'VIN', v: 5, rout: 0.3, imax: 0.5, label: 'VIN (USB 5 V)' }],
    gnd: def.pins.filter((p) => p.label === 'GND').map((p) => p.id),
    notes: ['GPIO 3.3 V mantık, 5 V DAYANIKLI DEĞİL (5 V uygulamak pini/çipi bozar).', 'GPIO34/35/36/39 yalnızca giriş.', 'Strapping pinleri: GPIO0, 2, 5, 12 (MTDI: açılışta HIGH ise flash 1.8 V olur, boot hatası), 15.', 'GPIO6–11 dahili flash’a bağlıdır (bu kartta çıkarılmamıştır).', 'ADC2 pinleri Wi-Fi açıkken kullanılamaz (Wi-Fi simüle edilmez).', 'ADC doğrusal değildir; burada ideal doğrusal ADC varsayılır.', 'Pin başına 20 mA önerilen, 40 mA mutlak maksimum.'],
  };
  return { spec, simNote: 'GPIO = Thevenin kaynağı (~30 Ω). Wi-Fi/BLE/DAC/touch simüle edilmez; sketch modunda Wire (I2C, pinler Wire.begin(sda,scl) ile seçilebilir), SPI ve GPIO kesmesi işlem/adım düzeyinde modellenir; ADC ideal doğrusal. 3V3 pini LDO çıkışı, VIN USB 5 V varsayılır.' };
}

function pico(def: ComponentDef): Built {
  const pinMap: Record<number, string> = {};
  for (const p of def.pins) { const m = /^GP(\d+)$/.exec(p.id); if (m) pinMap[Number(m[1])] = p.id; }
  const spec: McuBoardSpec = {
    family: 'rp2040', vcc: 3.3, intBits: 32, cpuHz: 133e6, adcBits: 10, adcVref: 3.3,
    pinMap, constants: { LED_BUILTIN: 25, A0: 26, A1: 27, A2: 28, SDA: 4, SCL: 5 },
    pwmPins: Object.keys(pinMap).map(Number), pwmHz: 1000, spi: { mosi: 19, miso: 16, sck: 18, ss: 17 }, adcPins: [26, 27, 28].filter((n) => pinMap[n]), inputOnly: [],
    rOutHigh: 50, rOutLow: 50, rPullup: 50000, imaxPin: 0.012, vInMargin: 0.3,
    brownoutV: 1.8, // RP2040 brown-out detect, typical, doğrulanmadı (BOR level is configurable; value assumed)
    supplies: [{ pin: '3V3', v: 3.3, rout: 1, imax: 0.3, label: '3V3 (SMPS)' }, { pin: 'VBUS', v: 5, rout: 0.3, imax: 0.5, label: 'VBUS (USB 5 V)' }],
    gnd: def.pins.filter((p) => p.label === 'GND' || p.label === 'AGND').map((p) => p.id),
    notes: ['GPIO 3.3 V, 5 V dayanıklı DEĞİL.', 'Varsayılan sürüş 4 mA; en yüksek ayarda 12 mA (burada 12 mA mutlak sınır alındı).', 'Yerleşik LED GP25 başlıkta çıkarılmadı: LED_BUILTIN bu modelde bağlı değil.', 'ADC: GP26–GP28 (12 bit donanım; çekirdek varsayılanı 10 bit, analogReadResolution(12) ile değişir).', 'Tüm GPIO’lar PWM yapabilir (burada 1 kHz).'],
  };
  return { spec, simNote: 'GPIO = Thevenin kaynağı (~50 Ω). PIO/UART çevre birimleri, USB ve Wi-Fi (Pico W) simüle edilmez; sketch modunda Wire (I2C0 varsayılan GP4/GP5, Wire.setSDA/setSCL), SPI (SPI0 varsayılan GP16–19) ve GPIO kesmesi işlem/adım düzeyinde modellenir.' };
}

const BUILD: Record<string, (d: ComponentDef) => Built> = {
  mod_arduino_uno_r3: (d) => avr(d, { analogBase: 14, nAnalog: 6, pwm: [3, 5, 6, 9, 10, 11], ledNum: 13, sda: 18, scl: 19, intPins: [2, 3], spi: { mosi: 11, miso: 12, sck: 13, ss: 10 } }),
  mod_arduino_nano: (d) => avr(d, { analogBase: 14, nAnalog: 8, pwm: [3, 5, 6, 9, 10, 11], inputOnly: [20, 21], ledNum: 13, sda: 18, scl: 19, intPins: [2, 3], spi: { mosi: 11, miso: 12, sck: 13, ss: 10 } }),
  mod_arduino_mega_2560: (d) => avr(d, { analogBase: 54, nAnalog: 16, pwm: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], ledNum: 13, sda: 20, scl: 21, intPins: [2, 3, 21, 20, 19, 18] }),
  mod_esp32_devkit_v1: esp32,
  mod_raspberry_pi_pico: pico,
};

export const MCU_BOARD_IDS = Object.keys(BUILD);

/** Turn library-only board defs into simulatable MCU boards (in place). */
export function upgradeMcuBoards(defs: ComponentDef[]): void {
  for (const d of defs) {
    const b = BUILD[d.type];
    if (!b) continue;
    const { spec, simNote } = b(d);
    d.model = 'mcu';
    d.mcu = spec;
    d.simModel = 'partial';
    d.simNote = simNote;
    d.missing = ['bit düzeyi I2C/SPI zamanlaması (işlem düzeyi model)', 'I2C/SPI slave modu', 'zamanlayıcı/PWM kesmeleri', 'brownout', 'Wi-Fi/BLE', 'ısıl model', 'SPICE modeli'];
  }
}

// ------------------------------------------------------------------ compatibility matrix
export type Support = 'sim' | 'partial' | 'hw' | 'na';
export const SUPPORT_LABEL: Record<Support, string> = { sim: 'Simüle edilir', partial: 'Kısmi', hw: 'Donanımda var, simüle edilmez', na: 'Yok' };

export const PERIPHERALS = ['GPIO giriş/çıkış', 'Dahili pull-up', 'PWM (analogWrite)', 'ADC (analogRead)', 'DAC', 'UART / Serial', 'I2C (Wire)', 'SPI', 'Dış kesme', 'Zamanlayıcı / millis / delay', 'Wi-Fi', 'Bluetooth / BLE', 'GPIO akım/gerilim sınır kontrolü'] as const;

export interface MatrixBoard { id: string; name: string; cells: Support[] }

// order follows PERIPHERALS
export const COMPAT: MatrixBoard[] = [
  { id: 'mod_arduino_uno_r3', name: 'Arduino Uno / Nano / Mega', cells: ['sim', 'sim', 'sim', 'sim', 'na', 'sim', 'partial', 'partial', 'partial', 'sim', 'na', 'na', 'sim'] },
  { id: 'mod_esp32_devkit_v1', name: 'ESP32 DevKit V1', cells: ['sim', 'sim', 'sim', 'partial', 'hw', 'sim', 'partial', 'partial', 'partial', 'sim', 'hw', 'hw', 'sim'] },
  { id: 'mod_raspberry_pi_pico', name: 'Raspberry Pi Pico', cells: ['sim', 'sim', 'sim', 'sim', 'na', 'sim', 'partial', 'partial', 'partial', 'sim', 'na', 'na', 'sim'] },
  { id: 'mod_nodemcu_esp8266', name: 'NodeMCU ESP8266', cells: ['hw', 'hw', 'hw', 'hw', 'na', 'hw', 'hw', 'hw', 'hw', 'hw', 'hw', 'na', 'hw'] },
  { id: 'mod_stm32_blue_pill', name: 'STM32 Blue Pill', cells: ['hw', 'hw', 'hw', 'hw', 'na', 'hw', 'hw', 'hw', 'hw', 'hw', 'na', 'na', 'hw'] },
];
