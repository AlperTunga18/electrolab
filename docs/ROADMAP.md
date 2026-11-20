# Yol haritası

| Aşama | Kapsam | Durum |
|---|---|---|
| 1 | Altyapı, 3D alan, yerleştirme, kablo, kayıt | Büyük ölçüde tamam (katman/grup/çoklu seçim eksik) |
| 2 | Kütüphane → 100+ bileşen, GLB model içe aktarma, KiCad/SnapEDA/LCSC lisans araştırması ve içe aktarıcılar | Kısmi (~20 genel model) |
| 3 | Netlist dışa aktarma, ngspice çapraz doğrulama, AC analiz | DC+transient yerleşik çözücüyle tamam; ngspice yok |
| 4 | Termal model, arıza enjeksiyonu, yanma/duman, arıza raporu | Yalnızca limit aşımı uyarısı |
| 5 | ESP32/Arduino, kod editörü, emülasyon (Renode/QEMU/Wokwi araştırması) | Planlı |
| 6 | Eğitim: quiz, görevler, 30+ devre | 6 devre |
| 7 | Sürüklenebilir ölçüm probları, ek cihazlar, motor, SMPS | Planlı |
| 8 | 2D şematik, PCB, BOM, Gerber, PDF, KiCad | BOM CSV (kısmi) |

Her aşama sonunda: testleri çalıştır, `src/features.ts` ve `docs/STATUS.md` güncelle.
