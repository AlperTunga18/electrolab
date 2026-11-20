import { CircuitBuilder } from '../core/circuit/builder';
import type { Circuit, Firmware } from '../core/circuit/types';
import { TEMPLATES } from '../core/mcu/templates';

export interface Example {
  id: string;
  level: 'baslangic' | 'orta' | 'ariza' | 'mcu';
  title: string;
  titleEn: string;
  summary: string;
  steps: string[];
  expected: string;
  build: () => Circuit;
  /** recommended simulation speed (sim s per real s) */
  speed?: number;
  /** long/switching circuit: the generic 2 ms transient smoke test is skipped (it has a dedicated test) */
  heavy?: boolean;
}

const led = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 5 }, -6, 0, 0, 'V1');
  b.add('resistor', { r: 150 }, -1, -3);
  b.add('led', { color: 'red' }, 4, -3);
  b.add('ground', {}, 0, 4);
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'D1.A'); b.chain('D1.K', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

const divider = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 10 }, -6, 0, 0, 'V1');
  b.add('resistor', { r: 1000 }, 0, -3, 1);
  b.add('resistor', { r: 2000 }, 0, 3, 1);
  b.add('ground', {}, 5, 0);
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'R2.1'); b.chain('R2.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

const rcCharge = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 5 }, -7, 0, 0, 'V1');
  b.add('switch', { closed: false }, -3, -3);
  b.add('resistor', { r: 1000 }, 1, -3);
  b.add('capacitor_el', { c: 100e-6, vmax: 16 }, 5, 0, 1);
  b.add('ground', {}, 0, 4);
  b.chain('V1.P', 'SW1.1'); b.chain('SW1.2', 'R1.1'); b.chain('R1.2', 'C1.1'); b.chain('C1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

const rectifier = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('signal_gen', { wave: 'sine', amp: 10, freq: 50 }, -7, 0, 0, 'V1');
  b.add('diode', {}, -2, -3);
  b.add('capacitor_el', { c: 100e-6, vmax: 25 }, 3, 0, 1);
  b.add('resistor', { r: 1000 }, 7, 0, 1);
  b.add('ground', {}, 0, 4);
  b.chain('V1.P', 'D1.A'); b.chain('D1.K', 'C1.1'); b.chain('C1.1', 'R1.1'); b.chain('C1.2', 'GND1.G'); b.chain('R1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

const npnSwitch = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 5 }, -8, 0, 0, 'V1');
  b.add('button', { closed: false }, -4, 3);
  b.add('resistor', { r: 10000 }, -1, 3);
  b.add('resistor', { r: 330 }, 3, -4, 1);
  b.add('led', { color: 'green' }, 3, -1, 1);
  b.add('npn', {}, 3, 3);
  b.add('ground', {}, 0, 7);
  b.chain('V1.P', 'SW1.1'); b.chain('SW1.2', 'R1.1'); b.chain('R1.2', 'Q1.B');
  b.chain('V1.P', 'R2.1'); b.chain('R2.2', 'D1.A'); b.chain('D1.K', 'Q1.C'); b.chain('Q1.E', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

const mosfetPwm = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 12 }, -8, -3, 0, 'V1');
  b.add('signal_gen', { wave: 'square', v: 2.5, amp: 2.5, freq: 1000, duty: 30 }, -8, 4, 0, 'V2');
  b.add('resistor', { r: 12 }, 3, -4, 1);
  b.add('nmos_logic', {}, 3, 2);
  b.add('ground', {}, 0, 8);
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'Q1.D'); b.chain('V2.P', 'Q1.G'); b.chain('Q1.S', 'GND1.G'); b.chain('V1.N', 'GND1.G'); b.chain('V2.N', 'GND1.G');
  return b.circuit;
};

const ledFault = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 5 }, -6, 0, 0, 'V1');
  b.add('resistor', { r: 10 }, -1, -3);
  b.add('led', { color: 'red' }, 4, -3);
  b.add('ground', {}, 0, 4);
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'D1.A'); b.chain('D1.K', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

const mosfetHeat = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 12 }, -8, -3, 0, 'V1');
  b.add('dc_supply', { v: 4 }, -8, 4, 0, 'V2');
  b.add('resistor', { r: 6, pmax: 10 }, 3, -4, 1);
  b.add('nmos_std', {}, 3, 2);
  b.add('ground', {}, 0, 8);
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'Q1.D'); b.chain('V2.P', 'Q1.G'); b.chain('Q1.S', 'GND1.G'); b.chain('V1.N', 'GND1.G'); b.chain('V2.N', 'GND1.G');
  return b.circuit;
};

