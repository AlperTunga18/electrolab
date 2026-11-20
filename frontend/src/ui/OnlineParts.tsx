import { useEffect, useState } from 'react';
import { clearKeys, hasKeys, loadKeys, providerList, safeUrl, saveKeys, searchOnline, type Keys, type OnlinePart, type OnlineSearch, type ProviderId, type ProviderInfo } from '../core/online/parts';

const card = 'rounded-lg border border-zinc-800 bg-zinc-900';
const btn = 'px-2.5 py-1 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700';
const input = 'w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm';

const FALLBACK: ProviderInfo[] = [
  { id: 'nexar', name: 'Octopart / Nexar', status: 'available', note: 'Kendi Nexar client id + secret anahtarınız gerekli.' },
  { id: 'mouser', name: 'Mouser', status: 'available', note: 'Kendi Mouser Search API anahtarınız gerekli.' },
  { id: 'snapeda', name: 'SnapEDA / SnapMagic', status: 'planned', note: 'Planlı (API onay gerektiriyor).' },
  { id: 'lcsc', name: 'LCSC', status: 'unsupported', note: 'resmi API yok, desteklenmiyor.' },
];

const fmtPrice = (n: number, cur: string) => `${n} ${cur}`;

function PartRow({ p }: { p: OnlinePart }) {
  const names: Record<string, string> = { nexar: 'Octopart/Nexar', mouser: 'Mouser' };
  return (
    <div className="border-t border-zinc-800 py-2 text-xs">
      <div className="flex flex-wrap gap-2 items-baseline">
        <b className="text-sm">{p.mpn}</b><span className="text-zinc-400">{p.manufacturer}</span>
        <span className="px-1.5 py-0.5 rounded text-[10px] bg-sky-900 text-sky-300">{names[p.provider] ?? p.provider}</span>
        <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-900 text-amber-300" title={p.fetched_at}>canlı veri, doğrulayın</span>
      </div>
      <div className="text-zinc-400">{p.description}</div>
      <div className="flex gap-2 flex-wrap my-1">
        {p.datasheet_urls.map((u) => { const s = safeUrl(u); return s ? <a key={u} className={btn} href={s} target="_blank" rel="noopener noreferrer">Datasheet ↗</a> : null; })}
        {!p.datasheet_urls.length && <span className="text-zinc-500">Datasheet bağlantısı yok</span>}
      </div>
      {p.offers.length ? (
        <div className="overflow-x-auto"><table className="w-full">
          <thead><tr className="text-left text-zinc-500"><th className="pr-3">Distribütör</th><th className="pr-3">SKU</th><th className="pr-3">Stok</th><th>Fiyat kademeleri</th></tr></thead>
          <tbody>{p.offers.map((o, i) => (
            <tr key={i} className="align-top border-t border-zinc-800/60">
              <td className="pr-3 whitespace-nowrap">{safeUrl(o.url) ? <a className="text-sky-400 underline" href={safeUrl(o.url)!} target="_blank" rel="noopener noreferrer">{o.distributor}</a> : o.distributor}</td>
              <td className="pr-3 font-mono">{o.sku ?? '—'}</td>
              <td className="pr-3">{o.stock ?? '—'}</td>
              <td className="text-zinc-300">{o.price_breaks.length ? o.price_breaks.map((b) => `${b.qty}+: ${fmtPrice(b.price, b.currency)}`).join(' · ') : '—'}</td>
            </tr>))}</tbody>
        </table></div>
      ) : <div className="text-zinc-500">Teklif verisi yok</div>}
    </div>
  );
}

