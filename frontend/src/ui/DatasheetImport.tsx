import { useState } from 'react';
import { useLab } from '../store/lab';
import { saveUserPart } from '../library/components';
import { extractDatasheet, toLibraryPart, type Extraction } from '../core/datasheet/extract';
import { formatSI } from '../core/units';

const card = 'rounded-lg border border-zinc-800 bg-zinc-900';
const btn = 'px-2.5 py-1 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700';

const show = (v: number | string, unit: string): string => (typeof v === 'number' ? (unit ? formatSI(v, unit) : String(v)) : v);

export function DatasheetImport() {
  const s = useLab();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [res, setRes] = useState<Extraction | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const run = (t: string) => { setRes(extractDatasheet(t)); setMsg(''); };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setMsg('');
    try {
      const { pdfToText } = await import('../core/datasheet/pdf');
      const t = await pdfToText(await f.arrayBuffer());
      setText(t); run(t);
      if (!t.trim()) setMsg('PDF’den metin çıkmadı (taranmış görüntü olabilir). Metni elle yapıştırın.');
    } catch (e) {
      setMsg(`PDF okunamadı: ${e instanceof Error ? e.message : String(e)}. Metni datasheet’ten kopyalayıp yapıştırın.`);
    } finally { setBusy(false); }
  };

  const part = res ? toLibraryPart(res.fields) : null;
  const addToLib = () => {
    if (!part?.ok) return;
    saveUserPart(part.def);
    s.set({ libVersion: s.libVersion + 1 });
    setMsg(`“${part.def.name}” kullanıcı parçası olarak eklendi (doğrulanmadı olarak işaretli).`);
  };
  const copyJson = async () => {
    if (!res) return;
    try { await navigator.clipboard.writeText(JSON.stringify(res, null, 2)); setMsg('JSON panoya kopyalandı.'); } catch { setMsg('Panoya kopyalanamadı.'); }
  };

  return (
    <div className={`${card} p-3 mb-4`}>
      <button className="text-sm font-semibold w-full text-left" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} Datasheet içe aktar</button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-zinc-400">Datasheet metnini yapıştırın veya yerel bir PDF seçin (dosya tarayıcıdan çıkmaz, ağ kullanılmaz). Yalnızca metinde bulunan değerler çıkarılır; her değerin kaynağı olan satır gösterilir. Bulunamayanlar EKSİK işaretlenir, tahmin edilmez.</p>
          <textarea className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs font-mono h-40" value={text} onChange={(e) => setText(e.target.value)} placeholder="Datasheet metnini buraya yapıştırın…" />
          <div className="flex gap-2 flex-wrap items-center">
            <button className="px-3 py-1 rounded text-sm font-semibold bg-emerald-600 hover:bg-emerald-500" onClick={() => run(text)}>Çıkar</button>
            <label className={`${btn} cursor-pointer`}>{busy ? 'PDF okunuyor…' : 'PDF seç'}<input type="file" accept="application/pdf,.pdf" className="hidden" disabled={busy} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
            {res && <button className={btn} onClick={() => void copyJson()}>JSON kopyala</button>}
          </div>
          {msg && <div className="text-xs text-amber-300">{msg}</div>}
          {res && (
            <>
              <div className="text-xs text-zinc-400">Tahmin edilen tür: <b className="text-zinc-200">{res.kind === 'unknown' ? 'belirsiz' : res.kind}</b></div>
              <div className="overflow-x-auto"><table className="w-full text-xs">
                <thead><tr className="text-left text-zinc-400"><th className="pr-3 py-1">Alan</th><th className="pr-3">Değer</th><th className="pr-3">Güven</th><th>Kaynak satır (alıntı)</th></tr></thead>
                <tbody>
                  {res.fields.map((f) => (
                    <tr key={f.key} className="border-t border-zinc-800 align-top">
                      <td className="py-1 pr-3 text-zinc-400 whitespace-nowrap">{f.label}</td>
                      <td className="pr-3 text-zinc-100 whitespace-nowrap">{show(f.value, f.unit)}</td>
                      <td className="pr-3"><span className={`px-1.5 py-0.5 rounded text-[10px] ${f.confidence === 'high' ? 'bg-emerald-900 text-emerald-300' : 'bg-amber-900 text-amber-300'}`}>{f.confidence === 'high' ? 'yüksek' : 'düşük'}</span></td>
                      <td className="font-mono text-zinc-300 break-all">{f.quote}</td>
                    </tr>
                  ))}
                  {res.missing.map((m) => (
                    <tr key={m} className="border-t border-zinc-800"><td className="py-1 pr-3 text-zinc-400 whitespace-nowrap">{m}</td><td colSpan={3}><span className="px-1.5 py-0.5 rounded text-[10px] bg-red-900 text-red-300">EKSİK</span></td></tr>
                  ))}
                </tbody>
              </table></div>
              {res.notes.map((n) => <div key={n} className="text-[11px] text-zinc-500">• {n}</div>)}
              <div className="flex gap-2 items-center flex-wrap">
                {part?.ok
                  ? <button className="px-3 py-1 rounded text-sm font-semibold bg-sky-700 hover:bg-sky-600" onClick={addToLib}>Kütüphaneye ekle (kullanıcı parçası)</button>
                  : <span className="text-[11px] text-zinc-500">Kütüphaneye eklemek için eksik: {part && !part.ok ? part.missing.join(', ') : '—'}</span>}
                {part?.ok && part.warnings.map((w) => <span key={w} className="text-[11px] text-zinc-500">{w}</span>)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
