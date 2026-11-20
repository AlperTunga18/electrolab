import { useEffect, useMemo, useRef, useState } from 'react';
import { getRunner, useLab } from '../store/lab';
import { formatSI } from '../core/units';
import { WINDOW_LABELS, estimateThd, findPeaks, nextPow2, scopeSpectrum, type SpectralPeak, type Spectrum, type WindowKind } from '../core/instruments/fft';

const CH_COLORS = ['#facc15', '#22d3ee', '#f472b6', '#4ade80', '#fb923c', '#a78bfa'];
const TIMEBASES = [1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 1e-1, 1];
const VDIVS = ['auto', '0.01', '0.1', '0.5', '1', '2', '5', '10', '50'];

const niceStep = (x: number): number => {
  const e = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
};

interface Meas { vmax: number; vmin: number; vpp: number; vavg: number; vrms: number; freq: number | null }
function measure(t: number[], v: number[]): Meas | null {
  const n = v.length;
  if (n < 2) return null;
  let max = -Infinity, min = Infinity, sum = 0, sq = 0;
  for (let i = 0; i < n; i++) { const x = v[i]; if (x > max) max = x; if (x < min) min = x; sum += x; sq += x * x; }
  const mean = sum / n;
  const crossings: number[] = [];
  for (let i = 1; i < n; i++) if (v[i - 1] < mean && v[i] >= mean) crossings.push(t[i - 1] + ((mean - v[i - 1]) / (v[i] - v[i - 1])) * (t[i] - t[i - 1]));
  const freq = max - min > 1e-6 && crossings.length >= 2 ? (crossings.length - 1) / (crossings[crossings.length - 1] - crossings[0]) : null;
  return { vmax: max, vmin: min, vpp: max - min, vavg: mean, vrms: Math.sqrt(sq / n), freq };
}

type ScopeView = 'time' | 'fft' | 'both';
interface SpecInfo { fs: number; nyquist: number; df: number; n: number; peaks: SpectralPeak[]; thd: number | null; f0: number | null }
const DB_SPAN = 100;

