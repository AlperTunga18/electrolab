import { useEffect, useState } from 'react';
import { useLab } from '../store/lab';
import { COMPONENTS } from '../library/components';
import { LESSONS } from '../education/content';
import { EXAMPLES } from '../examples/examples';
import { FEATURES, type FeatureStatus } from '../features';
import { backendOnline, deleteProject, listProjects, loadProject, type ProjectSummary } from '../store/persist';
import { getDict } from '../i18n';

const card = 'rounded-lg border border-zinc-800 bg-zinc-900';
const btn = 'px-3 py-1.5 rounded text-sm border border-zinc-700 bg-zinc-800 hover:bg-zinc-700';

export function PageShell({ title, children }: { title: string; children: React.ReactNode }) {
  const go = useLab((s) => s.go);
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center gap-3 mb-5"><button className={btn} onClick={() => go('home')}>← Ana ekran</button><h1 className="text-xl font-semibold">{title}</h1></div>
        {children}
      </div>
    </div>
  );
}

const badge: Record<FeatureStatus, string> = {
  done: 'bg-emerald-900 text-emerald-300', partial: 'bg-amber-900 text-amber-300', planned: 'bg-zinc-800 text-zinc-400',
};
const badgeText: Record<FeatureStatus, string> = { done: 'Çalışıyor ve test edildi', partial: 'Kısmi', planned: 'Planlanıyor' };

export function Home() {
  const s = useLab();
  const t = getDict(s.lang);
  const tiles: { key: string; title: string; desc: string; status: FeatureStatus; onClick: () => void }[] = [
    { key: 'new', title: t.newProject, desc: 'Boş çalışma alanı', status: 'done', onClick: () => { s.newProject(); s.go('lab'); } },
    { key: 'proj', title: t.myProjects, desc: 'Kayıtlı projeler', status: 'done', onClick: () => s.go('projects') },
    { key: 'lab', title: t.lab, desc: 'Yerleştir, bağla, çalıştır', status: 'done', onClick: () => s.go('lab') },
    { key: 'lib', title: t.library, desc: `${COMPONENTS.length} genel model`, status: 'partial', onClick: () => s.go('library') },
    { key: 'acad', title: t.academy, desc: `${LESSONS.length} ders, ${EXAMPLES.length} hazır devre, testler, görevler`, status: 'partial', onClick: () => s.go('academy') },
    { key: 'sim', title: t.simCenter, desc: 'Motorlar ve doğrulama', status: 'partial', onClick: () => s.go('simcenter') },
    { key: 'mcu', title: t.mcuLab, desc: 'Arduino / ESP32 / Pico, kod, seri monitör', status: 'partial', onClick: () => s.go('mculab') },
    { key: 'sch', title: 'Şematik editörü', desc: '2D şema (3D ile senkron), ERC', status: 'partial', onClick: () => s.go('schematic') },
    { key: 'pcb', title: t.pcb, desc: 'Yerleşim, iz, DRC, Gerber, KiCad', status: 'partial', onClick: () => s.go('pcb') },
    { key: 'inst', title: t.instruments, desc: 'Osiloskop + ölçüm tablosu (Lab içinde)', status: 'partial', onClick: () => s.go('lab') },
    { key: 'ai', title: 'Mühendislik asistanı', desc: 'Devre analizi, hesaplar, kod; API anahtarı olmadan çalışır', status: 'partial', onClick: () => { s.set({ bottomTab: 'assistant', panels: { ...s.panels, bottom: true } }); s.go('lab'); } },
    { key: 'set', title: t.settings, desc: 'Dil, durum raporu', status: 'done', onClick: () => s.go('settings') },
  ];
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-8">
        <h1 className="text-3xl font-bold">⚡ {t.appName}</h1>
        <p className="text-zinc-400 mt-1">{t.tagline}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 mt-6">
          {tiles.map((x) => (
            <button key={x.key} onClick={x.onClick} className={`${card} p-4 text-left hover:border-emerald-600 transition-colors`}>
              <div className="font-semibold">{x.title}</div>
              <div className="text-xs text-zinc-400 mt-1">{x.desc}</div>
              <span className={`inline-block mt-3 px-1.5 py-0.5 rounded text-[10px] ${badge[x.status]}`}>{badgeText[x.status]}</span>
            </button>
          ))}
        </div>
        <p className="mt-10 text-[11px] text-zinc-500">⚠ {t.simDisclaimer}</p>
      </div>
    </div>
  );
}

export function Planned() {
  const title = useLab((s) => s.plannedTitle);
  return (
    <PageShell title={title}>
      <div className={`${card} p-6 text-zinc-300`}>
        <div className={`inline-block px-2 py-0.5 rounded text-xs mb-3 ${badge.planned}`}>Planlanıyor — henüz uygulanmadı</div>
        <p>Bu modül henüz çalışmıyor; çalışıyormuş gibi gösterilmiyor. Kapsam ve sıra için <b>Ayarlar → Proje durumu</b> bölümüne bakın.</p>
      </div>
    </PageShell>
  );
}

