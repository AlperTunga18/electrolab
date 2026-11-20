export type FeatureStatus = 'done' | 'partial' | 'planned';

export interface Feature { name: string; status: FeatureStatus; note: string }

/** Single source of truth for what actually works. Mirrors docs/STATUS.md. */
export const FEATURES: { group: string; items: Feature[] }[] = [
  {
    group: 'Aşama 1 — Temel uygulama',
    items: [
      { name: '3D çalışma alanı (kamera, grid, yakınlaştırma)', status: 'done', note: 'OrbitControls, ızgara hizalama' },
      { name: 'Sürükle-bırak yerleştirme, taşıma, döndürme', status: 'done', note: 'Kütüphane → sahne; R ile döndür' },
      { name: 'Pin-pin kablo, renk/kalınlık', status: 'done', note: 'Pine tıkla → pine tıkla' },
      { name: 'Geri al / yinele, kopyala / yapıştır', status: 'done', note: 'Ctrl+Z/Y/C/V/D' },
      { name: 'Proje kaydet (sunucu + yerel), JSON dışa/içe aktarma, otomatik kayıt', status: 'done', note: 'Sunucu yoksa yerel depolama' },
      { name: 'Katmanlar, gruplama, çoklu devre', status: 'planned', note: '' },
      { name: 'Çoklu seçim (Shift/Ctrl+tık, Shift+sürükle kutu, Ctrl+A), grup taşı/döndür/sil/kopyala/hizala/dağıt, ortak parametre; isteğe bağlı ortogonal otomatik kablo yönlendirme', status: 'partial', note: 'Mantık testli (30 test); Ctrl+A tarayıcıda görüldü; kutu seçimi ve Shift+tık elle denenmedi; otomatik yönlendirme görsel olarak denenmedi' },
    ],
  },
  {
    group: 'Aşama 2 — Bileşen kütüphanesi',
    items: [
      { name: '287 parça: 22 genel model + 265 katalog parçası (üretici, model no, paket, spec, pinout), çok kelimeli arama, kategori/model süzgeci, karşılaştırma, kullanıcı parçası', status: 'partial', note: 'Değerler elle girilmiş, datasheet ile doğrulanmadı; ~100 parçanın elektriksel modeli yok' },
      { name: 'Parametrik 3D modeller', status: 'partial', note: 'Basit parametrik/genel modeller; GLB yükleme yok' },
      { name: 'İnternetten parça arama (Octopart/Nexar, Mouser: resmî API, kullanıcının kendi anahtarı), fiyat/stok', status: 'partial', note: 'Gerçek anahtarla canlı çağrı yapılmadı (mock testli, resmî dokümanla alanlar doğrulandı); LCSC resmî API yok → desteklenmiyor; SnapEDA herkese açık API dokümanı bulunamadı → planned' },
      { name: 'SPICE .MODEL içe aktarma (D/NPN/PNP/NMOS/PMOS) ve kullanıcı .glb 3D modeli yükleme', status: 'partial', note: 'Yalnızca simülatörün kullandığı parametreler eşlenir, diğerleri listelenir; .SUBCKT simüle edilmez; STEP desteklenmez; GLB gerçek dosyayla/tarayıcıda denenmedi' },
    ],
  },
  {
    group: 'Aşama 3 — Elektriksel simülasyon',
    items: [
      { name: 'MNA çözücü: DC + transient (R, C, L, kaynaklar, diyot, LED, zener, BJT, MOSFET)', status: 'done', note: '21 doğrulama testi (analitik referanslar)' },
      { name: 'Gerçek zamanlı osiloskop, düğüm/bileşen ölçümleri', status: 'done', note: 'Çözücü verisiyle' },
      { name: 'ngspice / Xyce / Icarus adaptörleri', status: 'partial', note: 'Sunucu adaptör iskeleti var; ikili dosyalar kurulu değil' },
      { name: 'Monte Carlo (tolerans, tohumlu, histogram) ve gürültü analizi (direnç ısıl + diyot saçma gürültüsü)', status: 'partial', note: 'Gürültü: BJT/MOSFET/opamp gürültüsü ve 1/f yok (az tahmin eder); en kötü durum birinci dereceden tahmin; testli (analitik karşılaştırma)' },
    ],
  },
  {
    group: 'Aşama 4 — Arıza simülasyonu ve termal',
    items: [
      { name: 'Anma değeri aşımı uyarıları (güç, gerilim, akım, ters polarite)', status: 'done', note: 'Anlık değerlerle; testli' },
      { name: 'Termal model (Tj, Rθjc/Rθja, Cth, ortam, soğutucu, fan) + ısıl kamera renk haritası + kararlı hal / gerçek zamanlı', status: 'partial', note: 'Rθ/Cth paket sınıfı ve anma gücünden TAHMİN; PCB bakırı, hava akışı, parçalar arası ısı transferi yok' },
      { name: 'Hasar modeli (ısıl, aşırı gerilim, aşırı akım, kontak) → parça devrede açık/kısa olur', status: 'partial', note: 'Kural tabanlı eşikler; kesin süre yerine risk aralığı + belirsizlik notu' },
      { name: 'Arıza enjeksiyonu: açık/kısa, değer kayması, kapasite kaybı, kaçak, gate hasarı, yapışık kontak, aralıklı temas, kopuk kablo', status: 'done', note: 'Normal simülasyondan bağımsız; testli' },
      { name: 'Arıza analiz ekranı (neden, sınır, değerler, bağlantılar, koruma, çözüm) + duman/alev/flaş', status: 'done', note: 'Kural tabanlı analiz' },
      { name: 'Ek arızalar: ters polarite (polarize kondansatör), düşük besleme/brownout (MCU), ESR artışı, yalıtım hatası (megger ile ölçülür), gevşek konnektör (tel)', status: 'partial', note: 'Eşikler/dağılımlar tipik, doğrulanmamış; arayüz tarayıcıda denenmedi; testli (17 test)' },
      { name: 'Diyot kırılması, SOA/anahtarlama kaybı, röle yapışması', status: 'planned', note: '' },
    ],
  },
  {
    group: 'Aşama 5 — Mikrodenetleyiciler',
    items: [
      { name: 'GPIO elektriksel modeli (Thevenin çıkış, pull-up, pin gerilimi/akımı), besleme pinleri; Uno/Nano/Mega, ESP32 DevKit V1, Pico', status: 'done', note: 'Çıkış dirençleri yaklaşık; testli' },
      { name: 'Canlı bağlantı geri bildirimi (LED dirençsiz/ters, kısa devre, askıda pin, ERC)', status: 'done', note: 'Topolojiden anlık; 5 test; çubuk sol üstte, tıklayınca parçayı seçer' },
    { name: 'Arduino sketch yorumlayıcısı (alt küme) + kod editörü (renklendirme, tamamlama, hata işaretleri), seri monitör/çizici, GPIO tablosu', status: 'partial', note: 'Gerçek derleyici değil; pointer/struct/kesme/Wire/SPI yok (uyarı verir)' },
      { name: 'AVR HEX emülatörü (avr8js, ATmega328P): GPIO, Timer/PWM, USART, ADC', status: 'partial', note: 'TWI/SPI/EEPROM yok; yalnızca Uno/Nano' },
      { name: 'Gerçek derleme (arduino-cli, sunucu)', status: 'partial', note: 'Gerçek arduino-cli 1.6.0 + arduino:avr 1.8.8 ile Uno Blink derlendi, HEX emülatörde 1 Hz doğrulandı; hata satırları ayrıştırılıyor. Uno (AVR HEX emülatörde çalıştırıldı), Pico (rp2040 6.4.0) ve ESP32 (esp32 3.3.13) derlemeleri başarılı; Pico/ESP32 çıktıları (.bin) emülatörde çalıştırılamaz (yalnızca derleme doğrulandı); araç kullanıcı makinesinde kurulmalı' },
      { name: 'Uyumluluk matrisi, GPIO aşım/hasar (5 V → 3.3 V pin vb.), MCU örnek devreleri', status: 'done', note: '' },
      { name: 'I2C/SPI (işlem düzeyi, TMP102/24C02/MCP3008 modelleri, pull-up denetimi) ve harici kesmeler (sketch yorumlayıcı + AVR HEX)', status: 'partial', note: 'Bit zamanlaması, clock stretching yok; kesme tespiti adım çözünürlüğünde; testli (43 test); gerçek derlenmiş Wire/SPI HEX’iyle denenmedi' },
      { name: 'Raspberry Pi Pico firmware çalıştırma (rp2040js, UF2)', status: 'partial', note: 'Blink 1 Hz doğrulandı; GERÇEK bootrom yok, JS ROM kalıbı kullanılıyor; tek çekirdek, USB/PIO/I2C/SPI köprüsü yok' },
      { name: 'ESP32 firmware çalıştırma (QEMU), ESP-IDF/PlatformIO, Renode/Wokwi, Wi-Fi/BLE, DAC', status: 'planned', note: 'QEMU Xtensa kurulumu yok; ESP32 derlenir ama çalıştırılamaz' },
    ],
  },
  {
    group: 'Aşama 6 — Eğitim',
    items: [
      { name: '38 ders (temel 10, analog 10, dijital/MCU 8, güç 4, arıza bulma 6): teori, hesap, BOM/bağlantı tablosu, adımlar, beklenen sonuçlar, sık hatalar, arıza deneyleri, test', status: 'done', note: 'Beklenen değerler ve quiz cevapları otomatik testlerle çözücüye karşı doğrulanır (595 test)' },
      { name: 'Görevler (çözücü ile otomatik kontrol) ve arıza avı (gizli arıza, ölçüp bul)', status: 'done', note: '15+ görev, 10+ arıza avı; referans çözümleri testli' },
      { name: 'İlerleme, puan/seviye, rozetler, deney defteri (Markdown dışa aktarma)', status: 'done', note: 'Yerel depolamada; sunucuya senkron yok' },
      { name: '2D şematik gösterimi, MCU ödevleri için otomatik firmware kontrolü, çok kullanıcılı/öğretmen paneli, 100+ ders', status: 'planned', note: 'Ders arıza belirtisi metinlerinin bir kısmı testle değil çözücü mantığından türetilmiştir' },
    ],
  },
  {
    group: 'Aşama 7 — Gelişmiş laboratuvar (AC, ölçüm, motor, güç)',
    items: [
      { name: 'AC küçük-sinyal analizi: frekans yanıtı (Bode), −3 dB, rezonans/Q, kompleks empedans', status: 'done', note: 'RC, RLC, BJT yükselteç, diyot rd, transformatör testli; jonksiyon kapasitesi modeli yok' },
      { name: 'Ölçüm cihazları: DMM (V DC/AC/TRMS, A, Ω, diyot, süreklilik, kapasite, Hz; otomatik/manuel aralık), analog multimetre (iç direnç yükler), LCR, ESR, frekans sayacı, güç analizörü (P/S/Q/PF/THD), mantık analizörü, izolasyon test cihazı', status: 'done', note: 'Cihazlar sekmesi; probe atama listeden veya 3D’de pine tıklayarak; doğru/yanlış bağlantı (ampermetre paralel → sigorta atar, enerjili devrede Ω → ERR)' },
      { name: 'DC motor (kalkış akımı, ters-EMK, eylemsizlik, yük torku, stall), röle (çekme/bırakma eşiği ve gecikmesi), transformatör (kuplajlı bobin), elektronik yük (CC/CR/CP)', status: 'done', note: 'Parça modelleri testli; 3D modellerde dönen şaft/fan, röle armatürü' },
      { name: 'Güç elektroniği örnekleri: boost, H-köprü motor, AC-DC adaptör, röle flyback', status: 'partial', note: 'İdeal gate sürücü, anahtarlama/ESR kaybı yok' },
      { name: 'Step motor (2 faz, sinüs modeli) ve servo (davranışsal, SG90 sınıfı)', status: 'partial', note: 'Genel tipik değerler, ölçülmemiş; tutma torku/mikro adım/sürücü elektroniği yok; servo darbe genişliğinden açı, direnç benzeri akım; testli' },
      { name: 'BLDC (trapezoidal, 6 adım ESC) ve solenoid modeli', status: 'partial', note: 'Genel tipik değerler; ESC ideal rotor konumu bilir, U/V/W sırası etiketle; solenoidde doyma/sekme yok; testli (11 test)' },
      { name: 'Osiloskop FFT (pencereler, tepe/THD) ve protokol çözücü (UART/I2C/SPI)', status: 'partial', note: 'Çekirdek testli (27 test, gerçek MCU bit-bang UART çözüldü); arayüz açılıyor ama gerçek sinyalle spektrum/çözüm elle denenmedi; UART için düşük simülasyon hızı gerekir' },
      { name: 'Röle kontak sıçraması/ark ve endüktans doyması', status: 'partial', note: 'Testli (18 test); ark/sıçrama sabitleri genel, doğrulanmamış; yeni röle varsayılanları eski devrelerde ark/aşınma raporu verebilir' },
    ],
  },
  {
    group: 'Aşama 8 — Şematik / PCB / dışa aktarma',
    items: [
      { name: '2D şematik editörü: sembol kütüphanesi, otomatik yerleşim, ortogonal kablo, sürükle/döndür/kablo çekme, ERC; 3D ile aynı devre modeli (iki yönlü senkron)', status: 'done', note: 'Sembol ve yerleşim testli (325 test)' },
      { name: 'Şematikte T-bağlantı: bir telin ortasına tel bitirme/başlatma (pin bekliyorken tele tıkla, ya da Alt+tel tıkla → pine tıkla), kavşakta dolu nokta; devre modelinde net birleşir, 3D’de normal tel görünür', status: 'partial', note: 'Çekirdek testli (net birleşimi, kopuk ana tel, silme/yapıştırma, SVG); tarayıcıda bir T-bağlantı elle kuruldu (pin → tele; nokta ve dik bitiş görüldü), Alt+tıkla başlatma ve 3D görünüm görsel denenmedi. Modelde tel yine pin-pin (b = ana telin a pini, `tap` alanı çizim içindir); ana tel kopuksa dal da kopuk sayılır. Kavşak yeri ızgaraya oturtulur; tel taşınınca dal en yakın noktaya kayar' },
      { name: 'Şematikte çoklu seçim (Shift/Ctrl+tık, Shift+sürükle kutu, Ctrl+A), grup taşı/döndür(R)/sil/kopyala(Ctrl+C/V/D)/hizala/dağıt, ortak parametre; Oto. kablo (dik açılı, parça gövdelerinden kaçınan A* yönlendirme); canlı ipucu çubuğu (tıklayınca parçayı seç)', status: 'partial', note: 'Grup mantığı, yönlendirme ve depo işlemleri testli (kutu, hizala, döndür, kopyala/yapıştır, silme: ~20 test); Ctrl+A, kutu seçimi (olay simülasyonuyla), grup çubuğu tarayıcıda görüldü; gerçek fare ile Shift+tık/Ctrl+tık/grup sürükleme ve Oto. kablo görsel olarak denenmedi. Oto. kablo yalnızca varsayılan yönlendirme parça gövdesinden geçiyorsa devreye girer; yol bulunamazsa varsayılan çizim kalır' },
      { name: 'Şematikte otomatik dönüş: yeni parça, bekleyen pine bakacak şekilde yerleştirilir; "Oto. yön" seçili parçaları bağlı oldukları pinlere göre döndürür', status: 'partial', note: 'Testli (7 test). Yönlendirme sezgiseldir (kısa mesafe + pinin uzağa bakmaması), bağlama sırasında / sürüklerken kendiliğinden DÖNDÜRME YOK (kullanıcıyı şaşırtmamak için bilerek yapılmadı); yeni parçada yalnızca İLK pin hizalanır; tarayıcıda denenmedi' },
      { name: 'PCB: yerleşim, iz/via/zone çizimi, katman (2/4), otomatik yerleştir ve A* otomatik yönlendirme, ratsnest, 3D PCB görünümü', status: 'partial', note: 'Footprint’ler genel üretilmiş şablonlar (datasheet land pattern değil); parametrik kütüphane (core/pcb/landPatterns.ts: çip 0402–1206, SOIC/TSSOP/QFN-n, SOT-23-3/5/6, SOT-223, TO-220, DIP-n, header 1×n/2×n, radyal elektrolitik; boyutlar TİPİK, verified:false) parçaya göre seçilebilir, pin sayısı uyuşmazsa reddedilir (DRC FOOTPRINT_MISMATCH), kullanıcı tanımlı pad tablosu editörü (customFootprints); QFN termal/EP pad yok, SOT-223 tab pin 2 ile ortak, BOM override’ı yansıtmaz, arayüz tarayıcıda elle denenmedi; itici yönlendirme (push-and-shove) yok. Yönlendirme (Gece 5 adım 5, testli): 8 yönlü (octile) A* ile 45° adımlar (kütüphane varsayılanı KAPALI = eski çıktı birebir aynı, regresyon hash testli; arayüzde onay kutusu varsayılan AÇIK), başarısız bağlantılar için sınırlı yeniden deneme turları (başarısız netler öne, tohumlu karıştırma, en iyi geçiş kazanır; itici/rip-up-and-reroute değil, sıra tabanlı), net uzunluk raporu (iz + via başına kart kalınlığı; hedef/tolerans, DRC LENGTH uyarısı; serpantin/uzunluk eşitleme YOK), basit fark çifti (2 pinli _P/_N ya da seçilen netler: biri yönlendirilir, diğeri sabit ofsetle türetilip DRC ile doğrulanır, olmazsa “başarısız” raporlanır ve normal yönlendirilir; empedans/skew yok), elle izde 45° kilidi (Shift serbest) ve canlı aralık ihlali (kırmızı). Arayüz tarayıcıda elle denenmedi Poligon kart sınırı (konkav), çokgen zone (öncelik, termal rölyef 4 spoke), NPTH montaj deliği çizimi/DRC/yönlendirici engeli testli; ada temizliği ve min. kalınlık uygulaması YOK (planlı), çokgen zone kart sınırına kırpılmaz, zone doldurma kaba (kenar boşluğu/miter), tarayıcıda elle denenmedi. Net sınıfları (iz/boşluk/via, kararlı net anahtarı, kullanıcı net adı) testli; fark çifti aralığı (diffGap) yalnız basit fark çifti türetmede kullanılır, KiCad’e yalnız saklanır/dışa aktarılır' },
      { name: 'DRC (boşluk, genişlik, delik, annular, kenar, kısa, bağlanmamış, courtyard, akım, gerilim aralığı) + IPC-2221 akım/boşluk, mikroşerit/fark empedansı, via hesapları + EMC ön kontrolleri', status: 'partial', note: 'IPC tabloları bellekten girildi, standartla karşılaştırılmadı; EMC kontrolleri sezgisel' },
      { name: 'BOM, Gerber (RS-274X) + Excellon + pick-and-place + ZIP, PDF raporu', status: 'partial', note: 'Gerber dosyaları gerbonara ile hatasız açıldı; gerçek görüntüleyici/DFM/üretici ile doğrulanmadı. Silk referans yazısı (kendi çizgi fontu, alt yüz aynalı), F/B Paste (yalnız SMD), NPTH.drl montaj deliklerini yazar (delik yoksa boş), poligon kart Edge_Cuts, zone poligon bölgesi + termal spoke + öncelik (Gerber harici görüntüleyicide AÇILMADI: bu oturumda gerbonara kurulu değildi); paste açıklığı pad boyutunda (küçültme yok), modelde plansız delik yok' },
      { name: 'KiCad netlist ve .kicad_pcb dışa aktarma', status: 'partial', note: 'Deneysel: kiutils ile hatasız ayrıştı, KiCad’in kendisinde açılmadı. fp_text reference/value, 4 katmanda In1/In2 tanımı, zone (yalnız poligon, DOLDURULMAMIŞ: KiCad’de B ile yeniden doldurun) var. Poligon kart gr_poly, zone poligonu/priority/termal gap+bridge/min_thickness, np_thru_hole montaj deliği footprint’i yazılır (parantez dengesi testli; priority/gr_poly/np_thru_hole söz dizimi bellekten, kiutils/KiCad ile bu oturumda DOĞRULANMADI). Kullanıcı net adları yazılır; net sınıfları .kicad_pcb’ye eski (KiCad 5/6) net_class söz dizimiyle ve ayrıca .kicad_pro net_settings olarak yazılır — ikisi de DOĞRULANMADI (KiCad 7 sınıfları .kicad_pro’da tutar; alan adları bellekten). KiCad dosyası içe aktarma: aşağıdaki kayda bakın' },
      { name: '.kicad_pcb içe aktarma (kısıtlı): genel S-ifade okuyucu (core/export/sexpr.ts) + footprint Reference → devre parçası eşleşmesi ile konum/dönüş/yüz, segment→iz, via, zone (poligon, katman, net, priority, termal, min kalınlık), Edge.Cuts gr_rect/gr_poly/gr_line, np_thru_hole→delik, iç katman sayısı; UI: "KiCad içe aktar" + özet/uyarılar + üzerine yazma onayı', status: 'partial', note: 'YALNIZ kendi kicadPcb() çıktımızla gidiş-dönüş testlidir; gerçek KiCad’de üretilmiş dosya ELDE YOKTU, bu yüzden "KiCad dosyalarını okur" denemez. Alan adları/açı yönü/KiCad 8 `property "Reference"` bellekten ve DOĞRULANMADI. Yabancı footprint’in pad geometrisi alınmaz (parça kendi footprint’ini korur); net sınıfları, yay/daire, metin, iç katman izi, blind/micro via, iç kesim içe aktarılmaz (uyarı listesine yazılır); zone dolguları okunmaz; kart (0,0)’a kaydırılmaz. Arayüz tarayıcıda elle denenmedi' },
      { name: 'Derin PCB analizi: PCB ısıl analizi, creepage otomatik denetimi, impedans kontrollü yönlendirme, üretici kural şablonları', status: 'planned', note: '' },
    ],
  },
  { group: 'Diğer', items: [
    { name: 'Mühendislik asistanı — çevrimdışı motor: devre incelemesi (flyback, GPIO yükü, gate sürüşü, anma payları, ısı), “bu parça neden var”, akım/güç kaynağı, ısınma/soğutucu, kondansatör/ripple (geçici analizle ölçer), MOSFET seçimi, direnç/kablo hesapları, simülasyon yorumu, PCB incelemesi, datasheet açıklama, pin bağlantılarından Arduino kodu', status: 'done', note: 'API anahtarı gerekmez; hesaplar adım adım ve kaynaklarıyla; 26 test' },
    { name: 'Asistan — yapay zekâ modu (serbest sorular)', status: 'partial', note: 'Sunucu vekili (/api/ai/chat) mock testli; gerçek sağlayıcıya karşı denenmedi; kullanıcının kendi anahtarı gerekir' },
    { name: 'Datasheet metin/PDF içe aktarma (alan çıkarımı, birebir alıntı, EKSİK işareti, kullanıcı parçası)', status: 'partial', note: 'Sentetik metinle testli; tarayıcıda metin katmanlı bir PDF (jsPDF ile üretilmiş) okunup alanlar çıkarıldı; gerçek üretici PDF’leri denenmedi; taranmış PDF için OCR yok; kullanıcı parçası doğrulanmadı işaretli' },
    { name: 'Asistan: çok adımlı araç kullanan ajan, alternatif devre sentezi', status: 'planned', note: '' },
    { name: 'Gerçek donanım (HIL/SIL)', status: 'planned', note: '' },
    { name: 'Türkçe/İngilizce arayüz altyapısı', status: 'partial', note: 'Ana arayüz metinleri çevrildi; içerik Türkçe' },
  ] },
];
