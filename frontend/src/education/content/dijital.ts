import { CircuitBuilder } from '../../core/circuit/builder';
import type { Circuit, Firmware } from '../../core/circuit/types';
import type { Lesson } from '../types';

/**
 * Dijital ve mikrodenetleyici parkuru.
 * Test notu: derslerin "expects" ölçümleri firmware ÇALIŞTIRILMADAN DC çözümle doğrulanır; bu çözümde GPIO pinleri yüksek empedanslıdır.
 * Bu yüzden beklenen değerler firmware'den bağımsız pasif parçalar (pull-up, bölücü, 5V pini ...) ve "eşdeğer devre" kollarıdır.
 * Firmware kaynaklı zamanlama/davranış doğrulamaları dijital.test.ts içindedir.
 */

const fw = (source: string): Record<string, Firmware> => ({ U1: { kind: 'sketch', source } });
const uno = (b: CircuitBuilder) => b.add('mod_arduino_uno_r3', {}, 0, 0, 0, 'U1');
const esp = (b: CircuitBuilder) => b.add('mod_esp32_devkit_v1', {}, 0, 0, 0, 'U1');

// ------------------------------------------------------------------ firmware kaynakları (export: dijital.test.ts kullanır)
export const CODE_01 = `// Üç farklı giriş biçimi: dış pull-up (D2), dış pull-down (D3), dahili pull-up (D4).
void setup() {
  Serial.begin(115200);
  pinMode(2, INPUT);          // dış 10k pull-up var
  pinMode(3, INPUT);          // dış 10k pull-down var
  pinMode(4, INPUT_PULLUP);   // dahili ~35k pull-up
}

void loop() {
  Serial.print("D2=");
  Serial.print(digitalRead(2));
  Serial.print(" D3=");
  Serial.print(digitalRead(3));
  Serial.print(" D4=");
  Serial.println(digitalRead(4));
  delay(500);
}
`;

export const CODE_02 = `// D13 -> 220 ohm -> LED. HIGH iken akım ~ (5 - Vf) / (220 + ~40) olur.
const int LED = 13;

void setup() {
  pinMode(LED, OUTPUT);
  Serial.begin(115200);
  Serial.println("LED akim sinirlama: R = 220 ohm");
}

void loop() {
  digitalWrite(LED, HIGH);
  Serial.println("D13 = HIGH");
  delay(500);
  digitalWrite(LED, LOW);
  Serial.println("D13 = LOW");
  delay(500);
}
`;

export const CODE_03 = `// Buton D2 ile GND arasında, INPUT_PULLUP: basılı = LOW (active-low).
// Her basışta LED durumu değişir (kenar algılama).
const int BTN = 2;
const int LED = 13;
bool ledOn = false;
int last = HIGH;

void setup() {
  pinMode(BTN, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
  Serial.begin(115200);
  delay(10);                 // pull-up'ın oturması için kısa bekleme
  last = digitalRead(BTN);   // başlangıç durumunu oku (sahte basış önlenir)
}

void loop() {
  int now = digitalRead(BTN);
  if (last == HIGH && now == LOW) {
    ledOn = !ledOn;
    if (ledOn) {
      digitalWrite(LED, HIGH);
      Serial.println("LED ACIK");
    } else {
      digitalWrite(LED, LOW);
      Serial.println("LED KAPALI");
    }
    delay(20);   // basit sicrama (debounce) beklemesi
  }
  last = now;
}
`;

export const CODE_04 = `// A0: potansiyometre, A1: sabit gerilim bölücü. 10 bit ADC, Vref = 5 V.
void setup() {
  Serial.begin(115200);
}

void loop() {
  int a0 = analogRead(A0);
  int a1 = analogRead(A1);
  float v0 = a0 * 5.0 / 1023.0;
  float v1 = a1 * 5.0 / 1023.0;
  Serial.print("A0 ADC=");
  Serial.print(a0);
  Serial.print(" V=");
  Serial.print(v0, 3);
  Serial.print("  A1 ADC=");
  Serial.print(a1);
  Serial.print(" V=");
  Serial.println(v1, 3);
  delay(500);
}
`;

export const CODE_05 = `// Potansiyometre -> ADC -> PWM (D9, ~490 Hz). Ortalama gerilim = duty * 5 V.
void setup() {
  pinMode(9, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  int value = analogRead(A0);              // 0..1023
  int duty = map(value, 0, 1023, 0, 255);  // 0..255
  analogWrite(9, duty);
  Serial.print("ADC=");
  Serial.print(value);
  Serial.print(" PWM=");
  Serial.println(duty);
  delay(100);
}
`;

export const CODE_06 = `// ESP32: GPIO26 yalnızca MOSFET kapısını sürer (akım < 1 mA), yük 12 V hattından beslenir.
const int GATE = 26;

void setup() {
  pinMode(GATE, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  digitalWrite(GATE, HIGH);
  Serial.println("YUK ACIK");
  delay(1000);
  digitalWrite(GATE, LOW);
  Serial.println("YUK KAPALI");
  delay(1000);
}
`;

export const CODE_07 = `// ESP32 GPIO4 girişi: 5 V sinyal 1.8k/3.3k bölücüyle ~3.2 V'a indirilmiştir.
void setup() {
  pinMode(4, INPUT);
  Serial.begin(115200);
}

void loop() {
  Serial.print("GPIO4 = ");
  Serial.println(digitalRead(4));
  delay(500);
}
`;

export const CODE_08 = `// delay() kullanmadan: iki LED farklı hızda yanıp söner, buton her an okunur.
const int LED1 = 13;
const int LED2 = 8;
const int BTN = 2;           // dış 10k pull-up, basılı = LOW
unsigned long last1 = 0;
unsigned long last2 = 0;
bool s1 = false;
bool s2 = false;
int prev = HIGH;
int presses = 0;

void setup() {
  pinMode(LED1, OUTPUT);
  pinMode(LED2, OUTPUT);
  pinMode(BTN, INPUT);
  Serial.begin(115200);
  Serial.println("basladi");
}

void loop() {
  unsigned long now = millis();
  if (now - last1 >= 500) {
    last1 = now;
    s1 = !s1;
    if (s1) { digitalWrite(LED1, HIGH); } else { digitalWrite(LED1, LOW); }
  }
  if (now - last2 >= 150) {
    last2 = now;
    s2 = !s2;
    if (s2) { digitalWrite(LED2, HIGH); } else { digitalWrite(LED2, LOW); }
  }
  int b = digitalRead(BTN);
  if (prev == HIGH && b == LOW) {
    presses++;
    Serial.print("buton basildi #");
    Serial.print(presses);
    Serial.print(" t=");
    Serial.println(now);
  }
  prev = b;
}
`;

// ------------------------------------------------------------------ devreler (export: dijital.test.ts)
export const build01 = (): Circuit => {
  const b = new CircuitBuilder();
  uno(b);
  // D2: dış pull-up + GND'ye buton (active-low)
  b.add('resistor', { r: 10000 }, 9, -9, 0, 'R1');
  b.add('button', { closed: false }, 13, -6, 0, 'SW1');
  // D3: dış pull-down + 5V'a buton (active-high)
  b.add('resistor', { r: 10000 }, 9, 6, 0, 'R2');
  b.add('button', { closed: false }, 13, 3, 0, 'SW2');
  // D4: dahili pull-up, yalnızca buton
  b.add('button', { closed: false }, 13, 9, 0, 'SW3');
  b.add('ground', {}, 9, 12);
  b.chain('U1.5V', 'R1.1'); b.chain('R1.2', 'U1.D2'); b.chain('U1.D2', 'SW1.1'); b.chain('SW1.2', 'GND1.G');
  b.chain('U1.5V', 'SW2.1'); b.chain('SW2.2', 'U1.D3'); b.chain('U1.D3', 'R2.1'); b.chain('R2.2', 'GND1.G');
  b.chain('U1.D4', 'SW3.1'); b.chain('SW3.2', 'GND1.G'); b.chain('U1.GND', 'GND1.G');
  return { ...b.circuit, firmware: fw(CODE_01) };
};

export const build02 = (): Circuit => {
  const b = new CircuitBuilder();
  uno(b);
  b.add('resistor', { r: 220 }, 9, -4, 0, 'R1');
  b.add('led', { color: 'red' }, 13, -2, 0, 'D1');
  // Eşdeğer devre: D13 = HIGH iken pinin Thevenin modeli (5 V + ~40 ohm) ile aynı kol
  b.add('resistor', { r: 40 }, 9, 5, 0, 'R2');
  b.add('resistor', { r: 220 }, 13, 5, 0, 'R3');
  b.add('led', { color: 'red' }, 17, 5, 0, 'D2');
  b.add('ground', {}, 9, 9);
  b.chain('U1.D13/SCK', 'R1.1'); b.chain('R1.2', 'D1.A'); b.chain('D1.K', 'GND1.G'); b.chain('U1.GND', 'GND1.G');
  b.chain('U1.5V', 'R2.1'); b.chain('R2.2', 'R3.1'); b.chain('R3.2', 'D2.A'); b.chain('D2.K', 'GND1.G');
  return { ...b.circuit, firmware: fw(CODE_02) };
};

export const build03 = (): Circuit => {
  const b = new CircuitBuilder();
  uno(b);
  b.add('button', { closed: false }, 9, 0, 0, 'SW1');
  b.add('resistor', { r: 220 }, 9, -4, 0, 'R1');
  b.add('led', { color: 'green' }, 13, -2, 0, 'D1');
  // Eşdeğer devre: dahili pull-up (~35 kΩ) + BASILI buton
  b.add('resistor', { r: 35000 }, 9, 6, 0, 'R2');
  b.add('button', { closed: true }, 13, 6, 0, 'SW2');
  b.add('ground', {}, 9, 10);
  b.chain('U1.D2', 'SW1.1'); b.chain('SW1.2', 'GND1.G'); b.chain('U1.GND', 'GND1.G');
  b.chain('U1.D13/SCK', 'R1.1'); b.chain('R1.2', 'D1.A'); b.chain('D1.K', 'GND1.G');
  b.chain('U1.5V', 'R2.1'); b.chain('R2.2', 'SW2.1'); b.chain('SW2.2', 'GND1.G');
  return { ...b.circuit, firmware: fw(CODE_03) };
};

export const build04 = (): Circuit => {
  const b = new CircuitBuilder();
  uno(b);
  b.add('pot', { r: 10000, pos: 0.7 }, 9, 2, 0, 'RV1');
  b.add('resistor', { r: 10000 }, 9, 7, 0, 'R1');
  b.add('resistor', { r: 4700 }, 9, 11, 0, 'R2');
  b.add('ground', {}, 13, 8);
  b.chain('U1.5V', 'RV1.A'); b.chain('RV1.W', 'U1.A0'); b.chain('RV1.B', 'GND1.G'); b.chain('U1.GND', 'GND1.G');
  b.chain('U1.5V', 'R1.1'); b.chain('R1.2', 'U1.A1'); b.chain('U1.A1', 'R2.1'); b.chain('R2.2', 'GND1.G');
  return { ...b.circuit, firmware: fw(CODE_04) };
};

export const build05 = (): Circuit => {
  const b = new CircuitBuilder();
  uno(b);
  b.add('pot', { r: 10000, pos: 0.7 }, 9, 2, 0, 'RV1');
  b.add('resistor', { r: 220 }, 9, -4, 0, 'R1');
  b.add('led', { color: 'yellow' }, 13, -2, 0, 'D1');
  // Eşdeğer devre: %30 doluluklu 490 Hz kare dalga + RC alçak geçiren süzgeç -> ortalama gerilim
  b.add('signal_gen', { wave: 'square', v: 2.5, amp: 2.5, freq: 490, duty: 30 }, 9, 9, 0, 'V2');
  b.add('resistor', { r: 1000 }, 13, 9, 0, 'R2');
  b.add('capacitor', { c: 10e-6, vmax: 50 }, 17, 11, 1, 'C1');
  b.add('ground', {}, 13, 14);
  b.chain('U1.5V', 'RV1.A'); b.chain('RV1.W', 'U1.A0'); b.chain('RV1.B', 'GND1.G'); b.chain('U1.GND', 'GND1.G');
  b.chain('U1.D9', 'R1.1'); b.chain('R1.2', 'D1.A'); b.chain('D1.K', 'GND1.G');
  b.chain('V2.P', 'R2.1'); b.chain('R2.2', 'C1.1'); b.chain('C1.2', 'GND1.G'); b.chain('V2.N', 'GND1.G');
  return { ...b.circuit, firmware: fw(CODE_05) };
};