export function Projects() {
  const s = useLab();
  const [items, setItems] = useState<ProjectSummary[]>([]);
  const [online, setOnline] = useState(false);
  const [err, setErr] = useState('');
  const refresh = () => listProjects().then((r) => { setItems(r.items); setOnline(r.online); }).catch((e) => setErr(String(e)));
  useEffect(() => { void refresh(); }, []);
  return (
    <PageShell title="Projelerim">
      <div className="text-xs text-zinc-400 mb-3">Sunucu: {online ? <span className="text-emerald-400">çevrimiçi (SQLite)</span> : <span className="text-amber-300">çevrimdışı — yerel depolama kullanılıyor</span>}</div>
      {err && <div className="text-red-400 text-sm mb-2">{err}</div>}
      {!items.length && <div className="text-zinc-500 text-sm">Kayıtlı proje yok. Laboratuvarda “Kaydet”e basın.</div>}
      <div className="space-y-2">
        {items.map((p) => (
          <div key={p.source + p.id} className={`${card} p-3 flex items-center gap-3`}>
            <div className="flex-1"><b>{p.name}</b><div className="text-xs text-zinc-500">{new Date(p.updated_at).toLocaleString('tr-TR')} · sürüm {p.version} · {p.source === 'backend' ? 'sunucu' : 'yerel'}</div></div>
            <button className={btn} onClick={async () => { const d = await loadProject(p.id, p.source); s.loadCircuit(d.circuit, d.name, p.id, p.source); s.go('lab'); }}>Aç</button>
            <button className={btn} onClick={async () => { if (confirm(`“${p.name}” silinsin mi?`)) { await deleteProject(p.id, p.source); void refresh(); } }}>Sil</button>
          </div>
        ))}
      </div>
    </PageShell>
  );
}

interface EngineInfo { id: string; name: string; kind: string; available: boolean; status: string; license: string; notes: string }

export function SimCenter() {
  const [engines, setEngines] = useState<EngineInfo[] | null>(null);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    void backendOnline().then(async (ok) => {
      setOnline(ok);
      if (ok) setEngines(await (await fetch('/api/sim/engines')).json() as EngineInfo[]);
    });
  }, []);
  return (
    <PageShell title="Simülasyon Merkezi">
      <div className={`${card} p-4 mb-4`}>
        <b>Yerleşik çözücü (tarayıcıda)</b> <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${badge.done}`}>Çalışıyor ve test edildi</span>
        <p className="text-sm text-zinc-400 mt-2">Modified Nodal Analysis; Newton-Raphson (junction limiting, source/gmin stepping); transient: backward-Euler ve trapezoidal; modeller: R, C, L, V/I kaynakları, diyot/LED/zener (Shockley), BJT (Ebers-Moll), MOSFET (level-1 + gövde diyodu). Genel ders kitabı modelleridir — üretici SPICE modeli değildir.</p>
        <div className="text-xs text-zinc-300 mt-2">Doğrulama: bölücü, paralel direnç, pot, LED, diyot, zener, NPN doyum, NMOS/PMOS, RC şarj/deşarj, RL, RC alçak geçiren (fc’de 1/√2), yarım dalga doğrultucu, enerji dengesi. <code>npm test</code></div>
      </div>
      <h2 className="font-semibold mb-2">Harici motor adaptörleri (sunucu)</h2>
      {!online && <div className="text-amber-300 text-sm">Sunucu çevrimdışı; adaptör durumu okunamıyor. <code>backend</code> klasöründe <code>uvicorn app.main:app --port 8000</code> çalıştırın.</div>}
      <div className="grid md:grid-cols-2 gap-3">
        {engines?.map((e) => (
          <div key={e.id} className={`${card} p-3`}>
            <div className="flex justify-between"><b>{e.name}</b><span className="text-xs text-zinc-500">{e.kind}</span></div>
            <div className={`text-xs mt-1 ${e.available ? 'text-emerald-400' : 'text-zinc-400'}`}>{e.status === 'available' ? 'Kurulu ve kullanılabilir' : e.status === 'planned' ? 'Planlanıyor' : 'Kurulu değil'}</div>
            <div className="text-xs text-zinc-500 mt-1">{e.license} — {e.notes}</div>
          </div>
        ))}
      </div>
    </PageShell>
  );
}

export function Settings() {
  const s = useLab();
  const t = getDict(s.lang);
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => { void backendOnline().then(setOnline); }, []);
  return (
    <PageShell title={t.settings}>
      <div className={`${card} p-4 mb-4 space-y-3`}>
        <label className="text-sm flex items-center gap-3">{t.language}
          <select value={s.lang} onChange={(e) => s.setLang(e.target.value as 'tr' | 'en')} className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1"><option value="tr">Türkçe</option><option value="en">English</option></select>
        </label>
        <div className="text-sm">{t.backend}: {online === null ? '…' : online ? <span className="text-emerald-400">{t.online}</span> : <span className="text-amber-300">{t.offline}</span>}</div>
      </div>
      <h2 className="font-semibold mb-2">Proje durumu (uygulanan / kısmi / planlanan)</h2>
      <div className="space-y-4">
        {FEATURES.map((g) => (
          <div key={g.group} className={`${card} p-3`}>
            <div className="font-medium mb-2">{g.group}</div>
            {g.items.map((f) => (
              <div key={f.name} className="flex items-start gap-2 text-sm py-0.5">
                <span className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[10px] ${badge[f.status]}`}>{badgeText[f.status]}</span>
                <span>{f.name}{f.note && <span className="text-zinc-500"> — {f.note}</span>}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </PageShell>
  );
}
