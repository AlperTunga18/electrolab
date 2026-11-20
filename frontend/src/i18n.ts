export type Lang = 'tr' | 'en';

const tr = {
  appName: 'ElectroLab 3D',
  tagline: 'Öğren · Tasarla · Bağla · Simüle Et · Ölç · Hata Oluştur · Analiz Et',
  newProject: 'Yeni proje', myProjects: 'Projelerim', lab: '3D Elektronik Laboratuvarı', library: 'Bileşen Kütüphanesi',
  academy: 'Eğitim Merkezi', simCenter: 'Simülasyon Merkezi', mcuLab: 'Mikrodenetleyici Lab.', pcb: 'PCB Tasarım Merkezi',
  instruments: 'Ölçüm Cihazları', settings: 'Ayarlar', home: 'Ana ekran',
  run: 'Çalıştır', stop: 'Durdur', reset: 'Sıfırla', save: 'Kaydet', undo: 'Geri al', redo: 'Yinele',
  dcSolve: 'DC çöz', export: 'Dışa aktar', import: 'İçe aktar', bom: 'BOM (CSV)',
  search: 'Ara…', all: 'Tümü', properties: 'Özellikler', noSelection: 'Seçim yok. Bir bileşene veya kabloya tıklayın.',
  scope: 'Osiloskop', measurements: 'Ölçümler', log: 'Kayıtlar', serial: 'Seri monitör',
  planned: 'Planlanıyor', partial: 'Kısmi', done: 'Çalışıyor',
  speed: 'Hız (sim s / gerçek s)', wireColor: 'Kablo rengi', wireWidth: 'Kalınlık', grid: 'Izgara', labels: 'Etiketler', voltageTags: 'Gerilim etiketleri',
  simDisclaimer: 'Bu bir SANAL simülasyondur. Gerçek devrelerde şebeke gerilimi, büyük kondansatörler, piller ve yüksek akım ölçümleri hayati tehlike taşır.',
  noGround: 'Devrede toprak yok', delete: 'Sil', rotate: 'Döndür (R)', duplicate: 'Çoğalt',
  category: { passive: 'Pasif', semiconductor: 'Yarı iletken', source: 'Kaynaklar', io: 'Giriş/Çıkış', reference: 'Referans', ic: 'Entegre', mcu: 'Mikrodenetleyici', power: 'Güç', sensor: 'Sensör', display: 'Ekran', motor: 'Motor/Aktüatör', comm: 'Haberleşme', connector: 'Bağlantı' },
  missingData: 'Eksik veri', dataSource: 'Veri kaynağı', genericModel: 'Genel (generic) model — üretici parçası değil',
  language: 'Dil', backend: 'Sunucu', online: 'çevrimiçi', offline: 'çevrimdışı (yerel depolama)',
  ratings: 'Sınırlar', exceeded: 'SINIR AŞILDI',
} as const;

const en: Record<keyof typeof tr, unknown> = {
  appName: 'ElectroLab 3D',
  tagline: 'Learn · Design · Wire · Simulate · Measure · Break · Analyze',
  newProject: 'New project', myProjects: 'My projects', lab: '3D Electronics Lab', library: 'Component Library',
  academy: 'Academy', simCenter: 'Simulation Center', mcuLab: 'Microcontroller Lab', pcb: 'PCB Design Center',
  instruments: 'Instruments', settings: 'Settings', home: 'Home',
  run: 'Run', stop: 'Stop', reset: 'Reset', save: 'Save', undo: 'Undo', redo: 'Redo',
  dcSolve: 'DC solve', export: 'Export', import: 'Import', bom: 'BOM (CSV)',
  search: 'Search…', all: 'All', properties: 'Properties', noSelection: 'Nothing selected. Click a component or wire.',
  scope: 'Oscilloscope', measurements: 'Measurements', log: 'Log', serial: 'Serial monitor',
  planned: 'Planned', partial: 'Partial', done: 'Working',
  speed: 'Speed (sim s / real s)', wireColor: 'Wire color', wireWidth: 'Thickness', grid: 'Grid', labels: 'Labels', voltageTags: 'Voltage tags',
  simDisclaimer: 'This is a VIRTUAL simulation. Mains voltage, large capacitors, batteries and high currents are life-threatening on real circuits.',
  noGround: 'No ground in circuit', delete: 'Delete', rotate: 'Rotate (R)', duplicate: 'Duplicate',
  category: { passive: 'Passive', semiconductor: 'Semiconductor', source: 'Sources', io: 'Input/Output', reference: 'Reference', ic: 'IC', mcu: 'Microcontroller', power: 'Power', sensor: 'Sensor', display: 'Display', motor: 'Motor/Actuator', comm: 'Comms', connector: 'Connector' },
  missingData: 'Missing data', dataSource: 'Data source', genericModel: 'Generic model — not a manufacturer part',
  language: 'Language', backend: 'Backend', online: 'online', offline: 'offline (local storage)',
  ratings: 'Ratings', exceeded: 'LIMIT EXCEEDED',
};

const dict = { tr, en } as unknown as Record<Lang, typeof tr>;

export type Dict = typeof tr;
export const getDict = (lang: Lang): Dict => dict[lang];
