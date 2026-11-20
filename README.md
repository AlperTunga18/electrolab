# ElectroLab 3D

Sanal elektronik laboratuvarı: 3D yerleştirme, kablolama, gerçek MNA tabanlı devre simülasyonu, osiloskop, aşım uyarıları.

## Çalıştırma
```bash
cd frontend && npm install && npm run dev        # http://localhost:5173
cd backend && py -3.11 -m venv .venv && .venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m uvicorn app.main:app --port 8000   # isteğe bağlı: proje kaydı + motor durumu
```
Sunucu yoksa projeler yerel depolamaya kaydedilir.

## Testler
```bash
cd frontend && npm test        # çözücü doğrulama + örnek devreler (32 test)
cd backend && .venv/Scripts/python -m pytest
```

Durum: `docs/STATUS.md` · Mimari: `docs/ARCHITECTURE.md` · Yol haritası: `docs/ROADMAP.md`