const tpl = (id: string): string => TEMPLATES.find((t) => t.id === id)!.code;
const fw = (id: string, source: string): Record<string, Firmware> => ({ [id]: { kind: 'sketch', source } });

const mcuBlink = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('mod_arduino_uno_r3', {}, 0, 0, 0, 'U1');
  b.add('resistor', { r: 220 }, 9, -4);
  b.add('led', { color: 'red' }, 13, -2);
  b.add('ground', {}, 9, 3);
  b.chain('U1.D13/SCK', 'R1.1'); b.chain('R1.2', 'D1.A'); b.chain('D1.K', 'U1.GND'); b.chain('U1.GND', 'GND1.G');
  return { ...b.circuit, firmware: fw('U1', tpl('blink')) };
};

const mcuButton = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('mod_arduino_uno_r3', {}, 0, 0, 0, 'U1');
  b.add('button', { closed: false }, 9, 0);
  b.add('resistor', { r: 220 }, 9, -4);
  b.add('led', { color: 'green' }, 13, -2);
  b.add('ground', {}, 9, 4);
  b.chain('U1.D2', 'SW1.1'); b.chain('SW1.2', 'GND1.G'); b.chain('U1.GND', 'GND1.G');
  b.chain('U1.D13/SCK', 'R1.1'); b.chain('R1.2', 'D1.A'); b.chain('D1.K', 'GND1.G');
  return { ...b.circuit, firmware: fw('U1', tpl('button')) };
};

const mcuPotPwm = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('mod_arduino_uno_r3', {}, 0, 0, 0, 'U1');
  b.add('pot', { r: 10000, pos: 0.3 }, 9, 2);
  b.add('resistor', { r: 220 }, 9, -4);
  b.add('led', { color: 'yellow' }, 13, -2);
  b.add('ground', {}, 12, 5);
  b.chain('U1.5V', 'RV1.A'); b.chain('RV1.W', 'U1.A0'); b.chain('RV1.B', 'GND1.G'); b.chain('U1.GND', 'GND1.G');
  b.chain('U1.D9', 'R1.1'); b.chain('R1.2', 'D1.A'); b.chain('D1.K', 'GND1.G');
  return { ...b.circuit, firmware: fw('U1', tpl('pot-pwm')) };
};

const esp32Mosfet = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('mod_esp32_devkit_v1', {}, 0, 0, 0, 'U1');
  b.add('resistor', { r: 100 }, 8, 4);
  b.add('resistor', { r: 10000 }, 8, 7);
  b.add('nmos_logic', {}, 12, 4);
  b.add('dc_supply', { v: 12 }, 16, -2, 0, 'V1');
  b.add('resistor', { r: 12, pmax: 25 }, 12, -2, 1, 'RL');
  b.add('ground', {}, 12, 9);
  b.chain('U1.D26', 'R1.1'); b.chain('R1.2', 'Q1.G'); b.chain('Q1.G', 'R2.1'); b.chain('R2.2', 'GND1.G');
  b.chain('V1.P', 'RL.1'); b.chain('RL.2', 'Q1.D'); b.chain('Q1.S', 'GND1.G'); b.chain('V1.N', 'GND1.G'); b.chain('U1.GND', 'GND1.G');
  return { ...b.circuit, firmware: fw('U1', tpl('esp32-relay')) };
};

const ESP32_5V_CODE = [
  '// GPIO4 giriş olarak okunuyor; ama pine 5 V sinyal bağlı!',
  'void setup() {',
  '  pinMode(4, INPUT);',
  '  Serial.begin(115200);',
  '}',
  '',
  'void loop() {',
  '  Serial.println(digitalRead(4));',
  '  delay(500);',
  '}',
  '',
].join('\n');

const esp32Overvoltage = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('mod_esp32_devkit_v1', {}, 0, 0, 0, 'U1');
  b.add('dc_supply', { v: 5 }, 10, -3, 0, 'V1');
  b.add('resistor', { r: 1000 }, 10, 1);
  b.add('ground', {}, 8, 6);
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'U1.D4'); b.chain('V1.N', 'GND1.G'); b.chain('U1.GND', 'GND1.G');
  return { ...b.circuit, firmware: fw('U1', ESP32_5V_CODE) };
};

