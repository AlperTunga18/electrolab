# Özellik durumu (ilk sürüm)

Statüler: **✅ Çalışıyor ve test edildi · 🟡 Kısmi · ⬜ Planlı**. Kaynak: `frontend/src/features.ts`.

## ✅
- MNA çözücü: DC + transient; R, C, L, V/I kaynakları, diyot/LED/zener, BJT, MOSFET — 21 analitik doğrulama testi
- 3D alan, sürükle-bırak, döndürme, pin-pin kablo (renk/kalınlık), geri al/yinele, kopyala/yapıştır
- Canlı simülasyon + osiloskop (zaman tabanı, tetik, kanal başına V/div, ölçümler)
- Proje kaydı (FastAPI/SQLite sürümlü + yerel yedek), JSON dışa/içe aktarma, otomatik kayıt
- Backend: projeler/sürümler, motor adaptör iskeleti (10 test geçer, 1 atlandı: ngspice kurulu değil)

- Arıza enjeksiyonu (9 tür), kopuk kablo, arıza analiz ekranı, ısıl kamera — 18 test (faults.test.ts)

- MCU: GPIO Thevenin modeli, sketch yorumlayıcısı + AVR HEX emülatörü, 5 kart, GPIO hasarı — 424 frontend testi (mcu.test, mcu.e2e.test, sketch.test, avr.test)