export const build06 = (): Circuit => {
  const b = new CircuitBuilder();
  esp(b);
  b.add('resistor', { r: 100 }, 8, 4, 0, 'R1');
  b.add('resistor', { r: 10000 }, 8, 7, 0, 'R2');
  b.add('nmos_logic', {}, 12, 4, 0, 'Q1');
  b.add('dc_supply', { v: 12 }, 16, -2, 0, 'V1');
  b.add('resistor', { r: 12, pmax: 25 }, 12, -2, 1, 'RL');
  // Eşdeğer devre A: GPIO = HIGH (3.3 V, ~30 ohm) kapı direnciyle MOSFET'i sürer
  b.add('dc_supply', { v: 3.3 }, 22, 6, 0, 'V2');
  b.add('resistor', { r: 130 }, 26, 6, 0, 'RG2');
  b.add('nmos_logic', {}, 30, 6, 0, 'Q2');
  b.add('resistor', { r: 12, pmax: 25 }, 30, 0, 1, 'RL2');
  // Eşdeğer devre B: yük GPIO'ya doğrudan bağlı (30 ohm çıkış direnci + 12 ohm yük)
  b.add('resistor', { r: 30 }, 22, 12, 0, 'RO');
  b.add('resistor', { r: 12 }, 26, 12, 0, 'RLD');
  b.add('ground', {}, 12, 10);
  b.chain('U1.D26', 'R1.1'); b.chain('R1.2', 'Q1.G'); b.chain('Q1.G', 'R2.1'); b.chain('R2.2', 'GND1.G');
  b.chain('V1.P', 'RL.1'); b.chain('RL.2', 'Q1.D'); b.chain('Q1.S', 'GND1.G'); b.chain('V1.N', 'GND1.G'); b.chain('U1.GND', 'GND1.G');
  b.chain('V2.P', 'RG2.1'); b.chain('RG2.2', 'Q2.G'); b.chain('V1.P', 'RL2.1'); b.chain('RL2.2', 'Q2.D'); b.chain('Q2.S', 'GND1.G'); b.chain('V2.N', 'GND1.G');
  b.chain('V2.P', 'RO.1'); b.chain('RO.2', 'RLD.1'); b.chain('RLD.2', 'GND1.G');
  return { ...b.circuit, firmware: fw(CODE_06) };
};

export const build07 = (): Circuit => {
  const b = new CircuitBuilder();
  esp(b);
  b.add('dc_supply', { v: 5 }, 12, -3, 0, 'V1');
  b.add('resistor', { r: 1800 }, 12, 1, 0, 'R1');
  b.add('resistor', { r: 3300 }, 16, 5, 1, 'R2');
  b.add('ground', {}, 12, 9);
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'U1.D4'); b.chain('R1.2', 'R2.1'); b.chain('R2.2', 'GND1.G');
  b.chain('V1.N', 'GND1.G'); b.chain('U1.GND', 'GND1.G');
  return { ...b.circuit, firmware: fw(CODE_07) };
};

export const build08 = (): Circuit => {
  const b = new CircuitBuilder();
  uno(b);
  b.add('resistor', { r: 330 }, 9, -6, 0, 'R1');
  b.add('led', { color: 'red' }, 13, -4, 0, 'D1');
  b.add('resistor', { r: 330 }, 9, -1, 0, 'R2');
  b.add('led', { color: 'green' }, 13, 1, 0, 'D2');
  b.add('resistor', { r: 10000 }, 9, 5, 0, 'R3');
  b.add('button', { closed: false }, 13, 8, 0, 'SW1');
  b.add('ground', {}, 9, 11);
  b.chain('U1.D13/SCK', 'R1.1'); b.chain('R1.2', 'D1.A'); b.chain('D1.K', 'GND1.G');
  b.chain('U1.D8', 'R2.1'); b.chain('R2.2', 'D2.A'); b.chain('D2.K', 'GND1.G');
  b.chain('U1.5V', 'R3.1'); b.chain('R3.2', 'U1.D2'); b.chain('U1.D2', 'SW1.1'); b.chain('SW1.2', 'GND1.G'); b.chain('U1.GND', 'GND1.G');
  return { ...b.circuit, firmware: fw(CODE_08) };
};

// ------------------------------------------------------------------ challenge devreleri
const ledChallenge = (rSeries: number): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 5 }, -6, 0, 0, 'V1');
  b.add('resistor', { r: 40 }, -2, -3, 0, 'R0');      // GPIO çıkış direnci modeli (değiştirmeyin)
  b.add('resistor', { r: rSeries }, 2, -3, 0, 'R1');  // sizin seri dirençiniz
  b.add('led', { color: 'red' }, 6, -3, 0, 'D1');
  b.add('ground', {}, 0, 4);
  b.chain('V1.P', 'R0.1'); b.chain('R0.2', 'R1.1'); b.chain('R1.2', 'D1.A'); b.chain('D1.K', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
};

const adcChallenge = (r1: number, r2: number): Circuit => {
  const b = new CircuitBuilder();
  uno(b);
  b.add('resistor', { r: r1 }, 9, 0, 0, 'R1');
  b.add('resistor', { r: r2 }, 9, 4, 0, 'R2');
  b.add('ground', {}, 13, 4);
  b.chain('U1.5V', 'R1.1'); b.chain('R1.2', 'U1.A0'); b.chain('U1.A0', 'R2.1'); b.chain('R2.2', 'GND1.G'); b.chain('U1.GND', 'GND1.G');
  return b.circuit;
};

const driveChallenge = (withMosfet: boolean): Circuit => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 3.3 }, -8, 4, 0, 'V2');          // GPIO = HIGH (3.3 V)
  b.add('resistor', { r: 30 }, -4, 4, 0, 'RG');             // GPIO çıkış direnci: bu dirençten geçen akım pinin akımıdır
  b.add('resistor', { r: 12, pmax: 25 }, 6, -2, 1, 'RL');   // 12 V / 1 A yük
  b.add('ground', {}, 0, 10);
  b.chain('V2.N', 'GND1.G');
  b.chain('V2.P', 'RG.1');
  if (!withMosfet) {
    b.chain('RG.2', 'RL.1'); b.chain('RL.2', 'GND1.G');
  } else {
    b.add('dc_supply', { v: 12 }, 10, -4, 0, 'V1');
    b.add('resistor', { r: 100 }, 0, 4, 0, 'RB');
    b.add('nmos_logic', {}, 4, 4, 0, 'Q1');
    b.chain('RG.2', 'RB.1'); b.chain('RB.2', 'Q1.G'); b.chain('V1.P', 'RL.1'); b.chain('RL.2', 'Q1.D'); b.chain('Q1.S', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  }
  return b.circuit;
};

const levelChallenge = (divider: boolean): Circuit => {
  const b = new CircuitBuilder();
  esp(b);
  b.add('dc_supply', { v: 5 }, 12, -3, 0, 'V1');
  b.add('resistor', { r: divider ? 1800 : 1000 }, 12, 1, 0, 'R1');
  b.add('ground', {}, 12, 9);
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'U1.D4'); b.chain('V1.N', 'GND1.G'); b.chain('U1.GND', 'GND1.G');
  if (divider) { b.add('resistor', { r: 3300 }, 16, 5, 1, 'R2'); b.chain('R1.2', 'R2.1'); b.chain('R2.2', 'GND1.G'); }
  return b.circuit;
};

const TRAN_MEAN = { stop: 0.3, dt: 20e-6, stat: 'mean' as const, skip: 0.6 };