const rlcResonance = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('signal_gen', { wave: 'sine', amp: 1, freq: 1590 }, -9, 0, 0, 'V1');
  b.add('inductor', { l: 10e-3 }, -4, -3, 0, 'L1');
  b.add('capacitor', { c: 1e-6 }, 1, -3, 0, 'C1');
  b.add('resistor', { r: 10 }, 6, 0, 1, 'R1');
  b.add('ground', {}, 0, 4);
  b.chain('V1.P', 'L1.1'); b.chain('L1.2', 'C1.1'); b.chain('C1.2', 'R1.1'); b.chain('R1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

const ceAmplifier = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('signal_gen', { wave: 'sine', amp: 0.01, freq: 1000, v: 0 }, -12, 4, 0, 'VS');
  b.add('dc_supply', { v: 12 }, -12, -4, 0, 'VCC');
  b.add('capacitor_el', { c: 10e-6, vmax: 25 }, -7, 4, 0, 'CIN');
  b.add('resistor', { r: 47000 }, -3, -4, 1, 'RB1');
  b.add('resistor', { r: 10000 }, -3, 4, 1, 'RB2');
  b.add('resistor', { r: 2200 }, 5, -4, 1, 'RC');
  b.add('npn', { bf: 200 }, 3, 1, 0, 'Q1');
  b.add('resistor', { r: 1000 }, 5, 6, 1, 'RE');
  b.add('capacitor_el', { c: 1e-3, vmax: 25 }, 9, 6, 1, 'CE');
  b.add('ground', {}, 2, 10);
  b.chain('VS.P', 'CIN.1'); b.chain('CIN.2', 'Q1.B'); b.chain('Q1.B', 'RB1.2'); b.chain('Q1.B', 'RB2.1');
  b.chain('VCC.P', 'RB1.1'); b.chain('VCC.P', 'RC.1'); b.chain('RC.2', 'Q1.C'); b.chain('Q1.E', 'RE.1'); b.chain('Q1.E', 'CE.1');
  b.chain('RE.2', 'GND1.G'); b.chain('CE.2', 'GND1.G'); b.chain('RB2.2', 'GND1.G'); b.chain('VS.N', 'GND1.G'); b.chain('VCC.N', 'GND1.G');
  return b.circuit;
};

const dcMotorStart = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 6 }, -6, 0, 0, 'V1');
  b.add('dc_motor', {}, 3, 0, 1, 'M1');
  b.add('ground', {}, 0, 5);
  b.chain('V1.P', 'M1.P'); b.chain('M1.N', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

/** 5 V relay driven by a logic MOSFET; flyback diode D1 across the coil (remove it to see the voltage spike). */
export const relayFlyback = (diode = true): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 5 }, -10, -3, 0, 'VC');
  b.add('signal_gen', { wave: 'square', v: 2.5, amp: 2.5, freq: 5, duty: 50 }, -10, 5, 0, 'V2');
  b.add('relay_5v', {}, 0, -2, 0, 'K1');
  b.add('nmos_logic', {}, -2, 4, 0, 'Q1');
  b.add('dc_supply', { v: 12 }, 8, -6, 0, 'VL');
  b.add('resistor', { r: 100, pmax: 2 }, 8, 1, 1, 'RL');
  b.add('ground', {}, 0, 9);
  if (diode) b.add('diode', {}, -5, -2, 1, 'D1');
  b.chain('VC.P', 'K1.C1'); b.chain('K1.C2', 'Q1.D'); b.chain('V2.P', 'Q1.G'); b.chain('Q1.S', 'GND1.G');
  b.chain('VC.N', 'GND1.G'); b.chain('V2.N', 'GND1.G');
  b.chain('VL.P', 'K1.COM'); b.chain('K1.NO', 'RL.1'); b.chain('RL.2', 'GND1.G'); b.chain('VL.N', 'GND1.G');
  if (diode) { b.chain('K1.C2', 'D1.A'); b.chain('K1.C1', 'D1.K'); }
  return b.circuit;
};