- Eğitim: 38 ders + görevler + arıza avı + deney defteri/rozetler; ders sayıları ve beklenen değerler testli (education/*.test.ts)

- AC analiz (Bode, empedans), 9 sanal ölçüm cihazı, DC motor/röle/transformatör/elektronik yük modelleri — 647 testin parçası (ac.test, devices.test, readings.test, meters.test)

- Şematik editörü (3D ile senkron), PCB yerleşim/yönlendirme/DRC, Gerber/Excellon/ZIP, KiCad/PDF — 1023 testin parçası (schematic, pcb, export, pipeline)

- Mühendislik asistanı (çevrimdışı): 26 test; hesap makineleri (LED/taban direnci, bölücü, kablo, soğutucu, PSU, ripple, MOSFET sıralama) elle doğrulanmış sayılarla; devre inceleme kuralları

## 🟡
- Kütüphane: 287 parça (22 genel + 265 katalog: 93 yarı iletken, 47 pasif/kaynak, 55 entegre, 70 kart/sensör/ekran/motor/modül/konnektör). Değerler elle girilmiş tipik değerler, `verified:false`; entegreler/kartlar/modüller elektriksel modelsiz (açık devre + uyarı). Arama, karşılaştırma, kullanıcı parçası var.
- Termal + hasar: Rθ/Cth TAHMİNİ (paket sınıfı + anma gücü), hasar eşikleri kural tabanlı; kesin yanma süresi verilmez, risk + belirsizlik gösterilir
- Eğitim (6 devre), BOM CSV, ölçüm tablosu, İngilizce altyapı

## ⬜
Katman/grup, AC/Monte Carlo/noise, ESR/röle/SOA modelleri, PCB bakır ısı yayılımı, I2C/SPI/Wi-Fi/kesme, ESP-IDF/Renode/QEMU, internetten bileşen/datasheet/SPICE/3D içe aktarma, 3D ölçüm probları, HIL/SIL.

## Gece 3 eki (2026-11-18/19)
Eklendi (hepsi testli, "kısmi"): I2C/SPI + kesmeler, ek arızalar (ters polarite, brownout, ESR, yalıtım, gevşek konnektör), çoklu seçim + otomatik kablo, BLDC + solenoid, osiloskop FFT + protokol çözücü, röle sıçraması/ark + endüktans doyması, Pico firmware çalıştırma (rp2040js), internetten parça arama (Nexar/Mouser, kullanıcı anahtarıyla), SPICE .MODEL ve GLB içe aktarma.
Önemli sınırlar:
- Pico: gerçek bootrom indirilmedi; JS ROM kalıbı ile Blink çalışıyor. Gerçek bootrom için kullanıcı onayı gerekir.
- ESP32 çalıştırma yok (QEMU kurulu değil). LCSC için resmî API yok; SnapEDA planned.
- Online arama gerçek anahtarla denenmedi (mock + resmî doküman).
- Birçok yeni arayüz (kutu seçimi, FFT spektrumu, protokol çözümü, çevrimiçi arama, GLB yükleme, ek arıza panelleri, step/servo/BLDC/solenoid 3D) tarayıcıda gerçek veriyle denenmedi.
- Röle varsayılanları (sıçrama 2 ms, ark açık) eski devrelerde ark/aşınma raporu verebilir.
- Tüm yeni fiziksel sabitler tipik/genel, doğrulanmamış.

## Gece 2 eki (2026-11-18)
- Eklendi: Monte Carlo + gürültü analizi (testli, analitik karşılaştırma), step motor ve servo modeli (testli, genel tipik değerler), datasheet metin/PDF çıkarımı (EKSİK işaretli; tarayıcıda metin katmanlı PDF ile denendi).
- Derleme: arduino-cli ile Uno, Pico, ESP32 gerçekten derlendi. Pico/ESP32 .bin çıktıları emüle edilmiyor.
- IPC-2221 Tablo 6-1: B1 ve B4 değerleri birden çok ikincil kaynakla uyuşuyor; bir kaynak B4/B5 satırlarını farklı veriyor, B2 0.6→0.64 mm yapıldı. Birincil standart metnine erişilemedi, doğrulanmış sayılmaz.
- Hâlâ kısmi: parça kataloğu (265 parça `verified:false`), footprint'ler genel, LLM modu gerçek sağlayıcıyla denenmedi, BLDC/solenoid yok, step/servo için şematik sembol ve arıza seçenekleri kontrol edilmedi.

## Doğrulama turu (2026-11-18)
Gece eki: gerçek arduino-cli 1.6.0 ile Uno derlemesi ve HEX emülasyonu doğrulandı; ders arıza metinlerindeki sayılar çözücüyle test ediliyor (`faultProse.test.ts`); canlı bağlantı ipuçları ve kısayol penceresi eklendi.
Doğrulandı:
- tsc temiz; 1049 ön yüz testi, 37 sunucu testi geçti; üretim derlemesi tamam.
- Tarayıcıda ekran görüntüsüyle: 3D laboratuvar, tıkla-yerleştir, kütüphaneden sürükle-bırak, şematik editör (ERC 0/0), PCB otomatik yönlendirme (7 iz, DRC 0 hata).
- GERÇEK HATA bulundu ve düzeltildi: 3D'de pine tıklayarak kablo çekme, parça gövdesi pin kürelerini gölgelediği için çalışmıyordu (Workspace.tsx `pinClick`). Tarayıcıda yeniden denendi: R1.2 → D1.K teli oluştu.
- Gerber/Excellon (gerbonara) ve .kicad_pcb (kiutils) üçüncü taraf ayrıştırıcılarda hatasız açıldı; KiCad'in kendisinde açılmadı.
- IPC-2221 akım formülü (k=0.048 dış / 0.024 iç, 0.44, 0.725) birden çok kaynakla doğrulandı.
- IRFZ44N (55 V, 49 A, 17.5 mΩ, Vth 2–4 V) ve IRLZ44N (22 mΩ @10 V, Vth 1–2 V) katalog değerleri üretici veri sayfasıyla uyumlu; sürümler arası farklar var.

Hâlâ doğrulanmadı:
- IPC-2221 Tablo 6-1 aralık değerleri: web kaynakları birbiriyle çelişiyor (bazı satırlar), orijinal standart elde edilemedi. Değerler B1/B2/B4 için bellekten; resmi standartla karşılaştırın.
- ESP32 GPIO akım sınırı (40 mA mutlak / 20 mA tavsiye) Espressif veri sayfasından birebir doğrulanamadı.
- Termal Rθ/Cth tahminleri, ders arıza belirtisi metinleri, gerçek LLM sağlayıcısı, arduino-cli ile derleme, motor/röle 3D animasyonu görsel kontrolü.

## Gece 4 eki — şematik editör (2026-11-18)
Eklendi (hepsi "kısmi"; testli, tsc temiz, 1364 ön yüz testi geçti, build tamam):
- T-bağlantı: pin bekliyorken tele tıkla veya Alt+tel tıkla → pine tıkla. Kavşakta dolu nokta; tel modelde yine pin-pin (`Wire.tap` yalnızca çizim bilgisi), net birleşimi `nets.ts` union-find ile aynı; ana tel kopuksa dal kopuk sayılır; ana tel/parça silinince dal silinir; kopyala-yapıştırda dal yeni ana tele bağlanır.
- Şematikte çoklu seçim (Shift/Ctrl+tık, Shift+sürükle kutu, Ctrl+A), grup taşı/döndür/sil/kopyala/yapıştır/çoğalt/hizala/dağıt (3D'deki `selection.ts` ve store seçim durumu yeniden kullanıldı), Oto. kablo bayrağı (A* ile parça gövdelerinden kaçınan dik yol), HintBar (3D'dekiyle aynı bileşen).
- Otomatik dönüş: yeni parça bekleyen pine bakacak şekilde yerleşir (yalnızca ilk pin); "Oto. yön" düğmesi seçili parçaları bağlı pinlere göre döndürür.
Sınırlar / yapılmayanlar:
- Bağlama veya sürükleme sırasında kendiliğinden döndürme YOK (bilerek).
- Tarayıcıda görülen: Ctrl+A, kutu seçimi (simüle olaylarla), grup çubuğu, pin→tel T-bağlantısı (nokta ve dik bitiş). Görülmeyen: Alt+tel başlatma, gerçek fareyle Shift/Ctrl+tık ve grup sürükleme, Oto. kablo, 3D'de T-bağlantı kablosunun görünümü (ana telin a pinine düz tel olarak gelir).
- Kavşak yeri ızgaraya oturtulur; ana tel yeniden yönlenince dal en yakın noktaya kayar. Ana tele çizim dışı bağımlı olmayan başka kod (PCB/KiCad) dalı pin-pin tel sayar.
- Şematikte kopyalama +20 px kaydırır (önceden yapıştırılan parça şematikte üst üste biniyordu).

## Gece 5 eki — PCB üretim çıktısı (adım 1)
Eklendi (testli, "kısmi"): kendi çizgi fontu (core/pcb/strokeFont.ts, A–Z 0–9 ve - _ . / + : ( ) # = % ? Ω µ); Gerber'de F_Silkscreen.gto + B_Silkscreen.gbo (referans yazısı, alt yüz x'te aynalı), F_Paste.gtp / B_Paste.gbp (yalnız SMD pad, pad boyutunda), NPTH.drl (şimdilik boş: modelde plansız delik yok); KiCad .kicad_pcb'de fp_text reference/value, 4 katmanda In1.Cu/In2.Cu tanımı, zone poligonu (anchor pin ağı, kart kenarından edgeClearance içeride).
Doğrulama: dışa aktarılan dosyalar gerbonara (Gerber/Excellon) ve kiutils (.kicad_pcb: 2 zone, fp_text, 4 katman) ile hatasız açıldı. gerbonara PTH/NPTH.drl için "G90 başlıktan sonra" SyntaxWarning veriyor (hata değil). KiCad'in kendisinde, gerçek görüntüleyicide ve üreticide açılmadı.
Sınırlar: zone KiCad'e DOLDURULMAMIŞ gelir (yeniden doldurma gerekir); paste açıklığı küçültülmedi; SMD paste harici ayrıştırıcıyla denenmedi (örnek devrede SMD yok, birim testle doğrulandı); font stroke tabanlı, kalite/okunabilirlik görsel denenmedi; silk yazısı pad'lerle çakışma denetimi yok; KiCad gr_text yazılmadı.

## Gece 5 eki — PCB net sınıfları (adım 2)
Eklendi (testli, "kısmi"): net sınıfları (iz, boşluk, via, opsiyonel diffGap), kararlı net anahtarıyla net→sınıf ataması ve kullanıcı net adı; DRC/yönlendirici/elle iz aracı sınıfı kullanır; KiCad'e net adları + net_class (eski söz dizimi) + .kicad_pro. Eski projeler (alanlar yok) aynen çalışır (regresyon testli).
Doğrulanmadı: KiCad'de açılış (net_class/.kicad_pro alan adları bellekten), arayüz tarayıcıda elle denenmedi. Bilinen sınırlar: diffGap yalnız adım 5'teki basit fark çifti türetmede kullanılır (DRC aralığını değiştirmez); atama netin en küçük pin anahtarına bağlı, o pin netten çıkarsa kaybolabilir.

## Gece 5 eki — PCB poligon geometrisi (adım 3)
Eklendi (testli, "kısmi"): core/pcb/geom.ts; poligon kart sınırı (outline.poly), çokgen zone (öncelik, termal rölyef, aynı katmanda çoklu zone), NPTH montaj deliği. Gerber (zone bölgesi, 4 spoke, Edge_Cuts poligon, NPTH.drl), DRC (EDGE poligona göre, HOLE_*, ZONE_OUTSIDE), yönlendirici (kart dışı/delik engeli), KiCad (gr_poly, zone priority/termal, np_thru_hole), arayüz araçları ve 3D poligon kart. Yeni alanlar opsiyonel; eski projeler değişmeden çalışır, mevcut testler değişmedi.
Doğrulanmadı: gerbonara/kiutils bu oturumda kurulu değildi, üretilen dosyalar harici ayrıştırıcıyla AÇILMADI; KiCad'de açılmadı (priority, gr_poly, np_thru_hole söz dizimi bellekten); arayüz tarayıcıda elle denenmedi.
Yapılmadı (planlı): ada temizliği, min kalınlık uygulaması. Sınırlar: çokgen zone karta kırpılmaz; offset öz-kesişim temizlemez; öncelik dolgusu kaba.

## Gece 5 eki — Footprint kütüphanesi (adım 4)
Eklendi (testli, "kısmi"): core/pcb/landPatterns.ts (kendi formüllerimizle parametrik çip R/C/L, SOIC/TSSOP/QFN-n, SOT-23-3/5/6, SOT-223, TO-220, DIP-n, header, radyal elektrolitik), placements[id].footprint ve PcbDesign.customFootprints (opsiyonel), resolveFootprint (pin sayısı uyuşmazsa reddedilir, DRC FOOTPRINT_MISMATCH), Gerber silk/pick&place, KiCad, DRC courtyard, UI footprint listesi ve FootprintEditor. Tüm boyutlar tipik değerlerdir (verified:false), datasheet land pattern'i DEĞİLDİR. QFN exposed pad yok; toplu BOM (bomForFab) override'ı yansıtmaz; arayüz tarayıcıda elle denenmedi; KiCad kütüphane/kaynağı kopyalanmadı.

## Gece 5 eki — PCB yönlendirme (adım 5)
Eklendi (testli, "kısmi"): router.ts 8 yönlü (octile) A* — köşegen adımda sagitta payı iki katı ve iki yan hücre boş şartı; seçenek `diagonal`. KARAR: kütüphane varsayılanı KAPALI (45° kapalıyken çıktı eskisiyle birebir aynı; 9 örnek devre için JSON hash regresyon testi), arayüzde "45°" onay kutusu varsayılan AÇIK. Rip-up/retry (`ripupRounds`, `seed`): başarısız netler öne alınıp yeni temiz ızgarada yeniden denenir (ikinci turdan itibaren tohumlu karıştırma, deterministik); en az başarısızlıklı geçiş seçilir, yani sonuç hiçbir zaman ilk geçişten kötü olmaz. Sabit bir yoğun fixture'da 2 başarısız bağlantı 0'a iner (testli). Bu sıra tabanlı yeniden denemedir; mevcut izleri itme/silme (gerçek rip-up-and-reroute, push-and-shove) YOK.
core/pcb/length.ts: net uzunluğu = o neta bağlı iz parçalarının orta çizgi toplamı + via başına kart kalınlığı; net/sınıf hedef uzunluğu ve tolerans (varsayılan ±1 mm), tam bağlı net'te sapma > tolerans ise DRC 'LENGTH' uyarısı. Elle hesaplı örnekle eşleşir (3+4 mm iz + 1 via x 1,6 = 8,6 mm). Dallı netlerde tüm dallar toplanır; serpantin/uzunluk eşitleme YOK.
core/pcb/diffpair.ts: sınıfta diffGap olan ve adı X_P/X_N biten iki net ya da kullanıcı seçimi (design.diffPairs); P net normal yönlendirilir, N net sabit ofsetli (miter köşe) kopya + pad'e kısa saplamalarla türetilir, aday DRC ile doğrulanır (yeni hata yok, N bağlanmış). Başarısızsa 'failed' + neden raporlanır ve N normal yönlendirilir. Sınırlar: yalnız 2 pinli netler, ana net tek iz/tek katman/via'sız, empedans ve skew kontrolü yok, aralık kenardan kenara.
Arayüz (Pcb.tsx): elle izde 45° kilidi (varsayılan açık, Shift serbest açı, kapalıyken eski dik açı), canlı aralık ihlali (çizilen iz DRC'de CLEARANCE/SHORT verecekse kırmızı önizleme + daire), 'Uzunluk' sekmesi (net uzunluk tablosu, hedef girişi), oto-yönlendir 45°/rip-up/fark çifti seçenekleri, sınıf için fark aralığı/hedef uzunluk, fark çifti listesi. Yeni alanlar opsiyonel (NetClass.targetLength/lengthTol, PcbDesign.netLengthTargets/diffPairs); eski projeler ve mevcut testler değişmedi.
Doğrulanmadı: arayüz tarayıcıda elle denenmedi; canlı ihlal her imleç adımında tam DRC çalıştırır (büyük kartlarda yavaşlayabilir, ölçülmedi); köşegen güvenliği DRC ile fixture'larda doğrulandı, KiCad'e fark çifti/uzunluk bilgisi yazılmaz.

## Gece 5 eki — .kicad_pcb içe aktarma (adım 6, kısıtlı)
Eklendi (testli, "kısmi"): core/export/sexpr.ts (genel S-ifade okuyucu: tırnaklı metin, kaçışlar, sayılar; hatalı girdide hata döner, çökmez; derinlik sınırı) ve core/export/kicadImport.ts. Footprint Reference değeri devredeki parça ref'iyle eşleşir → konum/dönüş/yüz; segment (net, katman, genişlik) → iz (ardışık segmentler birleştirilir), via, zone (poligon, katman, net, priority, termal, min kalınlık), Edge.Cuts gr_rect/gr_poly/kapalı gr_line → kart sınırı, np_thru_hole → montaj deliği, iç katman sayısı → 2/4 katman. Eşleşmeyen footprint, bilinmeyen net ve desteklenmeyen öğeler uyarı listesine yazılır. Arayüz: Pcb'de "KiCad içe aktar", sonuç özeti, uyarılar ve üzerine yazma onayı (geri alınabilir).
ÖNEMLİ SINIR: gerçek KiCad'de üretilmiş dosya ELDE YOKTU; içe aktarma yalnız kendi kicadPcb() çıktımızla gidiş-dönüş testlidir. "KiCad dosyalarını okur" iddiası YOKTUR. Dosya biçimi alan adları, açı yönü (KiCad CCW varsayıldı) ve KiCad 8 `property "Reference"` söz dizimi bellekten yazıldı, doğrulanmadı.
Diğer sınırlar: yabancı footprint'in pad geometrisi alınmaz (parça kendi footprint'ini korur; footprint origin'i = yerleşim merkezi varsayıldı); gidiş-dönüşte dönüş pad dizilimi eşlemesiyle geri kazanılır (dışa aktarma dönüşü pad'lere gömer); tam 0.5/0.5 termal değeri "termal yok" sayılır; net sınıfları, yay/daire, metin, grafik, iç katman izi, blind/micro via, iç kesim, zone dolguları içe aktarılmaz; kart (0,0)'a kaydırılmaz; tasarımdaki iz/via/zone/delik DEĞİŞTİRİLİR (birleştirilmez); arayüz tarayıcıda elle denenmedi.
