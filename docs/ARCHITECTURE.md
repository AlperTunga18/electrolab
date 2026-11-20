# ElectroLab 3D — Mimari

## Katmanlar
```
frontend/ (React + TS + Vite + R3F + Zustand + Tailwind)
  src/core/circuit   merkezi devre modeli (types), net çıkarımı (nets), geometri, builder
  src/core/sim       MNA çözücü (mna.ts), canlı çalıştırıcı (runner.ts), aşım kontrolü (stress.ts)
  src/library        bileşen tanımları (pin, parametre, anma değeri, EKSİK veri listesi)
  src/three          3D sahne ve parametrik modeller
  src/store          zustand durumu (lab.ts), kalıcılık (persist.ts)
  src/ui, examples   arayüz, hazır devreler
backend/ (FastAPI + SQLite)
  app/routes         /api/projects (sürümlü), /api/sim, /ws/health
  app/sim            SimEngine arayüzü + ngspice/Xyce/Icarus adaptörleri, Renode/QEMU kayıtları (planned)
```

## Karar gerekçeleri
- **Merkezi devre modeli** (`Circuit = components + wires`): 3D, ileride 2D şematik ve PCB aynı veriyi düzenler; netler her seferinde teller + toprak bileşeninden türetilir (union-find), böylece görünümler arasında tutarsızlık olmaz.
- **Çözücü tarayıcıda (TypeScript)**: gerçek zamanlı etkileşim (anahtar çevir → anında sonuç) için gecikmesiz; testlenebilir; sunucu gerektirmez. Dense MNA küçük/orta devreler için yeterli; büyük devreler için seyrek çözücü planlı.
- **Dış motorlar sunucuda, adaptör arayüzüyle**: ngspice (analog, otorite referans), Xyce, Icarus Verilog (dijital), Renode/QEMU (MCU). Hiçbiri kurulu değilse `503 not installed` döner; sahte sonuç üretilmez. Sonraki adım: frontend netlist’i (SPICE netlist dışa aktarma) ngspice’a gönderip yerleşik çözücüyle çapraz doğrulama.
- **Basit eğitim modeli ile SPICE seviyesi ayrımı**: yerleşik modeller genel ders kitabı modelleridir (UI’da “generic” etiketli); üretici SPICE modeli yoksa varmış gibi gösterilmez.
- **Arıza**: şimdilik yalnızca anma aşımı uyarısı. Gerçek “yanma zamanı” termal model + datasheet verisi ister (Aşama 4).

## Çözücü
MNA (düğüm gerilimleri + V kaynağı/bobin/kondansatör-IC dalları). Newton-Raphson, pnjlim sınırlama, kaynak/gmin adımlama; transient: BE/trapezoidal (süreksizlikte BE’ye dönüş), yakınsama olmazsa adım yarılama. Bilinen sınırlar: ideal kaynaklar (iç direnç yok), kare dalga kenarları ideal, ESR/kaçak/Early etkisi yok.

## Dış motor entegrasyon planı
1. `frontend/core/sim/spice.ts`: Circuit → SPICE netlist.
2. `POST /api/sim/run` ile ngspice batch; çıktı ayrıştırma; yerleşik çözücüyle karşılaştırma testleri.
3. Xyce/Icarus aynı adaptör arayüzü; Renode/QEMU/Wokwi için lisans/API araştırması sonrası.