export function Scope() {
  const live = useLab((s) => s.live);
  const status = useLab((s) => s.simStatus);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [tb, setTb] = useState(1e-3);
  const [trig, setTrig] = useState(true);
  const [sel, setSel] = useState<number[]>([]);
  const [vdiv, setVdiv] = useState<Record<number, string>>({});
  const [meas, setMeas] = useState<Record<number, Meas | null>>({});
  const [view, setView] = useState<ScopeView>('time');
  const [logF, setLogF] = useState(false);
  const [win, setWin] = useState<WindowKind>('hann');
  const [specInfo, setSpecInfo] = useState<Record<number, SpecInfo | null>>({});
  const specCache = useRef<{ at: number; key: string; specs: Record<number, Spectrum | null> }>({ at: 0, key: '', specs: {} });
  const names = live?.netNames ?? getRunner()?.netNames ?? [];
  const active = useMemo(() => (sel.length ? sel : names.map((_, i) => i).filter((i) => i > 0).slice(0, 3)), [sel, names]);

  useEffect(() => {
    let raf = 0;
    let lastMeas = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const cv = canvas.current, run = getRunner();
      if (!cv) return;
      const r = cv.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
      const ctx = cv.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = r.width, Hfull = r.height;
      const showTime = view !== 'fft', showFft = view !== 'time';
      const H = view === 'both' ? Hfull / 2 : Hfull; // height of the time-domain region
      ctx.fillStyle = '#06090c'; ctx.fillRect(0, 0, W, Hfull);
      if (showTime) {
        ctx.strokeStyle = '#1b2a22'; ctx.lineWidth = 1;
        for (let i = 0; i <= 10; i++) { ctx.beginPath(); ctx.moveTo((W * i) / 10, 0); ctx.lineTo((W * i) / 10, H); ctx.stroke(); }
        for (let j = 0; j <= 8; j++) { ctx.beginPath(); ctx.moveTo(0, (H * j) / 8); ctx.lineTo(W, (H * j) / 8); ctx.stroke(); }
        ctx.strokeStyle = '#2f4a3b'; ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
      }
      if (!run || run.t.length < 3) {
        ctx.fillStyle = '#6b7280'; ctx.font = '12px sans-serif';
        ctx.fillText('Çalıştır’a basın. Osiloskop gerçek zamanlı geçici (transient) analiz verisini çizer.', 14, 24);
        return;
      }
      const T = run.t, n = T.length;
      const span = tb * 10;
      const tEnd = T[n - 1];
      let tStart = Math.max(T[0], tEnd - span);
      if (trig && active.length) {
        const v0 = run.nets[active[0]];
        const lo = v0.reduce((a, b) => Math.min(a, b), Infinity), hi = v0.reduce((a, b) => Math.max(a, b), -Infinity);
        const level = (lo + hi) / 2;
        for (let i = n - 1; i > 0; i--) {
          if (T[i] < T[n - 1] - span && v0[i - 1] < level && v0[i] >= level) { tStart = T[i]; break; }
        }
        if (tEnd - tStart < span * 0.5) tStart = Math.max(T[0], tEnd - span);
      }
      let i0 = 0;
      while (i0 < n && T[i0] < tStart) i0++;
      const nextMeas: Record<number, Meas | null> = {};
      active.forEach((net, ci) => {
        const v = run.nets[net];
        if (!v) return;
        let vd = Number(vdiv[net]);
        if (!Number.isFinite(vd) || vdiv[net] === 'auto' || vdiv[net] === undefined) {
          let mx = 0;
          for (let i = i0; i < n; i++) mx = Math.max(mx, Math.abs(v[i]));
          vd = niceStep(Math.max(mx, 1e-6) / 3.2);
        }
        if (showTime) {
        ctx.strokeStyle = CH_COLORS[ci % CH_COLORS.length]; ctx.lineWidth = 1.6; ctx.beginPath();
        let started = false;
        const step = Math.max(1, Math.floor((n - i0) / (W * 2)));
        for (let i = i0; i < n; i += step) {
          const x = ((T[i] - tStart) / span) * W;
          if (x > W) break;
          const y = H / 2 - (v[i] / (vd * 8)) * H;
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.fillStyle = CH_COLORS[ci % CH_COLORS.length]; ctx.font = '11px sans-serif';
        ctx.fillText(`${names[net] ?? net}  ${formatSI(vd, 'V')}/div`, 8, 14 + ci * 14);
        }
        nextMeas[net] = measure(T.slice(i0), v.slice(i0));
      });
      if (showTime) { ctx.fillStyle = '#9ca3af'; ctx.font = '11px sans-serif'; ctx.fillText(`${formatSI(tb, 's')}/div`, W - 80, H - 6); }
      // FFT of the visible window (recomputed at most every 250 ms or when settings change)
      if (showFft) {
        const y0 = view === 'both' ? H : 0, Hf = Hfull - y0;
        const key = `${win}|${active.join(',')}|${tb}|${trig}|${view}`;
        const cache = specCache.current;
        if (key !== cache.key || now - cache.at > 250) {
          cache.key = key; cache.at = now; cache.specs = {};
          const Tw = T.slice(i0);
          const info: Record<number, SpecInfo | null> = {};
          active.forEach((net) => {
            const v = run.nets[net];
            const sp = v ? scopeSpectrum(Tw, v.slice(i0), win, { padTo: Math.min(16384, nextPow2(Tw.length) * 2) }) : null;
            cache.specs[net] = sp;
            if (sp) {
              const thd = estimateThd(sp);
              info[net] = { fs: sp.fs, nyquist: sp.nyquist, df: sp.df, n: sp.n, peaks: findPeaks(sp, 5), thd: thd ? thd.thdPercent : null, f0: thd ? thd.fundamental : null };
            } else info[net] = null;
          });
          setSpecInfo(info);
        }
        const specs = active.map((net) => cache.specs[net]).filter((x): x is Spectrum => !!x);
        ctx.save(); ctx.beginPath(); ctx.rect(0, y0, W, Hf); ctx.clip();
        ctx.fillStyle = '#06090c'; ctx.fillRect(0, y0, W, Hf);
        if (!specs.length) {
          ctx.fillStyle = '#6b7280'; ctx.font = '12px sans-serif'; ctx.fillText('FFT için yeterli veri yok (pencerede en az 4 örnek gerekir).', 14, y0 + 24);
        } else {
          const nyq = Math.max(...specs.map((q) => q.nyquist));
          const fLo = Math.max(specs[0].df, 1), fHi = nyq;
          const padL = 38, padB = 14, pw = W - padL, ph = Hf - padB - 4;
          const xOf = (f: number) => padL + (logF ? Math.log(Math.max(f, fLo) / fLo) / Math.log(fHi / fLo) : f / fHi) * pw;
          let top = -Infinity;
          for (const q of specs) for (let k = 1; k < q.dbv.length; k++) if (q.dbv[k] > top) top = q.dbv[k];
          top = Math.ceil((top + 5) / 10) * 10;
          const bot = top - DB_SPAN;
          const yOf = (db: number) => y0 + 4 + ((top - Math.max(db, bot)) / DB_SPAN) * ph;
          ctx.strokeStyle = '#1b2a22'; ctx.lineWidth = 1; ctx.fillStyle = '#6b7280'; ctx.font = '10px sans-serif';
          for (let d = bot; d <= top; d += 20) { const yy = yOf(d); ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W, yy); ctx.stroke(); ctx.fillText(`${d}`, 4, yy + 3); }
          ctx.fillText('dBV', 4, y0 + 12);
          if (logF) {
            for (let dec = Math.pow(10, Math.ceil(Math.log10(fLo))); dec <= fHi; dec *= 10) { const xx = xOf(dec); ctx.beginPath(); ctx.moveTo(xx, y0 + 4); ctx.lineTo(xx, y0 + Hf - padB); ctx.stroke(); ctx.fillText(formatSI(dec, 'Hz'), xx + 2, y0 + Hf - 3); }
          } else {
            for (let i = 0; i <= 10; i++) { const xx = padL + (pw * i) / 10; ctx.beginPath(); ctx.moveTo(xx, y0 + 4); ctx.lineTo(xx, y0 + Hf - padB); ctx.stroke(); if (i % 2 === 0) ctx.fillText(formatSI((fHi * i) / 10, 'Hz'), xx + 2, y0 + Hf - 3); }
          }
          active.forEach((net, ci) => {
            const q = cache.specs[net];
            if (!q) return;
            ctx.strokeStyle = CH_COLORS[ci % CH_COLORS.length]; ctx.lineWidth = 1.3; ctx.beginPath();
            let started = false, lastX = -1;
            for (let k = logF ? 1 : 0; k < q.freq.length; k++) {
              if (logF && q.freq[k] < fLo) continue;
              const xx = xOf(q.freq[k]), yy = yOf(q.dbv[k]);
              if (started && Math.abs(xx - lastX) < 0.5) continue;
              if (!started) { ctx.moveTo(xx, yy); started = true; } else ctx.lineTo(xx, yy);
              lastX = xx;
            }
            ctx.stroke();
            ctx.fillStyle = CH_COLORS[ci % CH_COLORS.length]; ctx.font = '11px sans-serif';
            ctx.fillText(`${names[net] ?? net}  FFT (${WINDOW_LABELS[win]})`, padL + 8, y0 + 14 + ci * 14);
          });
          ctx.fillStyle = '#9ca3af'; ctx.font = '11px sans-serif';
          ctx.fillText(`Nyquist ${formatSI(nyq, 'Hz')}`, W - 110, y0 + 14);
        }
        ctx.restore();
      }
      if (now - lastMeas > 300) { lastMeas = now; setMeas(nextMeas); }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [tb, trig, active, vdiv, names, view, logF, win]);

  return (
    <div className="flex h-full">
      <div className="w-52 shrink-0 border-r border-zinc-800 p-2 overflow-y-auto text-xs space-y-2">
        <label className="block text-zinc-400">Zaman tabanı
          <select value={tb} onChange={(e) => setTb(Number(e.target.value))} className="w-full bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5">
            {TIMEBASES.map((x) => <option key={x} value={x}>{formatSI(x, 's')}/div</option>)}
          </select>
        </label>
        <div className="flex gap-1">
          {([['time', 'Zaman'], ['fft', 'FFT'], ['both', 'İkisi']] as [ScopeView, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setView(k)} className={`flex-1 px-1 py-0.5 rounded border ${view === k ? 'bg-emerald-800 border-emerald-600 text-white' : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800'}`}>{label}</button>
          ))}
        </div>
        {view !== 'time' && (
          <>
            <label className="block text-zinc-400">FFT penceresi
              <select value={win} onChange={(e) => setWin(e.target.value as WindowKind)} className="w-full bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5">
                {(Object.keys(WINDOW_LABELS) as WindowKind[]).map((k) => <option key={k} value={k}>{WINDOW_LABELS[k]}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1 text-zinc-400"><input type="checkbox" checked={logF} onChange={(e) => setLogF(e.target.checked)} />Logaritmik frekans ekseni</label>
          </>
        )}
        <label className="flex items-center gap-1 text-zinc-400"><input type="checkbox" checked={trig} onChange={(e) => setTrig(e.target.checked)} />Tetik (yükselen kenar, KN1)</label>
        <div className="text-zinc-500 uppercase tracking-wide pt-1">Kanallar (düğümler)</div>
        {names.map((nm, i) => i === 0 ? null : (
          <div key={nm} className="flex items-center gap-1">
            <input type="checkbox" checked={active.includes(i)} onChange={(e) => setSel(e.target.checked ? [...active, i] : active.filter((x) => x !== i))} />
            <span className="w-8" style={{ color: CH_COLORS[Math.max(active.indexOf(i), 0) % CH_COLORS.length] }}>{nm}</span>
            <select value={vdiv[i] ?? 'auto'} onChange={(e) => setVdiv({ ...vdiv, [i]: e.target.value })} className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5">
              {VDIVS.map((v) => <option key={v} value={v}>{v === 'auto' ? 'oto' : `${v} V/div`}</option>)}
            </select>
          </div>
        ))}
        {status !== 'running' && !live && <div className="text-zinc-500">Düğüm listesi çalıştırınca oluşur.</div>}
      </div>
      <div className="flex-1 min-w-0 relative"><canvas ref={canvas} className="w-full h-full block" /></div>
      <div className="w-60 shrink-0 border-l border-zinc-800 p-2 overflow-y-auto text-[11px]">
        {view !== 'time' && (
          <div className="mb-3">
            <div className="text-zinc-500 uppercase tracking-wide mb-1">FFT tepeleri</div>
            {active.map((net, ci) => {
              const si = specInfo[net];
              return (
                <div key={net} className="mb-2">
                  <div style={{ color: CH_COLORS[ci % CH_COLORS.length] }} className="font-semibold">{names[net]}</div>
                  {si ? (
                    <>
                      <div className="text-zinc-500">Örnekleme {formatSI(si.fs, 'Hz')} · Nyquist sınırı {formatSI(si.nyquist, 'Hz')} · bin aralığı {formatSI(si.df, 'Hz')}</div>
                      <table className="w-full text-zinc-300"><thead><tr className="text-zinc-500 text-left"><th>f</th><th>V (tepe)</th><th>dBV</th></tr></thead><tbody>
                        {si.peaks.map((p) => <tr key={p.bin}><td>{formatSI(p.freq, 'Hz', 4)}</td><td>{formatSI(p.amp, 'V', 3)}</td><td>{p.dbv.toFixed(1)}</td></tr>)}
                      </tbody></table>
                      <div className="text-zinc-300">{si.thd !== null && si.f0 ? `THD (2–10. harmonik, f₀ ${formatSI(si.f0, 'Hz', 4)}): ${si.thd.toFixed(2)} %` : 'THD: temel bileşen bulunamadı'}</div>
                    </>
                  ) : <div className="text-zinc-600">veri yok</div>}
                </div>
              );
            })}
            <div className="text-zinc-600">Spektrum, görünen pencerenin eşit aralıklı örneklemeye (doğrusal ara değerleme) çevrilmesiyle hesaplanır; genlik pencere düzeltmeli (V tepe).</div>
          </div>
        )}
        <div className="text-zinc-500 uppercase tracking-wide mb-1">Ölçümler (görünen pencere)</div>
        {active.map((net, ci) => {
          const m = meas[net];
          return (
            <div key={net} className="mb-2">
              <div style={{ color: CH_COLORS[ci % CH_COLORS.length] }} className="font-semibold">{names[net]}</div>
              {m ? (
                <div className="grid grid-cols-2 gap-x-2 text-zinc-300">
                  <span>Vpp {formatSI(m.vpp, 'V')}</span><span>Vort {formatSI(m.vavg, 'V')}</span>
                  <span>Vmax {formatSI(m.vmax, 'V')}</span><span>Vmin {formatSI(m.vmin, 'V')}</span>
                  <span>Vrms {formatSI(m.vrms, 'V')}</span><span>f {m.freq ? formatSI(m.freq, 'Hz') : '—'}</span>
                </div>
              ) : <div className="text-zinc-600">veri yok</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Measurements() {
  const live = useLab((s) => s.live);
  const circuit = useLab((s) => s.circuit);
  const peak = useLab((s) => s.peakStress);
  const members = useMemo(() => {
    const m = new Map<number, string[]>();
    if (!live) return m;
    for (const [pin, net] of live.pinNet) {
      const [cid, p] = pin.split(':');
      const ref = circuit.components.find((c) => c.id === cid)?.ref ?? cid;
      m.set(net, [...(m.get(net) ?? []), `${ref}.${p}`]);
    }
    return m;
  }, [live, circuit]);
  if (!live) return <div className="p-3 text-sm text-zinc-500">Önce “DC çöz” veya “Çalıştır”. Ölçümler gerçek çözücü sonuçlarıdır.</div>;
  const peaks = Object.values(peak);
  return (
    <div className="h-full overflow-auto p-3 grid grid-cols-1 xl:grid-cols-2 gap-4 text-xs">
      <div>
        <div className="text-zinc-500 uppercase tracking-wide mb-1">Düğüm gerilimleri (toprağa göre)</div>
        <table className="w-full"><tbody>
          {live.netNames.map((n, i) => (
            <tr key={n} className="border-b border-zinc-800"><td className="py-0.5 w-12 font-semibold">{n}</td><td className="w-24 text-cyan-300">{formatSI(live.netV[i], 'V', 4)}</td><td className="text-zinc-500">{(members.get(i) ?? []).join(', ')}</td></tr>
          ))}
        </tbody></table>
      </div>
      <div>
        <div className="text-zinc-500 uppercase tracking-wide mb-1">Bileşenler</div>
        <table className="w-full"><thead><tr className="text-zinc-500 text-left"><th>Ref</th><th>V</th><th>I</th><th>P</th></tr></thead><tbody>
          {circuit.components.filter((c) => live.comps[c.id] && c.type !== 'ground').map((c) => {
            const r = live.comps[c.id];
            const bad = live.stress.some((x) => x.comp === c.id);
            return <tr key={c.id} className={`border-b border-zinc-800 ${bad ? 'text-red-300' : ''}`}><td className="py-0.5 font-semibold">{c.ref}</td><td>{formatSI(r.v, 'V')}</td><td>{formatSI(r.i, 'A')}</td><td>{formatSI(r.p, 'W')}</td></tr>;
          })}
        </tbody></table>
        {peaks.length > 0 && (
          <div className="mt-3">
            <div className="text-red-400 uppercase tracking-wide mb-1">Sınır aşımı geçmişi (tepe)</div>
            {peaks.map((p) => <div key={p.key} className="text-red-300">{p.ref}: {p.label} tepe {p.value.toPrecision(3)} {p.unit} (limit {p.limit}, {p.ratio.toFixed(1)}×), ilk t={formatSI(p.t, 's')}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}

export function LogView() {
  const log = useLab((s) => s.log);
  const set = useLab((s) => s.set);
  return (
    <div className="h-full overflow-y-auto p-2 font-mono text-xs">
      <button className="mb-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700" onClick={() => set({ log: [] })}>Temizle</button>
      {log.map((l) => <div key={l.id} className={l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-300' : 'text-zinc-300'}><span className="text-zinc-600">{l.time}</span> {l.text}</div>)}
      {!log.length && <div className="text-zinc-600">Kayıt yok.</div>}
    </div>
  );
}
