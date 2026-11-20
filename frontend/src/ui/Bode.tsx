import { useEffect, useMemo, useRef, useState } from 'react';
import { useLab } from '../store/lab';
import { getDef } from '../library/components';
import { acSweep, analyzeResponse, type AcResult } from '../core/sim/ac';
import { formatSI } from '../core/units';
import { download } from '../store/persist';

const btn = 'px-2 py-1 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40';
const inp = 'bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-xs w-20';

/** Frequency response (Bode) from the small-signal AC analysis. */
export function Bode() {
  const s = useLab();
  const sources = s.circuit.components.filter((c) => getDef(c.type).model === 'vsource');
  const [src, setSrc] = useState('');
  const [f0, setF0] = useState('10');
  const [f1, setF1] = useState('1e6');
  const [ppd, setPpd] = useState('40');
  const [res, setRes] = useState<AcResult | null>(null);
  const [err, setErr] = useState('');
  const [hover, setHover] = useState<number | null>(null);
  const cvMag = useRef<HTMLCanvasElement>(null);
  const cvPh = useRef<HTMLCanvasElement>(null);
  const probe = s.probes.red;
  const source = src || sources[0]?.id || '';
  const info = useMemo(() => (res ? analyzeResponse(res.f, res.mag[0]) : null), [res]);

  const run = () => {
    setErr('');
    if (!probe || !source) { setErr('Kırmızı probu çıkış düğümüne atayın ve bir gerilim kaynağı seçin.'); return; }
    try {
      const c = { ...s.circuit, faults: { ...(s.circuit.faults ?? {}), ...s.hiddenFaults } };
      setRes(acSweep(c, { source, probes: [probe], fStart: Number(f0), fStop: Number(f1), ppd: Number(ppd) }));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setRes(null); }
  };

  useEffect(() => {
    for (const [cv, kind] of [[cvMag.current, 'mag'], [cvPh.current, 'ph']] as const) {
      if (!cv) continue;
      const r = cv.getBoundingClientRect();
      cv.width = r.width; cv.height = r.height;
      const ctx = cv.getContext('2d')!;
      ctx.fillStyle = '#06090c'; ctx.fillRect(0, 0, r.width, r.height);
      if (!res) continue;
      const W = r.width, H = r.height, pad = 34;
      const xs = res.f.map((f) => pad + ((Math.log10(f) - Math.log10(res.f[0])) / (Math.log10(res.f[res.f.length - 1]) - Math.log10(res.f[0]))) * (W - pad - 6));
      const y = kind === 'mag' ? res.mag[0].map((m) => 20 * Math.log10(Math.max(m, 1e-12))) : res.phase[0];
      let lo = Math.min(...y), hi = Math.max(...y);
      if (kind === 'ph') { lo = Math.min(lo, -180); hi = Math.max(hi, 180); } else { lo = Math.max(lo, hi - 120); const span = Math.max(hi - lo, 6); lo = hi - span; hi += 3; lo -= 3; }
      const Y = (v: number) => H - 14 - ((v - lo) / (hi - lo)) * (H - 24);
      ctx.strokeStyle = '#1b2a22'; ctx.lineWidth = 1; ctx.fillStyle = '#6b7280'; ctx.font = '10px sans-serif';
      for (let d = Math.ceil(Math.log10(res.f[0])); d <= Math.floor(Math.log10(res.f[res.f.length - 1])); d++) {
        const x = pad + ((d - Math.log10(res.f[0])) / (Math.log10(res.f[res.f.length - 1]) - Math.log10(res.f[0]))) * (W - pad - 6);
        ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, H - 14); ctx.stroke(); ctx.fillText(formatSI(10 ** d, 'Hz', 1), x - 14, H - 3);
      }
      const step = kind === 'mag' ? Math.max(Math.round((hi - lo) / 6 / 5) * 5, 5) : 90;
      for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) { ctx.beginPath(); ctx.moveTo(pad, Y(v)); ctx.lineTo(W - 6, Y(v)); ctx.stroke(); ctx.fillText(`${v}`, 2, Y(v) + 3); }
      ctx.strokeStyle = kind === 'mag' ? '#facc15' : '#22d3ee'; ctx.lineWidth = 1.8; ctx.beginPath();
      xs.forEach((x, i) => (i ? ctx.lineTo(x, Y(y[i])) : ctx.moveTo(x, Y(y[i]))));
      ctx.stroke();
      if (kind === 'mag' && info?.f3db) {
        const x = pad + ((Math.log10(info.f3db) - Math.log10(res.f[0])) / (Math.log10(res.f[res.f.length - 1]) - Math.log10(res.f[0]))) * (W - pad - 6);
        ctx.strokeStyle = '#f87171'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, H - 14); ctx.stroke(); ctx.setLineDash([]);
      }
      if (hover !== null) { ctx.strokeStyle = '#ffffff55'; ctx.beginPath(); ctx.moveTo(xs[hover], 4); ctx.lineTo(xs[hover], H - 14); ctx.stroke(); }
      ctx.fillStyle = '#9ca3af'; ctx.fillText(kind === 'mag' ? 'Kazanç (dB)' : 'Faz (°)', W - 70, 12);
    }
  }, [res, info, hover]);

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!res) return;
    const r = e.currentTarget.getBoundingClientRect(), pad = 34;
    const u = (e.clientX - r.left - pad) / (r.width - pad - 6);
    setHover(Math.min(Math.max(Math.round(u * (res.f.length - 1)), 0), res.f.length - 1));
  };
  const csv = () => res && download('frekans-yaniti.csv', ['f_Hz,gain,gain_dB,phase_deg', ...res.f.map((f, i) => `${f},${res.mag[0][i]},${20 * Math.log10(Math.max(res.mag[0][i], 1e-12))},${res.phase[0][i]}`)].join('\r\n'), 'text/csv');
  const log = () => info && res && s.logMeas('Frekans yanıtı', `${info.kind}: tepe ${formatSI(info.peakF, 'Hz', 3)} (${(20 * Math.log10(info.peakGain)).toFixed(1)} dB)${info.f3db ? `, -3 dB ${formatSI(info.f3db, 'Hz', 3)}` : ''}${info.q ? `, Q ${info.q.toFixed(1)}` : ''}`);

  return (
    <div className="space-y-2 h-full flex flex-col">
      <div className="flex gap-2 flex-wrap items-center text-xs">
        <label className="text-zinc-400">Kaynak (1 V) <select className={`${inp} w-24`} value={source} onChange={(e) => setSrc(e.target.value)}>{sources.map((c) => <option key={c.id} value={c.id}>{c.ref}</option>)}</select></label>
        <label className="text-zinc-400">f başlangıç <input className={inp} value={f0} onChange={(e) => setF0(e.target.value)} /></label>
        <label className="text-zinc-400">f bitiş <input className={inp} value={f1} onChange={(e) => setF1(e.target.value)} /></label>
        <label className="text-zinc-400">nokta/dekad <input className={`${inp} w-14`} value={ppd} onChange={(e) => setPpd(e.target.value)} /></label>
        <button className={`${btn} !bg-emerald-800`} onClick={run}>▶ Frekans taraması</button>
        <button className={btn} disabled={!res} onClick={csv}>CSV</button>
        <button className={btn} disabled={!info} onClick={log}>Kaydet</button>
      </div>
      <div className="text-[11px] text-zinc-500">Çıkış = kırmızı probun düğümü (toprağa göre). Doğrusallaştırılmış (küçük sinyal) AC analizi, DC çalışma noktası etrafında; diyot/transistör/MOSFET jonksiyon kapasiteleri modelde yok.</div>
      {err && <div className="text-xs text-red-400">{err}</div>}
      {info && res && (
        <div className="text-xs text-zinc-300 flex gap-4 flex-wrap">
          <span>Tür: <b>{({ lowpass: 'alçak geçiren', highpass: 'yüksek geçiren', bandpass: 'band geçiren', flat: 'düz' })[info.kind]}</b></span>
          <span>Tepe: <b>{formatSI(info.peakF, 'Hz', 3)}</b> ({(20 * Math.log10(info.peakGain)).toFixed(2)} dB)</span>
          {info.f3db && <span>−3 dB: <b>{formatSI(info.f3db, 'Hz', 3)}</b></span>}
          {info.fLo && info.fHi && <span>Bant: {formatSI(info.fLo, 'Hz', 3)} – {formatSI(info.fHi, 'Hz', 3)}</span>}
          {info.q && <span>Q: <b>{info.q.toFixed(2)}</b></span>}
          {hover !== null && <span className="text-cyan-300">imleç: {formatSI(res.f[hover], 'Hz', 3)} · {(20 * Math.log10(Math.max(res.mag[0][hover], 1e-12))).toFixed(2)} dB · {res.phase[0][hover].toFixed(1)}°</span>}
        </div>
      )}
      <div className="flex-1 min-h-0 grid grid-cols-2 gap-2">
        <canvas ref={cvMag} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="w-full h-full min-h-32 border border-zinc-800 rounded" />
        <canvas ref={cvPh} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="w-full h-full min-h-32 border border-zinc-800 rounded" />
      </div>
    </div>
  );
}
