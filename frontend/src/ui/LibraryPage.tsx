import { useMemo, useState } from 'react';
import { useLab } from '../store/lab';
import { COMPONENTS, deleteUserPart, getDef, saveUserPart } from '../library/components';
import { categoriesInUse, searchParts, simOf, type SimFilter } from '../library/search';
import type { Category, ComponentDef } from '../library/types';
import { datasheetSearch } from '../library/factories';
import { formatSI, parseSI } from '../core/units';
import { getDict } from '../i18n';
import { PageShell } from './Pages';
import { DatasheetImport } from './DatasheetImport';
import { OnlineParts } from './OnlineParts';
import { SpiceImport } from './SpiceImport';
import { Model3dUpload } from './Model3dUpload';

const card = 'rounded-lg border border-zinc-800 bg-zinc-900';
const btn = 'px-2.5 py-1 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700';

const SIM_BADGE = {
  full: ['bg-emerald-900 text-emerald-300', 'Tam model'],
  partial: ['bg-amber-900 text-amber-300', 'Kısmi model'],
  none: ['bg-zinc-800 text-zinc-400', 'Model yok'],
} as const;

export const SimBadge = ({ c }: { c: ComponentDef }) => {
  const [cls, text] = SIM_BADGE[simOf(c)];
  return <span className={`px-1.5 py-0.5 rounded text-[10px] ${cls}`}>{text}</span>;
};