export function OnlineParts() {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<ProviderId>('mouser');
  const [keys, setKeys] = useState<Keys>(loadKeys);
  const [remember, setRemember] = useState(() => { try { return localStorage.getItem('electrolab.onlineKeys') !== null; } catch { return false; } });
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<OnlineSearch | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>(FALLBACK);

  useEffect(() => { if (open) void providerList().then((l) => { if (l) setProviders(l); }); }, [open]);

  const upd = (patch: Partial<Keys>) => { const k = { ...keys, ...patch }; setKeys(k); if (remember) saveKeys(k); };
  const toggleRemember = (on: boolean) => { setRemember(on); if (on) saveKeys(keys); else clearKeys(); };
  const missing = !hasKeys(provider, keys);

  const run = async () => {
    if (!q.trim() || missing) return;
    setBusy(true); setErr(''); setRes(null);
    try { setRes(await searchOnline(provider, q, keys)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <div className={`${card} p-3 mb-4`}>
      <button className="text-sm font-semibold w-full text-left" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} İnternetten parça ara</button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-zinc-400">Yalnızca resmî API’ler, kendi anahtarlarınızla. Sunucuya yalnızca arama metni ve seçilen sağlayıcı gönderilir; devreniz hiçbir zaman gönderilmez. Anahtarlar sunucuda saklanmaz, her istekte başlıkla iletilir. Sonuçlar canlı veridir: sipariş öncesi distribütör sayfasında doğrulayın.</p>
          <div className="flex gap-2 flex-wrap">
            {providers.map((p) => (
              <label key={p.id} className={`text-xs px-2 py-1 rounded border ${p.status === 'available' ? (provider === p.id ? 'border-emerald-500 bg-emerald-950' : 'border-zinc-700') : 'border-zinc-800 opacity-60'}`} title={p.note}>
                <input type="radio" name="prov" className="mr-1" disabled={p.status !== 'available'} checked={provider === p.id} onChange={() => setProvider(p.id as ProviderId)} />
                {p.name}{p.status === 'planned' ? ' (planlı)' : p.status === 'unsupported' ? ' (resmi API yok, desteklenmiyor)' : ''}
              </label>
            ))}
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            {provider === 'nexar' ? (
              <>
                <label className="text-xs text-zinc-400">Nexar client id<input type="password" autoComplete="off" className={input} value={keys.nexarId} onChange={(e) => upd({ nexarId: e.target.value })} /></label>
                <label className="text-xs text-zinc-400">Nexar client secret<input type="password" autoComplete="off" className={input} value={keys.nexarSecret} onChange={(e) => upd({ nexarSecret: e.target.value })} /></label>
              </>
            ) : (
              <label className="text-xs text-zinc-400 md:col-span-2">Mouser Search API anahtarı<input type="password" autoComplete="off" className={input} value={keys.mouserKey} onChange={(e) => upd({ mouserKey: e.target.value })} /></label>
            )}
          </div>
          <label className="text-xs text-zinc-400 flex items-start gap-1"><input type="checkbox" checked={remember} onChange={(e) => toggleRemember(e.target.checked)} />
            <span>Anahtarı bu tarayıcıda (localStorage) hatırla. <b className="text-amber-300">Uyarı:</b> düz metin saklanır; ortak bilgisayarlarda işaretlemeyin.</span></label>
          {missing && <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-900 text-red-300">API anahtarı gerekli — EKSİK</span>}
          <div className="flex gap-2">
            <input className={input} placeholder="Model no veya anahtar kelime (örn. LM339, 1N4148)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void run(); }} />
            <button className="px-3 py-1 rounded text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 shrink-0" disabled={busy || missing || !q.trim()} onClick={() => void run()}>{busy ? 'Aranıyor…' : 'Ara'}</button>
          </div>
          <div className="text-[11px] text-zinc-500">Gönderilen veri: arama metni “{q.trim() || '…'}” + sağlayıcı “{provider}”. Başka hiçbir şey gönderilmez.</div>
          {err && <div className="text-xs text-red-300">{err}</div>}
          {res && (
            <div>
              {res.notes.map((n) => <div key={n} className="text-[11px] text-amber-300">• {n}</div>)}
              <div className="text-[11px] text-zinc-500 mb-1">{res.results.length} sonuç · kaynak: {res.provider}</div>
              {res.results.map((p, i) => <PartRow key={`${p.mpn}-${i}`} p={p} />)}
              {!res.results.length && <div className="text-xs text-zinc-500">Sonuç yok.</div>}
              <div className="text-[11px] text-zinc-400 mt-2">Datasheet’i otomatik indirmiyoruz: PDF’i kendiniz indirip yukarıdaki “Datasheet içe aktar” bölümüne yükleyin (metin yerelde çıkarılır, ağ kullanılmaz).</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
