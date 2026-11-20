import { useState } from 'react';
import { useLab } from '../store/lab';
import { saveUserPart } from '../library/components';
import { parseSpice, type SpiceModel, type SpiceParse } from '../core/spice/parse';
import { buildUserPart } from '../core/spice/toPart';

const card = 'rounded-lg border border-zinc-800 bg-zinc-900';
const btn = 'px-2.5 py-1 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700';

export function SpiceImport() {
  const s = useLab();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [res, setRes] = useState<SpiceParse | null>(null);
  const [wl, setWl] = useState('1');
  const [msg, setMsg] = useState('');

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 1_000_000) { setMsg('Dosya çok büyük (>1 MB).'); return; }
    const t = await f.text();
    setText(t); setRes(parseSpice(t)); setMsg('');
  };
  const add = (m: SpiceModel) => {
    const w = Number(wl);
    saveUserPart(buildUserPart(m, { wOverL: Number.isFinite(w) && w > 0 ? w : 1 }));
    s.set({ libVersion: s.libVersion + 1 });
    setMsg(`“${m.name}” kullanıcı parçası olarak eklendi (doğrulanmadı, kaynak: SPICE içe aktarma).`);
  };

  return (
    <div className={`${card} p-3 mb-4`}>
      <button className="text-sm font-semibold w-full text-left" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} SPICE modeli içe aktar (.model / .lib)</button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-zinc-400">Yerel işlem, ağ yok. Desteklenen: .MODEL D / NPN / PNP / NMOS / PMOS (sayısal değerler). Yalnızca simülatörün kullandığı parametreler eşlenir (diyot Is, N; BJT Is, Bf; MOSFET seviye-1 Vto, Kp, Lambda); diğerleri “yok sayılan” olarak listelenir. .SUBCKT simüle edilmez.</p>
          <textarea className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs font-mono h-32" value={text} onChange={(e) => setText(e.target.value)} placeholder=".MODEL D1N4148 D (IS=2.5n N=1.75 RS=0.6)" />
          <div className="flex gap-2 items-center flex-wrap">
            <button className="px-3 py-1 rounded text-sm font-semibold bg-emerald-600 hover:bg-emerald-500" onClick={() => { setRes(parseSpice(text)); setMsg(''); }}>Çözümle</button>
            <label className={`${btn} cursor-pointer`}>Dosya seç<input type="file" accept=".lib,.mod,.model,.txt,.cir,.sub" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
            <label className="text-xs text-zinc-400">MOSFET W/L <input className="w-16 bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-xs" value={wl} onChange={(e) => setWl(e.target.value)} /></label>
          </div>
          {msg && <div className="text-xs text-amber-300">{msg}</div>}
          {res && (
            <div className="space-y-2">
              {res.warnings.map((w) => <div key={w} className="text-[11px] text-amber-300">• {w}</div>)}
              {res.models.map((m, i) => (
                <div key={`${m.name}-${i}`} className="border border-zinc-800 rounded p-2 text-xs space-y-1">
                  <div className="flex gap-2 items-center flex-wrap"><b>{m.name}</b><span className="text-zinc-400">{m.kind}</span>
                    <button className={btn} onClick={() => add(m)}>Kütüphaneye ekle</button></div>
                  <div>Eşlenen: {Object.keys(m.mapped).length ? Object.entries(m.mapped).map(([k, v]) => `${k}=${v}`).join(', ') : <span className="text-red-300">hiçbiri (EKSİK)</span>}</div>
                  {m.ignored.length > 0 && <div className="text-zinc-400">Yok sayılan: {m.ignored.map((x) => `${x.name} (${x.reason})`).join('; ')}</div>}
                  {m.warnings.map((w) => <div key={w} className="text-[11px] text-amber-300">• {w}</div>)}
                </div>
              ))}
              {res.subckts.map((c) => <div key={c.name} className="text-xs text-red-300">{c.message}</div>)}
              {res.unsupported.map((u) => <div key={u} className="text-xs text-red-300">{u}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