function PartCard({ c, selected, onSelect }: { c: ComponentDef; selected: boolean; onSelect: () => void }) {
  const s = useLab();
  const [open, setOpen] = useState(false);
  const specs = Object.entries(c.specs ?? {});
  return (
    <div className={`${card} p-3 ${selected ? 'border-cyan-500' : ''}`}>
      <div className="flex justify-between gap-2">
        <div>
          <b>{s.lang === 'tr' ? c.name : c.nameEn}</b>
          <div className="text-[11px] text-zinc-500">{[c.manufacturer, c.package, c.mpn && c.mpn !== c.name ? c.mpn : null].filter(Boolean).join(' · ') || 'Genel model'}</div>
        </div>
        <label className="text-[11px] text-zinc-400 flex items-start gap-1 shrink-0"><input type="checkbox" checked={selected} onChange={onSelect} />karşılaştır</label>
      </div>
      <p className="text-xs text-zinc-400 mt-1">{c.description}</p>
      <div className="flex gap-1.5 flex-wrap mt-2 items-center">
        <SimBadge c={c} />
        {c.verified !== 'datasheet' && c.dataSource === 'manufacturer' && <span className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-amber-300">değerler datasheet ile doğrulanmadı</span>}
        {c.userMade && <span className="px-1.5 py-0.5 rounded text-[10px] bg-sky-900 text-sky-300">kullanıcı parçası</span>}
        {c.tags?.map((t) => <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-400">{t}</span>)}
      </div>
      {specs.length > 0 && (
        <table className="w-full mt-2 text-[11px]"><tbody>
          {specs.slice(0, open ? 99 : 5).map(([k, v]) => <tr key={k} className="border-t border-zinc-800"><td className="py-0.5 pr-2 text-zinc-500 whitespace-nowrap align-top">{k}</td><td className="text-zinc-200">{v}</td></tr>)}
        </tbody></table>
      )}
      {open && (
        <div className="mt-2 text-[11px] space-y-1">
          {c.simNote && <div className="text-zinc-300"><b>Simülasyon:</b> {c.simNote}</div>}
          <div className="text-zinc-300"><b>Pinler ({c.pins.length}):</b> {c.pins.map((p) => p.label).join(' · ')}</div>
          {c.params.length > 0 && <div className="text-zinc-300"><b>Parametreler:</b> {c.params.map((p) => `${p.label}${p.type === 'number' ? ` = ${p.si ? formatSI(Number(p.default), p.unit) : p.default}` : ''}`).join('; ')}</div>}
          <div className="text-amber-300/80"><b>Eksik:</b> {c.missing.length ? c.missing.join(', ') : '—'}</div>
          {c.userMade && <Model3dUpload c={c} />}
        </div>
      )}
      <div className="flex gap-2 mt-2 flex-wrap">
        <button className={btn} onClick={() => setOpen(!open)}>{open ? 'Daralt' : 'Ayrıntı'}</button>
        <button className={btn} onClick={() => { s.go('lab'); s.arm(c.type); }}>Laboratuvara ekle</button>
        {c.datasheetUrl && <a className={btn} href={c.datasheetUrl} target="_blank" rel="noreferrer">Datasheet ara ↗</a>}
        {c.userMade && <button className={btn} onClick={() => { if (confirm('Silinsin mi?')) { deleteUserPart(c.type); s.set({ libVersion: s.libVersion + 1 }); } }}>Sil</button>}
      </div>
    </div>
  );
}

function Compare({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const parts = ids.map((i) => getDef(i));
  const keys = Array.from(new Set(parts.flatMap((p) => Object.keys(p.specs ?? {}))));
  return (
    <div className={`${card} p-3 mb-4 overflow-x-auto`}>
      <div className="flex justify-between mb-2"><b>Karşılaştırma</b><button className={btn} onClick={onClose}>Kapat</button></div>
      <table className="text-xs w-full"><thead><tr className="text-left text-zinc-400"><th className="pr-3 py-1"> </th>{parts.map((p) => <th key={p.type} className="pr-3">{p.name}</th>)}</tr></thead>
        <tbody>
          <tr className="border-t border-zinc-800"><td className="text-zinc-500 pr-3">Paket</td>{parts.map((p) => <td key={p.type}>{p.package ?? '—'}</td>)}</tr>
          <tr className="border-t border-zinc-800"><td className="text-zinc-500 pr-3">Simülasyon</td>{parts.map((p) => <td key={p.type}>{SIM_BADGE[simOf(p)][1]}</td>)}</tr>
          {keys.map((k) => <tr key={k} className="border-t border-zinc-800"><td className="text-zinc-500 pr-3 whitespace-nowrap">{k}</td>{parts.map((p) => <td key={p.type}>{p.specs?.[k] ?? '—'}</td>)}</tr>)}
        </tbody></table>
      <div className="text-[11px] text-zinc-500 mt-2">Fiyat ve bulunabilirlik: doğrulanmış güncel veri kaynağı bağlanana kadar gösterilmez. Değerler datasheet ile doğrulanmamıştır.</div>
    </div>
  );
}

function NewPart({ onDone }: { onDone: () => void }) {
  const bases = COMPONENTS.filter((c) => c.model !== 'none' && c.model !== 'ground' && !c.userMade && !c.mpn);
  const [baseType, setBaseType] = useState(bases[0]?.type ?? 'resistor');
  const base = getDef(baseType);
  const [name, setName] = useState('');
  const [mfr, setMfr] = useState('');
  const [mpn, setMpn] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [vals, setVals] = useState<Record<string, string>>({});
  const create = () => {
    if (!name.trim()) return;
    const params = base.params.map((p) => {
      const raw = vals[p.key];
      if (raw === undefined || raw === '' || p.type !== 'number') return p;
      const v = parseSI(raw);
      return v === null ? p : { ...p, default: v };
    });
    const def: ComponentDef = {
      ...base, type: `user_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now().toString(36)}`, name: name.trim(), nameEn: name.trim(),
      manufacturer: mfr || undefined, mpn: mpn || undefined, datasheetUrl: url || (mpn ? datasheetSearch(mpn) : undefined),
      params, userMade: true, dataSource: 'manufacturer', verified: false, tags: ['kullanıcı'],
      description: notes || base.description, specs: { ...(base.specs ?? {}), Not: notes || 'Kullanıcı tarafından girildi' },
      missing: ['kullanıcı tarafından girildi — doğrulanmadı'], visual: { ...(base.visual ?? {}), like: base.visual?.like ?? base.type },
    };
    saveUserPart(def);
    onDone();
  };
  const input = 'w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm';
  return (
    <div className={`${card} p-4 mb-4 space-y-3`}>
      <b>Kendi bileşenini oluştur</b>
      <p className="text-xs text-zinc-400">Mevcut bir elektriksel modeli temel alır; parametreleri kendi datasheet değerlerinle değiştirirsin. SPICE modeli / 3D model / datasheet PDF yükleme planlanıyor.</p>
      <div className="grid md:grid-cols-2 gap-3">
        <label className="text-xs text-zinc-400">Temel model<select className={input} value={baseType} onChange={(e) => { setBaseType(e.target.value); setVals({}); }}>{bases.map((b) => <option key={b.type} value={b.type}>{b.name}</option>)}</select></label>
        <label className="text-xs text-zinc-400">Ad *<input className={input} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="text-xs text-zinc-400">Üretici<input className={input} value={mfr} onChange={(e) => setMfr(e.target.value)} /></label>
        <label className="text-xs text-zinc-400">Model no<input className={input} value={mpn} onChange={(e) => setMpn(e.target.value)} /></label>
        <label className="text-xs text-zinc-400 md:col-span-2">Datasheet bağlantısı (boşsa model no ile arama)<input className={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></label>
        {base.params.filter((p) => p.type === 'number').map((p) => (
          <label key={p.key} className="text-xs text-zinc-400">{p.label} ({p.unit || '—'}) — varsayılan {p.si ? formatSI(Number(p.default), '') : String(p.default)}
            <input className={input} value={vals[p.key] ?? ''} placeholder="4.7k, 100n …" onChange={(e) => setVals({ ...vals, [p.key]: e.target.value })} /></label>
        ))}
        <label className="text-xs text-zinc-400 md:col-span-2">Not<textarea className={input} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></label>
      </div>
      <div className="flex gap-2"><button className="px-3 py-1 rounded text-sm font-semibold bg-emerald-600 hover:bg-emerald-500" onClick={create}>Kaydet</button><button className={btn} onClick={onDone}>Vazgeç</button></div>
    </div>
  );
}

export function LibraryPage() {
  const s = useLab();
  void s.libVersion;
  const t = getDict(s.lang);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Category | 'all'>('all');
  const [sim, setSim] = useState<SimFilter>('all');
  const [cmp, setCmp] = useState<string[]>([]);
  const [showCmp, setShowCmp] = useState(false);
  const [creating, setCreating] = useState(false);
  const list = useMemo(() => searchParts(q, cat, sim), [q, cat, sim, s.libVersion]);
  const cats = categoriesInUse();
  const tr = t.category as Record<string, string>;
  return (
    <PageShell title={`Bileşen Kütüphanesi (${COMPONENTS.length} parça)`}>
      <div className="flex gap-2 mb-2 flex-wrap items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ara: ad, model no, üretici, paket, etiket… (örn. irfz44n, TO-220, logic-level)" className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 w-96 text-sm" />
        <select value={sim} onChange={(e) => setSim(e.target.value as SimFilter)} className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm">
          <option value="all">Tüm modeller</option><option value="full">Tam model</option><option value="partial">Kısmi model</option><option value="none">Model yok</option>
        </select>
        <button className={btn} onClick={() => setCreating(!creating)}>+ Kendi bileşenim</button>
        <button className={btn} disabled={cmp.length < 2} onClick={() => setShowCmp(true)}>Karşılaştır ({cmp.length})</button>
      </div>
      <div className="flex gap-1 flex-wrap mb-3">
        {(['all', ...cats] as const).map((c) => <button key={c} onClick={() => setCat(c)} className={`px-2 py-0.5 rounded text-xs ${cat === c ? 'bg-emerald-700' : 'bg-zinc-800 text-zinc-300'}`}>{c === 'all' ? t.all : tr[c] ?? c}</button>)}
      </div>
      <div className="text-xs text-zinc-500 mb-3">{list.length} sonuç. Katalog değerleri elle girilmiş tipik değerlerdir ve datasheet ile henüz doğrulanmamıştır; “Datasheet ara” bağlantıları model numarasıyla arama sayfasına gider. Elektriksel modeli olmayan parçalar simülasyonda açık devre sayılır.</div>
      <OnlineParts />
      <DatasheetImport />
      <SpiceImport />
      {creating && <NewPart onDone={() => { setCreating(false); s.set({ libVersion: s.libVersion + 1 }); }} />}
      {showCmp && cmp.length >= 2 && <Compare ids={cmp} onClose={() => setShowCmp(false)} />}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {list.map((c) => <PartCard key={c.type} c={c} selected={cmp.includes(c.type)} onSelect={() => setCmp(cmp.includes(c.type) ? cmp.filter((x) => x !== c.type) : [...cmp, c.type].slice(-4))} />)}
      </div>
      {!list.length && <div className="text-zinc-500 text-sm">Sonuç yok.</div>}
    </PageShell>
  );
}
