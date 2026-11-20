export interface SketchTemplate { id: string; name: string; code: string }

export const TEMPLATES: SketchTemplate[] = [
  {
    id: 'blink', name: 'Blink (LED yak-söndür)',
    code: `// LED_BUILTIN pinine bağlı LED'i 500 ms aralıkla yakıp söndürür.
void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  Serial.println("LED yandi");
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  Serial.println("LED sondu");
  delay(500);
}
`,
  },
  {
    id: 'button', name: 'Buton → LED (INPUT_PULLUP)',
    code: `// Buton pin 2 ile GND arasında; basılınca pin LOW olur.
const int BUTTON = 2;
const int LED = 13;

void setup() {
  pinMode(BUTTON, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
}

void loop() {
  if (digitalRead(BUTTON) == LOW) {
    digitalWrite(LED, HIGH);
  } else {
    digitalWrite(LED, LOW);
  }
}
`,
  },
  {
    id: 'pot-pwm', name: 'Potansiyometre → PWM parlaklık',
    code: `// A0'daki potansiyometre değerini okuyup 9 numaralı pindeki LED parlaklığına çevirir.
const int POT = A0;
const int LED = 9;

void setup() {
  pinMode(LED, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  int value = analogRead(POT);              // 0..1023 (10 bit)
  int duty = map(value, 0, 1023, 0, 255);
  analogWrite(LED, duty);
  Serial.print("ADC=");
  Serial.print(value);
  Serial.print(" PWM=");
  Serial.println(duty);
  delay(100);
}
`,
  },
  {
    id: 'serial', name: 'Seri monitör: sayaç',
    code: `int counter = 0;

void setup() {
  Serial.begin(9600);
  Serial.println("Merhaba ElectroLab!");
}

void loop() {
  Serial.print("sayac: ");
  Serial.print(counter);
  Serial.print("  hex: ");
  Serial.println(counter, HEX);
  counter++;
  delay(1000);
}
`,
  },
  {
    id: 'i2c-scanner', name: 'I2C tarayıcı (Wire)',
    code: `// SDA/SCL hattındaki tüm 7 bit adresleri dener, yanıt verenleri yazar.
// Devrede SDA ve SCL için dış pull-up dirençleri (örn. 4.7 kΩ → VCC) OLMALIDIR;
// yoksa hiçbir cihaz bulunmaz ("SDA/SCL pull-up yok" uyarısı çıkar).
// Not: simülasyon işlem düzeyindedir (bit zamanlaması yok).
#include <Wire.h>

void setup() {
  Wire.begin();
  Serial.begin(115200);
  Serial.println("I2C tarama basliyor");
  int n = 0;
  for (byte a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    byte err = Wire.endTransmission();
    if (err == 0) {
      Serial.print("Cihaz bulundu: 0x");
      if (a < 16) Serial.print("0");
      Serial.println(a, HEX);
      n++;
    }
  }
  Serial.print("Toplam: ");
  Serial.println(n);
}

void loop() {
}
`,
  },
  {
    id: 'i2c-tmp102', name: 'TMP102 sıcaklık oku (I2C)',
    code: `// TMP102 sınıfı sensör, adres 0x48 (ADD0=GND). SDA/SCL için dış pull-up gerekir.
// Sıcaklık yazmacı: 12 bit, 0.0625 °C/LSB, 16 bitte sola yaslı.
#include <Wire.h>

const int TMP_ADDR = 0x48;

void setup() {
  Serial.begin(115200);
  Wire.begin();
}

void loop() {
  Wire.beginTransmission(TMP_ADDR);
  Wire.write(0x00);                       // gösterge: sıcaklık yazmacı
  if (Wire.endTransmission() != 0) {
    Serial.println("TMP102 yanit vermedi (pull-up / baglanti?)");
    delay(1000);
    return;
  }
  Wire.requestFrom(TMP_ADDR, 2);
  if (Wire.available() == 2) {
    long msb = Wire.read();
    long lsb = Wire.read();
    long raw = ((msb << 8) | lsb) >> 4;   // 12 bit
    if (raw & 0x800) raw -= 4096;         // negatif sıcaklık (ikilik tümleyen)
    float c = raw * 0.0625;
    Serial.print("Sicaklik: ");
    Serial.print(c, 2);
    Serial.println(" C");
  }
  delay(1000);
}
`,
  },
  {
    id: 'esp32-relay', name: 'ESP32: zamanlayıcı ile çıkış (GPIO26)',
    code: `// ESP32: GPIO26 çıkışını 2 sn açık / 3 sn kapalı çalıştırır (MOSFET/transistör sürücüsü için).
// NOT: GPIO pini yükü doğrudan sürmez, mutlaka transistör/MOSFET kullanın.
const int OUT = 26;

void setup() {
  pinMode(OUT, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  digitalWrite(OUT, HIGH);
  Serial.println("ACIK");
  delay(2000);
  digitalWrite(OUT, LOW);
  Serial.println("KAPALI");
  delay(3000);
}
`,
  },
];