/** H-bridge: 4 logic MOSFETs; the four gate drivers are ideal floating sources (gate-source). Negative amplitude = inverted square (complementary phase). */
const hBridgeMotor = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 6 }, -12, 0, 0, 'V1');
  b.add('nmos_logic', {}, -2, -5, 0, 'Q1'); // high side A
  b.add('nmos_logic', {}, -2, 5, 0, 'Q2');  // low side A
  b.add('nmos_logic', {}, 8, -5, 0, 'Q3');  // high side B
  b.add('nmos_logic', {}, 8, 5, 0, 'Q4');   // low side B
  b.add('dc_motor', {}, 3, 0, 0, 'M1');
  const drv = (ref: string, amp: number, x: number, z: number) => b.add('signal_gen', { wave: 'square', v: 5, amp, freq: 2, duty: 50 }, x, z, 0, ref);
  drv('G1', 5, -6, -8); drv('G4', 5, 12, 8); drv('G3', -5, 12, -8); drv('G2', -5, -6, 8);
  b.add('ground', {}, 3, 11);
  b.chain('V1.P', 'Q1.D'); b.chain('V1.P', 'Q3.D');
  b.chain('Q1.S', 'Q2.D'); b.chain('Q1.S', 'M1.P');
  b.chain('Q3.S', 'Q4.D'); b.chain('Q3.S', 'M1.N');
  b.chain('Q2.S', 'GND1.G'); b.chain('Q4.S', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  b.chain('G1.P', 'Q1.G'); b.chain('G1.N', 'Q1.S');
  b.chain('G3.P', 'Q3.G'); b.chain('G3.N', 'Q3.S');
  b.chain('G2.P', 'Q2.G'); b.chain('G2.N', 'GND1.G');
  b.chain('G4.P', 'Q4.G'); b.chain('G4.N', 'GND1.G');
  return b.circuit;
};

const boostConverter = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 5 }, -10, 0, 0, 'V1');
  b.add('inductor', { l: 220e-6, imax: 3 }, -4, -4, 0, 'L1');
  b.add('nmos_std', {}, 0, 3, 0, 'Q1');
  b.add('signal_gen', { wave: 'square', v: 5, amp: 5, freq: 50000, duty: 50 }, -4, 6, 0, 'V2');
  b.add('sb560', {}, 4, -4, 0, 'D1');
  b.add('capacitor_el', { c: 47e-6, vmax: 25 }, 9, 0, 1, 'C1');
  b.add('resistor', { r: 100, pmax: 2 }, 13, 0, 1, 'RL');
  b.add('ground', {}, 4, 9);
  b.chain('V1.P', 'L1.1'); b.chain('L1.2', 'Q1.D'); b.chain('L1.2', 'D1.A'); b.chain('D1.K', 'C1.1'); b.chain('C1.1', 'RL.1');
  b.chain('Q1.S', 'GND1.G'); b.chain('C1.2', 'GND1.G'); b.chain('RL.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  b.chain('V2.P', 'Q1.G'); b.chain('V2.N', 'GND1.G');
  return b.circuit;
};

