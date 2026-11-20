import { useMemo, useState } from 'react';
import { useLab } from '../store/lab';
import { getDef } from '../library/components';
import { monteCarlo, type McDist, type McResult } from '../core/sim/montecarlo';
import { noiseAnalysis, type NoiseResult } from '../core/sim/noise';
import { formatSI } from '../core/units';

const btn = 'px-2 py-1 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40';
const inp = 'bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-xs w-20';

function Histogram({ samples, nominal, bins = 30 }: { samples: number[]; nominal: number; bins?: number }) {
  const h = useMemo(() => {
    const lo = Math.min(...samples), hi = Math.max(...samples);
    const w = (hi - lo) / bins || 1;
    const counts = new Array<number>(bins).fill(0);
    for (const v of samples) counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++;
    return { lo, hi, counts, max: Math.max(...counts) };
  }, [samples, bins]);
  const W = 480, H = 140, bw = W / bins;
  const nx = h.hi > h.lo ? ((nominal - h.lo) / (h.hi - h.lo)) * W : W / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H + 16}`} className="w-full max-w-xl bg-zinc-950 border border-zinc-800 rounded">
      {h.counts.map((c, i) => <rect key={i} x={i * bw + 1} y={H - (c / h.max) * H} width={bw - 2} height={(c / h.max) * H} className="fill-sky-500/70" />)}
      <line x1={nx} x2={nx} y1={0} y2={H} className="stroke-amber-400" strokeDasharray="3 3" />
      <text x={2} y={H + 12} className="fill-zinc-400" fontSize="10">{formatSI(h.lo, 'V')}</text>
      <text x={W - 2} y={H + 12} textAnchor="end" className="fill-zinc-400" fontSize="10">{formatSI(h.hi, 'V')}</text>
      <text x={W / 2} y={H + 12} textAnchor="middle" className="fill-amber-400" fontSize="10">nominal</text>
    </svg>
  );
}

/** Monte Carlo tolerans analizi + termal/saçma gürültü tahmini (çıkış düğümü seçilen pin). */
export function AnalysisTab() {
  const circuit = useLab((x) => x.circuit);
  const pins = useMemo(() => circuit.components.flatMap((c) => getDef(c.type).pins.map((p) => ({ key: `${c.id}:${p.id}`, label: `${c.ref}.${p.label}` }))), [circuit.components]);
  const [sel, setSel] = useState('');
  const [runs, setRuns] = useState('1000');
  const [seed, setSeed] = useState('1');
  const [dist, setDist] = useState<McDist>('gaussian');
  const [bw, setBw] = useState('20000');
  const [mc, setMc] = useState<McResult | null>(null);
  const [nz, setNz] = useState<NoiseResult | null>(null);
  const [err, setErr] = useState('');
  const key = sel || pins[0]?.key || '';
  const probe = () => { const [comp, pin] = key.split(':'); return { comp, pin }; };

  const runMc = () => {
    setErr('');
    try { setMc(monteCarlo(circuit, { runs: Math.max(1, Math.min(20000, +runs || 1000)), seed: +seed || 1, probe: probe(), dist })); }
    catch (e) { setMc(null); setErr((e as Error).message); }
  };
  const runNz = () => {
    setErr('');
    try { setNz(noiseAnalysis(circuit, { probe: probe(), bandwidth: +bw || 20000 })); }
    catch (e) { setNz(null); setErr((e as Error).message); }
  };

  if (!pins.length) return <div className="p-3 text-xs text-zinc-500">Devre boş: analiz için bileşen ekleyin.</div>;
  return (
    <div className="h-full overflow-auto p-3 text-xs text-zinc-300 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label>Çıkış pini
          <select value={key} onChange={(e) => setSel(e.target.value)} className="ml-1 bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-xs">
            {pins.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        <label>Koşu <input className={inp} value={runs} onChange={(e) => setRuns(e.target.value)} /></label>
        <label>Tohum <input className={inp} value={seed} onChange={(e) => setSeed(e.target.value)} /></label>
        <select value={dist} onChange={(e) => setDist(e.target.value as McDist)} className="bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-xs">
          <option value="gaussian">Gauss (σ=tol/3)</option><option value="uniform">Düzgün (±tol)</option>
        </select>
        <button className={btn} onClick={runMc}>Monte Carlo çalıştır</button>
        <label>B (Hz) <input className={inp} value={bw} onChange={(e) => setBw(e.target.value)} /></label>
        <button className={btn} onClick={runNz}>Gürültü hesapla</button>
      </div>
      {err && <div className="text-red-400">{err}</div>}
      {mc && (
        <div className="space-y-2">
          <Histogram samples={mc.samples} nominal={mc.nominal} />
          <table className="text-xs">
            <tbody>
              {([['Nominal', mc.nominal], ['Ortalama', mc.mean], ['Std', mc.std], ['Min', mc.min], ['Maks', mc.max], ['%5', mc.p5], ['%95', mc.p95], ['En kötü min', mc.worstCase.min], ['En kötü maks', mc.worstCase.max]] as [string, number][]).map(([k, v]) => (
                <tr key={k}><td className="pr-4 text-zinc-500">{k}</td><td className="font-mono">{formatSI(v, 'V', 4)}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="text-zinc-500">Birim V (gerilim probu). En kötü durum birinci derece duyarlılıkla hesaplanır. {mc.failed > 0 && `${mc.failed} koşu çözülemedi.`}</div>
        </div>
      )}
      {nz && (
        <div className="space-y-1">
          <div>Toplam çıkış gürültüsü (B = {formatSI(nz.bandwidth, 'Hz')}): <span className="font-mono text-emerald-400">{formatSI(nz.totalVrms, 'V', 4)} rms</span> <span className="text-zinc-500">({nz.method === 'flat' ? 'düz PSD' : 'frekans entegrasyonu'})</span></div>
          <table className="text-xs"><tbody>
            {nz.perSource.map((s) => <tr key={s.comp}><td className="pr-4 text-zinc-500">{s.comp} ({s.kind === 'thermal' ? 'termal' : 'saçma'})</td><td className="font-mono">{formatSI(s.vrms, 'V', 4)}</td></tr>)}
          </tbody></table>
          <div className="text-zinc-500">Yalnız direnç termal + diyot saçma gürültüsü; 1/f, transistör ve opamp gürültüsü yok.</div>
        </div>
      )}
    </div>
  );
}
