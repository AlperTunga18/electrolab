import type { ComponentDef } from '../types';
import { boardPart, moduleBoard, modulePart, sipIcPart, dipPins } from '../factories';

/**
 * Library-only modules (no electrical model): dev boards, breakout modules, motors, relays, connectors.
 * All figures are typical values typed from memory and flagged verified:false by the factories.
 */

type MbOpts = Omit<Parameters<typeof moduleBoard>[0], 'h'> & { h?: number };
const mb = (o: MbOpts): ComponentDef => moduleBoard({ h: 0.6, ...o });
const CONN_NOTE = 'Elektriksel model yok (bağlantı elemanı): çözücü bu parça üzerinden iletim yapmaz.';
const MCU_NOTE = 'Elektriksel model yok: kart pin başlıkları ve teknik veriler kütüphane amaçlıdır; çözücü bu kartı devreden bağımsız sayar.';

// ------------------------------------------------------------------ development boards
const BOARDS: ComponentDef[] = [
  boardPart({
    id: 'mod_arduino_uno_r3', mpn: 'A000066', mfr: 'Arduino', name: 'Arduino Uno R3', category: 'mcu', pkg: 'Header (güç+analog / dijital)',
    left: ['RESET', '3V3', '5V', 'GND', 'GND', 'VIN', 'A0', 'A1', 'A2', 'A3', 'A4/SDA', 'A5/SCL'],
    right: ['AREF', 'GND', 'D13/SCK', 'D12/MISO', 'D11/MOSI', 'D10/SS', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1/TX', 'D0/RX'],
    gap: 5.0, color: '#0b6b8a', simNote: MCU_NOTE,
    desc: 'ATmega328P tabanlı 5 V mantık seviyeli kart; başlık düzeyinde basitleştirilmiştir. D0/D1 USB-seri ile paylaşılır, kod yüklerken bu pinlere bağlantı yapmayın.',
    specs: {
      'MCU': 'ATmega328P, 16 MHz', 'Mantık seviyesi': '5 V', 'Besleme': 'USB 5 V veya VIN 7-12 V (mutlak 6-20 V)',
      'GPIO akımı': 'Pin başına 20 mA önerilen (mutlak maks. 40 mA); tüm pinler toplam 200 mA, VCC/GND başına 100-150 mA',
      'ADC': '10 bit, 6 kanal (A0-A5), referans 5 V/1.1 V/AREF', 'PWM': 'D3, D5, D6, D9, D10, D11 (~490 Hz; D5/D6 ~980 Hz)',
      'I2C': 'A4 (SDA), A5 (SCL)', 'SPI': 'D10 (SS), D11 (MOSI), D12 (MISO), D13 (SCK)', 'UART': 'D0 (RX), D1 (TX)',
      'Kesme pinleri': 'D2, D3', 'Pin kısıtlamaları': 'D0/D1 USB seri hattıyla paylaşılır; D13 yerleşik LED; A4/A5 I2C ile aynı pinler',
      '3V3 çıkışı': 'En fazla 50 mA',
    },
  }),
  boardPart({
    id: 'mod_arduino_nano', mpn: 'A000005', mfr: 'Arduino', name: 'Arduino Nano', category: 'mcu', pkg: '2x15 header (15.24 mm sıra aralığı)',
    left: ['D13/SCK', '3V3', 'AREF', 'A0', 'A1', 'A2', 'A3', 'A4/SDA', 'A5/SCL', 'A6', 'A7', '5V', 'RST', 'GND', 'VIN'],
    right: ['D1/TX', 'D0/RX', 'RST', 'GND', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10/SS', 'D11/MOSI', 'D12/MISO'],
    gap: 1.5, color: '#0b6b8a', simNote: MCU_NOTE,
    desc: 'ATmega328P tabanlı 5 V kart. A6 ve A7 yalnızca analog girdidir; dijital giriş/çıkış veya pull-up olarak kullanılamaz.',
    specs: {
      'MCU': 'ATmega328P, 16 MHz', 'Mantık seviyesi': '5 V', 'Besleme': 'USB 5 V veya VIN 7-12 V',
      'GPIO akımı': 'Pin başına 20 mA önerilen (mutlak maks. 40 mA); toplam 200 mA',
      'ADC': '10 bit, 8 kanal (A0-A7)', 'PWM': 'D3, D5, D6, D9, D10, D11', 'I2C': 'A4 (SDA), A5 (SCL)',
      'SPI': 'D10-D13', 'UART': 'D0 (RX), D1 (TX)', 'Pin kısıtlamaları': 'A6/A7 sadece analog giriş; D0/D1 USB seri ile paylaşılır; D13 yerleşik LED',
      '5V pini': 'VIN beslemeyle 5 V regülatör çıkışı; USB ile beslenince USB 5 V',
    },
  }),
  boardPart({
    id: 'mod_arduino_mega_2560', mpn: 'A000067', mfr: 'Arduino', name: 'Arduino Mega 2560 (basitleştirilmiş)', category: 'mcu', pkg: 'Header (D22-D53 çift sıra konnektör gösterilmedi)',
    left: ['RESET', '3V3', '5V', 'GND', 'GND', 'VIN', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15'],
    right: ['AREF', 'GND', 'D13', 'D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1/TX0', 'D0/RX0', 'D14/TX3', 'D15/RX3', 'D16/TX2', 'D17/RX2', 'D18/TX1', 'D19/RX1', 'D20/SDA', 'D21/SCL'],
    gap: 5.0, color: '#0b6b8a', simNote: MCU_NOTE,
    desc: 'ATmega2560 tabanlı 5 V kart; D22-D53 çift sıra konnektörü gösterilmemiştir. D0/D1 USB-seri (ATmega16U2) ile paylaşılır.',
    specs: {
      'MCU': 'ATmega2560, 16 MHz', 'Mantık seviyesi': '5 V', 'Besleme': 'USB 5 V veya VIN 7-12 V',
      'GPIO akımı': 'Pin başına 20 mA önerilen (mutlak maks. 40 mA); toplam 200 mA',
      'Pin sayısı': '54 dijital (15 PWM), 16 analog', 'ADC': '10 bit, 16 kanal (A0-A15)',
      'UART': '4 adet: Serial0 D0/D1, Serial1 D18/D19, Serial2 D16/D17, Serial3 D14/D15',
      'I2C': 'D20 (SDA), D21 (SCL)', 'SPI': 'D50 (MISO), D51 (MOSI), D52 (SCK), D53 (SS)',
      'Kesme pinleri': 'D2, D3, D18, D19, D20, D21', 'Pin kısıtlamaları': 'D0/D1 USB seri ile paylaşılır; D13 yerleşik LED; D22-D53 bu modelde yok',
    },
  }),
  boardPart({
    id: 'mod_esp32_devkit_v1', mpn: 'ESP32-WROOM-32', mfr: 'Espressif', name: 'ESP32 DevKit V1 (30 pin)', category: 'mcu', pkg: '2x15 header',
    left: ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13', 'GND', 'VIN'],
    right: ['D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'TX2', 'RX2', 'D4', 'D2', 'D15', 'GND', '3V3'],
    gap: 2.5, color: '#111827', simNote: MCU_NOTE,
    desc: 'D34, D35, VP(36), VN(39) yalnızca girdidir (pull-up/pull-down yok). Wi-Fi açıkken ADC2 pinleri okunamaz; D12 boot sırasında HIGH olmamalıdır.',
    specs: {
      'MCU': 'ESP32-WROOM-32, çift çekirdek Xtensa LX6, 240 MHz', 'Mantık seviyesi': '3.3 V (5 V toleranslı DEĞİL)',
      'Besleme': 'VIN 5 V (AMS1117 ile 3.3 V), USB 5 V veya 3V3 pininden 3.3 V',
      'GPIO akımı': 'Pin başına tipik sürüş 20 mA, mutlak maks. 40 mA; toplam için datasheet\'e bakın',
      'ADC': '12 bit, ADC1 (D32-D39) ve ADC2 (D0, D2, D4, D12-D15, D25-D27); Wi-Fi açıkken ADC2 kullanılamaz',
      'DAC': '8 bit, D25 ve D26', 'PWM': 'LEDC, 16 kanal, tüm çıkış pinleri',
      'I2C': 'Varsayılan SDA D21, SCL D22 (herhangi bir pine atanabilir)', 'SPI': 'VSPI: D23 (MOSI), D19 (MISO), D18 (SCK), D5 (CS)',
      'UART': 'UART0 TX0/RX0 (GPIO1/3, USB ile paylaşılır), UART2 TX2/RX2 (GPIO17/16)',
      'Girdi-only pinler': 'GPIO34, 35, 36 (VP), 39 (VN); dahili pull-up/down yok',
      'Boot (strapping) pinleri': 'GPIO0 (BOOT, LOW = flash modu), GPIO2 (LOW/floating), GPIO5 (HIGH), GPIO12 (MTDI, boot sırasında HIGH olursa flash 1.8 V seçilir, kart açılmaz), GPIO15 (HIGH = boot günlüğü)',
      'Kullanılamayan pinler': 'GPIO6-11 dahili flash\'a bağlıdır; bu kartın pin başlığında yoktur',
      'Dokunmatik pinler': 'GPIO4, 0, 2, 15, 13, 12, 14, 27, 33, 32',
      'Pin kısıtlamaları': 'D34/D35/VP/VN girdi-only; D12 ve D2/D15/D5 boot pinleri; ADC2 Wi-Fi ile çakışır; TX0/RX0 USB-seri ile paylaşılır',
    },
  }),
  boardPart({
    id: 'mod_nodemcu_esp8266', mpn: 'ESP-12E', mfr: 'Espressif / AI-Thinker', name: 'NodeMCU ESP8266 (ESP-12E v2, 30 pin)', category: 'mcu', pkg: '2x15 header',
    left: ['A0', 'RSV', 'RSV', 'SD3', 'SD2', 'SD1', 'CMD', 'SD0', 'CLK', 'GND', '3V3', 'EN', 'RST', 'GND', 'VIN'],
    right: ['D0', 'D1', 'D2', 'D3', 'D4', '3V3', 'GND', 'D5', 'D6', 'D7', 'D8', 'RX', 'TX', 'GND', '3V3'],
    gap: 2.3, color: '#111827', simNote: MCU_NOTE,
    desc: 'D3(GPIO0), D4(GPIO2) ve D8(GPIO15) boot pinleridir: D3 açılışta LOW olursa kart flash moduna girer, D8 LOW olmalıdır. SD0-SD3/CMD/CLK dahili flash pinleridir, kullanmayın.',
    specs: {
      'MCU': 'ESP8266EX, 80/160 MHz', 'Mantık seviyesi': '3.3 V (5 V toleranslı DEĞİL)', 'Besleme': 'VIN/USB 5 V (AMS1117/LDO), 3V3 pininden 3.3 V',
      'GPIO akımı': 'Pin başına maks. 12 mA (datasheet), tipik 6-12 mA',
      'ADC': '10 bit, tek kanal A0; çipte 0-1 V, NodeMCU kartında bölücü ile 0-3.3 V',
      'PWM': 'Yazılım PWM, tüm GPIO\'lar (GPIO16 hariç), 1 kHz varsayılan', 'I2C': 'Yazılım I2C, genelde D2 (SDA, GPIO4), D1 (SCL, GPIO5)',
      'SPI': 'HSPI: D5 (SCK, GPIO14), D6 (MISO, GPIO12), D7 (MOSI, GPIO13), D8 (CS, GPIO15)', 'UART': 'UART0: TX (GPIO1), RX (GPIO3); UART1 yalnızca TX (GPIO2)',
      'GPIO eşlemesi': 'D0=16, D1=5, D2=4, D3=0, D4=2, D5=14, D6=12, D7=13, D8=15, RX=3, TX=1, SD2=9, SD3=10',
      'Boot (strapping) pinleri': 'GPIO0 (D3): LOW = flash modu; GPIO2 (D4): açılışta HIGH olmalı (yerleşik LED); GPIO15 (D8): açılışta LOW olmalı',
      'Kullanılamayan pinler': 'GPIO6-11 (SD0-SD3, CMD, CLK) flash içindir; GPIO9/10 kullanılabilir ama QIO modda sorunludur',
      'Pin kısıtlamaları': 'GPIO16 (D0): PWM/I2C/kesme yok; derin uyku uyandırma için RST\'ye bağlanır; TX/RX USB-seri ile paylaşılır',
    },
  }),
  boardPart({
    id: 'mod_esp01', mpn: 'ESP-01', mfr: 'AI-Thinker', name: 'ESP-01 (ESP8266)', category: 'comm', pkg: '2x4 header (2.54 mm)',
    left: ['GND', 'GPIO2', 'GPIO0', 'RXD'], right: ['TXD', 'CH_PD', 'RST', 'VCC'], gap: 1.0, color: '#1e3a8a', simNote: MCU_NOTE,
    desc: 'Yalnızca GPIO0 ve GPIO2 serbest kullanılabilir. CH_PD (EN) yüksek olmalı, GPIO0 açılışta LOW ise flash moduna girer; 3.3 V dışında besleme modülü yakar.',
    specs: {
      'MCU': 'ESP8266EX (1 MB flash tipik)', 'Mantık seviyesi': '3.3 V (5 V toleranslı DEĞİL)', 'Besleme': '3.0-3.6 V; ani akım 300-400 mA, düşük akımlı regülatör sorun çıkarır',
      'GPIO akımı': 'Pin başına maks. 12 mA', 'UART': 'TXD/RXD, varsayılan baud genelde 115200 veya 9600 (AT yazılımına göre)',
      'Pin kısıtlamaları': 'GPIO0: LOW = flash modu, serbest bırakılırsa çalışır; GPIO2: açılışta HIGH olmalı; CH_PD HIGH zorunlu; RST dışarıdan LOW ile reset',
      'ADC': 'Yok (ESP-01\'de A0 çıkarılmamıştır)',
    },
  }),
  boardPart({
    id: 'mod_raspberry_pi_pico', mpn: 'SC0915', mfr: 'Raspberry Pi', name: 'Raspberry Pi Pico (RP2040)', category: 'mcu', pkg: '2x20 castellated/header',
    left: ['GP0', 'GP1', 'GND', 'GP2', 'GP3', 'GP4', 'GP5', 'GND', 'GP6', 'GP7', 'GP8', 'GP9', 'GND', 'GP10', 'GP11', 'GP12', 'GP13', 'GND', 'GP14', 'GP15'],
    right: ['VBUS', 'VSYS', 'GND', '3V3_EN', '3V3', 'ADC_VREF', 'GP28', 'AGND', 'GP27', 'GP26', 'RUN', 'GP22', 'GND', 'GP21', 'GP20', 'GP19', 'GP18', 'GND', 'GP17', 'GP16'],
    gap: 1.78, color: '#15803d', simNote: MCU_NOTE,
    desc: 'RP2040, 3.3 V mantık, 5 V toleranslı değil. GP23/24/25/29 kart içinde kullanılır (GP25 = yerleşik LED); yalnızca GP26-GP28 ADC girdisidir.',
    specs: {
      'MCU': 'RP2040, çift çekirdek Cortex-M0+, 133 MHz', 'Mantık seviyesi': '3.3 V (5 V toleranslı DEĞİL)',
      'Besleme': 'VSYS 1.8-5.5 V (VBUS Schottky ile VSYS\'e gider), 3V3 çıkışı en fazla ~300 mA (SMPS)',
      'GPIO akımı': 'Pin başına sürüş 2/4/8/12 mA ayarlanabilir (varsayılan 4 mA); tüm GPIO toplam sınırı için datasheet\'e bakın',
      'ADC': '12 bit (ENOB ~9), 3 harici kanal: GP26 (ADC0), GP27 (ADC1), GP28 (ADC2); ADC3 = VSYS/3 (GP29, dahili), 1 sıcaklık sensörü',
      'PWM': '8 dilim, 16 kanal, tüm GPIO\'lar', 'I2C': '2 çevre birimi: I2C0 (GP0/1, GP4/5, GP8/9...), I2C1 (GP2/3, GP6/7, GP10/11...)',
      'SPI': 'SPI0 varsayılan GP16 (RX), GP17 (CSn), GP18 (SCK), GP19 (TX); SPI1 GP8-GP11', 'UART': 'UART0 GP0/GP1, UART1 GP4/GP5 (alternatif GP8/GP9)',
      'Kullanılamayan pinler': 'GP23 (SMPS PS), GP24 (VBUS algılama), GP25 (LED), GP29 (ADC3, VSYS/3) başlığa çıkmaz',
      'Pin kısıtlamaları': 'ADC yalnızca GP26-GP28; RUN LOW = reset; 3V3_EN LOW = regülatör kapalı; GP25 LED sabit; BOOTSEL ayrı düğme',
    },
  }),
  boardPart({
    id: 'mod_rpi4b_gpio_header', mpn: 'Raspberry Pi 4 Model B', mfr: 'Raspberry Pi', name: 'Raspberry Pi 4B GPIO header', category: 'mcu', pkg: '2x20 header (2.54 mm)',
    left: ['3V3', 'GPIO2/SDA1', 'GPIO3/SCL1', 'GPIO4', 'GND', 'GPIO17', 'GPIO27', 'GPIO22', '3V3', 'GPIO10/MOSI', 'GPIO9/MISO', 'GPIO11/SCLK', 'GND', 'ID_SD', 'GPIO5', 'GPIO6', 'GPIO13', 'GPIO19', 'GPIO26', 'GND'],
    right: ['5V', '5V', 'GND', 'GPIO14/TXD', 'GPIO15/RXD', 'GPIO18', 'GND', 'GPIO23', 'GPIO24', 'GND', 'GPIO25', 'GPIO8/CE0', 'GPIO7/CE1', 'ID_SC', 'GND', 'GPIO12', 'GND', 'GPIO16', 'GPIO20', 'GPIO21'],
    gap: 1.0, color: '#15803d', simNote: MCU_NOTE,
    desc: 'Sol sütun tek (1,3,...,39), sağ sütun çift (2,4,...,40) fiziksel pinlerdir. GPIO\'lar 3.3 V mantıklıdır ve 5 V toleranslı değildir; ADC yoktur.',
    specs: {
      'SoC': 'BCM2711, Cortex-A72 4 çekirdek', 'Mantık seviyesi': '3.3 V (5 V toleranslı DEĞİL)',
      'GPIO akımı': 'Pin başına 2-16 mA ayarlanabilir (varsayılan 8 mA); tüm GPIO toplamı yaklaşık 50 mA ile sınırlandırılmalı',
      '3V3 pinleri': 'Toplam en fazla ~500 mA (kart güç tasarımına bağlı)', '5V pinleri': 'Doğrudan USB-C girişinden; sigorta yok, kısa devre kartı bozabilir',
      'ADC': 'Yok (harici ADC gerekir)', 'PWM': 'Donanım PWM: GPIO12, 13 (PWM0/1), GPIO18, 19 (PWM0/1 ikincil)',
      'I2C': 'I2C1: GPIO2 (SDA), GPIO3 (SCL); kart üzerinde 1.8 kΩ pull-up', 'SPI': 'SPI0: GPIO10 (MOSI), GPIO9 (MISO), GPIO11 (SCLK), GPIO8 (CE0), GPIO7 (CE1)',
      'UART': 'GPIO14 (TXD), GPIO15 (RXD)', 'Pin kısıtlamaları': 'GPIO0/GPIO1 (ID_SD/ID_SC) HAT EEPROM için ayrılmıştır; GPIO2/3 pull-up dahili 1.8 kΩ',
    },
  }),
  boardPart({
    id: 'mod_bluepill_stm32f103c8', mpn: 'STM32F103C8T6', mfr: 'STMicroelectronics', name: 'STM32 Blue Pill (STM32F103C8T6)', category: 'mcu', pkg: '2x20 header',
    left: ['B12', 'B13', 'B14', 'B15', 'A8', 'A9', 'A10', 'A11', 'A12', 'A15', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', '5V', 'GND', '3V3'],
    right: ['GND', 'GND', '3V3', 'R', 'B11', 'B10', 'B1', 'B0', 'A7', 'A6', 'A5', 'A4', 'A3', 'A2', 'A1', 'A0', 'C15', 'C14', 'C13', 'VBAT'],
    gap: 2.0, color: '#1d4ed8', simNote: MCU_NOTE,
    desc: 'PC13-PC15 yüksek akım veremez (3 mA, 2 MHz); PC13 yerleşik LED. PA11/PA12 USB D-/D+ için ayrılmıştır, PA13/PA14 (SWD) başlıkta yoktur.',
    specs: {
      'MCU': 'STM32F103C8T6, Cortex-M3, 72 MHz, 64 KB flash (genelde 128 KB), 20 KB RAM', 'Mantık seviyesi': '3.3 V',
      'Besleme': '5V pini veya USB, 3V3 pininden 3.3 V; çip 2.0-3.6 V',
      'GPIO akımı': 'Pin başına maks. 25 mA, toplam VDD 150 mA; PC13/14/15 akaç 3 mA, kaynak 0 mA (anahtarlama 2 MHz)',
      '5 V toleranslı pinler': 'FT işaretli pinler: PA8-PA12, PA15, PB2-PB15 (PB0/PB1 hariç); PA0-PA7, PB0, PB1 ve PC13-PC15 5 V toleranslı DEĞİL',
      'ADC': '12 bit, 2 ADC, 10 kanal: PA0-PA7, PB0, PB1', 'PWM': 'TIM1-TIM4, çoklu kanal',
      'I2C': 'I2C1: PB6 (SCL), PB7 (SDA); I2C2: PB10 (SCL), PB11 (SDA)', 'SPI': 'SPI1: PA4 (NSS), PA5 (SCK), PA6 (MISO), PA7 (MOSI); SPI2: PB12-PB15',
      'UART': 'USART1: PA9 (TX), PA10 (RX); USART2: PA2 (TX), PA3 (RX); USART3: PB10 (TX), PB11 (RX)',
      'USB': 'PA11 (D-), PA12 (D+)', 'Boot pinleri': 'BOOT0 ve BOOT1 (PB2) sarı atlama kablosu ile ayarlanır; BOOT0=1 sistem bellekten (seri yükleme)',
      'Pin kısıtlamaları': 'PC13 yerleşik LED (ters mantık); PA13/PA14 SWD, PB3/PB4/PA15 varsayılan JTAG; R = NRST; Çin klonlarında flash/CPU farklı olabilir',
    },
  }),
];

// ------------------------------------------------------------------ sensors
const SENSORS: ComponentDef[] = [
  sipIcPart({
    id: 'mod_dht11', mpn: 'DHT11', mfr: 'Aosong', name: 'DHT11 nem/sıcaklık (4 pin)', category: 'sensor', pins: ['VCC', 'DATA', 'NC', 'GND'],
    desc: 'Tek hatlı özel protokol (I2C veya 1-Wire değil); DATA hattı için 4.7-10 kΩ pull-up gerekir. Örnekleme en fazla 1 Hz, nem aralığı yalnızca %20-90.',
    specs: { 'Besleme': '3.3-5.5 V', 'Çıkış': 'Dijital, tek hat (DATA)', 'Nem': '%20-90 RH, ±%5', 'Sıcaklık': '0-50 °C, ±2 °C', 'Örnekleme hızı': 'En fazla 1 Hz', 'Pull-up': 'DATA-VCC arası 4.7-10 kΩ', 'Pin kısıtlamaları': '3. pin bağlantısız (NC); 3 pinli modül sürümünde VCC, DATA, GND (pull-up dahil olabilir)' },
  }),
  sipIcPart({
    id: 'mod_dht22', mpn: 'DHT22', mfr: 'Aosong', name: 'DHT22 / AM2302 nem/sıcaklık (4 pin)', category: 'sensor', pins: ['VCC', 'DATA', 'NC', 'GND'],
    desc: 'Tek hatlı özel protokol; DATA hattı için 4.7-10 kΩ pull-up gerekir. Örnekleme en fazla 0.5 Hz (2 sn arayla okuyun).',
    specs: { 'Besleme': '3.3-6 V', 'Çıkış': 'Dijital, tek hat (DATA)', 'Nem': '%0-100 RH, ±%2-5', 'Sıcaklık': '-40...80 °C, ±0.5 °C', 'Örnekleme hızı': 'En fazla 0.5 Hz', 'Pull-up': 'DATA-VCC arası 4.7-10 kΩ', 'Pin kısıtlamaları': '3. pin bağlantısız (NC)' },
  }),
  sipIcPart({
    id: 'mod_ds18b20', mpn: 'DS18B20', mfr: 'Analog Devices (Maxim)', name: 'DS18B20 sıcaklık (TO-92)', category: 'sensor', pins: ['GND', 'DQ', 'VDD'], pkg: 'TO-92 (alttan görünüm)',
    desc: '1-Wire veri hattı DQ için 4.7 kΩ pull-up gerekir; her çipin 64 bit benzersiz ID\'si vardır, tek hatta birden çok sensör bağlanabilir.',
    specs: { 'Besleme': '3.0-5.5 V', 'Arayüz': '1-Wire (DQ)', 'Sıcaklık': '-55...125 °C, ±0.5 °C (-10...85 °C)', 'Çözünürlük': '9-12 bit ayarlanır (12 bit: 750 ms dönüşüm)', 'Pull-up': 'DQ-VDD arası 4.7 kΩ', 'Pin kısıtlamaları': 'TO-92 düz yüz bakışı alttan: GND, DQ, VDD; ters bağlanırsa ısınır ve zarar görür; parazit güç modunda VDD GND\'ye bağlanır' },
  }),
  sipIcPart({
    id: 'mod_lm35', mpn: 'LM35', mfr: 'Texas Instruments', name: 'LM35 sıcaklık (TO-92)', category: 'sensor', pins: ['+Vs', 'Vout', 'GND'], pkg: 'TO-92 (önden görünüm)',
    desc: 'Analog çıkış 10 mV/°C; uzun kablo veya kapasitif yükte (>~50 pF) salınım yapabilir, çıkışa seri 200 Ω düşünün. Pozitif sıcaklık için tek besleme yeterlidir.',
    specs: { 'Besleme': '4-30 V', 'Çıkış': '10 mV/°C (0 mV @ 0 °C)', 'Doğruluk': '±0.5 °C @ 25 °C (LM35A), ±0.25 °C tipik', 'Aralık': 'LM35: -55...150 °C; LM35D: 0...100 °C (tek besleme: 2...150 °C)', 'ADC notu': '5 V referanslı 10 bit ADC ile çözünürlük ~0.5 °C; analog referans düşürülürse artar', 'Pin kısıtlamaları': 'TO-92 düz yüz bakışı: +Vs, Vout, GND' },
  }),
  mb({
    id: 'mod_hcsr04', mpn: 'HC-SR04', name: 'HC-SR04 ultrasonik mesafe', category: 'sensor', prefix: 'U', labels: ['VCC', 'TRIG', 'ECHO', 'GND'], color: '#1d4ed8', h: 1.5,
    desc: 'ECHO çıkışı 5 V seviyelidir; 3.3 V mikrodenetleyicilere doğrudan bağlamayın (gerilim bölücü veya seviye kaydırıcı kullanın). TRIG girişine en az 10 µs HIGH darbe verin.',
    specs: { 'Besleme': '5 V DC', 'Çalışma akımı': '~15 mA', 'Frekans': '40 kHz', 'Aralık': '2-400 cm', 'Çözünürlük': '~0.3 cm', 'Bakış açısı': '15°', 'Tetik': 'TRIG: ≥10 µs HIGH darbe', 'Pin kısıtlamaları': 'ECHO 5 V çıkar: 3.3 V MCU için bölücü gerekir; ölçüm aralığı en az 60 ms önerilir' },
  }),
  mb({
    id: 'mod_mpu6050', mpn: 'MPU-6050', mfr: 'TDK InvenSense', name: 'MPU6050 / GY-521 6 eksen IMU', category: 'sensor', prefix: 'U', labels: ['VCC', 'GND', 'SCL', 'SDA', 'XDA', 'XCL', 'AD0', 'INT'], color: '#1d4ed8',
    desc: 'I2C adresi AD0 ile seçilir (LOW: 0x68, HIGH: 0x69). Çip 3.3 V\'tur, GY-521 kartındaki regülatör 3.3-5 V besleme kabul eder; XDA/XCL yardımcı I2C hattıdır.',
    specs: { 'Besleme': 'Modül 3.3-5 V (çip 2.375-3.46 V)', 'Arayüz': 'I2C (400 kHz), adres 0x68/0x69', 'İvmeölçer': '±2/4/8/16 g, 16 bit', 'Jiroskop': '±250/500/1000/2000 °/s, 16 bit', 'Sıcaklık sensörü': 'Dahili', 'I2C': 'SCL, SDA; XDA/XCL yardımcı master', 'INT': 'Kesme çıkışı', 'Pin kısıtlamaları': 'Kart üzerinde 4.7 kΩ pull-up vardır; 5 V MCU\'da seviye uyumunu kontrol edin' },
  }),
  mb({
    id: 'mod_bmp280', mpn: 'BMP280', mfr: 'Bosch Sensortec', name: 'BMP280 basınç/sıcaklık (6 pin)', category: 'sensor', prefix: 'U', labels: ['VCC', 'GND', 'SCL', 'SDA', 'CSB', 'SDO'], color: '#7c3aed',
    desc: 'I2C adresi SDO ile seçilir (GND: 0x76, VCC: 0x77); SPI için CSB kullanılır. Çip 3.6 V üstünü kaldırmaz, kart sürümüne göre 3.3 V veya regülatörlüdür.',
    specs: { 'Besleme': '1.71-3.6 V (çip); modüle göre 3.3 V veya 5 V', 'Arayüz': 'I2C (3.4 MHz) veya SPI (3/4 telli, 10 MHz)', 'Basınç': '300-1100 hPa, ±1 hPa mutlak', 'Sıcaklık': '-40...85 °C, ±1 °C', 'I2C adresi': '0x76 (SDO=GND) / 0x77 (SDO=VCC)', 'Pin kısıtlamaları': 'Pin sırası kart üreticisine göre değişebilir; CSB I2C için VCC\'ye bağlanır' },
  }),
  mb({
    id: 'mod_bme280', mpn: 'BME280', mfr: 'Bosch Sensortec', name: 'BME280 basınç/nem/sıcaklık (6 pin)', category: 'sensor', prefix: 'U', labels: ['VCC', 'GND', 'SCL', 'SDA', 'CSB', 'SDO'], color: '#7c3aed',
    desc: 'BMP280\'e ek olarak nem ölçer; I2C adresi SDO ile seçilir (GND: 0x76, VCC: 0x77). Çip 3.6 V üstünü kaldırmaz.',
    specs: { 'Besleme': '1.71-3.6 V (çip); modüle göre 3.3 V veya 5 V', 'Arayüz': 'I2C (3.4 MHz) veya SPI (10 MHz)', 'Nem': '%0-100 RH, ±%3', 'Basınç': '300-1100 hPa, ±1 hPa', 'Sıcaklık': '-40...85 °C, ±1 °C', 'I2C adresi': '0x76 / 0x77', 'Pin kısıtlamaları': 'Pin sırası kart üreticisine göre değişebilir; CSB I2C için VCC\'ye bağlanır' },
  }),
  mb({
    id: 'mod_hcsr501', mpn: 'HC-SR501', name: 'HC-SR501 PIR hareket sensörü', category: 'sensor', prefix: 'U', labels: ['VCC', 'OUT', 'GND'], color: '#0f766e', h: 2.5,
    desc: 'Çıkış 3.3 V HIGH verir (5 V MCU\'ya doğrudan bağlanabilir). Açılışta yaklaşık 30-60 sn ısınma süresi vardır; gecikme ve hassasiyet kart üzerindeki potlarla ayarlanır.',
    specs: { 'Besleme': '4.5-20 V DC', 'Çıkış': '3.3 V HIGH / 0 V LOW', 'Bekleme akımı': '<50 µA', 'Menzil': '3-7 m, 120° koni', 'Tutma süresi': '0.3-200 s (ayarlı)', 'Tetik modu': 'Tekrar tetikleme (H) / tek (L) atlama teli', 'Pin kısıtlamaları': 'Isınma süresi boyunca çıkış güvenilmez' },
  }),
  mb({
    id: 'mod_ina219', mpn: 'INA219', mfr: 'Texas Instruments', name: 'INA219 akım/güç monitörü', category: 'sensor', prefix: 'U', labels: ['VIN+', 'VIN-', 'GND', 'VCC', 'SCL', 'SDA'], color: '#7c3aed',
    desc: 'Yüksek taraf (high-side) akım ölçer; VIN+/VIN- yük hattına seri bağlanır. Veri yolu gerilimi 26 V\'u geçmemelidir, besleme 3-5.5 V\'tur.',
    specs: { 'Besleme (VS)': '3-5.5 V', 'Ölçülen hat gerilimi': '0-26 V', 'Shunt (kart)': '0.1 Ω, ±3.2 A (320 mV tam skala)', 'ADC': '12 bit', 'Arayüz': 'I2C, adres 0x40-0x4F (A0/A1 ile)', 'Pin kısıtlamaları': 'Pin sırası kartlara göre değişir; ölçüm devresi toprağı ile MCU toprağı ortak olmalı' },
  }),
  mb({
    id: 'mod_acs712', mpn: 'ACS712', mfr: 'Allegro', name: 'ACS712 akım sensörü modülü', category: 'sensor', prefix: 'U', labels: ['VCC', 'OUT', 'GND'], color: '#1d4ed8',
    desc: 'Hall tabanlı, yalıtımlı akım sensörü; OUT 0 A\'de VCC/2 (≈2.5 V) verir. Çıkış 5 V ölçeklidir: 3.3 V ADC için bölücü kullanın.',
    specs: { 'Besleme': '5 V', 'Duyarlılık': '5 A: 185 mV/A, 20 A: 100 mV/A, 30 A: 66 mV/A', 'Çıkış': 'VCC/2 ± duyarlılık·I (oransal)', 'Bant genişliği': '80 kHz', 'Yalıtım': '2.1 kV RMS', 'İç direnç': '~1.2 mΩ', 'Pin kısıtlamaları': 'Yüksek akım ve şebeke bağlantısı güvenlik gerektirir; 3.3 V ADC için OUT bölünmeli' },
  }),
  sipIcPart({
    id: 'mod_a3144', mpn: 'A3144', mfr: 'Allegro', name: 'A3144 Hall etkili anahtar (TO-92)', category: 'sensor', pins: ['VCC', 'GND', 'OUT'], pkg: 'TO-92 (düz yüz önde)',
    desc: 'Açık-kollektör çıkış; OUT ile VCC arasına 10 kΩ pull-up gerekir. Yalnızca manyetik güney kutba duyarlıdır (unipolar).',
    specs: { 'Besleme': '4.5-24 V', 'Çıkış': 'Açık kollektör, en fazla 25 mA akıtır', 'Açma (Bop)': 'En fazla 350 G', 'Bırakma (Brp)': 'En az 50 G', 'Pin kısıtlamaları': 'Düz yüz önde: VCC, GND, OUT; pull-up şarttır' },
  }),
  mb({
    id: 'mod_tcrt5000', mpn: 'TCRT5000', mfr: 'Vishay', name: 'TCRT5000 yansımalı IR sensör modülü', category: 'sensor', prefix: 'U', labels: ['VCC', 'GND', 'D0', 'A0'], color: '#1d4ed8',
    desc: 'LM393 karşılaştırıcılı modül; D0 eşik potu ile ayarlanır, A0 analog yansıma düzeyini verir. En iyi algılama mesafesi yaklaşık 2.5 mm\'dir.',
    specs: { 'Besleme': '3.3-5 V', 'Dalga boyu': '950 nm', 'Menzil': '0.2-15 mm (optimum ~2.5 mm)', 'Çıkış': 'D0 dijital (eşik potlu), A0 analog', 'Pin kısıtlamaları': 'Güneş ışığı IR girişimi yapar; D0 mantık seviyesi VCC\'dir' },
  }),
  mb({
    id: 'mod_mq2', mpn: 'MQ-2', name: 'MQ-2 gaz/duman sensör modülü', category: 'sensor', prefix: 'U', labels: ['VCC', 'GND', 'DOUT', 'AOUT'], color: '#1d4ed8', h: 2.2,
    desc: 'Isıtıcı 5 V\'ta yaklaşık 150 mA çeker ve ısınır; ilk kullanımda uzun ısınma (20 dk-24 sa) gerekir. AOUT 0-5 V verir, 3.3 V ADC için bölücü kullanın.',
    specs: { 'Besleme': '5 V (ısıtıcı ~33 Ω)', 'Isıtıcı akımı': '~150 mA (~800 mW)', 'Algılanan gazlar': 'LPG, propan, H2, duman, alkol', 'Aralık': '200-10000 ppm', 'Çıkış': 'AOUT analog, DOUT eşikli dijital', 'Pin kısıtlamaları': 'Isınma süresi gerekir; kalibrasyonsuz ppm değeri güvenilmez; güvenlik uygulamasında tek başına kullanmayın' },
  }),
  boardPart({
    id: 'mod_hx711', mpn: 'HX711', mfr: 'Avia Semiconductor', name: 'HX711 yük hücresi yükselteci', category: 'sensor', pkg: 'Modül',
    left: ['E+', 'E-', 'A-', 'A+', 'B-', 'B+'], right: ['GND', 'DT', 'SCK', 'VCC'], gap: 2.0, color: '#1d4ed8', simNote: MCU_NOTE,
    desc: 'Kanal A: yük hücresi köprü girişi (A+/A-), kazanç 128 veya 64; kanal B kazanç 32. DT/SCK iki telli özel seri arayüzdür (I2C değildir).',
    specs: { 'Besleme': '2.6-5.5 V (modül 2.7-5 V)', 'ADC': '24 bit', 'Kazanç': 'Kanal A: 128/64, kanal B: 32', 'Hız': '10 veya 80 SPS (RATE pini)', 'Arayüz': 'DT (veri), SCK (saat); özel 2 telli', 'Uyarı': 'E+ / E- yük hücresi besleme, A± / B± sinyal', 'Pin kısıtlamaları': 'Yük hücresi kablo renkleri üreticiye göre değişir' },
  }),
  mb({
    id: 'mod_load_cell_4wire', mpn: 'Load cell (4 telli)', name: 'Yük hücresi (4 telli, köprü)', category: 'sensor', prefix: 'U', labels: ['E+', 'E-', 'A+', 'A-'], color: '#9ca3af', h: 1.5,
    desc: 'Wheatstone köprüsü: E+/E- besleme, A+/A- sinyal (tipik 1 mV/V). Kablo renkleri üreticiye göre değişir, kontrol etmeden bağlamayın.',
    specs: { 'Besleme (tipik)': '5 V DC (3-12 V)', 'Hassasiyet': '~1 mV/V (±0.15 mV/V tipik)', 'Köprü direnci': '~1 kΩ', 'Aralık': '1-200 kg (model bağımlı)', 'Pin kısıtlamaları': 'Renk eşlemesi (tipik): kırmızı E+, siyah E-, beyaz A-, yeşil A+; değişebilir' },
  }),
  mb({
    id: 'mod_vl53l0x', mpn: 'VL53L0X', mfr: 'STMicroelectronics', name: 'VL53L0X ToF mesafe sensörü', category: 'sensor', prefix: 'U', labels: ['VIN', 'GND', 'SCL', 'SDA', 'GPIO1', 'XSHUT'], color: '#7c3aed',
    desc: 'I2C adresi 0x29; birden çok sensörde XSHUT ile sırayla adres değiştirilir. Çip 2.6-3.5 V\'tur, kartların regülatörlü olanı VIN\'e 5 V kabul eder.',
    specs: { 'Besleme': 'Çip 2.6-3.5 V; regülatörlü kart VIN 3-5 V', 'Arayüz': 'I2C (400 kHz), adres 0x29', 'Menzil': '30-1200 mm tipik (2 m\'ye kadar)', 'Lazer': '940 nm VCSEL, Class 1', 'GPIO1': 'Kesme çıkışı', 'XSHUT': 'LOW = kapalı (shutdown)', 'Pin kısıtlamaları': 'Pin sırası kart üreticisine göre değişebilir; 3.3 V mantık' },
  }),
  mb({
    id: 'mod_ds3231_rtc', mpn: 'DS3231', mfr: 'Analog Devices (Maxim)', name: 'DS3231 RTC modülü', category: 'sensor', prefix: 'U', labels: ['32K', 'SQW', 'SCL', 'SDA', 'VCC', 'GND'], color: '#1d4ed8',
    desc: 'I2C adresi 0x68 (üzerindeki AT24C32 EEPROM 0x57). ZS-042 modülünde LIR2032 şarj devresi vardır: şarjsız CR2032 takmayın veya şarj diyotunu devreden çıkarın.',
    specs: { 'Besleme': '2.3-5.5 V', 'Doğruluk': '±2 ppm (0-40 °C), sıcaklık kompanzasyonlu', 'Arayüz': 'I2C (400 kHz), adres 0x68', 'Pil': 'CR2032 / LIR2032', 'Çıkışlar': '32 kHz, SQW/INT (açık drenaj)', 'Pin kısıtlamaları': '32K ve SQW açık drenaj: pull-up gerekir; SQW alarm kesmesi için kullanılır' },
  }),
  mb({
    id: 'mod_soil_moisture_resistive', mpn: 'FC-28 / YL-69', name: 'Toprak nem sensörü (dirençli, karşılaştırıcılı)', category: 'sensor', prefix: 'U', labels: ['VCC', 'GND', 'DO', 'AO'], color: '#1d4ed8',
    desc: 'Dirençli prob DC akımla çabuk paslanır; yalnızca ölçüm anında besleyin. AO değeri nem arttıkça düşer, DO eşik potu ile ayarlanır.',
    specs: { 'Besleme': '3.3-5 V', 'Çıkış': 'AO analog, DO dijital (LM393)', 'Pin kısıtlamaları': 'Prob elektrolizle aşınır; AO aralığı VCC\'ye bağlıdır' },
  }),
  mb({
    id: 'mod_soil_moisture_capacitive', mpn: 'Capacitive Soil Moisture v1.2', name: 'Toprak nem sensörü (kapasitif v1.2)', category: 'sensor', prefix: 'U', labels: ['AOUT', 'VCC', 'GND'], color: '#1f2937',
    desc: 'Kapasitif ölçüm; prob korozyona uğramaz. Çıkış nem arttıkça düşer, kalibrasyon (havada/suda) gerekir.',
    specs: { 'Besleme': '3.3-5.5 V', 'Çıkış': 'Analog ~1.2-3.0 V', 'Pin kısıtlamaları': 'Elektronik kısım toprağa batırılmamalı; kalibrasyon şart' },
  }),
  mb({
    id: 'mod_ky040_encoder', mpn: 'KY-040', name: 'KY-040 döner enkoder', category: 'sensor', prefix: 'SW', labels: ['CLK', 'DT', 'SW', '+', 'GND'], color: '#1d4ed8', h: 2.0,
    desc: 'Kuadratür çıkış (CLK/DT) mekanik kontaklıdır: debounce (yazılım/RC) gerekir. SW bastırma anahtarıdır; modülde 10 kΩ pull-up\'lar vardır.',
    specs: { 'Besleme': '3.3-5 V', 'Dekant sayısı': '20 adım/devir', 'Pull-up': '10 kΩ (kart üzerinde)', 'Çıkış': 'CLK, DT kuadratür; SW basma', 'Pin kısıtlamaları': '+ pini pull-up\'ların beslemesidir; MCU seviyesine göre 3.3/5 V verin' },
  }),
  mb({
    id: 'mod_ky023_joystick', mpn: 'KY-023', name: 'KY-023 analog joystick', category: 'sensor', prefix: 'SW', labels: ['GND', '+5V', 'VRX', 'VRY', 'SW'], color: '#1d4ed8', h: 2.5,
    desc: 'İki 10 kΩ potansiyometre; merkezde çıkış ≈VCC/2. SW basma anahtarı pull-up ister (genelde MCU dahili pull-up).',
    specs: { 'Besleme': '3.3-5 V (analog çıkış beslemeyle ölçeklenir)', 'Eksen': '2 adet analog (VRX, VRY), 10 kΩ', 'SW': 'Aktif LOW, harici/dahili pull-up gerekir', 'Pin kısıtlamaları': 'Analog çıkış aralığı beslemeye bağlıdır; 3.3 V ADC için 3.3 V ile besleyin' },
  }),
];

// ------------------------------------------------------------------ displays
const DISPLAYS: ComponentDef[] = [
  mb({
    id: 'mod_ssd1306_i2c', mpn: 'SSD1306 128x64 I2C', mfr: 'Solomon Systech', name: 'SSD1306 OLED 128x64 (I2C)', category: 'display', prefix: 'DS', labels: ['GND', 'VCC', 'SCL', 'SDA'], color: '#1e3a8a',
    desc: 'I2C adresi genelde 0x3C (bazı kartlarda 0x3D). Kart regülatörlü olduğu için 3.3-5 V ile beslenir; piksel akımı ekranın doluluğuna bağlıdır.',
    specs: { 'Çözünürlük': '128x64, monokrom', 'Besleme': '3.3-5 V (modül)', 'Arayüz': 'I2C (400 kHz), adres 0x3C/0x3D', 'Akım': '~20 mA tam beyaz', 'Pin kısıtlamaları': 'Pin sırası (GND-VCC-SCL-SDA) modül üreticisine göre değişebilir (VCC-GND sırası da vardır)' },
  }),
  mb({
    id: 'mod_ssd1306_spi', mpn: 'SSD1306 128x64 SPI', mfr: 'Solomon Systech', name: 'SSD1306 OLED 128x64 (SPI, 7 pin)', category: 'display', prefix: 'DS', labels: ['GND', 'VCC', 'D0/SCK', 'D1/MOSI', 'RES', 'DC', 'CS'], color: '#1e3a8a',
    desc: 'SPI modunda D0 saat, D1 veri (MOSI) hattıdır. RES ekranı sıfırlar (açılışta kısa LOW darbe verin), DC komut/veri seçer.',
    specs: { 'Çözünürlük': '128x64, monokrom', 'Besleme': '3.3-5 V (modül)', 'Arayüz': '4 telli SPI', 'Pin kısıtlamaları': 'RES düşük tutulursa ekran çalışmaz; mantık 3.3 V (5 V MCU için seviye kontrol edin)' },
  }),
  mb({
    id: 'mod_lcd1602_hd44780', mpn: 'HD44780 16x2', mfr: 'Hitachi (HD44780 uyumlu)', name: 'LCD 16x2 HD44780 (16 pin)', category: 'display', prefix: 'DS', color: '#16a34a', h: 1.2,
    labels: ['VSS', 'VDD', 'V0', 'RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A', 'K'],
    desc: 'V0 kontrast ucudur: 10 kΩ pot ile 0-1 V verin. Arka ışık A (anot) pini seri dirençle (ör. 220 Ω) beslenmelidir, doğrudan 5 V\'a bağlanmaz.',
    specs: { 'Besleme': '5 V (VDD)', 'Arayüz': '4 bit (D4-D7) veya 8 bit paralel; RW GND\'ye bağlanabilir', 'Arka ışık': 'A (anot) / K (katot), tipik 15-20 mA, seri direnç şart', 'Pin kısıtlamaları': 'V0 kontrast, ters beslemeyle zarar görür; 3.3 V MCU\'da VIH marjinal olabilir' },
  }),
  mb({
    id: 'mod_lcd1602_i2c', mpn: 'LCD1602 + PCF8574', name: 'LCD 16x2 I2C arka yüz modülü', category: 'display', prefix: 'DS', labels: ['GND', 'VCC', 'SDA', 'SCL'], color: '#16a34a', h: 1.2,
    desc: 'PCF8574 I2C genişletici; adres 0x27 (PCF8574) veya 0x3F (PCF8574A), jumper ile değişir. 5 V ile beslenir; kontrastı arkadaki mavi potla ayarlayın.',
    specs: { 'Besleme': '5 V', 'Arayüz': 'I2C, adres 0x20-0x27 / 0x38-0x3F', 'I2C seviyesi': 'Pull-up\'lar 5 V\'a gidebilir; 3.3 V MCU için seviye kaydırıcı önerilir', 'Pin kısıtlamaları': 'Kontrast potu doğru ayarlanmazsa ekran boş görünür' },
  }),
  mb({
    id: 'mod_tm1637', mpn: 'TM1637', mfr: 'Titan Micro', name: 'TM1637 4 haneli 7 segment', category: 'display', prefix: 'DS', labels: ['CLK', 'DIO', 'VCC', 'GND'], color: '#b91c1c',
    desc: 'TM1637 I2C değildir: CLK/DIO iki telli özel arayüz kullanır, herhangi iki GPIO\'ya bağlanabilir. Parlaklık 8 kademe ayarlanır.',
    specs: { 'Besleme': '3.3-5 V', 'Hane sayısı': '4 (iki nokta ":" dahil)', 'Arayüz': 'CLK/DIO (I2C benzeri, adres yok)', 'Parlaklık': '8 seviye', 'Pin kısıtlamaları': 'I2C veri yoluna bağlanmaz; adres yoktur' },
  }),
  mb({
    id: 'mod_max7219_matrix', mpn: 'MAX7219', mfr: 'Analog Devices (Maxim)', name: 'MAX7219 8x8 LED matris modülü', category: 'display', prefix: 'DS', labels: ['VCC', 'GND', 'DIN', 'CS', 'CLK'], color: '#16a34a',
    desc: 'MAX7219 5 V ile beslenir ve girişlerin VIH değeri yaklaşık 3.5 V\'tur; 3.3 V mikrodenetleyiciden güvenilmez olabilir, seviye kaydırıcı önerilir. Segment akımı RSET ile ayarlanır.',
    specs: { 'Besleme': '4.0-5.5 V', 'Arayüz': 'SPI benzeri (DIN, CLK, CS/LOAD), en fazla 10 MHz', 'Zincirleme': 'DOUT ile (bu modülde yalnızca giriş tarafı gösterildi)', 'Akım': 'RSET ile ayarlı, toplam ~330 mA tam yanık', 'Pin kısıtlamaları': 'VIH min 3.5 V (VDD=5 V): 3.3 V MCU marjinal' },
  }),
  modulePart({
    id: 'mod_7seg_cc_single', mpn: '5161AS (7 segment, ortak katot)', name: '7 segment tek hane (ortak katot, 10 pin)', category: 'display', prefix: 'DS', h: 0.9, color: '#b91c1c', kind: 'box',
    pins: dipPins(['E', 'D', 'CC', 'C', 'DP', 'B', 'A', 'CC', 'F', 'G'], 1.5),
    desc: 'Ortak katot: CC (3 ve 8) toprağa gider, segmentler ayrı seri dirençle sürülür (tipik 330 Ω @ 5 V). Segment başına yaklaşık 10-20 mA aşılmamalıdır.',
    specs: { 'Tip': 'Ortak katot', 'İleri gerilim': '~2 V (kırmızı) @ 10-20 mA', 'Segment akımı': '10-20 mA', 'Pin düzeni': '1 E, 2 D, 3 CC, 4 C, 5 DP, 6 B, 7 A, 8 CC, 9 F, 10 G', 'Pin kısıtlamaları': 'Ortak anot sürümü ters polarite gerektirir; mikrodenetleyici toplam akımı 8 segment x akım olabilir' },
  }),
  mb({
    id: 'mod_ili9341_spi', mpn: 'ILI9341 2.8" TFT', mfr: 'Ilitek', name: 'ILI9341 2.8" TFT SPI (dokunmatikli)', category: 'display', prefix: 'DS', color: '#1d4ed8', h: 0.8,
    labels: ['VCC', 'GND', 'CS', 'RESET', 'DC', 'SDI/MOSI', 'SCK', 'LED', 'SDO/MISO', 'T_CLK', 'T_CS', 'T_DIN', 'T_DO', 'T_IRQ'],
    desc: 'Giriş mantığı 3.3 V\'tur; 5 V MCU için seviye kaydırıcı (veya direnç bölücü) kullanın. Dokunmatik XPT2046 ayrı CS (T_CS) ile aynı SPI hattında çalışır.',
    specs: { 'Çözünürlük': '240x320, 65K renk', 'Besleme': 'VCC 3.3-5 V (modül regülatörlü olanlar)', 'Arayüz': 'SPI (genelde 10-40 MHz), DC komut/veri', 'Arka ışık': 'LED pini; doğrudan 3.3 V veya PWM/transistör', 'Dokunmatik': 'XPT2046 (T_CLK, T_CS, T_DIN, T_DO, T_IRQ)', 'Pin kısıtlamaları': 'Pin sırası modüle göre değişebilir; mantık 3.3 V' },
  }),
];

// ------------------------------------------------------------------ motors, actuators, relays, buzzers
const ACTUATORS: ComponentDef[] = [
  mb({
    id: 'mod_sg90_servo', mpn: 'SG90', mfr: 'TowerPro', name: 'SG90 mikro servo', category: 'motor', prefix: 'M', labels: ['GND', 'VCC', 'SIGNAL'], color: '#1d4ed8', h: 2.3,
    desc: 'Kablo renkleri: GND kahverengi, VCC kırmızı, sinyal turuncu. Servo akımını MCU 5 V pininden değil, ayrı 5 V beslemeden verin; GND\'ler ortak olmalı.',
    specs: { 'Besleme': '4.8-6 V', 'Sinyal': '50 Hz PWM, 0.5-2.4 ms darbe (genelde 1-2 ms)', 'Tork': '~1.8 kg·cm @ 4.8 V', 'Akım': 'Boşta ~10 mA, hareket ~100-250 mA, stall ~650 mA', 'Hız': '~0.1 s/60° @ 4.8 V', 'Kablo': 'Kahverengi GND, kırmızı VCC, turuncu sinyal', 'Pin kısıtlamaları': 'Stall akımı MCU regülatörünü aşar; sinyal 3.3 V ile çoğunlukla çalışır' },
  }),
  mb({
    id: 'mod_mg996r_servo', mpn: 'MG996R', mfr: 'TowerPro', name: 'MG996R servo', category: 'motor', prefix: 'M', labels: ['GND', 'VCC', 'SIGNAL'], color: '#1d4ed8', h: 4.0,
    desc: 'Metal dişli yüksek tork servo; stall akımı yaklaşık 2.5 A\'e çıkar, mutlaka güçlü ayrı besleme kullanın. Kablo: kahverengi GND, kırmızı VCC, turuncu sinyal.',
    specs: { 'Besleme': '4.8-7.2 V', 'Sinyal': '50 Hz PWM, ~1-2 ms darbe (0.5-2.5 ms uç)', 'Tork': '~9.4 kg·cm @ 4.8 V, ~11 kg·cm @ 6 V', 'Akım': 'Boşta ~10 mA, stall ~2.5 A @ 6 V', 'Pin kısıtlamaları': 'Ayrı 5-6 V/3 A+ besleme ve ortak GND şart' },
  }),
  mb({
    id: 'mod_28byj48_uln2003', mpn: '28BYJ-48 + ULN2003', name: '28BYJ-48 step motor + ULN2003 sürücü kartı', category: 'motor', prefix: 'M', labels: ['IN1', 'IN2', 'IN3', 'IN4', '+', '-'], color: '#1d4ed8', h: 2.0,
    desc: 'Tek kutuplu 5 V step motor; ULN2003 kartı IN1-IN4 girişlerini 5 V\'ta kanal başı 500 mA\'e kadar sürer. Besleme kartın +/- ucundan verilir, MCU pinlerinden değil.',
    specs: { 'Besleme': '5 V (+ / -)', 'Motor': 'Tek kutuplu, 4 faz, bobin ~50 Ω', 'Adım': 'Tam adım 4 faz: 2048 adım/devir; yarım adım 4096', 'Akım': '~240 mA tipik (2 faz)', 'ULN2003': 'Kanal başı 500 mA', 'Pin kısıtlamaları': 'IN1-IN4 sırası faz sırasıdır; sıra bozulursa motor titreşir; GND ortak olmalı' },
  }),
  mb({
    id: 'mod_nema17_stepper', mpn: 'NEMA17 (genel)', name: 'NEMA17 step motor (bipolar, 4 telli)', category: 'motor', prefix: 'M', labels: ['A+', 'A-', 'B+', 'B-'], color: '#6b7280', h: 4.0,
    desc: 'İki bobin: A+/A- bir bobin, B+/B- diğeri. Bobin eşlemesi bir ohmmetre ile (aynı bobin ~1-5 Ω) doğrulanmalı; tip değerleri model bağımlıdır, motor plakasına bakın.',
    specs: { 'Adım açısı': '1.8° (200 adım/devir)', 'Besleme (tipik)': '12-24 V sürücü ile', 'Bobin akımı (tipik)': '1.0-2.0 A/faz', 'Tutma torku (tipik)': '30-50 N·cm', 'Tip': 'Bipolar, sürücü gerekir (A4988/DRV8825)', 'Pin kısıtlamaları': 'Sürücü açıkken motor kablosu takılıp çıkarılmamalı; akım sınırı ayarlanmalı' },
  }),
  mb({
    id: 'mod_dc_motor_130', mpn: 'RF-130 (DC motor 130)', name: 'DC motor 130 (2 pin)', category: 'motor', prefix: 'M', labels: ['1', '2'], color: '#9ca3af', h: 2.0,
    desc: 'Fırçalı küçük DC motor. Bobin yükü: transistörle sürün ve motora paralel flyback diyotu (1N4001/Schottky) ekleyin; stall akımı yüksektir.',
    specs: { 'Besleme (tipik)': '3-6 V', 'Boşta akım (tipik)': '70-150 mA', 'Stall akımı (tipik)': '~0.7-2 A', 'Pin kısıtlamaları': 'MCU pininden doğrudan sürülmez; yön için H-köprüsü gerekir; değerler motor üretimine göre değişir' },
  }),
  mb({
    id: 'mod_bldc_3phase', mpn: 'BLDC (3 faz, genel)', name: 'Fırçasız DC (BLDC) motor, 3 faz', category: 'motor', prefix: 'M', labels: ['U', 'V', 'W'], color: '#6b7280', h: 2.5,
    desc: 'Üç faz ucu (U, V, W) ESC veya BLDC sürücüsüne bağlanır; doğrudan DC kaynağa bağlanmaz. Faz sırası dönüş yönünü belirler, ikisini yer değiştirmek yönü çevirir.',
    specs: { 'Tip': 'Üç fazlı fırçasız, sürücü/ESC gerekir', 'Pin kısıtlamaları': 'Doğrudan besleme verilmez; elektriksel değerler motora özeldir (KV, akım, voltaj)' },
  }),
  mb({
    id: 'mod_fan_12v_2pin', mpn: 'DC fan 12 V (2 pin)', name: 'Fan 12 V (2 pin)', category: 'motor', prefix: 'M', labels: ['+', '-'], color: '#1f2937', h: 2.5,
    desc: 'Kırmızı +12 V, siyah GND; kırmızı/siyah ters bağlanırsa fan çalışmaz veya zarar görebilir. Rotor kilitlenirse sargı akımı yükselir.',
    specs: { 'Besleme': '12 V DC (tipik 10.8-13.2 V)', 'Akım (tipik)': '~0.1-0.25 A', 'Pin kısıtlamaları': '2 telli fanda hız ölçümü (tach) yoktur; PWM ile MOSFET kullanılabilir, flyback diyot önerilir' },
  }),
  mb({
    id: 'mod_buzzer_active', mpn: 'Active buzzer 5 V', name: 'Aktif buzzer (5 V)', category: 'io', prefix: 'BZ', labels: ['+', '-'], color: '#111827', h: 0.9,
    desc: 'Dahili osilatörlü: DC verildiğinde sabit tonda öter (tipik 2-4 kHz). Uzun bacak +; akım genelde 30 mA altındadır ama MCU pin sınırını kontrol edin.',
    specs: { 'Besleme': '3-5 V (modele göre)', 'Akım': '~25-30 mA', 'Frekans': '~2.3-2.7 kHz sabit', 'Pin kısıtlamaları': 'Frekans değiştirilemez; 40 mA\'e yakın çeken modeller MCU pininden sürülmemeli' },
  }),
  mb({
    id: 'mod_buzzer_passive', mpn: 'Passive buzzer', name: 'Pasif buzzer / piezo', category: 'io', prefix: 'BZ', labels: ['+', '-'], color: '#111827', h: 0.9,
    desc: 'Osilatörü yoktur: kare dalga (PWM, tipik 2-4 kHz) uygulanmalıdır; DC ile sadece tıklar. Rezonans frekansında en yüksek ses verir.',
    specs: { 'Sürüş': 'Kare dalga, 2-4 kHz tipik rezonans', 'Gerilim': '3-12 V tepe (modele göre)', 'Akım': 'Birkaç mA - 30 mA', 'Pin kısıtlamaları': 'Frekansı yazılımla (tone/PWM) üretmek gerekir' },
  }),
  mb({
    id: 'mod_speaker_8ohm', mpn: 'Speaker 8 Ω 0.5 W', name: 'Hoparlör 8 Ω / 0.5 W', category: 'io', prefix: 'LS', labels: ['+', '-'], color: '#1f2937', h: 1.2,
    desc: 'Düşük empedans yük: MCU pininden doğrudan sürülmez; 5 V\'ta DC ile 600 mA çeker. Kondansatör üzerinden veya sınıf-D/PAM8403 gibi yükselteçle bağlayın.',
    specs: { 'Empedans': '8 Ω', 'Güç': '0.5 W', 'Sürüş': 'Yükselteç (ör. LM386, PAM8403) gerekir', 'Pin kısıtlamaları': 'DC akım geçirmeyin; MCU pininden doğrudan sürmek pin akım sınırını aşar' },
  }),
  mb({
    id: 'mod_srd05vdc_relay', mpn: 'SRD-05VDC-SL-C', mfr: 'Songle', name: 'Röle SRD-05VDC-SL-C (5 V bobin, SPDT)', category: 'power', prefix: 'K', labels: ['Coil1', 'Coil2', 'COM', 'NO', 'NC'], color: '#1d4ed8', h: 1.5, pkg: 'Elektromekanik, 5 pin',
    desc: 'Bobin 5 V, yaklaşık 70-90 mA çeker; MCU pininden değil transistörle sürün ve bobine paralel flyback diyotu (1N4007) koyun. Kontaklar 10 A/250 VAC, ama şebeke gerilimi öldürücüdür.',
    specs: { 'Bobin': '5 VDC, ~70 Ω, ~70-90 mA', 'Kontak': '1 x SPDT (COM, NO, NC)', 'Kontak kapasitesi': '10 A @ 250 VAC / 10 A @ 30 VDC', 'Süre': 'Çekme ~10 ms, bırakma ~5 ms', 'Pin kısıtlamaları': 'Bobin uçları kutupsuz ama flyback diyotu yönü önemlidir; yalıtım mesafelerine dikkat' },
  }),
  boardPart({
    id: 'mod_relay_module_1ch', mpn: '1 kanallı 5 V röle modülü', name: 'Röle modülü 1 kanal (5 V)', category: 'power', pkg: 'Modül',
    left: ['VCC', 'GND', 'IN'], right: ['COM', 'NO', 'NC'], gap: 2.0, color: '#1d4ed8', simNote: MCU_NOTE,
    desc: 'Tipik modül optokuplörlü ve genelde LOW tetiklidir (IN=LOW iken röle çeker). Bobin 5 V ~70-90 mA çeker; kontak tarafında şebeke gerilimi öldürücüdür.',
    specs: { 'Besleme': '5 V (VCC/GND), bobin ~70-90 mA', 'Giriş': 'IN: 2-5 mA, genelde aktif-LOW (optokuplörlü), 3.3 V MCU ile LOW/HIGH uyumuna bakın', 'Kontak': '10 A @ 250 VAC / 30 VDC (SRD-05VDC-SL-C)', 'Pin kısıtlamaları': 'JD-VCC atlama teli kaldırılırsa bobin ayrı beslenir; 3.3 V MCU\'da HIGH seviye yetersiz kalabilir' },
  }),
  mb({
    id: 'mod_ssr_25da', mpn: 'SSR-25DA', name: 'Katı hal röle SSR-25DA', category: 'power', prefix: 'K', labels: ['LOAD1', 'LOAD2', 'IN+', 'IN-'], color: '#b91c1c', h: 2.5,
    desc: 'DC kontrollü (3-32 V), AC yükü sürer (24-380 VAC, 25 A); DC yük sürmez. Yük akımında ısınır, soğutucu gerekir; şebeke gerilimi öldürücüdür.',
    specs: { 'Giriş': '3-32 VDC, ~7.5-15 mA', 'Yük': '24-380 VAC, 25 A (soğutucu ile)', 'Anahtarlama': 'Sıfır geçişli (zero-cross), AC yük için', 'Pin kısıtlamaları': 'Yalnızca AC yük; sızıntı akımı vardır, tam izolasyon yoktur; soğutucu zorunlu' },
  }),
  mb({
    id: 'mod_solenoid_12v', mpn: 'Solenoid 12 V (genel)', name: 'Solenoid 12 V (push-pull, genel)', category: 'motor', prefix: 'M', labels: ['1', '2'], color: '#6b7280', h: 3.0,
    desc: 'Endüktif yük: MOSFET/transistörle sürün ve bobine paralel flyback diyotu koyun. Sürekli enerjilendirmede ısınır, görev döngüsü sınırı vardır.',
    specs: { 'Besleme (tipik)': '12 VDC', 'Akım (tipik)': '0.3-1 A (model bağımlı)', 'Görev döngüsü': 'Genelde %25-50; sürekli çalışma ısı yapar', 'Pin kısıtlamaları': 'Flyback diyotu şart; MCU pininden doğrudan sürülmez' },
  }),
];

// ------------------------------------------------------------------ communication & power modules
const COMM_POWER: ComponentDef[] = [
  boardPart({
    id: 'mod_nrf24l01', mpn: 'nRF24L01+', mfr: 'Nordic Semiconductor', name: 'nRF24L01+ 2.4 GHz modül', category: 'comm', pkg: '2x4 header',
    left: ['GND', 'CE', 'SCK', 'MISO'], right: ['VCC', 'CSN', 'MOSI', 'IRQ'], gap: 1.0, color: '#1d4ed8', simNote: MCU_NOTE,
    desc: 'Besleme yalnızca 3.3 V (1.9-3.6 V): 5 V verilirse çip yanar. SPI girişleri 5 V toleranslıdır; VCC ile GND arasına 10-100 µF kondansatör önerilir.',
    specs: { 'Besleme': '1.9-3.6 V (3.3 V)', 'Giriş mantığı': '5 V toleranslı', 'Arayüz': 'SPI (en fazla 10 MHz) + CE, CSN, IRQ', 'Frekans': '2.4 GHz ISM, 125 kanal', 'Veri hızı': '250 kbps / 1 / 2 Mbps', 'Akım': 'TX 11.3 mA @ 0 dBm, RX ~13.5 mA', 'Pin kısıtlamaları': 'VCC 3.3 V; PA+LNA sürümleri 100+ mA çekebilir, regülatör ve kondansatör gerekir; fiziksel sıra: 1 GND, 2 VCC, 3 CE, 4 CSN, 5 SCK, 6 MOSI, 7 MISO, 8 IRQ' },
  }),
  mb({
    id: 'mod_hc05', mpn: 'HC-05', name: 'HC-05 Bluetooth seri modülü', category: 'comm', prefix: 'U', labels: ['STATE', 'RX', 'TX', 'GND', 'VCC', 'EN'], color: '#1d4ed8',
    desc: 'RX girişi 3.3 V mantıklıdır: 5 V MCU TX hattını bölücü ile düşürün. EN/KEY pini AT komut moduna alır (genelde 38400 baud).',
    specs: { 'Besleme': '3.6-6 V (modül regülatörlü), çip 3.3 V', 'Arayüz': 'UART, varsayılan 9600 baud (AT modunda 38400)', 'Bluetooth': '2.0 + EDR, SPP, menzil ~10 m', 'Mantık': '3.3 V (RX 5 V toleranslı değil)', 'Pin kısıtlamaları': 'TX HC-05 çıkışı 3.3 V; RX\'e 5 V uygulamayın; STATE bağlantı durumunu verir' },
  }),
  mb({
    id: 'mod_neo6m_gps', mpn: 'NEO-6M', mfr: 'u-blox', name: 'NEO-6M GPS modülü', category: 'comm', prefix: 'U', labels: ['VCC', 'RX', 'TX', 'GND'], color: '#1d4ed8',
    desc: 'Çıkış UART (NMEA), varsayılan 9600 baud. Anten açık gökyüzü görmelidir; soğuk başlangıç ~27 sn sürer, kapalı mekanda konum vermez.',
    specs: { 'Besleme': 'Modül 3.3-5 V (çip 2.7-3.6 V)', 'Arayüz': 'UART (TX/RX), 9600 baud varsayılan', 'Güncelleme hızı': '1 Hz varsayılan, en fazla 5 Hz', 'Başlangıç': 'Soğuk ~27 s, sıcak ~1 s', 'Pin kısıtlamaları': 'TX modülün çıkışıdır (MCU RX\'ine bağlanır); mantık 3.3 V' },
  }),
  mb({
    id: 'mod_mcp2515_can', mpn: 'MCP2515 + TJA1050', mfr: 'Microchip', name: 'MCP2515 CAN modülü', category: 'comm', prefix: 'U', labels: ['VCC', 'GND', 'CS', 'SO', 'SI', 'SCK', 'INT'], color: '#1d4ed8',
    desc: 'SPI arayüzlü CAN denetleyici (CANH/CANL vidalı uç ayrı). TJA1050 5 V ile çalışır, MCU 3.3 V ise SPI hatları için seviye kaydırıcı gerekir.',
    specs: { 'Besleme': '5 V (TJA1050 alıcı-verici)', 'CAN hızı': 'En fazla 1 Mbps', 'Arayüz': 'SPI (10 MHz), INT kesme çıkışı', 'Kristal': 'Genelde 8 MHz (ayarlı olmalı)', 'Pin kısıtlamaları': 'SO = MISO, SI = MOSI; modül 5 V mantık, 3.3 V MCU için seviye uyumu gerekir; hat sonu 120 Ω jumper' },
  }),
  boardPart({
    id: 'mod_rs485_ttl', mpn: 'MAX485', mfr: 'Analog Devices (Maxim)', name: 'RS485 – TTL modülü (MAX485)', category: 'comm', pkg: 'Modül',
    left: ['RO', 'RE', 'DE', 'DI'], right: ['VCC', 'B', 'A', 'GND'], gap: 2.0, color: '#1d4ed8', simNote: MCU_NOTE,
    desc: 'RE (aktif LOW) ve DE (aktif HIGH) genelde birleştirilip tek GPIO ile yön kontrolü yapılır. Modül 5 V\'tur; RO çıkışı 5 V seviyeli olduğundan 3.3 V MCU için bölücü kullanın.',
    specs: { 'Besleme': '5 V', 'Hız': 'En fazla 2.5 Mbps', 'Hat yükü': '32 birim yük', 'Pin kısıtlamaları': 'RE+DE birleştirilir (HIGH=gönder, LOW=al); A/B kutupluluğu cihaza göre; hat sonu 120 Ω; RO 5 V çıkışlıdır' },
  }),
  mb({
    id: 'mod_lm2596_buck', mpn: 'LM2596', mfr: 'Texas Instruments', name: 'LM2596 buck DC-DC modülü', category: 'power', prefix: 'PM', labels: ['IN+', 'IN-', 'OUT+', 'OUT-'], color: '#1d4ed8', h: 1.8,
    desc: 'Giriş 4.5-40 V, çıkış 1.25-35 V (giriş çıkıştan en az ~1.5-2 V yüksek olmalı); çıkış pot ile ayarlanır. Önce çıkış gerilimini ölçüp yükü öyle bağlayın; uzun süreli >2 A için soğutucu gerekir.',
    specs: { 'Giriş': '4.5-40 V', 'Çıkış': '1.25-35 V ayarlı', 'Akım': '3 A maks., sürekli ~2 A (soğutucu olmadan)', 'Anahtarlama': '150 kHz', 'Verim': '~80-90 %', 'Pin kısıtlamaları': 'Giriş-çıkış toprağı ortaktır (yalıtımsız); pot yön ayarı ters bağlantıda koruma yok' },
  }),
  mb({
    id: 'mod_mt3608_boost', mpn: 'MT3608', mfr: 'Aerosemi', name: 'MT3608 boost DC-DC modülü', category: 'power', prefix: 'PM', labels: ['IN+', 'IN-', 'OUT+', 'OUT-'], color: '#1d4ed8', h: 1.5,
    desc: 'Giriş 2-24 V, çıkış 5-28 V (çıkış girişten yüksek olmalı); düşük girişte akım küçüktür (~1-2 A anahtar). Boost olduğu için yük çıkışında kısa devre koruması yoktur, ters bağlantı yakar.',
    specs: { 'Giriş': '2-24 V', 'Çıkış': '5-28 V ayarlı (Vin\'den yüksek)', 'Anahtar akımı': '4 A tepe, 2 A sürekli (düşük Vin\'de çok daha az)', 'Anahtarlama': '1.2 MHz', 'Pin kısıtlamaları': 'Vout < Vin yapılamaz; çıkış kısa devre korumasız; giriş akımı çıkıştan büyüktür' },
  }),
  mb({
    id: 'mod_xl6009_boost', mpn: 'XL6009', mfr: 'XLSEMI', name: 'XL6009 boost DC-DC modülü', category: 'power', prefix: 'PM', labels: ['IN+', 'IN-', 'OUT+', 'OUT-'], color: '#1d4ed8', h: 1.8,
    desc: 'Giriş 5-32 V, çıkış 5-35 V (Vout > Vin), 4 A anahtar akımı; uzun süre yüksek akımda soğutucu gerekir. Çıkış kısa devre korumasızdır, giriş ters korumasız.',
    specs: { 'Giriş': '5-32 V', 'Çıkış': '5-35 V ayarlı', 'Anahtar akımı': '4 A', 'Anahtarlama': '400 kHz', 'Pin kısıtlamaları': 'Vout ≥ Vin; ters bağlantı ve çıkış kısa devre korumasızdır' },
  }),
  mb({
    id: 'mod_mp1584_buck', mpn: 'MP1584EN', mfr: 'Monolithic Power Systems', name: 'MP1584 mini buck DC-DC modülü', category: 'power', prefix: 'PM', labels: ['IN+', 'IN-', 'OUT+', 'OUT-'], color: '#1d4ed8', h: 1.2,
    desc: 'Giriş 4.5-28 V, çıkış 0.8-20 V ayarlı, 3 A tepe (sürekli ~2 A). Çıkış ayarı çok küçük bir trimpotla yapılır; önce yük bağlamadan ayarlayın.',
    specs: { 'Giriş': '4.5-28 V', 'Çıkış': '0.8-20 V ayarlı', 'Akım': '3 A tepe, ~2 A sürekli', 'Anahtarlama': '1.5 MHz', 'Pin kısıtlamaları': 'Yalıtımsız; ters polarite korumasız; çıkış girişten düşük olmalı' },
  }),
  mb({
    id: 'mod_tp4056_protected', mpn: 'TP4056 + DW01A', name: 'TP4056 şarj modülü (korumalı)', category: 'power', prefix: 'PM', labels: ['IN+', 'IN-', 'B+', 'B-', 'OUT+', 'OUT-'], color: '#1d4ed8', h: 1.2,
    desc: 'Tek hücreli Li-ion/LiPo şarjı (4.2 V CC/CV, tipik 1 A). Sadece tek hücre bağlanır; B+/B- pil, OUT+/OUT- yük (aşırı deşarj/akım korumalı). Şarj sırasında ısınır.',
    specs: { 'Giriş': '4-8 V (USB 5 V)', 'Şarj gerilimi': '4.2 V ±1.5 %', 'Şarj akımı': '1 A (RPROG 1.2 kΩ)', 'Koruma (DW01A+8205A)': 'Aşırı deşarj ~2.4-2.5 V, aşırı akım ~3 A, kısa devre', 'Bitiş': 'C/10 (~100 mA)', 'Pin kısıtlamaları': 'Yalnızca 1S Li-ion/LiPo; B+/B- ters bağlanırsa çip yanar; Pil ile giriş aynı anda bağlıyken yük çıkışı kesilebilir' },
  }),
  mb({
    id: 'mod_cp2102_usb_uart', mpn: 'CP2102', mfr: 'Silicon Labs', name: 'CP2102 USB-UART modülü', category: 'comm', prefix: 'U', labels: ['3V3', 'GND', 'TXD', 'RXD', '5V'], color: '#1d4ed8',
    desc: 'Modül TXD hedef MCU RX\'ine, RXD hedef MCU TX\'ine bağlanır. 3.3 V çıkış CP2102 iç regülatöründen gelir (en fazla ~100 mA); 5V pini USB VBUS\'tır.',
    specs: { 'USB': '2.0 full-speed', 'Mantık': '3.3 V (giriş pinleri 5 V toleranslı)', '3V3 çıkışı': 'En fazla ~100 mA', '5V pini': 'USB VBUS (doğrudan USB 5 V)', 'Baud': '300 bps - 1 Mbps', 'Pin kısıtlamaları': 'TX/RX çapraz bağlanır; 3V3 ve 5V pinlerini ikisini birden besleme olarak kullanmayın' },
  }),
];

// ------------------------------------------------------------------ connectors
const connector = (o: { id: string; mpn: string; mfr?: string; name: string; labels: string[]; desc: string; specs: Record<string, string>; h?: number; color?: string }): ComponentDef =>
  mb({ ...o, category: 'connector', prefix: 'J', color: o.color ?? '#1d4ed8', h: o.h ?? 1.0, simNote: CONN_NOTE });

const CONNECTORS: ComponentDef[] = [
  connector({
    id: 'mod_screw_terminal_2p', mpn: 'Vidalı klemens 5.08 mm 2P', name: 'Vidalı klemens 2 pin (5.08 mm)', labels: ['1', '2'], h: 1.5,
    desc: 'Kablo ucu vidalı klemens; tipik 5.08 mm aralık, 10 A / 300 V sınıfı (üreticiye göre değişir). Kablo kesitine uygun sıkma uygulayın.',
    specs: { 'Aralık': '5.08 mm', 'Akım (tipik)': '10-15 A', 'Gerilim (tipik)': '250-300 V', 'Tel': '0.3-2.0 mm² (tipik)' },
  }),
  connector({
    id: 'mod_screw_terminal_3p', mpn: 'Vidalı klemens 5.08 mm 3P', name: 'Vidalı klemens 3 pin (5.08 mm)', labels: ['1', '2', '3'], h: 1.5,
    desc: 'Üç kutuplu vidalı klemens; tipik 5.08 mm aralık. Akım ve gerilim sınırları üreticiye göre değişir.',
    specs: { 'Aralık': '5.08 mm', 'Akım (tipik)': '10-15 A', 'Gerilim (tipik)': '250-300 V', 'Tel': '0.3-2.0 mm² (tipik)' },
  }),
  connector({
    id: 'mod_header_1x4', mpn: '1x4 pin header 2.54 mm', name: '1x4 pin header (2.54 mm)', labels: ['1', '2', '3', '4'], h: 1.1,
    desc: '2.54 mm aralıklı tek sıra erkek pin başlık. Tipik temas akımı pin başına 1-3 A\'dir, lehim noktası kalitesine bağlıdır.',
    specs: { 'Aralık': '2.54 mm', 'Akım (tipik)': '1-3 A/pin', 'Gerilim (tipik)': '250 V' },
  }),
  connector({
    id: 'mod_jst_xh_2p', mpn: 'JST XH 2P', mfr: 'JST', name: 'JST-XH 2 pin (2.5 mm)', labels: ['1', '2'], h: 1.0,
    desc: '2.5 mm aralıklı JST-XH 2 pinli konnektör; kutupluluğu kilitli gövdesiyle korur. Tipik 3 A / 250 V.',
    specs: { 'Aralık': '2.5 mm', 'Akım': '3 A', 'Gerilim': '250 V' },
  }),
  connector({
    id: 'mod_dc_barrel_jack_55x21', mpn: 'DC barrel jack 5.5x2.1 mm', name: 'DC güç jakı 5.5x2.1 mm (3 pin)', labels: ['CENTER', 'SLEEVE', 'SW'], h: 1.2,
    desc: 'Merkez pin (tipik +, ancak polarite adaptöre göre değişir; ters bağlantıya karşı diyot koruması koyun). SW, fiş takılınca açılan anahtarlı kontaktır.',
    specs: { 'Boyut': '5.5 mm dış / 2.1 mm iç çap', 'Akım (tipik)': '2-5 A', 'Gerilim (tipik)': '12-24 V', 'Pin kısıtlamaları': 'Merkez polarite standardı yoktur; adaptör etiketine bakın; ters polarite için P-MOSFET/diyot koruması önerilir' },
  }),
  connector({
    id: 'mod_micro_usb_breakout', mpn: 'Micro-USB breakout', name: 'Micro-USB breakout (5 pin)', labels: ['VBUS', 'D-', 'D+', 'ID', 'GND'], h: 1.0,
    desc: 'Micro-USB B soket adaptörü; VBUS 5 V ve GND güç hattıdır, D+/D- veri hattıdır. USB 2.0 için kaynaktan en fazla 500 mA çekin; ID genelde bağlı bırakılır (OTG için).',
    specs: { 'VBUS': '5 V (USB 2.0 için 500 mA, standart port)', 'Veri': 'D+ / D- (USB 2.0)', 'ID': 'OTG kimliği, genelde kullanılmaz', 'Pin kısıtlamaları': 'D+/D- veri hatlarına 5 V doğrudan bağlanmaz; D+ ve D- 3.3 V mantıktır' },
  }),
];

export const MODULES: ComponentDef[] = [...BOARDS, ...SENSORS, ...DISPLAYS, ...ACTUATORS, ...COMM_POWER, ...CONNECTORS];