## Arıza / termal (Aşama 4)
- `core/thermal/thermal.ts`: Cth·dTj/dt = P − (Tj−Tamb)/Rθ, her adımda sabit güç için tam çözüm; Rθ/Cth paket sınıfı + anma gücünden tahmin (UI'da "tahmini" etiketli); soğutucu (Rθsa) ve fan (×0.4) etkisi.
- `core/sim/faults.ts` + `Sim` seçeneği `faults`: yapısal (açık/kısa/kaçak/gate/aralıklı) ve parametre düzeyi (kayma/kapasite kaybı/yapışık kontak) arızalar; kullanıcı arızaları `circuit.faults`, hasar modeli arızaları runner'da.
- `core/sim/damage.ts`: tetikleyiciler (Tj≥Tjmax, ≥1.5× gerilim, ≥3× akım küçük parça, kontak ≥2×) + kural tabanlı arıza raporu; tek bir evrensel yanma formülü yok.
- Isıl zaman ölçeği: elektriksel (µs–ms) ve ısıl (s–dk) süreler ayrıdır; `Isıl hız ×` ısıl-saniye/benzetim-saniyesi çarpanıdır, ortalama güç kullanılır.

## Mikrodenetleyiciler (Aşama 5)
- Sözleşme: `core/mcu/types.ts` (`McuRuntime`: load/advance/drives/gpio/serial). Çalışma zamanı SİMÜLE zamanda koşar; çözücüyle yalnızca pin sürüşü (çıkış) ve pin gerilimi (giriş) üzerinden konuşur.
- Elektrik: `mcu` modeli = her GPIO için Thevenin elemanı (`T`), kart GND pinleri içeriden bağlı, besleme pinleri kaynak. Kart spesifikasyonları `core/mcu/boards.ts`; desteklenmeyen kartlar kütüphane-only kalır.
- Çalışma zamanları: `sketch/` (Arduino C++ alt kümesi → JS generator, deyim başı 1 µs, delay/millis simüle zamandan) ve `avr/` (avr8js, gerçek HEX). `factory.ts` seçer. Sunucu: `/api/mcu/compile` (arduino-cli).
- `LiveRunner` her alt adımda MCU'yu ilerletir, pin sürüşlerini çözücüye yazar; pin gerilim/akım aşımı uyarı, ≥VDD+1.5 V veya ≥2× akım pin hasarı.

## Eğitim (Aşama 6)
- `education/types.ts` ders şeması; `engine.ts` probe değerlendirme (DC / geçici istatistik); `progress.ts` ilerleme-rozet-defter (localStorage).
- Her ders çözücüye karşı test edilir (`lessons.test.ts`): beklenen sonuçlar, sayısal quiz, görev (başlangıç geçmez / referans çözüm geçer), arıza avı (gizli arıza ölçülebilir fark yaratır).
- Gizli arızalar `hiddenFaults` olarak yalnızca simülasyon devresine eklenir, hiçbir arıza listesinde görünmez.

## AC analiz, cihazlar, elektromekanik modeller (Aşama 7)
- `Sim.acAt(f, stim)`: DC çalışma noktasında doğrusallaştırılmış kompleks MNA (R, C, L, diyot/BJT/MOSFET küçük-sinyal, motor, röle bobini, transformatör kuplajı). `core/sim/ac.ts`: `acSweep`, `analyzeResponse`, `measureImpedance`, `diodeTest`, `insulationTest` (enerjisiz devre = kaynaklar sıfırlanır).
- Elektromekanik: `motor` (i ve ω MNA bilinmeyeni, tanh sürtünme), `relay` (bobin R+L, eşik+gecikme durum makinesi, kontak direnci), `transformer` (iki sargı, ortak endüktans), `eload` (CC/CR/CP; CP için güç sürekliliği).
- Cihazlar yükler: `MeterSpec` pinler arasına gerçek direnç koyar (voltmetre 10 MΩ, ampermetre 10 mΩ + 10 A sigorta, analog 20 kΩ/V). Okumalar `LiveRunner` ağ/parça tamponlarından `core/instruments/readings.ts` ile hesaplanır.

## Şematik ve PCB (Aşama 8)
- Tek devre modeli: şematik (`PlacedComponent.sch`), 3D (x,z) ve PCB (`Circuit.pcb`, mm) aynı bileşen/kablo/net verisini paylaşır; kablo çizmek her görünümde aynı `Circuit.wires` kaydını değiştirir. PCB bağlantısı geometriden türetilir ve devre net'leriyle karşılaştırılır (UNROUTED / SHORT).
- `core/schematic`: semboller, otomatik yerleşim, ortogonal kablo, ERC, SVG. `core/pcb`: footprint üretimi, yerleşim, DRC + IPC hesapları, A* yönlendirici, Gerber/Excellon/ZIP. `core/export`: KiCad (deneysel) ve PDF.
- Doğrulama: `pipeline.test.ts` örnek devreleri yerleştirir → yönlendirir → DRC hatasız → Gerber/ZIP/KiCad/PDF üretir.

## Mühendislik asistanı
- `core/assistant`: `context.ts` (topoloji + DC çözüm + stres + ısıl + ERC), `calc.ts` (adım adım hesaplar, E24, MOSFET sıralama), `analysis.ts` (direnç/kondansatör rol tespiti, inceleme kuralları), `codegen.ts` (pin bağlantılarından Arduino kodu), `answer.ts` (Türkçe niyet eşleme + cevaplar + kaynak listesi), `llm.ts` (isteğe bağlı yapay zekâ).
- Yapay zekâ modu yalnızca kullanıcı açarsa çalışır; gönderilen bağlam arayüzde önizlenir; istek `/api/ai/chat` yerel vekil sunucusundan geçer (anahtar günlüğe yazılmaz). Anahtar yoksa çevrimdışı motor çalışmaya devam eder.
