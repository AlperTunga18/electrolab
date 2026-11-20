# Gece çalışması — ilerleme defteri

Kullanıcı uyudu; soru sorulmayacak. Limit/kesinti olursa "devam et" denince BU DOSYADAN devam et.

## Görevler (sırayla)
1. [ ] Lab arayüzünü tarayıcıda incele (işlevsel mi?), bulguları düzelt
2. [ ] Canlı bağlantı geri bildirimi: kablo çekilince anında doğrula/uyar (LED direnci yok, kısa devre, kutup ters, boş pin, tek pinli ağ) + ipuçları
3. [ ] Ders arıza belirtisi metinlerini solver ile test et (lessons testleri)
4. [ ] arduino-cli ile gerçek derleme doğrula (kurulabilirse)
5. [ ] Ucuz "Kısmi" boşlukları kapat; features.ts + docs/STATUS.md güncelle
6. [ ] tsc + vitest + build + pytest; son rapor

## Notlar
- [x] Adım 1-2 bitti: `core/hints.ts` (+5 test) ve Lab.tsx içinde `HintBar` (sol üst, tıklayınca parçayı seçer). Tarayıcıda doğrulandı.
- Sıradaki: adım 3 (ders arıza metinleri), 4 (arduino-cli), 5, 6.
- [x] Adım 3 bitti: `education/faultProse.test.ts` — ders arıza metinlerindeki sayılar çözücüyle eşleşiyor (86 satır; AC/genlik cümleleri atlanıyor). Toplam 1141 test geçti.
- Sıradaki: adım 4 arduino-cli.
- [x] Adım 4 bitti: arduino-cli 1.6.0 gerçekten indirilip (scratchpad/acli, PATH'e kalıcı eklenmedi) arduino:avr 1.8.8 ile Blink derlendi; HEX emülatörde ~1 Hz doğrulandı (`avr/realHex.test.ts` + `fixtures/blink.uno.hex`). /api/mcu/compile uçtan uca çalıştı (hata satırı ayrıştırıldı); `--no-color` eklendi. Pytest 37 geçti.
- Sıradaki: adım 5 (features.ts/STATUS güncelle, arayüz iyileştirmeleri), 6 son kontrol.
- [x] Adım 5-6 bitti: kısayol penceresi (`?`), features.ts güncellendi (canlı ipuçları 'done'; arduino-cli notu). tsc temiz, 1142 ön yüz testi, 37 sunucu testi, build tamam, tarayıcıda doğrulandı.

## DURUM: TÜM GÖREVLER BİTTİ. Yeni iş yok; kullanıcı sabah yeni talimat verecek.

# GECE 2 — "kısmi olanları tamamla" (kullanıcı uyuyor, soru yok)
Görevler: (a) Monte Carlo + gürültü analizi [builder] (b) IPC-2221 Tablo 6-1 web doğrulama (c) ESP32/Pico arduino-cli derleme (d) step/servo modeli (e) features.ts/STATUS + tüm testler.
Kural: yapılamayanı "yapıldı" yazma; features.ts'e dürüst not.
Durum satırları aşağıya:
- (b) IPC: B1 ve B4 değerleri birden çok ikincil kaynakla uyuşuyor; B2 0.6→0.64 yapıldı (çelişen kaynaklar). Birincil standart erişilemedi; belgeye not düşülecek.
- Başlatıldı: builder#1 (Monte Carlo+gürültü+Analysis.tsx), builder#2 (datasheet metin/PDF çıkarımı, LibraryPage'e bölüm). ESP32/Pico çekirdekleri arka planda kuruluyor (scratchpad/acli/cores.done). Bekleyen: stepper/servo (builder#1 bitince mna.ts çakışmasın diye), features/STATUS, final testler.
- builder#1 bitti (doğrulandı: tsc+vitest). Analysis sekmesi tarayıcıda henüz görülmedi.
- builder#3 (stepper+servo) başlatıldı; core kurulumu sürüyor. Bitince: ESP32/Pico derleme testi (backend /api/mcu/compile board esp32/pico), features/STATUS, final test.
- builder#2 bitti (datasheet çıkarım, 10 test, 1168 test). PDF gerçek dosyayla denenmedi; UI tarayıcıda denenmedi (yapılacak).
- builder#3 bitti (stepper+servo, 1168 test). Sıradaki: esp32/pico derleme, features/STATUS.
- PDF: tarayıcıda jsPDF->pdfjs->extract doğrulandı. features.ts güncellendi (MC/gürültü, step/servo, datasheet = partial). Bekleyen: esp32 çekirdek kurulumu + derleme, STATUS.md, son rapor.
- Pico derlemesi (rp2040:rp2040 6.4.0) /api/mcu/compile ile doğrulandı (ok, 54 KB). ESP32 çekirdeği hâlâ iniyor.
- ESP32 derlemesi doğrulandı. features.ts + STATUS.md güncellendi.

## DURUM (gece 2): TÜM GÖREVLER BİTTİ; kalan kısmi maddeler STATUS.md'de dürüstçe listeli.

# GECE 3 — kullanıcı talimatı: sırayla, soru yok
Sıra: (1) I2C/SPI + kesmeler (2) ek arızalar: ters/düşük gerilim, ESR artışı, yalıtım hatası, gevşek konnektör (3) çoklu seçim (+ otomatik kablo yönlendirme) (4) BLDC + solenoid (5) osiloskop FFT + protokol çözücü (6) röle kontak sıçraması + endüktans doyması (7) features/STATUS/test.
Her adım ayrı builder (dosya çakışması olmasın diye SIRAYLA). Her builder sonrası ben tsc+vitest doğrularım. Yapılamayanı dürüstçe features.ts'e yaz.
Durum:
- Adım 1 (I2C/SPI+kesme) builder başlatıldı; bitince doğrula, sonra adım 2.
- KUYRUĞA EKLENDİ (adım 8, tüm adımlardan sonra): Pico/ESP32 .bin çalıştıran emülatör. Plan: RP2040 için `rp2040js` (tarayıcıda, UF2/bin yükle, GPIO/UART köprüsü); ESP32 için Espressif QEMU gerekir (Xtensa, native, tarayıcıda yok) — Windows'ta kurulabilirse sunucu tarafı, değilse "planned" olarak dürüstçe bırak.
- KUYRUĞA EKLENDİ (adım 9): internetten parça/datasheet arama (SnapEDA, LCSC, Octopart), SPICE/3D model yükleme, fiyat/stok. KURAL: yalnızca resmi API'ler + kullanıcının kendi anahtarı; scraping yok; anahtar yoksa "EKSİK/anahtar gerekli"; uydurma URL/veri yok; SPICE/STEP dosyası kullanıcı yükler (yerel). Ek arızalar (ters/düşük gerilim, ESR artışı, yalıtım hatası, gevşek konnektör) zaten adım 2'de.
- Adım 1 bitti+doğrulandı (1223 test). TWI/SPI avr hook, 3 busdev parça, kesmeler; limit: transaction-level, step-granüler kesme.
- Adım 2 (ek arızalar) builder başlatıldı.
- Adım 2 bitti+doğrulandı (1240 test): reverseVoltage, lowVoltage(brownout), esrRise, insulationFault, looseConnector. Eşikler 'tipik, doğrulanmadı'. UI tarayıcıda denenmedi.
- Adım 3 (çoklu seçim + otomatik kablo yönlendirme) builder başlatıldı.
- Adım 3 bitti+doğrulandı (1256 test). Tarayıcı kontrolü yapılacak.
- Adım 3 tarayıcıda doğrulandı (Ctrl+A → 7 parça seçili, hizalama çubuğu, Oto. kablo). Marquee/shift-click elle denenmedi. Adım 4 (BLDC+solenoid) builder başlatıldı.
- Adım 4 bitti+doğrulandı (1273 test): bldc_3ph, bldc_driver_6step (analog gaz, ortalama değer), solenoid. Limit: genel değerler; ESC U/V/W sırası etiketle; analysis.ts flyback kuralı yeni indüktifleri bilmiyor (yapılacak küçük iş).
- Adım 5 (FFT + protokol çözücü) builder başlatıldı.
- Adım 5 bitti+doğrulandı (1300 test): fft.ts, decode.ts (UART/I2C/SPI), Protokol sekmesi. Gerçek MCU bit-bang UART 'Hi' çözüldü. UI tarayıcıda henüz görülmedi. Adım 6 (röle sıçraması + doyma) builder başlatıldı.
- Adım 6 bitti+doğrulandı (1318 test): röle sıçraması+ark, endüktans doyması (varsayılanlar genel; mevcut devrelerde yeni röle varsayılanları ark/aşınma raporu verebilir). Adım 8 (RP2040 emülatörü) builder başlatıldı; ESP32 QEMU kapsam dışı (kurulum yok).
- Tarayıcı: Protokol sekmesi + Osiloskop FFT görünümü açılıyor (UI render doğrulandı; gerçek sinyalle spektrum denenmedi). Bekleyen: RP2040 builder, adım 9 internet arama, features/STATUS final.
- Adım 8 builder bitti (1322 test): Rp2040Runtime + UF2 + JS ROM kalıbı (romShim.ts; GERÇEK bootrom değil, indirilmedi). Blink GP25 1 Hz. KULLANICIYA SABAH SOR: gerçek bootrom indirilsin mi / shim kalsın mı. Adım 9 (internet arama+SPICE+3D) builder başlatıldı.
- Limit sonrası (5 saat) adım 9 builder'ı SendMessage ile devam ettirildi. Bitince: doğrula, features.ts/STATUS son güncelleme (gece 3 maddeleri), son rapor.
- Adım 9 bitti+doğrulandı (1336 test, pytest 52). features.ts + STATUS.md güncellendi.

## DURUM (gece 3): TÜM SIRALI GÖREVLER BİTTİ. Sabah kullanıcıya: Pico bootrom kararı; yeni UI'ların elle denenmesi.

# GECE 4 — şematik
- Şematik editör: T-bağlantı (Wire.tap, nets.ts uyumlu, kavşak noktası), çoklu seçim/kutu/Ctrl+A/grup işlemleri/hizalama, Oto. kablo (A*), HintBar, otomatik dönüş (yeni parça pine bakar + "Oto. yön"). Yeni testler: wiring/orient/group/schematicStore (28 test). tsc temiz, 1364 test geçti, build tamam; features.ts + STATUS.md güncellendi. Tarayıcı: Ctrl+A, kutu seçimi, T-bağlantı doğrulandı; Alt+tıkla, fareyle grup sürükleme, Oto. kablo, 3D görünüm denenmedi. Bağlama sırasında kendiliğinden döndürme yok.

# GECE 5 — PCB merkezi
- Adım 1 (üretim çıktısı): strokeFont.ts (kendi çizgi fontu), Gerber F/B silk referans yazısı (alt yüz aynalı), F_Paste.gtp/B_Paste.gbp (yalnız SMD), NPTH.drl (boş), KiCad fp_text reference/value + In1/In2 katman tanımı + zone poligonu. Testler eklendi. gerbonara/kiutils ile açıldı (KiCad'in kendisinde açılmadı; zone doldurulmamış). SMD paste yalnızca birim testle doğrulandı (harici örnekte SMD parça yoktu).
- Adım 2 (net sınıfları ve net adları): core/pcb/netclass.ts (kararlı net anahtarı = netin en küçük 'comp:pin' anahtarı, net indeksi değil), PcbRules.netClasses + PcbDesign.netClassOf/netNames (opsiyonel; ensureDesign eski projeye varsayılan ekler), DRC (aralık: iki sınıfın büyüğü; MIN_WIDTH: Default genel minWidth, diğer sınıflar max(minWidth, sınıf izi)), yönlendirici (sınıf başına doluluk ızgarası; iz/via sınıftan, aralık max(kendi, engel sınıfı)), Pcb.tsx (sınıf tablosu, net→sınıf, net adı, elle iz/via sınıftan), KiCad (net adları, net_class, .kicad_pro). 18 yeni test; tümü: 1393 test geçti. Sınırlar: Default satırı hep genel kuralları yansıtır; atama o pin netten çıkarsa/en küçük anahtar değişirse başka pine kayabilir; fark çifti aralığı (diffGap) yalnız saklanır; net_class ve .kicad_pro KiCad'de açılmadı (alan adları bellekten); tarayıcıda elle denenmedi.
- Adım 3 (poligon geometrisi): core/pcb/geom.ts (poligonda nokta, segment/sınır mesafesi, içe/dışa offset, bbox, alan; konkav destekli), outline.poly, Zone.poly/priority/thermal/minThickness, design.holes (NPTH). Gerber: zone poligon bölgesi, aynı net pad'e 4 spoke termal, farklı net boşluğu, öncelik sırası, Edge_Cuts poligon, NPTH.drl delikleri. DRC: gerçek zone poligonu (zone dışı pad bağlanmaz), EDGE poligon sınırına göre, HOLE_OFF_BOARD/HOLE_CLEARANCE/ZONE_OUTSIDE. Yönlendirici: kart dışı + montaj deliği hücreleri engel. KiCad: gr_poly, zone poligonu (priority, termal), np_thru_hole footprint. Arayüz: Zone çokgen / Kart sınırı / Montaj deliği araçları, 'Kart' sekmesi (köşe/zone/delik düzenleme), 3D'de THREE.Shape kart. 21 yeni test; tümü 1414 test geçti. Planlı (yapılmadı): ada temizliği, min kalınlık uygulaması. Sınırlar: offset miter tabanlı, öz-kesişim temizliği yok; çokgen zone karta kırpılmaz; zone öncelik dolgusu kaba (üst öncelik farklı net alt zone'u poligon+boşluk kadar siler, aynı net birleşir); courtyard poligon kontrolü yalnız köşe noktalarına bakar; tarayıcıda elle denenmedi; gerbonara/kiutils bu makinede kurulu olmadığı için harici açma YAPILMADI, KiCad söz dizimleri doğrulanmadı.
- Adım 4 (footprint kütüphanesi): core/pcb/landPatterns.ts (parametrik üreteçler, tipik/doğrulanmamış boyutlar), footprintFor(def, override?) (varsayılan yol aynı), placements[id].footprint + customFootprints, resolveFootprint (pin uyuşmazlığı reddi + DRC FOOTPRINT_MISMATCH), Gerber/KiCad/DRC/UI tüketicileri, ui/FootprintEditor.tsx. 12 yeni test. Sınırlar: QFN EP pad yok, BOM override'sız, tarayıcıda elle denenmedi.
- Adım 6 (.kicad_pcb içe aktarma, kısıtlı): core/export/sexpr.ts (genel S-ifade okuyucu, yinelemeli, derinlik sınırlı) + kicadImport.ts (PcbDesign yaması: konum/rot/side, iz, via, zone, Edge.Cuts, NPTH, katman sayısı; uyarı listesi) + Pcb.tsx "KiCad içe aktar" (özet, uyarılar, üzerine yazma onayı). Testler: sexpr.test.ts + kicadImport.test.ts. Sınır: yalnız kendi çıktımızla gidiş-dönüş sınandı, gerçek KiCad dosyası yok; alan adları/açı yönü doğrulanmadı; tarayıcıda elle denenmedi.
- Adım 5 (yönlendirme): router.ts 8 yönlü A* (45° seçenek, kütüphane varsayılanı kapalı = eski çıktı hash-regresyonlu; UI varsayılanı açık) + sıra tabanlı rip-up/retry (tohumlu, en iyi geçiş) ; core/pcb/length.ts (net uzunluğu, hedef/tolerans, DRC LENGTH); core/pcb/diffpair.ts (basit fark çifti: ofsetle türet + DRC doğrula, olmazsa 'başarısız'); core/pcb/manual.ts (45° kilidi, canlı clearance); Pcb.tsx (45° kilit/Shift, kırmızı canlı ihlal, Uzunluk sekmesi, oto-yönlendir seçenekleri). Yeni testler: route45.test.ts + manual.test.ts. Sınırlar: gerçek rip-up-and-reroute/push-and-shove yok, serpantin yok, fark çifti yalnız 2 pinli netler, UI tarayıcıda elle denenmedi.