// ------------------------------------------------------------------ dersler
export const DIJITAL: Lesson[] = [
  // =============================================================== 1
  {
    id: 'dijital-01-mantik-seviyeleri', track: 'dijital', level: 'baslangic', minutes: 18,
    title: 'Dijital sinyal, mantık seviyeleri ve pull-up / pull-down',
    summary: 'Bir giriş pininin HIGH/LOW okuması için gerilimin tanımlı olması gerekir. Buton + direnç ile pull-up/pull-down kurar, "floating" girişin neden rastgele okunduğunu görürsünüz.',
    objectives: [
      'HIGH ve LOW mantık seviyelerini eşik gerilimleriyle (VIL/VIH) tanımlamak.',
      'Pull-up ve pull-down direncinin görevini ve tipik değerini (4.7–47 kΩ) açıklamak.',
      'Floating (açıkta kalan) girişin neden belirsiz okunduğunu açıklamak.',
      'Arduino Uno INPUT_PULLUP modunun dahili ~35 kΩ pull-up ile eşdeğer olduğunu ve okumanın "active-low" çıktığını bilmek.',
    ],
    theory: [
      { t: 'p', text: 'Dijital devrede sinyal sürekli değil iki "seviye" olarak yorumlanır. Mikrodenetleyici girişi gerilimi bir eşikle karşılaştırır: VIL altı LOW, VIH üstü HIGH sayılır; arası belirsiz bölgedir. Arduino Uno (5 V, ATmega328P) için yaklaşık VIL ≤ 0.3·VCC = 1.5 V, VIH ≥ 0.6·VCC = 3 V; ESP32/Pico (3.3 V) için VIH ≈ 0.75·VCC ≈ 2.5 V civarıdır.' },
      { t: 'formula', text: 'LOW: V ≤ VIL     HIGH: V ≥ VIH     VIL < V < VIH → belirsiz', note: 'Uno: VIL ≈ 1.5 V, VIH ≈ 3 V (VCC = 5 V)' },
      { t: 'p', text: 'Buton yalnızca "kısa devre" veya "açık devre" yapar; açıkken pin hiçbir şeye bağlı değildir (floating). Giriş pininin empedansı çok yüksektir (MΩ mertebesi), bu yüzden komşu iletkenlerden, elinizden, hatta ortam gürültüsünden kapasitif olarak gerilim kapar ve rastgele HIGH/LOW okur.' },
      { t: 'p', text: 'Çözüm: pini bir dirençle bilinen bir seviyeye "çekmek". Pull-up: VCC–direnç–pin, buton pin–GND; açıkken pin HIGH, basılınca LOW. Pull-down: pin–direnç–GND, buton VCC–pin; açıkken LOW, basılınca HIGH. Direnç yeterince büyük seçilir ki basılıyken akan akım (VCC/R) küçük kalsın, ama gürültüyü bastıracak kadar küçük olsun (tipik 10 kΩ).' },
      { t: 'formula', text: 'I_basılı = VCC / R_pull = 5 V / 10 kΩ = 0.5 mA', note: 'Pull-up buton basılıyken dirençten GND\'ye akan akım' },
      { t: 'p', text: 'Arduino Uno\'da pinMode(pin, INPUT_PULLUP) ATmega\'nın içindeki ~20–50 kΩ\'luk pull-up\'ı açar (simülatörde 35 kΩ). Dış direnç gerekmez; buton doğrudan pin–GND arasına konur. Sonuç tersine çalışır: basılı = LOW, bırakılı = HIGH (active-low).' },
      { t: 'warn', text: 'ESP32\'de GPIO34/35/36/39 pinlerinde dahili pull-up/pull-down yoktur; bunlarda dış direnç şarttır. Simülatör sınırı: GPIO modeli yaklaşıktır (giriş = yüksek empedans, pull-up = 35 kΩ Thevenin kolu); bu derste firmware çalışmadan yapılan DC testte pinler yüksek empedanslı kabul edilir.' },
    ],
    calc: [
      { title: 'Pull-up bölücüsü (buton açık)', formula: 'V_pin = VCC − I·R,  I ≈ 0', working: 'Giriş akımı ~nA → R üzerinde düşüm yok → V_pin ≈ 5 V → HIGH' },
      { title: 'Buton basılı', formula: 'V_pin = VCC · R_buton / (R_pull + R_buton)', working: 'R_buton ≈ 1 mΩ → V_pin ≈ 5·0.001/10000 ≈ 0.5 µV ≈ 0 V → LOW; I = 5/10 kΩ = 0.5 mA' },
      { title: 'Dahili pull-up (35 kΩ)', formula: 'I = VCC / R_dahili', working: '5 V / 35 kΩ = 143 µA basılıyken pinden akar' },
    ],
    build: build01,
    steps: [
      'Hız ayarı! Bu derste zamana duyarlı bir şey yok; hız çarpanını 1 bırakın.',
      'Çalıştır\'a basın. Kod sekmesinde sketch\'i, Seri sekmesinde her 500 ms\'de "D2=1 D3=0 D4=1" çıktısını izleyin.',
      'GPIO sekmesinde D2 (INPUT), D3 (INPUT) ve D4\'ün (INPUT_PULLUP, "pullup") modlarını inceleyin.',
      'SW1\'e çift tıklayın (basılı): D2 okuması 0\'a düşer. SW2 ve SW3 ile aynısını deneyin; D3 basılınca 1, D4 basılınca 0 olur.',
      'Inspector → Arıza laboratuvarı ile R1\'i "açık devre" yapın: D2 artık floating kalır, SW1 bırakılıyken değer belirsizleşir.',
      'Kodu değiştirdikten sonra Yükle ile yeni sketch\'i kartla çalıştırın (ör. D2 için INPUT_PULLUP deneyin).',
    ],
    expects: [
      { label: 'D2 düğümü (R1 pull-up, buton açık)', probe: { q: 'node', comp: 'U1', pin: 'D2' }, value: 5, unit: 'V' },
      { label: 'D3 düğümü (R2 pull-down, buton açık)', probe: { q: 'node', comp: 'U1', pin: 'D3' }, value: 0, tol: { abs: 0.01 }, unit: 'V' },
      { label: 'Buton açıkken pull-up akımı', probe: { q: 'i', comp: 'R1' }, value: 0, tol: { abs: 1e-6 }, unit: 'A' },
    ],
    mistakes: [
      'Pull-up/pull-down koymadan butonu doğrudan pine bağlamak: buton açıkken pin floating kalır, okuma rastgeledir.',
      'Pull-up direncini çok küçük seçmek (ör. 100 Ω): basılıyken 50 mA akar, gereksiz ısınır ve kaynak yüklenir.',
      'INPUT_PULLUP kullanıp "basılı = HIGH" varsaymak: dahili pull-up ile mantık ters çalışır (basılı = LOW).',
      'Pull-up\'ı 5 V yerine yanlışlıkla 12 V hattına bağlamak: 5 V\'luk GPIO\'yu bozar.',
    ],
    faults: [
      { title: 'R1 (pull-up) açık devre', how: 'Inspector → Arıza → R1 → Açık devre', symptom: 'Buton açıkken D2 hiçbir seviyeye bağlı değildir; okuma belirsizleşir. Basılınca yine LOW olur (buton yolu sağlam).' },
      { title: 'SW1 kaynak (kısa devre)', how: 'Inspector → Arıza → SW1 → Kısa devre', symptom: 'D2 her zaman LOW okunur, buton hiçbir şey değiştirmez; R1\'den sürekli 0.5 mA akar.' },
    ],
    quiz: [
      { id: 'q1', q: 'Dış pull-up ile (10 kΩ, 5 V) buton açıkken pin kaç volt görür?', options: ['0 V', 'Yaklaşık 5 V (HIGH)', '2.5 V', 'Belirsiz (floating)'], answer: 1, explain: 'Giriş yüksek empedanslı olduğundan dirençten akım geçmez, düşüm olmaz; pin VCC\'ye çekilir.' },
      { id: 'q2', q: 'INPUT_PULLUP kullanılan, GND\'ye bağlı butonda basılı iken digitalRead() ne döndürür?', options: ['HIGH', 'LOW', 'Belirsiz', 'Önce HIGH sonra LOW'], answer: 1, explain: 'Buton pini GND\'ye çeker; dahili pull-up zayıf (35 kΩ) kaldığı için LOW okunur (active-low).' },
      { id: 'q3', q: 'Buton basılıyken 10 kΩ pull-up\'tan geçen akım kaç mA\'dır (5 V)?', answer: 0.5, tol: 0.02, unit: 'mA', explain: 'I = V/R = 5 V / 10 kΩ = 0.5 mA.' },
      { id: 'q4', q: 'Floating giriş neden rastgele okunur?', options: ['Kod hatası olduğu için', 'Giriş empedansı çok yüksek olduğundan çevreden gürültü kapar', 'Pin içeride GND\'ye bağlı olduğu için', 'ADC açık kaldığı için'], answer: 1, explain: 'Pini bilinen bir gerilime bağlayan yol yoktur; MΩ mertebesi empedans gürültüyü yakalar.' },
      { id: 'q5', q: 'Uno için 5 V mantıkta HIGH sayılmasının alt sınırı (VIH ≈ 0.6·VCC) yaklaşık kaç volttur?', answer: 3, tol: 0.05, unit: 'V', explain: '0.6 × 5 V = 3 V; bunun altı belirsiz bölge ya da LOW\'dur.' },
    ],
    code: CODE_01,
  },

  // =============================================================== 2
  {
    id: 'dijital-02-dijital-cikis-led', track: 'dijital', level: 'baslangic', minutes: 20,
    prerequisites: ['dijital-01-mantik-seviyeleri'],
    title: 'Dijital çıkış: Arduino ile LED yakmak ve akım sınırı',
    summary: 'digitalWrite(13, HIGH) ile pin 5 V verir ama akım sınırlıdır. GPIO çıkış direncini (~40 Ω), pin başına 20 mA önerilen / 40 mA mutlak sınırı ve seri direnç hesabını öğrenirsiniz.',
    speed: 1,
    objectives: [
      'Çıkış pininin gerilim kaynağı + iç direnç (~40 Ω) olarak modellenebileceğini kavramak.',
      'LED seri direncini R = (VCC − Vf − I·Rpin)/I formülüyle hesaplamak.',
      'ATmega328P için 20 mA önerilen, 40 mA mutlak pin akım sınırını gözeterek akım seçmek.',
      'Direnç değerinin LED akımına ve parlaklığına etkisini ölçmek.',
    ],
    theory: [
      { t: 'p', text: 'pinMode(13, OUTPUT) ve digitalWrite(13, HIGH) pini VCC\'ye (5 V), LOW ise GND\'ye bağlar. Gerçekte bu bağlantı ideal değildir: çıkış transistörünün iç direnci vardır. Datasheet\'teki VOH/VOL–akım eğrilerinden yaklaşık 25–45 Ω çıkarılır; simülatör ATmega328P için 40 Ω kullanır (yaklaşık bir değerdir, ölçüm değildir).' },
      { t: 'formula', text: 'I_LED = (VCC − Vf) / (R_seri + R_pin)', note: 'Uno: VCC = 5 V, R_pin ≈ 40 Ω, kırmızı LED Vf ≈ 1.9–2 V' },
      { t: 'formula', text: 'R_seri = (VCC − Vf) / I_istenen − R_pin', note: '10 mA hedefi için: (5 − 1.95)/0.01 − 40 ≈ 265 Ω → 270 Ω (E12)' },
      { t: 'p', text: 'LED\'in akım–gerilim eğrisi diyot eğrisidir: Vf yaklaşık sabit kalır, akım dirençle belirlenir. Dirençsiz bağlarsanız akımı sadece 40 Ω sınırlar: (5−2)/40 ≈ 75 mA, pinin 40 mA mutlak sınırını aşar; pin ve/veya LED ölür.' },
      { t: 'warn', text: 'ATmega328P: pin başına 20 mA tasarım hedefi, 40 mA mutlak maksimum; tüm pinlerin toplamı ~200 mA. ESP32 için pin başına 40 mA mutlak, 12 mA civarı güvenli sürüş önerilir; Pico\'da pin başına 12 mA sınırlıdır. Seri direnç LED\'i değil asıl olarak PİNİ korur.' },
      { t: 'p', text: 'Bu derste lab devresinde D13 kolunun yanında, aynı değerlerle "eşdeğer kol" vardır: 5V pini → 40 Ω (GPIO modeli) → 220 Ω → LED. Çözücü firmware olmadan GPIO\'yu yüksek empedans saydığı için ölçümleri bu eşdeğer kolla doğrularız; D13 HIGH iken D1 kolu da aynı akımı çeker.' },
    ],
    calc: [
      { title: 'LED akımı (220 Ω)', formula: 'I = (VCC − Vf)/(R + R_pin)', working: 'Vf ≈ 1.9 V → I = (5 − 1.9)/(220 + 40) = 3.1/260 ≈ 11.9 mA' },
      { title: 'Seri direnç hesabı (10 mA)', formula: 'R = (VCC − Vf)/I − R_pin', working: '(5 − 1.9)/0.010 − 40 = 310 − 40 = 270 Ω' },
      { title: 'Dirençsiz bağlantı', formula: 'I = (VCC − Vf)/R_pin', working: '(5 − 1.9)/40 ≈ 77 mA > 40 mA → pin hasarı' },
    ],
    build: build02,
    steps: [
      'Hız ayarı! Hızı 1 yapın (Blink gerçek zamanda izlenir).',
      'Çalıştır\'a basın. D1 LED\'i 500 ms aralıkla yanıp sönmeli; Seri sekmesinde "D13 = HIGH/LOW" yazıları akar.',
      'Ölçümler sekmesinde D1 akımını (≈ 12 mA) ve eşdeğer kolun D2 akımını karşılaştırın.',
      'GPIO sekmesinde D13 pininin modunu (out) ve seviyesini izleyin.',
      'R1\'i 47 Ω ve 1 kΩ yapın: akım ve parlaklık nasıl değişiyor? 47 Ω\'da pin akımı 20 mA\'yı aşıyor mu?',
      'Kod sekmesinde delay değerlerini değiştirip Yükle ile tekrar yükleyin.',
    ],
    expects: [
      { label: 'Eşdeğer kol (5V → 40 Ω → 220 Ω → LED) akımı', probe: { q: 'i', comp: 'D2' }, value: 0.0119, tol: { rel: 0.06 }, unit: 'A' },
      { label: 'Toplam seri direnç gerilimi (R3 üzerinde)', probe: { q: 'v', comp: 'R3' }, value: 2.62, tol: { rel: 0.06 }, unit: 'V' },
      { label: 'LED gerilimi (Vf)', probe: { q: 'v', comp: 'D2' }, value: 1.9, tol: { rel: 0.08 }, unit: 'V' },
    ],
    mistakes: [
      'LED\'i dirençsiz doğrudan pine bağlamak: akımı yalnızca ~40 Ω sınırlar, pin 40 mA sınırını aşar.',
      'Direnci hesaplarken pin iç direncini unutmak: küçük değerlerde (≈ 100 Ω altı) akım beklenenden düşük/yüksek çıkar.',
      'LED\'i ters bağlamak: anot (A) pine/dirence, katot (K) GND\'ye gelmelidir; ters bağlı LED yanmaz.',
      'Birkaç LED\'i tek pinden paralel sürmek: pin toplam akımı 20–40 mA\'yı geçer.',
    ],
    faults: [
      { title: 'R1 değeri çok küçük (10 Ω)', how: 'Inspector\'dan R1 değerini 10 Ω yapın', symptom: 'D13 HIGH iken akım ≈ (5−1.9)/50 ≈ 62 mA: pin 40 mA sınırını aşar, hasar/aşırı akım uyarısı oluşur.' },
      { title: 'LED açık devre', how: 'Inspector → Arıza → D1 → Açık devre', symptom: 'LED yanmaz, direnç üzerinde gerilim düşümü olmaz, GPIO\'dan akım çekilmez.' },
    ],
    quiz: [
      { id: 'q1', q: 'ATmega328P için pin başına mutlak maksimum akım nedir?', options: ['5 mA', '20 mA', '40 mA', '200 mA'], answer: 2, explain: '40 mA mutlak maksimumdur, 20 mA ise önerilen sürekli akımdır. 200 mA tüm pinlerin toplamıdır.' },
      { id: 'q2', q: '5 V, Vf = 2 V, R_seri = 220 Ω, R_pin = 40 Ω için LED akımı kaç mA\'dır?', answer: 11.5, tol: 0.05, unit: 'mA', explain: 'I = 3 V / 260 Ω ≈ 11.5 mA.' },
      { id: 'q3', q: 'Aşağıdakilerden hangisi seri direncin ASIL görevidir?', options: ['LED\'i daha parlak yapmak', 'Akımı sınırlayıp LED ile GPIO pinini korumak', 'Gerilimi yükseltmek', 'Pini yüksek empedanslı yapmak'], answer: 1, explain: 'LED diyot gibi davrandığından akımı dış devre belirler; seri direnç akımı güvenli düzeyde tutar.' },
      { id: 'q4', q: 'Dirençsiz LED bağlanırsa (Vf=2 V, R_pin=40 Ω) akım yaklaşık kaç mA\'ya çıkmak ister?', answer: 75, tol: 0.05, unit: 'mA', explain: '(5 − 2)/40 = 75 mA > 40 mA mutlak sınır; pin zarar görür.' },
      { id: 'q5', q: 'Hedef 10 mA, Vf = 1.95 V, R_pin = 40 Ω. En yakın standart (E12) seri direnç hangisi?', options: ['100 Ω', '270 Ω', '1 kΩ', '10 Ω'], answer: 1, explain: 'R = 3.05/0.01 − 40 = 265 Ω; en yakın E12 değeri 270 Ω.' },
    ],
    challenge: {
      id: 'ch-led-akim', title: 'LED akımını güvenli aralığa getir',
      goal: '5 V kaynak + 40 Ω (GPIO modeli) üzerindeki R1 seri direncini seçerek LED akımını 5–15 mA arasına, R1 gücünü 0.125 W altına getirin.',
      hints: ['R1 şu an 10 Ω: akım ≈ 62 mA. R = (5 − 1.9)/I − 40 formülünü kullanın.', '10 mA için ≈ 270 Ω; 220 Ω ve 330 Ω da aralığa girer.', 'R0 (40 Ω) GPIO iç direncini temsil eder, onu değiştirmeyin.'],
      start: () => ledChallenge(10),
      solution: () => ledChallenge(270),
      checks: [
        { label: 'LED akımı 5–15 mA', probe: { q: 'i', comp: 'D1' }, min: 0.005, max: 0.015, unit: 'A' },
        { label: 'R1 gücü ≤ 0.125 W', probe: { q: 'p', comp: 'R1' }, max: 0.125, unit: 'W' },
      ],
    },
    code: CODE_02,
  },

  // =============================================================== 3
  {
    id: 'dijital-03-buton-okuma', track: 'dijital', level: 'baslangic', minutes: 18,
    prerequisites: ['dijital-01-mantik-seviyeleri', 'dijital-02-dijital-cikis-led'],
    title: 'Buton okuma ve kontrol: INPUT_PULLUP, active-low',
    summary: 'Butonu pin–GND arasına bağlayıp INPUT_PULLUP ile okur, "basılma anı"nı (kenar) algılayarak LED\'i aç/kapat yaparsınız.',
    speed: 1,
    objectives: [
      'INPUT_PULLUP ile dış direnç kullanmadan buton okumak.',
      'Active-low mantığı (basılı = LOW) kodda doğru kullanmak.',
      'Seviye okumak ile kenar (geçiş) algılamak arasındaki farkı kavramak.',
      'Mekanik butondaki sıçrama (bounce) olgusunu ve basit bir çözümünü açıklamak.',
    ],
    theory: [
      { t: 'p', text: 'En yalın bağlantı: buton bir ucu D2\'ye, diğer ucu GND\'ye. Kodda pinMode(2, INPUT_PULLUP) ile dahili pull-up açılır. Buton açıkken pin pull-up ile HIGH, basılınca GND\'ye çekilir ve LOW olur. Basit "basılıyken yan" mantığı: if (digitalRead(BTN) == LOW) { LED aç }.' },
      { t: 'p', text: 'Anahtar/toggle gibi davranması istenirse seviye değil geçiş algılanır: önceki okuma HIGH ve şimdiki LOW ise "yeni basıldı". Aksi hâlde loop() saniyede binlerce kez döndüğünden LED sürekli hızla açılıp kapanır. Bu derste last değişkeni önceki durumu saklar.' },
      { t: 'formula', text: 'basıldı  ⇔  (önceki == HIGH) VE (şimdiki == LOW)', note: 'Düşen kenar (falling edge) algılama' },
      { t: 'p', text: 'Gerçek mekanik butonlar kontak yaparken birkaç ms boyunca sıçrar (bounce): sinyal LOW–HIGH arasında defalarca gider gelir. Çözüm: kenar algılandıktan sonra 10–50 ms bekleyip (ya da millis ile zaman damgası kontrol edip) yeni olayları yok saymak ya da donanımda RC filtresi kullanmak.' },
      { t: 'warn', text: 'Simülatör sınırı: butonlar ideal anahtardır, sıçrama modellenmez; gerçek devrede debounce gereklidir. INPUT_PULLUP dahili direnci (~35 kΩ) simülatörde sabit bir Thevenin koludur; gerçek ATmega328P\'de 20–50 kΩ arasında değişir.' },
    ],
    calc: [
      { title: 'Basılıyken pinden akan akım', formula: 'I = VCC / R_pullup', working: '5 V / 35 kΩ = 143 µA (buton kapalıyken GND\'ye giden akım)' },
      { title: 'Pin gerilimi (basılı)', formula: 'V = VCC · R_buton/(R_pullup + R_buton)', working: '5 · 0.001/35000 ≈ 0.14 µV ≈ 0 V → LOW' },
      { title: 'LED akımı (D13 HIGH)', formula: 'I = (VCC − Vf)/(R + R_pin)', working: '(5 − 2.0)/(220 + 40) ≈ 11.5 mA' },
    ],
    build: build03,
    steps: [
      'Hız ayarı! Hızı 1 yapın.',
      'Çalıştır\'a basın. LED başlangıçta kapalıdır; GPIO sekmesinde D2 "pullup" modunda ve seviyesi 1 olmalı.',
      'SW1\'e çift tıklayarak basın: Seri sekmesinde "LED ACIK" yazar, LED yanar. Bırakınca LED yanık kalır; tekrar basınca söner.',
      'GPIO sekmesinde D2\'nin basılıyken 0, bırakılınca 1 olduğunu doğrulayın.',
      'Kod sekmesinde kenar algılamayı kaldırıp (if (now == LOW) LED aç) yeniden Yükle: LED artık yalnızca basılıyken yanar.',
      'Alt devrede SW2 (dahili pull-up eşdeğeri, basılı) akımını Ölçümler sekmesinden okuyun.',
    ],
    expects: [
      { label: 'Dahili pull-up eşdeğeri: basılı buton gerilimi ≈ 0 V', probe: { q: 'node', comp: 'R2', pin: '2' }, value: 0, tol: { abs: 0.01 }, unit: 'V' },
      { label: 'Dahili pull-up eşdeğeri akımı (5 V / 35 kΩ)', probe: { q: 'i', comp: 'R2' }, value: 0.000143, tol: { rel: 0.03 }, unit: 'A' },
    ],
    mistakes: [
      'INPUT_PULLUP kullanıp basılı için HIGH koşulu yazmak: mantık tersine çalışır.',
      'Seviye ile "basıldı" olayını karıştırmak: toggle için kenar algılaması şarttır.',
      'Debounce koymamak: gerçek butonda tek basış birkaç kez sayılabilir.',
      'Butonu pin ile VCC arasına bağlayıp INPUT_PULLUP kullanmak: pin sürekli HIGH okur.',
    ],
    faults: [
      { title: 'SW1 yapışık (kısa devre)', how: 'Inspector → Arıza → SW1 → Kısa devre', symptom: 'D2 her zaman LOW; kenar algılaması hiç tetiklenmez (başlangıçtan beri LOW).' },
      { title: 'SW1 açık devre (teması kopuk)', how: 'Inspector → Arıza → SW1 → Açık devre', symptom: 'Basılsa bile D2 HIGH kalır, LED hiç değişmez.' },
    ],
    quiz: [
      { id: 'q1', q: 'INPUT_PULLUP ile bağlı butona basılınca digitalRead() değeri ne olur?', options: ['HIGH (1)', 'LOW (0)', 'Değişmez', 'Rastgele'], answer: 1, explain: 'Buton pini GND\'ye çeker; pull-up çok zayıftır, LOW baskın olur.' },
      { id: 'q2', q: 'Butona her basışta LED\'in durumunun DEĞİŞMESİ için ne yapmak gerekir?', options: ['Seviye okumak yeter', 'Önceki ve şimdiki durumu karşılaştırıp kenarı algılamak', 'delay(10000) koymak', 'analogRead kullanmak'], answer: 1, explain: 'Seviye okunursa basılı kaldığı sürece her loop turunda durum değişir; kenar algılama tek bir olay üretir.' },
      { id: 'q3', q: '35 kΩ dahili pull-up ve basılı buton ile pinden akan akım kaç µA\'dır (5 V)?', answer: 143, tol: 0.03, unit: 'µA', explain: '5 V / 35 kΩ = 142.9 µA.' },
      { id: 'q4', q: 'Buton sıçraması (bounce) için basit yazılım çözümü hangisidir?', options: ['Gerilimi artırmak', 'Kenar sonrası 10–50 ms beklemek', 'Pini OUTPUT yapmak', 'Seri direnç eklemek'], answer: 1, explain: 'Sıçrama birkaç ms sürer; bu süre boyunca yeni geçişleri yok saymak yeterlidir.' },
    ],
    code: CODE_03,
  },

  // =============================================================== 4
  {
    id: 'dijital-04-adc-analogread', track: 'dijital', level: 'baslangic', minutes: 22,
    prerequisites: ['dijital-01-mantik-seviyeleri'],
    title: 'ADC: analogRead ve gerilim bölücü ile sensör okuma',
    summary: '10 bitlik ADC\'nin Vref ve LSB ilişkisini öğrenir; potansiyometre ve sabit gerilim bölücüyü A0/A1\'den okuyup ADC değerini volta çevirirsiniz.',
    objectives: [
      '10 bit ADC için sayısal değer ile gerilim arasındaki dönüşümü yapmak (ADC = Vin/Vref · 1023).',
      'Çözünürlüğü LSB = Vref/1023 ≈ 4.89 mV olarak hesaplamak.',
      'Direnç bölücü (sensör + sabit direnç) çıkışını hesaplayıp ADC\'den okumak.',
      'ADC girişine Vref\'in üstünde gerilim verilmemesi gerektiğini bilmek.',
    ],
    theory: [
      { t: 'p', text: 'ADC (analog–dijital çevirici), 0–Vref arasındaki girişi n bitlik bir tamsayıya çevirir. Uno\'da n = 10 (0…1023), Vref varsayılan 5 V\'tur. analogRead(A0) bu sayıyı döndürür; volta çevirmek kodun işidir.' },
      { t: 'formula', text: 'ADC = Vin / Vref · 1023     Vin = ADC · Vref / 1023', note: 'Uno: Vref = 5 V, 10 bit. (Gerçek donanım 1024 basamak olduğunu ve ADC = Vin/Vref·1024 kullandığını unutmayın; fark ≤ 1 LSB.)' },
      { t: 'formula', text: 'LSB = Vref / 1023 = 5 V / 1023 ≈ 4.89 mV', note: 'Çözünürlük: en küçük ayırt edilebilir gerilim farkı' },
      { t: 'p', text: 'Birçok sensör (LDR, NTC termistör, potansiyometre) direnç değiştirir. Okunabilmesi için gerilime çevrilmesi gerekir: sensör ile sabit direnç gerilim bölücü oluşturur, orta düğüm ADC pinine gider.' },
      { t: 'formula', text: 'Vout = Vcc · R_alt / (R_üst + R_alt)', note: '10 kΩ üst, 4.7 kΩ alt: 5·4.7/14.7 = 1.599 V → ADC ≈ 327' },
      { t: 'p', text: 'ADC girişi yüksek empedanslıdır ama kaynak direnci çok büyükse (Uno için ≳10 kΩ önerilir üst sınır) örnekleme kapasitesi doğru dolmaz; bu derste kullanılan 10 kΩ ve altı değerler uygundur.' },
      { t: 'warn', text: 'Pin giriş gerilimi Vref (= VCC) üstüne ya da GND altına çıkmamalıdır. Simülatör sınırı: ADC ideal, doğrusal ve gürültüsüz varsayılır; ESP32\'de gerçek ADC doğrusal değildir ve ADC2 Wi-Fi ile çakışır (bu simülatörde Wi-Fi yok).' },
    ],
    calc: [
      { title: 'Pot ADC değeri (konum 0.7: wiper = 5·(1 − 0.7))', formula: 'Vw = 5·(1 − 0.7) = 1.5 V;  ADC = Vw/5·1023', working: '1.5/5·1023 = 306.9 ≈ 307' },
      { title: 'Çözünürlük', formula: 'LSB = Vref/1023', working: '5/1023 = 4.888 mV' },
      { title: 'Sabit bölücü (A1)', formula: 'Vout = 5·R2/(R1+R2)', working: '5·4.7k/14.7k = 1.599 V → ADC = 1.599/5·1023 ≈ 327' },
    ],
    build: build04,
    steps: [
      'Hız ayarı! Hızı 1 yapın (yalnızca serial yazdırıyor).',
      'Çalıştır\'a basın; Seri sekmesinde "A0 ADC=307 V=1.500  A1 ADC=327 V=1.599" benzeri çıktıyı izleyin.',
      'RV1 konumunu (Inspector → pos) 0, 0.5, 1 yapın: ADC sırasıyla 1023, 512, 0 olur (pos arttıkça wiper GND ucuna yaklaşır).',
      'R2 değerini 10 kΩ yapın: A1 yaklaşık 2.5 V (ADC ≈ 512) olmalı.',
      'Kod sekmesinde Vref değerini 3.3 yapıp Yükle ile deneyin: yanlış Vref ile okunan volt nasıl bozulur?',
      'GPIO sekmesinde A0/A1\'in mod ve gerilimlerine bakın.',
    ],
    expects: [
      { label: 'A0 düğümü (pot konumu 0.7 → 5 V·0.3)', probe: { q: 'node', comp: 'U1', pin: 'A0' }, value: 1.5, tol: { rel: 0.03 }, unit: 'V' },
      { label: 'A1 düğümü (10 kΩ / 4.7 kΩ bölücü)', probe: { q: 'node', comp: 'U1', pin: 'A1' }, value: 1.599, tol: { rel: 0.03 }, unit: 'V' },
      { label: 'Bölücü akımı (R1)', probe: { q: 'i', comp: 'R1' }, value: 0.000340, tol: { rel: 0.04 }, unit: 'A' },
    ],
    mistakes: [
      'ADC değerini doğrudan "volt" sanmak: 307 sayısı 1.5 V\'tur, çevirmek gerekir.',
      'Vref yanlış: gerçek donanımda Vref 5 V değilse (USB düşük, AREF değişik) hesap kayar.',
      'Bölücüde çok büyük dirençler kullanmak: ADC örnekleme kapasitesi yavaş dolar, okuma hatalı olur.',
      'Sensör gerilimini 5 V\'tan büyük bırakmak (ör. 12 V hattı): ADC pini ve çip yanar.',
    ],
    faults: [
      { title: 'R2 (alt direnç) açık devre', how: 'Inspector → Arıza → R2 → Açık devre', symptom: 'A1 üst dirençten VCC\'ye çekilir: ≈ 5 V, ADC ≈ 1023 (okuma uç değere yapışır).' },
      { title: 'Pot temassızlığı (wiper kopuk)', how: 'Inspector → Arıza → RV1 → Açık devre', symptom: 'A0 floating kalır; ADC rastgele/öncekine yakın değerler okur.' },
    ],
    quiz: [
      { id: 'q1', q: 'Uno\'da analogRead() hangi aralıkta değer döndürür?', options: ['0–255', '0–1023', '0–4095', '0–5'], answer: 1, explain: '10 bit ADC: 2^10 = 1024 değer, yani 0–1023.' },
      { id: 'q2', q: 'ADC değeri 512 okundu (Vref = 5 V). Pin gerilimi yaklaşık kaç volt?', answer: 2.502, tol: 0.02, unit: 'V', explain: 'V = 512/1023 · 5 = 2.502 V.' },
      { id: 'q3', q: 'Uno ADC\'sinin çözünürlüğü (LSB) yaklaşık kaç mV\'tur?', answer: 4.89, tol: 0.02, unit: 'mV', explain: '5000 mV / 1023 ≈ 4.89 mV.' },
      { id: 'q4', q: '10 kΩ (üst) / 4.7 kΩ (alt) bölücü 5 V\'u böldüğünde orta düğüm gerilimi kaç volttur?', answer: 1.599, tol: 0.03, unit: 'V', explain: 'Vout = 5·4.7/(10+4.7) = 1.599 V.', verify: { probe: { q: 'node', comp: 'U1', pin: 'A1' } } },
      { id: 'q5', q: 'Aşağıdakilerden hangisi ADC ile doğrudan okunamaz?', options: ['Potansiyometre konumu', 'LDR ile kurulan bölücü gerilimi', 'Doğrudan 12 V akü gerilimi', 'Termistör bölücüsü'], answer: 2, explain: '12 V, Vref = 5 V üstündedir; bölücü ile 5 V altına indirilmeden pine bağlanamaz.' },
    ],
    challenge: {
      id: 'ch-adc-bolucu', title: 'ADC için orta nokta bölücüsü',
      goal: 'A0 girişindeki bölücüyü ayarlayın: A0 gerilimi 2.4–2.6 V arasında (ADC ≈ 490–532) ve bölücü akımı 0.5 mA altında olsun.',
      hints: ['R1 = 10 kΩ, R2 = 22 kΩ: A0 ≈ 3.44 V, çok yüksek.', 'Vout = 5·R2/(R1+R2). Yarıya inmek için R1 = R2 gerekir.', 'R1 = R2 = 10 kΩ iyi çalışır: 2.5 V, 0.25 mA.'],
      start: () => adcChallenge(10000, 22000),
      solution: () => adcChallenge(10000, 10000),
      checks: [
        { label: 'A0 gerilimi 2.4–2.6 V', probe: { q: 'node', comp: 'U1', pin: 'A0' }, min: 2.4, max: 2.6, unit: 'V' },
        { label: 'Bölücü akımı ≤ 0.5 mA', probe: { q: 'i', comp: 'R1' }, max: 0.0005, unit: 'A' },
      ],
    },
    code: CODE_04,
  },

  // =============================================================== 5
  {
    id: 'dijital-05-pwm-analogwrite', track: 'dijital', level: 'baslangic', minutes: 20,
    prerequisites: ['dijital-02-dijital-cikis-led', 'dijital-04-adc-analogread'],
    title: 'PWM: analogWrite, doluluk oranı ve ortalama gerilim',
    summary: 'analogWrite gerçek analog gerilim üretmez; hızlı açıp kapatarak ortalama gerilimi duty × Vcc yapar. LED parlaklığını pot ile ayarlar, ortalamayı RC süzgeçle ölçersiniz.',
    speed: 0.02,
    objectives: [
      'PWM\'in frekans, doluluk oranı (duty) ve ortalama gerilim kavramlarını tanımlamak.',
      'analogWrite(pin, 0…255) değerini duty ve Vort\'a çevirmek.',
      'Uno\'da hangi pinlerin PWM yapabildiğini (3,5,6,9,10,11; ~490 Hz) bilmek.',
      'RC alçak geçiren süzgeç ile ortalama gerilimi elde edebileceğini gözlemlemek.',
    ],
    theory: [
      { t: 'p', text: 'PWM (darbe genişlik modülasyonu): pin sabit frekansta (Uno: ~490 Hz) HIGH–LOW arasında hızla geçiş yapar; HIGH kalma oranına doluluk (duty) denir. analogWrite(pin, d) ile d = 0…255 verilir: duty = d/255.' },
      { t: 'formula', text: 'duty = d / 255     V_ort = duty · VCC', note: 'd = 76 → duty = 29.8 % → V_ort = 1.49 V (VCC = 5 V)' },
      { t: 'p', text: 'LED 490 Hz\'de her yanıp sönüşü göz algılamaz; göz ortalama ışığı görür. Ortalama akım doluluk oranıyla orantılıdır, bu yüzden parlaklık duty ile ayarlanır. Aynı yöntem motor hız ve ışık kontrolünde kullanılır.' },
      { t: 'p', text: 'Gerçek bir DC gerilim gerekiyorsa pin çıkışı RC alçak geçiren süzgeçten geçirilir; kesim frekansı fc = 1/(2π·R·C) PWM frekansından çok düşük olmalıdır. Bu derste eşdeğer devre: %30 doluluklu 490 Hz kare dalga → 1 kΩ + 10 µF (fc ≈ 16 Hz). Çıkışın ortalaması duty·5 V ≈ 1.5 V\'a oturur, küçük dalgalanma (ripple) kalır.' },
      { t: 'formula', text: 'fc = 1 / (2π·R·C) = 1/(2π · 1 kΩ · 10 µF) ≈ 15.9 Hz', note: 'τ = RC = 10 ms; birkaç τ sonra ortalama oturur' },
      { t: 'warn', text: 'PWM çıkışlı pin yine de bir GPIO\'dur: LED için seri direnç gereklidir ve pin akım sınırları (20/40 mA) geçerlidir. Simülatör sınırı: PWM zamanlayıcı donanımı değil, yazılımla üretilen ideal bir dalgadır; ISR/timer çakışmaları (tone, Servo) modellenmez. Yüksek frekanslı PWM\'de simülasyon hızını düşürmek gerekir (hız 0.02).' },
    ],
    calc: [
      { title: 'Pot → ADC → PWM', formula: 'ADC = 1.5/5·1023 = 307;  d = map(307, 0, 1023, 0, 255)', working: 'd = 307·255/1023 = 76' },
      { title: 'Doluluk ve ortalama', formula: 'duty = d/255;  V_ort = duty·5', working: '76/255 = 29.8 %;  V_ort = 1.49 V ≈ 1.5 V' },
      { title: 'RC süzgeç', formula: 'fc = 1/(2πRC)', working: 'R = 1 kΩ, C = 10 µF → fc = 15.9 Hz ≪ 490 Hz → iyi süzgeçleme' },
    ],
    build: build05,
    steps: [
      'Hız ayarı! Hızı 0.02 yapın (PWM kenarlarının incelenmesi için ağır çekim).',
      'Çalıştır\'a basın. Seri sekmesinde "ADC=307 PWM=76" yazılır. GPIO sekmesinde D9 modu "pwm", duty ≈ %30.',
      'RV1 konumunu 1 → 0 çevirin: duty %0–%100 arasında değişir (pos arttıkça gerilim düşer) ve D1 LED\'in akımı/parlaklığı değişir.',
      'Osiloskopta V2 çıkışı ve C1 (RC süzgeç çıkışı) gerilimini birlikte izleyin: C1 yaklaşık 1.5 V\'ta durur.',
      'V2\'nin Doluluk (duty) parametresini %60 yapın: C1 ortalaması yaklaşık 3 V olur.',
      'Kod sekmesinde analogWrite satırını sabit 128 yapıp Yükle ile yükleyin: duty %50 olur.',
    ],
    expects: [
      { label: 'A0 düğümü (pot konumu 0.7 → 5 V·0.3)', probe: { q: 'node', comp: 'U1', pin: 'A0' }, value: 1.5, tol: { rel: 0.03 }, unit: 'V' },
      { label: 'Kare dalga kaynağının ortalaması (%30 duty, 5 V)', probe: { q: 'v', comp: 'V2' }, value: 1.5, tol: { rel: 0.05 }, unit: 'V', tran: TRAN_MEAN },
      { label: 'RC süzgeç çıkışı ortalaması (duty·5 V)', probe: { q: 'v', comp: 'C1' }, value: 1.5, tol: { rel: 0.05 }, unit: 'V', tran: TRAN_MEAN },
    ],
    mistakes: [
      'analogWrite\'ın gerçek analog gerilim ürettiğini sanmak: ortalaması değişen hızlı bir dijital sinyaldir.',
      'PWM olmayan bir pine analogWrite yapmak: yalnızca 0/255 gibi davranır (Uno\'da 3,5,6,9,10,11 dışı).',
      'RC süzgecin kesim frekansını PWM frekansına yakın seçmek: büyük dalgalanma kalır.',
      'LED\'i seri dirençsiz PWM pinine bağlamak.',
    ],
    faults: [
      { title: 'C1 açık devre', how: 'Inspector → Arıza → C1 → Açık devre', symptom: 'RC çıkışı süzülmez; düğüm gerilimi kare dalganın kendisini izler (R üzerinde akım yok, ortalama hâlâ 1.5 V ama dalgalanma ±1.7 V).' },
      { title: 'D1 LED yapışık/kısa', how: 'Inspector → Arıza → D1 → Kısa devre', symptom: 'D9 yüksekken yalnızca 220 Ω + 40 Ω sınırlar: akım ≈ 19 mA; LED parlaklığı ayar yapılamaz olur.' },
    ],
    quiz: [
      { id: 'q1', q: 'analogWrite(9, 128) ile Uno\'da (5 V) ortalama gerilim yaklaşık kaç volttur?', answer: 2.51, tol: 0.03, unit: 'V', explain: 'duty = 128/255 = %50.2 → V_ort = 0.502·5 ≈ 2.51 V.' },
      { id: 'q2', q: 'PWM\'de LED parlaklığı neden duty ile değişir?', options: ['Gerilim tepe değeri artar', 'Ortalama akım doluluk oranıyla orantılıdır', 'Frekans artar', 'LED direnci değişir'], answer: 1, explain: 'Tepe değer sabit; açık kalma süresi oranı kadar ortalama akım ve ışık artar.' },
      { id: 'q3', q: '%30 duty, 5 V genlikli PWM\'in RC ile süzülmüş ortalaması kaç volttur?', answer: 1.5, tol: 0.05, unit: 'V', explain: 'V_ort = duty · Vcc = 0.30 · 5 = 1.5 V.', verify: { probe: { q: 'v', comp: 'C1' }, tran: TRAN_MEAN } },
      { id: 'q4', q: 'Uno\'da hangi pin PWM çıkışı DEĞİLDİR?', options: ['D3', 'D9', 'D13', 'D6'], answer: 2, explain: 'Uno PWM pinleri 3, 5, 6, 9, 10, 11\'dir; D13 PWM değildir.' },
      { id: 'q5', q: 'R = 1 kΩ, C = 10 µF süzgecin kesim frekansı yaklaşık kaç Hz\'dir?', answer: 15.9, tol: 0.03, unit: 'Hz', explain: 'fc = 1/(2π·1000·10e-6) ≈ 15.9 Hz.' },
    ],
    code: CODE_05,
  },

  // =============================================================== 6
  {
    id: 'dijital-06-mosfet-yuk-surme', track: 'dijital', level: 'orta', minutes: 24,
    prerequisites: ['dijital-02-dijital-cikis-led', 'dijital-05-pwm-analogwrite'],
    title: 'Transistör/MOSFET ile yük sürme: GPIO yükü neden doğrudan sürmemeli',
    summary: 'ESP32 GPIO26\'dan 12 Ω / 12 V yükü doğrudan sürmek pini yakar. Kapı direnci + mantık seviyeli N-MOSFET ile 1 A yük, pin akımı ≈ 0 ile anahtarlanır.',
    speed: 1,
    objectives: [
      'GPIO\'nun yalnızca ~birkaç 10 mA ve 3.3 V verebildiğini, yükü doğrudan sürmenin neden hasar yaptığını hesaplamak.',
      'Mantık seviyeli N-MOSFET ile low-side anahtar devresini kurmak.',
      'Gate direncinin ve pull-down direncinin (10 kΩ) görevini açıklamak.',
      'MOSFET iletimde RDS(on) ≈ 50 mΩ olduğunda yükte ve MOSFETte düşen gerilim/gücü hesaplamak.',
    ],
    theory: [
      { t: 'p', text: 'GPIO pinleri sinyal içindir, güç için değil: ESP32\'de pin başına en fazla 40 mA mutlak (12 mA güvenli sürüş), çıkış gerilimi 3.3 V\'tur. 12 V / 1 A bir yük (örn. 12 Ω röle, motor, LED şerit) pinden doğrudan sürülemez: hem gerilim hem akım yetersizdir ve yük pinin çıkışına ters/aşırı akım gönderebilir.' },
      { t: 'formula', text: 'Doğrudan: I = 3.3 V / (R_pin + R_yük) = 3.3/(30 + 12) ≈ 78.6 mA', note: 'ESP32 pin sınırı 40 mA\'nın ~2 katı, üstelik yük 12 V yerine yaklaşık 0.9 V görür' },
      { t: 'p', text: 'Çözüm: GPIO yalnızca bir anahtar elemanının kontrol ucunu sürer, yük güç kaynağından beslenir. Mantık seviyeli N-MOSFET (VGS(th) ≈ 1.8 V) 3.3 V\'ta tam iletime yakın girer. Kaynak (S) GND\'ye, yük drain ile 12 V arasına konur (low-side anahtar). Gate yalıtkandır, DC\'de akım çekmez; pinden yalnızca pull-down direncinin akımı (3.3 V / 10.1 kΩ ≈ 0.33 mA) akar.' },
      { t: 'formula', text: 'I_yük = V_besleme / (R_yük + RDS(on)) = 12/(12 + 0.05) ≈ 0.996 A', note: 'VGS = 3.3 V, Vov = 3.3 − 1.8 = 1.5 V, RDS(on) ≈ 1/(2·K·Vov) ≈ 48 mΩ (K = 7 A/V²)' },
      { t: 'p', text: 'Gate serisindeki direnç (≈100 Ω) gerçek devrede anahtarlama sırasındaki akım sıçramasını ve zil sesini sınırlar; gate–GND direnci (10 kΩ) pull-down işlevi görür: MCU açılırken pin floating iken gate\'i LOW tutup yükün istenmeden çalışmasını engeller.' },
      { t: 'formula', text: 'P_MOSFET = I²·RDS(on) = 0.996² · 0.048 ≈ 48 mW', note: 'İletimde ısınma ihmal edilebilir; yüksek akım/yüksek frekanslı PWM\'de artar' },
      { t: 'warn', text: 'Standart gate MOSFET\'ler (VGS(th) ≈ 3–4 V, ör. IRF540) 3.3 V ile tam açılmaz, lineer bölgede ısınır; mantık seviyeli (logic-level) seçin. Endüktif yüklerde (röle, motor) drain\'e ters diyot (flyback) ekleyin. Simülatör sınırı: MOSFET jenerik bir K–VTH modelidir; gate kapasitesi/Qg ve anahtarlama kayıpları yok. GPIO yaklaşık Thevenin kaynağı; firmware çalıştırılmadan yapılan DC testte pinler yüksek empedanslıdır, bu yüzden "pin HIGH" durumu eşdeğer devrelerle (V2 = 3.3 V) kurulmuştur.' },
    ],
    calc: [
      { title: 'Doğrudan sürüş (hatalı)', formula: 'I = V/(R_pin + R_yük)', working: '3.3 V/(30 + 12) Ω = 78.6 mA > 40 mA; yük gerilimi = 78.6 mA · 12 Ω ≈ 0.94 V' },
      { title: 'MOSFET RDS(on)', formula: 'RDS(on) ≈ 1/(2·K·(VGS − Vth))', working: '1/(2·7·(3.3 − 1.8)) = 1/21 ≈ 0.048 Ω' },
      { title: 'Yük akımı (MOSFET ile)', formula: 'I = 12/(12 + RDS)', working: '12/12.048 ≈ 0.996 A; pinden yalnızca pull-down akımı (≈ 0.33 mA) akar' },
      { title: 'Güç dağılımı', formula: 'P = I²·R', working: 'Yük: 0.996²·12 = 11.9 W (R pmax = 25 W seçildi); MOSFET: 0.048 W' },
    ],
    build: build06,
    steps: [
      'Hız ayarı! Hızı 1 yapın (1 s açık / 1 s kapalı).',
      'Çalıştır\'a basın. Seri sekmesinde "YUK ACIK/KAPALI", ölçümlerde RL akımının 0 ↔ ≈1 A arasında geçtiğini izleyin.',
      'GPIO sekmesinde D26 modunun "out", seviyenin 1/0 olduğunu ve R1 (gate direnci) akımının yalnızca ≈ 0.33 mA (pull-down üzerinden) olduğunu doğrulayın.',
      'Alt devrede RO + RLD (yük doğrudan 3.3 V pinden): akım ≈ 79 mA, yük gerilimi < 1 V. Pin akımının 40 mA sınırını aştığını not edin.',
      'Q1\'i "nmos_std" ile değiştirmeyi deneyin (3.3 V\'ta tam açılmaz): yük akımının nasıl düştüğünü görün.',
      'Kod sekmesinde süreleri değiştirip Yükle; R2 (pull-down) silerseniz gate floating kalır, açılışta yük istenmeden çalışabilir.',
    ],
    expects: [
      { label: 'Q1 gate düğümü (pull-down ile LOW, pin yüksek-Z)', probe: { q: 'node', comp: 'Q1', pin: 'G' }, value: 0, tol: { abs: 0.01 }, unit: 'V' },
      { label: 'MOSFET\'li eşdeğer devre: yük akımı (GPIO HIGH = 3.3 V)', probe: { q: 'i', comp: 'RL2' }, value: 0.996, tol: { rel: 0.03 }, unit: 'A' },
      { label: 'Doğrudan sürüşte pin akımı', probe: { q: 'i', comp: 'RO' }, value: 0.0786, tol: { rel: 0.03 }, unit: 'A' },
      { label: 'MOSFET\'in tam iletim RDS(on) dolayısıyla VDS', probe: { q: 'val', comp: 'Q2', key: 'vds' }, value: 0.048, tol: { rel: 0.15, abs: 0.01 }, unit: 'V' },
    ],
    mistakes: [
      'Motor/röle/LED şeridi GPIO\'ya doğrudan bağlamak: pin akımı aşılır, çip bozulur.',
      'Standart gate MOSFET\'i 3.3 V\'ta sürmek: VGS(th)\'e yakın olduğundan RDS(on) yüksek, MOSFET ısınır.',
      'Gate pull-down koymamak: açılışta floating gate yükü istenmeden çalıştırabilir ve MOSFET\'i ısıtabilir.',
      'Yük besleme GND\'si ile MCU GND\'sini birleştirmemek: ortak referans olmazsa gate gerilimi anlamsız olur.',
      'Endüktif yükte flyback diyodu unutmak: kapanırken drain gerilimi sıçrar, MOSFET zarar görür.',
    ],
    faults: [
      { title: 'Q1 gate–source kısa (gateShort)', how: 'Inspector → Arıza → Q1 → Gate kısa devre', symptom: 'Gate\'i GND\'ye çekilir; GPIO HIGH olsa bile yük çalışmaz. Pin 100 Ω üzerinden GND\'ye ~25 mA akıtır (hatalı yük).' },
      { title: 'R1 (gate direnci) açık devre', how: 'Inspector → Arıza → R1 → Açık devre', symptom: 'GPIO sinyali gate\'e ulaşmaz; gate pull-down ile LOW kalır, yük hiç açılmaz.' },
    ],
    quiz: [
      { id: 'q1', q: 'ESP32 GPIO\'sunu 12 Ω / 12 V yüke doğrudan bağlamak neden yanlıştır?', options: ['Yük çok küçük', 'Gerilim 3.3 V ve akım sınırı yetersiz, pin bozulur', 'GPIO çıkışı AC\'dir', 'Hiçbir sorun yok'], answer: 1, explain: 'Pin 3.3 V verebilir ve en fazla 40 mA mutlak akım taşır; yük 1 A ister.' },
      { id: 'q2', q: 'Doğrudan sürüşte (30 Ω pin direnci, 12 Ω yük, 3.3 V) pin akımı kaç mA\'dır?', answer: 78.6, tol: 0.03, unit: 'mA', explain: 'I = 3.3/(30+12) = 78.6 mA; ESP32 sınırının yaklaşık 2 katı.' },
      { id: 'q3', q: 'MOSFET low-side anahtarlamada gate–GND arasındaki 10 kΩ direncin görevi nedir?', options: ['Yük akımını sınırlamak', 'MCU belirsizken gate\'i LOW tutmak (pull-down)', 'Gerilimi yükseltmek', 'Anahtarlamayı hızlandırmak'], answer: 1, explain: 'MCU açılırken pin floating iken gate rastgele iletime girebilir; pull-down bunu engeller.' },
      { id: 'q4', q: 'VGS = 3.3 V, Vth = 1.8 V, K = 7 A/V² için RDS(on) ≈ 1/(2K·Vov) kaç mΩ\'dur?', answer: 47.6, tol: 0.05, unit: 'mΩ', explain: '1/(2·7·1.5) = 0.0476 Ω = 47.6 mΩ.' },
      { id: 'q5', q: 'Yük akımı MOSFET ile yaklaşık kaç amperdir (12 V, 12 Ω, RDS ≈ 48 mΩ)?', answer: 0.996, tol: 0.03, unit: 'A', explain: 'I = 12/(12 + 0.048) = 0.996 A.', verify: { probe: { q: 'i', comp: 'RL2' } } },
    ],
    challenge: {
      id: 'ch-mosfet-surucu', title: 'Yükü GPIO\'dan kurtar',
      goal: '3.3 V GPIO modeli (V2 + 30 Ω) ile 12 Ω / 12 V yükü sürün: yük akımı ≥ 0.8 A olsun, pin akımı (RG) ≤ 40 mA kalsın.',
      hints: ['Şu anda yük doğrudan GPIO\'ya bağlı: yalnızca 79 mA akıyor.', 'Yükü 12 V kaynak (V1) ile bir N-MOSFET\'in drain\'i arasına koyun; source GND\'de.', 'RG\'den sonra 100 Ω gate direnci ve Q1 (nmos_logic) ekleyin; yük akımı ≈ 1 A olur.'],
      start: () => driveChallenge(false),
      solution: () => driveChallenge(true),
      checks: [
        { label: 'Yük akımı ≥ 0.8 A', probe: { q: 'i', comp: 'RL' }, min: 0.8, unit: 'A' },
        { label: 'Pin akımı (RG) ≤ 40 mA', probe: { q: 'i', comp: 'RG' }, max: 0.04, unit: 'A' },
      ],
    },
    code: CODE_06,
  },

  // =============================================================== 7
  {
    id: 'dijital-07-seviye-uyumsuzlugu', track: 'dijital', level: 'orta', minutes: 22,
    prerequisites: ['dijital-01-mantik-seviyeleri'],
    title: '3.3 V / 5 V mantık seviyeleri ve seviye uyumsuzluğu',
    summary: 'ESP32\'ye 5 V sinyal vermek pini bozar. 1.8 kΩ / 3.3 kΩ gerilim bölücü 5 V\'u ≈ 3.2 V\'a indirir; hesabı, sınırlarını (hız, empedans) ve alternatiflerini öğrenirsiniz.',
    speed: 1,
    objectives: [
      '3.3 V ve 5 V mantık ailelerinin VIH/VIL/VOH sınırlarını karşılaştırmak.',
      '5 V sinyali 3.3 V\'luk girişe güvenli çevirmek için direnç bölücü hesaplamak.',
      'Bölücünün akım, hız ve hat empedansı sınırlarını bilmek.',
      '3.3 V çıkışın 5 V girişi sürmesinin ne zaman çalışıp ne zaman çalışmadığını açıklamak.',
    ],
    theory: [
      { t: 'p', text: 'Mantık ailelerinin gerilimleri farklıdır: Uno (5 V): VOH ≈ 4.5 V, VIH ≈ 3 V; ESP32/Pico (3.3 V): VOH ≈ 3.3 V, VIH ≈ 0.75·VDD ≈ 2.5 V, ve girişleri 5 V dayanıklı DEĞİLDİR (mutlak maks. ≈ VDD + 0.3–0.5 V).' },
      { t: 'p', text: '5 V → 3.3 V yönü tehlikelidir: 5 V sinyal 3.3 V pinin koruma diyotlarını ve içindeki transistörleri zorlar, pin/çip kalıcı bozulur. 3.3 V → 5 V yönü çoğu zaman çalışır: 3.3 V ≥ 5 V cihazın VIH\'si (3 V) olduğu için HIGH sayılır, fakat marj çok azdır; güvenilmez olabilir.' },
      { t: 'formula', text: 'V_çıkış = V_giriş · R2 / (R1 + R2)', note: '5 · 3.3k / (1.8k + 3.3k) = 3.235 V' },
      { t: 'p', text: 'Bölücü doğru çalışsın diye pinin giriş direnci ≫ R2 olmalıdır (ESP32 girişi MΩ mertebesi, sorun yok). Bölücü akımı I = 5/(R1+R2) ≈ 0.98 mA; hız sınırı ise R_Thevenin = R1‖R2 ≈ 1.17 kΩ ile pin ve hat kapasitesinin (C ≈ 10–20 pF) oluşturduğu RC süzgeçtir: f ≈ 1/(2π·1.17k·15 pF) ≈ 9 MHz, UART/GPIO için fazlasıyla yeterlidir.' },
      { t: 'formula', text: 'R_Th = R1 ∥ R2 = 1.8k·3.3k/5.1k ≈ 1.165 kΩ', note: 'Hız sınırı: f_c ≈ 1/(2π·R_Th·C_pin)' },
      { t: 'warn', text: 'Bölücü yalnızca TEK YÖNLÜ, düşük/orta hızlı 5 V → 3.3 V sinyaller içindir. İki yönlü hatlar (I2C) için MOSFET tabanlı (BSS138) seviye çevirici veya hazır TXS/74LVC çipler kullanın. Simülatör sınırı: ESP32 pin hasar modeli giriş gerilimi sınırına bakar (VDD + 0.3 V); I2C/SPI protokolleri simüle edilmez ve çıkış katı ideal Thevenin kaynağıdır.' },
    ],
    calc: [
      { title: 'Bölücü çıkışı', formula: 'Vout = Vin·R2/(R1+R2)', working: '5 · 3300 / (1800 + 3300) = 5·0.647 = 3.235 V' },
      { title: 'Bölücü akımı', formula: 'I = Vin/(R1+R2)', working: '5 / 5100 ≈ 0.98 mA' },
      { title: 'Kaynak direnci ve hız', formula: 'R_Th = R1∥R2;  fc = 1/(2π·R_Th·C)', working: 'R_Th = 1.165 kΩ, C ≈ 15 pF → fc ≈ 9 MHz' },
      { title: 'Güvenlik marjı', formula: 'Vout ≤ VDD + 0.3 ve Vout ≥ VIH', working: '3.235 ≤ 3.6 V ve 3.235 ≥ 2.475 V (0.75·3.3) → güvenli ve HIGH' },
    ],
    build: build07,
    steps: [
      'Hız ayarı! Hızı 1 yapın.',
      'Çalıştır\'a basın. Seri sekmesinde "GPIO4 = 1" yazar; GPIO sekmesinde D4 giriş, hasar yok.',
      'Ölçümlerde R1/R2 düğümünün ≈ 3.24 V olduğunu doğrulayın.',
      'R2\'yi Inspector\'dan açık devre yapın: düğüm 5 V\'a çıkar; ESP32 D4 pini aşırı gerilim uyarısı verir ve hasar raporu oluşur.',
      'R1/R2 değerlerini 3.3k/6.8k yapın: Vout ≈ 3.37 V (sınırda), 1k/1k yaparsanız 2.5 V (HIGH eşiğine yakın) olur; sonuçları karşılaştırın.',
      'Kod sekmesinde pinMode(4, INPUT) satırını bırakıp Yükle ile yeniden başlatın.',
    ],
    expects: [
      { label: 'Bölücü çıkışı (ESP32 D4 düğümü)', probe: { q: 'node', comp: 'U1', pin: 'D4' }, value: 3.235, tol: { rel: 0.02 }, unit: 'V' },
      { label: 'Bölücü akımı (R1)', probe: { q: 'i', comp: 'R1' }, value: 0.00098, tol: { rel: 0.03 }, unit: 'A' },
      { label: 'R2 üzerindeki gerilim', probe: { q: 'v', comp: 'R2' }, value: 3.235, tol: { rel: 0.02 }, unit: 'V' },
    ],
    mistakes: [
      '5 V sinyali doğrudan 3.3 V pine bağlamak (ESP32/Pico/STM32 girişleri 5 V dayanıklı değildir).',
      'Bölücüde çok büyük dirençler (≥ 100 kΩ) kullanmak: hat kapasitesiyle yavaşlar, hızlı sinyal bozulur.',
      'Bölücüyü ÇIKIŞ yönünde (3.3 V cihazdan 5 V cihaza) kullanmak: seviye düşer, yanlış okunur.',
      'I2C gibi çift yönlü hatlarda direnç bölücü kullanmak: yön tersine döner, sinyal bozulur.',
      'Ortak GND\'yi bağlamamak: iki kartın referansı farklı olur, bölücü çalışmaz.',
    ],
    faults: [
      { title: 'R2 açık devre (bölücü kopuk)', how: 'Inspector → Arıza → R2 → Açık devre', symptom: 'Pin düğümü 5 V\'a çıkar: ESP32 pini aşırı gerilimle zorlanır, hasar raporu üretilir.' },
      { title: 'R1 kısa devre', how: 'Inspector → Arıza → R1 → Kısa devre', symptom: 'Bölücünün üst ayağı kalmaz: pin doğrudan 5 V görür, ESP32 pini zarar görür.' },
    ],
    quiz: [
      { id: 'q1', q: 'ESP32 GPIO girişine doğrudan 5 V uygulanırsa ne olur?', options: ['Hiçbir şey, güvenli', 'Pin/çip kalıcı olarak bozulabilir', 'Giriş otomatik 3.3 V\'a kırpılır', 'Yalnızca ADC etkilenir'], answer: 1, explain: 'ESP32 GPIO\'ları 5 V dayanıklı değildir; mutlak maksimum ≈ VDD + 0.3 V.' },
      { id: 'q2', q: '1.8 kΩ / 3.3 kΩ bölücü 5 V\'u kaç volta indirir?', answer: 3.235, tol: 0.02, unit: 'V', explain: 'Vout = 5·3.3/(1.8+3.3) = 3.235 V.', verify: { probe: { q: 'node', comp: 'U1', pin: 'D4' } } },
      { id: 'q3', q: '3.3 V çıkışlı bir ESP32 pini, 5 V Uno girişini (VIH ≈ 3 V) doğrudan sürebilir mi?', options: ['Hayır, asla', 'Genellikle evet ama marj küçüktür (3.3 V ≥ 3 V)', 'Yalnızca PWM ile', 'Yalnızca seri dirençle'], answer: 1, explain: '3.3 V, 5 V cihazın VIH\'sinin (≈3 V) üstündedir; ancak gürültü ve yük altında marj azdır, güvenilirlik düşebilir.' },
      { id: 'q4', q: 'Bölücü akımı yaklaşık kaç mA\'dır (5 V, 1.8k + 3.3k)?', answer: 0.98, tol: 0.03, unit: 'mA', explain: 'I = 5/5100 = 0.98 mA.' },
      { id: 'q5', q: 'I2C hattında seviye dönüşümü için en uygun çözüm hangisidir?', options: ['Direnç bölücü', 'MOSFET tabanlı çift yönlü seviye çevirici', 'Seri diyot', 'Kondansatör'], answer: 1, explain: 'I2C çift yönlüdür; bölücü tek yönlüdür. BSS138 tabanlı çevirici iki yönü de destekler.' },
    ],
    challenge: {
      id: 'ch-seviye-bolucu', title: '5 V\'u ESP32 için güvenli hale getir',
      goal: '5 V sinyalin geldiği D4 girişine bölücü ekleyin: D4 gerilimi 2.475–3.3 V arasında ve bölücü akımı 1.5 mA altında olsun.',
      hints: ['Şu an yalnızca R1 (1 kΩ) var; pin floating gibi 5 V\'a çekiliyor.', 'Vout = 5·R2/(R1+R2) ≈ 3.2–3.3 V hedefleyin: R2/R1 ≈ 1.83.', 'R1 = 1.8 kΩ, R2 = 3.3 kΩ ile R2\'yi D4 düğümünden GND\'ye ekleyin.'],
      start: () => levelChallenge(false),
      solution: () => levelChallenge(true),
      checks: [
        { label: 'D4 gerilimi 2.475–3.3 V (HIGH okur, pini bozmaz)', probe: { q: 'node', comp: 'U1', pin: 'D4' }, min: 2.475, max: 3.3, unit: 'V' },
        { label: 'Bölücü akımı ≤ 1.5 mA', probe: { q: 'i', comp: 'R1' }, max: 0.0015, unit: 'A' },
      ],
    },
    faultHunt: {
      id: 'fh-seviye-bolucu', title: 'ESP32 pini neden bozuldu?',
      symptom: 'Bölücülü seviye çevirici kurulu. Bir süre çalıştıktan sonra ESP32 GPIO4 hep aynı değeri okuyor ve ölçülen pin gerilimi 3.3 V\'u aşıyor. Hangi parça arızalı?',
      circuit: build07,
      hidden: { R2: { kind: 'open' } },
      hints: ['D4 düğümünün gerilimini ölçün: beklenen ≈ 3.2 V.', 'Gerilim 5 V\'a yakın: bölücünün alt ayağı yok gibi davranıyor.', 'R2 üzerindeki akıma bakın: sıfır ise açık devredir.'],
      answer: { comp: 'R2', kind: 'open' },
      explain: 'R2 açık olunca bölücünün alt ayağı kopar; R1 üzerinden pin 5 V\'a çekilir (ESP32 girişi akım çekmez) ve 3.3 V sınırı aşılır. Çözüm: bölücüyü onarmak ve gerekirse pin başına seri koruma direnci/Zener kıskacı eklemek.',
      telltale: { q: 'node', comp: 'U1', pin: 'D4' },
    },
    code: CODE_07,
  },

  // =============================================================== 8
  {
    id: 'dijital-08-millis-seri-monitor', track: 'dijital', level: 'orta', minutes: 25,
    prerequisites: ['dijital-02-dijital-cikis-led', 'dijital-03-buton-okuma'],
    title: 'Seri monitör ve zamanlama: millis() ile bloklamayan blink',
    summary: 'delay() işlemciyi bekletir; butonu kaçırırsınız. millis() ile iki LED\'i farklı hızda yakıp söndürürken butonu her an okur, Serial ile hata ayıklarsınız.',
    speed: 1,
    objectives: [
      'delay() ile millis() tabanlı zamanlamanın farkını ve bloklama sorununu anlamak.',
      'now − last ≥ aralık deseniyle birden fazla bağımsız zamanlayıcı yazmak.',
      'Serial.print/println ile durumu izleyerek hata ayıklamak.',
      'unsigned long taşmasının (≈ 49.7 gün) fark hesabında sorun yaratmadığını bilmek.',
    ],
    theory: [
      { t: 'p', text: 'delay(500) süresince işlemci başka hiçbir şey yapmaz. Bu sürede butona basarsanız kaçırılır. Çok işli sistemlerde delay kullanılmaz: loop() hızlıca dönerken millis() (açılıştan beri geçen ms) ile zaman farkı kontrol edilir.' },
      { t: 'formula', text: 'if (now − last ≥ aralık) { last = now; … }', note: 'Her görev kendi last değişkenini tutar; loop() hiç beklemez' },
      { t: 'p', text: 'Fark (now − last) unsigned long aritmetiğiyle hesaplandığı için millis() ~49.7 günde 0\'a sarsa bile doğru çıkar (tamsayı modüler aritmetik). now ≥ last + aralık biçiminde yazmak ise taşmada hata verir.' },
      { t: 'p', text: 'Serial.println ile hangi koşulun ne zaman gerçekleştiğini yazdırmak en basit hata ayıklama yöntemidir. Serial 115200 baud\'da bir karakter ≈ 87 µs sürer; çok sık yazdırmak programı yavaşlatır (gerçek donanımda tampon dolunca bloklar).' },
      { t: 'formula', text: 'T_karakter ≈ 10 bit / baud = 10/115200 ≈ 87 µs', note: 'Bir satır ("buton basildi #3 t=1520", ~24 karakter) ≈ 2 ms' },
      { t: 'warn', text: 'Simülatör sınırı: sketch yorumlayıcısı tam bir C++ derleyicisi değildir (pointer, struct, class, enum, Wire, SPI, attachInterrupt yok). Zamanlama sanal CPU saatine göre ilerler; gerçek derleyici optimizasyonu, ISR ve timer çakışmaları modellenmez. Butonlar ideal olduğundan debounce gösterilmez; gerçek devrede ekleyin.' },
    ],
    calc: [
      { title: 'LED1 frekansı', formula: 'f = 1 / (2·T_aralık)', working: 'aralık 500 ms → yanma + sönme periyodu 1 s → f = 1 Hz' },
      { title: 'LED2 frekansı', formula: 'f = 1/(2·T)', working: 'aralık 150 ms → periyot 300 ms → 3.33 Hz' },
      { title: 'Tarama hızı', formula: 'loop sayısı ≈ F_cpu / (komut sayısı)', working: 'Uno 16 MHz, tur başına ~100–200 µs → saniyede binlerce kez buton okunur' },
      { title: 'LED akımı', formula: 'I = (5 − Vf)/(R + R_pin)', working: '(5 − 1.9)/(330 + 40) = 8.4 mA (kırmızı); yeşil Vf ≈ 2.1 V → 7.8 mA' },
    ],
    build: build08,
    steps: [
      'Hız ayarı! Hızı 1 yapın (gerçek zamanlı).',
      'Çalıştır\'a basın. D1 (kırmızı) 500 ms, D2 (yeşil) 150 ms aralıkla yanıp sönmeli.',
      'SW1\'e basın/bırakın: Seri sekmesinde "buton basildi #n t=…" yazar, LED\'ler hiç duraksamadan çalışır.',
      'GPIO sekmesinde D13, D8 ve D2\'nin seviyelerini izleyin.',
      'Kod sekmesinde ilk iki LED bloğunu delay(500) ile değiştirin ve Yükle: butona basınca olayın kaçırıldığını/geciktiğini seri çıktıda görün.',
      'Aralıkları 250 ve 75 ms yapın: kodun hâlâ butonu yakaladığını doğrulayın.',
    ],
    expects: [
      { label: 'D2 düğümü (10 kΩ pull-up, buton açık)', probe: { q: 'node', comp: 'U1', pin: 'D2' }, value: 5, unit: 'V' },
      { label: 'Buton uçlarındaki gerilim (açık)', probe: { q: 'v', comp: 'SW1' }, value: 5, unit: 'V' },
      { label: 'Pull-up akımı (buton açık)', probe: { q: 'i', comp: 'R3' }, value: 0, tol: { abs: 1e-6 }, unit: 'A' },
    ],
    mistakes: [
      'loop() içinde uzun delay() kullanıp butonu/seri girişi kaçırmak.',
      'Son zaman damgasını güncellemeyi unutmak (last = now): koşul her turda doğru olur, LED çılgın hızla yanıp söner.',
      'Zamanı int ile tutmak: int 16 bit (Uno) olduğundan 32 saniyede taşar; unsigned long kullanın.',
      'now >= last + aralık biçiminde kıyaslamak: millis taşmasında hatalı olur.',
      'Her turda Serial.println çağırmak: seri çıktıyı boğar, zamanlamayı bozar.',
    ],
    faults: [
      { title: 'SW1 kısa devre', how: 'Inspector → Arıza → SW1 → Kısa devre', symptom: 'D2 hep LOW: "buton basildi" yalnızca başlangıçta bir kez (prev başlangıçta HIGH) yazılır, sonra hiç yazılmaz.' },
      { title: 'R3 (pull-up) açık devre', how: 'Inspector → Arıza → R3 → Açık devre', symptom: 'D2 floating: buton açıkken okuma belirsiz, "buton basildi" sahte olaylar üretebilir.' },
    ],
    quiz: [
      { id: 'q1', q: 'delay() ile millis() tabanlı zamanlamanın temel farkı nedir?', options: ['millis daha hassas bir saat kullanır', 'delay işlemciyi bekletir, millis() beklemeden zaman farkı kontrol etmeyi sağlar', 'delay yalnızca ESP32\'de çalışır', 'Fark yok'], answer: 1, explain: 'delay() sırasında kod ilerlemez; millis ile loop() hiç bloklanmadan görevleri sırayla kontrol eder.' },
      { id: 'q2', q: 'Aralığı 150 ms olan bir LED\'in yanıp sönme frekansı kaç Hz\'dir?', answer: 3.33, tol: 0.03, unit: 'Hz', explain: 'Periyot = 2·150 ms = 300 ms → f = 1/0.3 = 3.33 Hz.' },
      { id: 'q3', q: 'Zaman değişkeni için hangi tip uygundur?', options: ['int', 'unsigned long', 'byte', 'bool'], answer: 1, explain: 'millis() 32 bit işaretsiz sayı döndürür; int Uno\'da 16 bittir ve 32 saniyede taşar.' },
      { id: 'q4', q: 'Buton açıkken 10 kΩ pull-up\'a bağlı giriş pini kaç volt okur?', options: ['0 V', 'Yaklaşık 5 V', '2.5 V', '12 V'], answer: 1, explain: 'Giriş pini yüksek empedanslıdır, pull-up dirençten akım geçmez ve pin VCC\'de (5 V) kalır.' },
      { id: 'q5', q: '115200 baud\'da bir karakter yaklaşık ne kadar sürer?', answer: 87, tol: 0.03, unit: 'µs', explain: 'Bir karakter 10 bit (başlangıç + 8 veri + bitiş): 10/115200 ≈ 86.8 µs.' },
    ],
    code: CODE_08,
  },
];