/** Virtual only: 230 V / 50 Hz sine source (325 V peak) -> transformer -> bridge -> filter -> load. */
const acDcAdaptor = (): Circuit => {
  const b = new CircuitBuilder();
  b.add('signal_gen', { wave: 'sine', amp: 325, freq: 50, v: 0 }, -12, 0, 0, 'V1');
  b.add('transformer', {}, -5, 0, 0, 'TR1');
  b.add('db107', {}, 2, 0, 0, 'BR1');
  b.add('capacitor_el', { c: 1000e-6, vmax: 63 }, 8, 1, 1, 'C1');
  b.add('resistor', { r: 100, pmax: 15 }, 13, 1, 1, 'RL');
  b.add('ground', {}, 4, 8);
  b.chain('V1.P', 'TR1.P1'); b.chain('TR1.P2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  b.chain('TR1.S1', 'BR1.AC1'); b.chain('TR1.S2', 'BR1.AC2');
  b.chain('BR1.P', 'C1.1'); b.chain('C1.1', 'RL.1'); b.chain('BR1.N', 'GND1.G'); b.chain('C1.2', 'GND1.G'); b.chain('RL.2', 'GND1.G');
  return b.circuit;
};

export const EXAMPLES: Example[] = [
  {
    id: 'led', level: 'baslangic', title: 'LED yakma', titleEn: 'Light an LED', build: led,
    summary: '5 V kaynak, 150 Ω sınırlama direnci ve kırmızı LED. LED akımı R üzerindeki gerilim düşümüyle belirlenir.',
    steps: ['Çalıştır’a basın.', 'R1 değerini 47 Ω yapın: LED akımı limiti aşar mı?', 'R1’i 1 kΩ yapın: akım ve parlaklık nasıl değişir?'],
    expected: 'I ≈ (5 V − Vf) / 150 Ω ≈ 20 mA, Vf ≈ 1.9 V',
  },
  {
    id: 'divider', level: 'baslangic', title: 'Gerilim bölücü', titleEn: 'Voltage divider', build: divider,
    summary: '10 V kaynağın 1 kΩ + 2 kΩ ile bölünmesi. Orta düğüm gerilimi oranla belirlenir.',
    steps: ['Çalıştır’a basın.', 'Orta düğüm gerilimini Ölçümler sekmesinde okuyun.', 'R2’yi 1 kΩ yapın ve tekrar okuyun.'],
    expected: 'Vout = 10 × 2k/(1k+2k) = 6.667 V, I = 3.33 mA',
  },
  {
    id: 'rc', level: 'baslangic', title: 'Kondansatör şarjı (RC)', titleEn: 'Capacitor charging (RC)', build: rcCharge,
    summary: '1 kΩ + 100 µF → τ = 100 ms. Anahtar kapanınca kondansatör üstel olarak şarj olur.',
    steps: ['Hız çarpanını 0.1 yapın, Çalıştır’a basın.', 'SW1’e çift tıklayarak anahtarı kapatın.', 'Osiloskopta C1 geriliminin 5 V’a yükselişini izleyin.'],
    expected: 'v(t) = 5·(1 − e^(−t/τ)), τ = R·C = 100 ms; 5τ ≈ 500 ms’de ≈ %99.3',
  },
  {
    id: 'rectifier', level: 'baslangic', title: 'Yarım dalga doğrultucu', titleEn: 'Half-wave rectifier', build: rectifier,
    summary: '10 V tepe, 50 Hz sinüs → diyot → 100 µF filtre kondansatörü + yük.',
    steps: ['Hız çarpanını 1 yapın, Çalıştır’a basın.', 'Osiloskopta giriş ve çıkış düğümünü birlikte seçin.', 'C1 değerini 10 µF yapın: ripple nasıl değişir?'],
    expected: 'Tepe ≈ 10 V − Vf(≈0.7 V); ripple ≈ I/(f·C)',
  },
  {
    id: 'npn', level: 'orta', title: 'Transistörle LED anahtarlama', titleEn: 'NPN LED switch', build: npnSwitch,
    summary: 'Buton, 10 kΩ taban direnci ve NPN transistör ile LED sürme.',
    steps: ['Çalıştır’a basın, SW1’e çift tıklayıp butonu “bastırın”.', 'Q1 için Vce ve Ic değerlerine bakın (doyum: Vce < 0.3 V).', 'R1’i 1 MΩ yapın: transistör doyuma ulaşıyor mu?'],
    expected: 'Ib ≈ (5 − 0.7)/10k = 0.43 mA; Ic ≈ (5 − 2.1 − Vce)/330 Ω ≈ 8.5 mA; Vce(sat) < 0.3 V',
  },
  {
    id: 'mosfet', level: 'orta', title: 'MOSFET ile PWM yük sürme', titleEn: 'MOSFET PWM load', build: mosfetPwm,
    summary: '0–5 V, 1 kHz, %30 doluluklu kare dalga ile N-MOSFET gate sürüşü; 12 Ω yük.',
    steps: ['Hız çarpanını 0.01 yapın, Çalıştır’a basın.', 'Osiloskopta gate ve drain düğümlerini izleyin.', 'Q1’i “standart gate” MOSFET ile değiştirip kütüphaneden ekleyin: 5 V’ta tam iletime geçiyor mu?'],
    expected: 'VGS = 5 V → mantık seviyeli MOSFET’te VDS ≈ 0.2 V civarı; yük akımı ≈ 1 A; ortalama yük gerilimi ≈ 0.3×12 V',
  },
  {
    id: 'led_fault', level: 'ariza', title: 'Arıza: LED’i yeterli dirençsiz sürmek', titleEn: 'Fault: LED without proper resistor', build: ledFault,
    summary: '5 V kaynak + yalnızca 10 Ω ile LED: akım ≈ 280 mA, LED’in sınırının (30 mA) ~9 katı.',
    steps: ['Çalıştır’a basın (Hasar uygula açık): LED birkaç an içinde arızalanır.', 'Alt panelde Arızalar sekmesini açın: neden, değerler, bağlantılar, öneriler.', 'Sıfırla, sonra R1’i 150 Ω yapıp tekrar deneyin.'],
    expected: 'I ≈ (5 − 2)/10 = 0.3 A > 3 × 30 mA → aşırı akım hasarı (açık devre); doğru direnç ≈ 100–150 Ω',
  },
  {
    id: 'mosfet_heat', level: 'ariza', title: 'Arıza: yetersiz gate sürüşü ve ısınma', titleEn: 'Fault: weak gate drive & heating', build: mosfetHeat,
    summary: 'Eşiği 3.5 V olan MOSFET 4 V gate ile süreniyor: doyum bölgesinde kalır, ≈ 6 W harcar ve ısınır.',
    steps: ['Ana ekrandan DC çöz: Q1 için kararlı hal Tj’ye bakın (limit 175 °C).', 'Isıl kamera’yı açın. Q1’i seçip büyük soğutucu + fan ekleyin ve tekrar DC çözün.', 'Alternatif: V2’yi 10 V yapın — MOSFET tam iletime geçer, ısı ≈ 0.'],
    expected: 'Vov = 0.5 V → Id ≈ K·Vov² ≈ 1 A, VDS ≈ 5.6 V, P ≈ 6 W; serbest havada Tj ≫ 175 °C, büyük soğutucuda ≈ 50 °C',
  },
  {
    id: 'mcu_blink', level: 'mcu', title: 'MCU: Arduino Uno Blink', titleEn: 'MCU: Arduino Uno Blink', build: mcuBlink, speed: 1,
    summary: 'Uno D13 → 220 Ω → LED. Sketch yorumlayıcısı pini 500 ms aralıkla sürer; GPIO elektriksel olarak ~40 Ω çıkışlı kaynak olarak çözülür.',
    steps: ['Hız 1 olarak ayarlı. Çalıştır’a basın.', 'Alt panelde Seri sekmesinde “LED yandi/sondu” çıktısını izleyin.', 'Osiloskopta D13 düğümünü seçin; GPIO sekmesinde pin akımını/gerilimini görün.'],
    expected: 'HIGH iken Vpin ≈ 5 V − 40 Ω·I ≈ 4.8 V, LED akımı ≈ (4.8 − 1.9)/220 ≈ 13 mA',
  },
  {
    id: 'mcu_button', level: 'mcu', title: 'MCU: Buton → LED (INPUT_PULLUP)', titleEn: 'MCU: Button → LED', build: mcuButton, speed: 1,
    summary: 'D2 dahili pull-up ile buton okur, D13’teki LED’i sürer.',
    steps: ['Çalıştır’a basın.', 'SW1’e çift tıklayıp butonu basılı yapın: D2 LOW olur, LED yanar.', 'GPIO sekmesinde D2 modunun pullup olduğunu görün.'],
    expected: 'Buton açıkken D2 ≈ 5 V (35 kΩ pull-up), basılıyken ≈ 0 V',
  },
  {
    id: 'mcu_pot_pwm', level: 'mcu', title: 'MCU: Potansiyometre → ADC → PWM LED', titleEn: 'MCU: Pot → ADC → PWM LED', build: mcuPotPwm, speed: 0.02,
    summary: 'A0 analogRead (10 bit) → map → analogWrite(D9) (~490 Hz PWM).',
    steps: ['Çalıştır’a basın.', 'Seri sekmesinde ADC ve PWM değerlerini izleyin; Seri çizici’yi açın.', 'RV1 konumunu Inspector’dan değiştirin; osiloskopta D9 PWM’ini izleyin.'],
    expected: 'pos=0.3 → wiper = 5 V × 0.7 = 3.5 V, ADC ≈ 716, duty ≈ %70',
  },
  {
    id: 'esp32_mosfet', level: 'mcu', title: 'MCU: ESP32 GPIO → MOSFET → yük', titleEn: 'MCU: ESP32 GPIO → MOSFET load', build: esp32Mosfet, speed: 1,
    summary: 'ESP32 GPIO26 (3.3 V) 100 Ω ile mantık seviyeli MOSFET gate’ini sürer; 12 V / 12 Ω yük (motor modeli yok, yük direnci). 2 s açık / 3 s kapalı.',
    steps: ['Hız 1; Çalıştır. Osiloskopta gate ve drain düğümlerini izleyin.', 'Q1’i “standart gate” MOSFET ile değiştirin: 3.3 V gate tam iletime geçer mi?', 'GPIO sekmesinde pin akımına bakın.'],
    expected: 'GPIO HIGH: VGS ≈ 3.3 V → VDS küçük, yük akımı ≈ 1 A; GPIO akımı ≈ 0 (gate kapasitesi modellenmedi)',
  },
  {
    id: 'esp32_5v', level: 'ariza', title: 'Arıza: ESP32 pinine 5 V', titleEn: 'Fault: 5 V on ESP32 GPIO', build: esp32Overvoltage, speed: 1,
    summary: 'ESP32 GPIO4 pini 3.3 V mantıklıdır ve 5 V’a dayanıklı değildir; burada 1 kΩ üzerinden 5 V uygulanıyor.',
    steps: ['Çalıştır’a basın (Hasar uygula açık).', 'Arızalar sekmesinde GPIO gerilimi aşımı raporunu ve çözüm önerisini (bölücü/seviye dönüştürücü) okuyun.', 'Seri sekmesinde okunan değere bakın.'],
    expected: 'Pin gerilimi 5 V > VDD+0.3 V (3.6 V) → uyarı; ≥ VDD+1.5 V (4.8 V) → pin hasarlı (açık) sayılır',
  },
  {
    id: 'rlc-rezonans', level: 'orta', title: 'Seri RLC rezonansı', titleEn: 'Series RLC resonance', build: rlcResonance,
    summary: '1 V sinüs kaynak, L = 10 mH, C = 1 µF ve R = 10 Ω seri bağlı. R üzerindeki gerilim rezonansta kaynağa eşitlenir; bant geçiren bir süzgeç oluşur.',
    steps: ['Cihazlar → Frekans yanıtı aracını açın; kaynak olarak V1’i, ölçüm düğümü olarak R1’in üst ucunu (R1.1) seçin.', '100 Hz – 20 kHz aralığında tarayın: tepe frekansını ve −3 dB bant genişliğini okuyun.', 'R1’i 100 Ω yapıp tekrar tarayın: Q düşer, bant genişler.'],
    expected: 'f0 = 1/(2π√(LC)) ≈ 1.59 kHz, Q = (1/R)·√(L/C) ≈ 10, BW ≈ f0/Q ≈ 160 Hz; rezonansta |VR/V1| = 1',
  },
  {
    id: 'ce-yukselec', level: 'orta', title: 'Ortak emetörlü transistör yükselteci', titleEn: 'Common-emitter BJT amplifier', build: ceAmplifier, speed: 0.01,
    summary: 'Gerilim bölücü ile kutuplanan (47 k / 10 k) NPN, RC = 2.2 kΩ, RE = 1 kΩ + CE = 1 mF baypas, CIN = 10 µF. Girişe 10 mV / 1 kHz verilir; kolektörde ters fazlı yükseltilmiş sinyal görülür.',
    steps: ['DC çöz: Q1 için Ic ve Vce’yi okuyun (aktif bölgede olmalı).', 'Cihazlar → Frekans yanıtı: kaynak VS, ölçüm düğümleri Q1.C ve Q1.B; orta bant kazancı Q1.C / Q1.B oranıdır.', 'Çalıştır (hız 0.01): osiloskopta Q1.B ve Q1.C’yi birlikte izleyin; CE’yi çıkarın: kazanç neden düşer?'],
    expected: 'Ic ≈ 1.4 mA, gm = Ic/Vt ≈ 54 mS; |Av| ≈ gm·RC ≈ 120 (CE ile), 180° faz farkı; CE olmadan Av ≈ −RC/RE ≈ −2',
  },
  {
    id: 'dc-motor-kalkis', level: 'orta', title: 'DC motor kalkış akımı', titleEn: 'DC motor start-up current', build: dcMotorStart, speed: 0.02,
    summary: '6 V kaynak ve fırçalı DC motor (R = 3 Ω, ke = 4.5 mV·s/rad). Dururken ters EMK yoktur: kalkış akımı ≈ V/R; hızlanınca ters EMK akımı düşürür.',
    steps: ['Hız 0.02; Çalıştır’a basın.', 'Osiloskopta motor akımını (M1) izleyin: ≈ 2 A’den ≈ 0.1 A’e iner. Ölçümler sekmesinde devir/dakikayı okuyun.', 'Arızalar: M1’e “sıkışmış rotor (stalled)” arızası verin — akım V/R = 2 A’de kalır ve motor aşırı akımla zorlanır.'],
    expected: 'Kalkışta I ≈ 6/3 = 2 A; kararlı hâlde I = V/(R + ke²/B) ≈ 0.1 A, ω ≈ 1300 rad/s (≈ 12 000 dev/dk); sıkışmışta I = 2 A',
  },
  {
    id: 'role-flyback', level: 'orta', title: 'Röle sürme ve flyback diyodu', titleEn: 'Relay drive and flyback diode', build: () => relayFlyback(true), speed: 0.02,
    summary: '5 V röle bobini mantık seviyeli MOSFET ile 5 Hz kare dalgayla sürülür; NO kontağı 12 V’tan 100 Ω yükü besler. D1 bobine paralel flyback diyodudur: MOSFET kapanınca bobin akımına yol verir.',
    steps: ['Hız 0.02; Çalıştır. Osiloskopta Q1 drain’ini ve RL’yi izleyin: röle ≈ 10 ms gecikmeyle yükü bağlar.', 'D1’i silin ve tekrar çalıştırın: drain gerilimi kapanışta onlarca/yüzlerce volta fırlar (MOSFET ve sürücü için tehlikeli).', 'D1’i geri koyun: drain tepe değeri ≈ 5 V + 0.7 V ile sınırlanır.'],
    expected: 'Diyotlu: Vdrain,max ≈ 5.7 V; diyotsuz: L·di/dt yüzünden ≫ 10 V (ideal modelde sınırlayan eleman yok). Yük akımı ≈ 0.12 A',
  },
  {
    id: 'h-kopru-motor', level: 'orta', title: 'H-köprü ile motor yönü', titleEn: 'H-bridge motor direction', build: hBridgeMotor, speed: 0.05, heavy: true,
    summary: '4 mantık seviyeli MOSFET’ten H-köprü; motor orta noktalar arasında. Her MOSFET’in G–S arasında yüzen ideal kapı sürücüsü (kare dalga, 2 Hz) vardır; Q1+Q4 ve Q2+Q3 ters fazlı çalışır: önce ileri, sonra geri.',
    steps: ['Hız 0.05; Çalıştır.', 'Osiloskopta M1 gerilimini ve akımını izleyin: ilk 250 ms pozitif, sonraki 250 ms negatif.', 'G1’in genliğini 0 yapın (Q1 kapalı): ileri yön kaybolur. Not: model ölü zaman içermez; gerçek sürücüde şarttır.'],
    expected: 'İleri fazda VM ≈ +6 V, i ≈ +0.1 A (kararlı); geri fazda VM ≈ −6 V, i ≈ −0.1 A; geçişte motor frenlenip ters yönde hızlanır',
  },
  {
    id: 'boost-donusturucu', level: 'orta', title: 'Boost (yükseltici) dönüştürücü', titleEn: 'Boost converter', build: boostConverter, speed: 0.0005, heavy: true,
    summary: '5 V → ≈ 9–10 V: L = 220 µH, düşük taraf MOSFET (50 kHz, D = %50, ideal kapı sürücüsü), SB560 diyot, 47 µF çıkış kondansatörü, 100 Ω yük.',
    steps: ['Hız çarpanını çok düşük (0.0005) tutup Çalıştır; osiloskopta çıkış (C1) düğümünü izleyin.', 'V2 duty değerini %30 ve %60 yapın: Vout = Vin/(1 − D) kuralını gözleyin.', 'RL’yi 20 Ω yapın: akım artar, ripple ve düşüm büyür.'],
    expected: 'Vout ≈ Vin/(1 − D) = 10 V; diyot/MOSFET düşümleri ve yük nedeniyle ≈ 8.5–9.5 V; ripple küçük. Anahtarlama kaybı ve kapı sürücü kaybı modellenmez',
  },
  {
    id: 'ac-dc-adaptor', level: 'orta', title: 'AC-DC adaptör (trafo + köprü + filtre)', titleEn: 'AC-DC adapter (transformer + bridge + filter)', build: acDcAdaptor, speed: 0.01, heavy: true,
    summary: 'DİKKAT: Bu yalnızca sanal bir simülasyondur; gerçek şebeke gerilimi (230 V) ölümcüldür, gerçek devreyi bu bilgiyle kurmayın. 230 V / 50 Hz (325 V tepe) → 10:1 transformatör → DB107 köprü → 1000 µF → 100 Ω.',
    steps: ['Hız 0.01; Çalıştır. Osiloskopta sekonder (TR1.S1) ve çıkış (C1) düğümlerini izleyin.', 'C1’i 100 µF yapın: ripple nasıl büyür?', 'RL’yi 20 Ω yapın: çıkış gerilimi düşer, trafo ve köprü akımı artar.'],
    expected: 'Sekonder ≈ 22.6 V rms (31.9 V tepe); çıkış DC ≈ 26–29 V, ripple ≈ I/(2·f·C) ≈ 3 V pp; köprüde 2 diyot düşümü (≈ 2 V)',
  },
];
