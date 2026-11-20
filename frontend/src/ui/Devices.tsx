import { useEffect, useMemo, useRef, useState } from 'react';
import { getRunner, useLab, type DmmMode, type InstKind } from '../store/lab';
import { getDef } from '../library/components';
import { formatSI } from '../core/units';
import { diodeTest, insulationTest, measureImpedance, type AcProbe } from '../core/sim/ac';
import { acRms, digitize, formatRanged, frequency, mean, powerStats, rms, thd } from '../core/instruments/readings';
import type { Circuit, PinRef } from '../core/circuit/types';
import { download } from '../store/persist';
import { useProgress } from '../education/progress';
import { Bode } from './Bode';

const btn = 'px-2 py-1 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40';
const sel = 'bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-xs';
const SAMPLES = 4000;

const INSTRUMENTS: [InstKind, string][] = [
  ['dmm', 'Dijital multimetre'], ['analog', 'Analog multimetre'], ['lcr', 'LCR metre'], ['esr', 'ESR metre'], ['counter', 'Frekans sayacı'],
  ['power', 'Güç analizörü'], ['logic', 'Mantık analizörü'], ['insulation', 'İzolasyon test cihazı'], ['bode', 'Frekans yanıtı (AC)'],
];

const DMM_MODES: [DmmMode, string, string][] = [
  ['vdc', 'V ⎓', 'DC gerilim'], ['vac', 'V ~', 'AC gerilim (AC bileşen RMS)'], ['vtrms', 'V TRMS', 'True RMS gerilim'], ['adc', 'A ⎓', 'DC akım (SERİ bağlanır!)'], ['aac', 'A ~', 'AC akım (SERİ)'],
  ['ohm', 'Ω', 'Direnç (devre enerjisiz)'], ['diode', '▶|', 'Diyot testi'], ['cont', '•))', 'Süreklilik'], ['cap', '⊣⊢', 'Kapasite'], ['freq', 'Hz', 'Frekans'],
];
const RANGES: Record<string, number[]> = { v: [0.2, 2, 20, 200, 1000], a: [0.02, 0.2, 2, 10], ohm: [200, 2e3, 2e4, 2e5, 2e6, 2e7], cap: [2e-9, 2e-8, 2e-7, 2e-6, 2e-5, 2e-4], hz: [200, 2e3, 2e4, 2e5] };

const rangeKey = (m: DmmMode) => (m === 'vdc' || m === 'vac' || m === 'vtrms' ? 'v' : m === 'adc' || m === 'aac' ? 'a' : m === 'ohm' || m === 'cont' ? 'ohm' : m === 'cap' ? 'cap' : m === 'freq' ? 'hz' : '');

const pinKey = (p: PinRef | null) => (p ? `${p.comp}|${p.pin}` : '');
const toPin = (v: string): PinRef | null => { if (!v) return null; const [comp, pin] = v.split('|'); return { comp, pin }; };

/** circuit energised? (static ohm/LCR/insulation measurements are invalid then) */
function energized(c: Circuit): boolean {
  return c.components.some((x) => {
    const d = getDef(x.type);
    if (d.model === 'vsource') return Math.abs(Number(x.params.v) || 0) > 1e-9 || Math.abs(Number(x.params.amp) || 0) > 1e-9;
    if (d.model === 'isource') return Math.abs(Number(x.params.i) || 0) > 1e-12;
    return d.model === 'mcu';
  });
}

function useRefs() {
  const s = useLab();
  const pinOpts = s.circuit.components.flatMap((c) => getDef(c.type).pins.map((p) => ({ v: `${c.id}|${p.id}`, label: `${c.ref}.${p.label}` })));
  return { s, pinOpts };
}

/** differential signal V(a) − V(b) from the recorded net buffers */
function useDiff(a: PinRef | null, b: PinRef | null) {
  const live = useLab((s) => s.live);
  const run = getRunner();
  if (!a || !b || !live || !run || run.t.length < 4) return null;
  const na = live.pinNet.get(`${a.comp}:${a.pin}`), nb = live.pinNet.get(`${b.comp}:${b.pin}`);
  if (na === undefined || nb === undefined || !run.nets[na] || !run.nets[nb]) return null;
  const n = Math.min(SAMPLES, run.t.length), from = run.t.length - n;
  const t = run.t.slice(from), y = run.nets[na].slice(from).map((v, k) => v - run.nets[nb][from + k]);
  return { t, y };
}

function Display({ text, warn, sub }: { text: string; warn?: string; sub?: string }) {
  return (
    <div className="rounded border border-zinc-700 bg-black px-4 py-3 w-full max-w-md">
      <div className="font-mono text-3xl text-emerald-400 tracking-wider">{text}</div>
      {sub && <div className="text-[11px] text-zinc-500 mt-1">{sub}</div>}
      {warn && <div className="text-[11px] text-amber-300 mt-1">⚠ {warn}</div>}
    </div>
  );
}

function ProbesNote({ ok }: { ok: boolean }) {
  return ok ? null : <div className="text-xs text-zinc-500">Kırmızı ve siyah probu pinlere atayın (soldan seçin ya da “3D’den seç” ile pine tıklayın).</div>;
}

function useStatic<T>(fn: () => T, deps: unknown[]): T | { error: string } {
  return useMemo(() => { try { return fn(); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; } }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

function circuitForStatic(s: ReturnType<typeof useLab.getState>): Circuit {
  return { ...s.circuit, faults: { ...(s.circuit.faults ?? {}), ...s.hiddenFaults } };
}

function Dmm({ analog }: { analog: boolean }) {
  const { s } = useRefs();
  const { red, black } = s.probes;
  const mode = analog ? 'vdc' : s.dmmMode;
  const diff = useDiff(red, black);
  const run = getRunner();
  const live = useLab((st) => st.live);
  const [manual, setManual] = useState<number | null>(null);
  const rk = rangeKey(mode);
  const staticMode = mode === 'ohm' || mode === 'diode' || mode === 'cont' || mode === 'cap';
  const hot = energized(s.circuit) && !s.powerOff;
  const stat = useStatic(() => {
    if (!staticMode || !red || !black) return null;
    const c = circuitForStatic(s);
    const a: AcProbe = red, b: AcProbe = black;
    if (mode === 'diode') return { kind: 'diode' as const, ...diodeTest(c, a, b) };
    const z = measureImpedance(c, a, b, mode === 'cap' ? 1000 : 0);
    return { kind: mode, z };
  }, [s.circuit, s.hiddenFaults, red, black, mode, staticMode]);

  let text = '—', sub = '', warn: string | undefined;
  let value: number | null = null, unit = '';
  if (!red || !black) { text = '----'; }
  else if (staticMode) {
    if (hot) { text = 'ERR'; warn = 'Devre enerjili: direnç/diyot/süreklilik/kapasite ölçmeden önce enerjiyi kesin (aşağıdan “enerjiyi kes” seçin). Enerjili devrede bu ölçümler yanlış okunur ve cihaza zarar verebilir.'; }
    else if (stat && 'error' in stat) { text = 'ERR'; warn = stat.error; }
    else if (stat && stat.kind === 'diode') { text = stat.open ? 'OL' : `${stat.volts.toFixed(3)} V`; sub = stat.open ? 'ters yön / açık' : 'ileri yön gerilimi (1 mA)'; value = stat.volts; unit = 'V'; }
    else if (stat && 'z' in stat && stat.kind === 'ohm') { value = stat.z.rs; unit = 'Ω'; text = stat.z.rs > 1e8 ? 'OL' : manual ? formatRanged(stat.z.rs, manual, 'Ω') : formatSI(stat.z.rs, 'Ω', 4); }
    else if (stat && 'z' in stat && stat.kind === 'cont') { const r = stat.z.rs; value = r; unit = 'Ω'; text = r < 50 ? `${r.toFixed(1)} Ω` : 'OL'; sub = r < 50 ? '🔔 BİP — süreklilik var (< 50 Ω)' : 'süreklilik yok'; }
    else if (stat && 'z' in stat && stat.kind === 'cap') { const c = stat.z.cs; value = c ?? 0; unit = 'F'; text = c ? (manual ? formatRanged(c, manual, 'F') : formatSI(c, 'F', 4)) : 'OL'; sub = '1 kHz seri eşdeğer'; }
  } else if (!live || !run || !diff) { text = '----'; sub = 'Çalıştır'; }
  else if (mode === 'vdc') { value = mean(diff.y); unit = 'V'; text = manual ? formatRanged(value, manual, 'V') : formatSI(value, 'V', 4); }
  else if (mode === 'vac') { value = acRms(diff.y); unit = 'V'; text = manual ? formatRanged(value, manual, 'V') : formatSI(value, 'V', 4); sub = 'AC bileşen RMS'; }
  else if (mode === 'vtrms') { value = rms(diff.y); unit = 'V'; text = manual ? formatRanged(value, manual, 'V') : formatSI(value, 'V', 4); sub = 'True RMS (DC + AC)'; }
  else if (mode === 'freq') { const f = frequency(diff.t, diff.y); value = f.freq; unit = 'Hz'; text = f.freq ? formatSI(f.freq, 'Hz', 4) : '0 Hz'; sub = f.freq ? `T = ${formatSI(f.period, 's')}, doluluk ${(f.duty * 100).toFixed(0)} %` : 'periyodik sinyal yok'; }
  else if (mode === 'adc' || mode === 'aac') {
    const buf = run?.meterBuf.m1;
    if (run?.fuseBlown) { text = 'FUSE'; warn = 'Sigorta attı (10 A). Ampermetre gerilim kaynağına veya yüke PARALEL bağlandı: akım ölçerken devreyi açıp cihazı SERİ bağlayın. Sigortayı değiştirmek için soldaki düğmeyi kullanın.'; }
    else if (!buf || buf.length < 4) { text = '----'; sub = 'Çalıştır'; }
    else { const w = buf.slice(-SAMPLES); value = mode === 'adc' ? mean(w) : acRms(w); unit = 'A'; text = manual ? formatRanged(value, manual, 'A') : formatSI(value, 'A', 4); sub = mode === 'aac' ? 'AC bileşen RMS' : 'kırmızıdan siyaha doğru akım (10 mΩ şönt)'; }
  }
  if (!analog && (mode === 'adc' || mode === 'aac') && red && black && !run?.fuseBlown && diff && Math.abs(mean(diff.y)) > 0.5) warn = 'Probelar arasında yüksek gerilim var: ampermetre normalde devrenin AÇILIP seri bağlandığı iki uca bağlanır.';

  const range = analog ? s.meterRange : manual;
  return (
    <div className="space-y-3">
      {!analog && (
        <div className="flex gap-1 flex-wrap">
          {DMM_MODES.map(([m, label, tip]) => <button key={m} title={tip} onClick={() => { s.set({ dmmMode: m }); setManual(null); setTimeout(() => s.applyMeters(), 0); }} className={`${btn} ${mode === m ? '!bg-emerald-800 !border-emerald-600' : ''}`}>{label}</button>)}
        </div>
      )}
      {analog ? (
        <AnalogGauge value={value ?? mean(diff?.y ?? [0])} range={s.meterRange} ready={!!diff} />
      ) : <Display text={text} sub={sub} warn={warn} />}
      <div className="flex gap-3 items-center flex-wrap text-xs">
        {analog ? (
          <label className="text-zinc-400">Tam skala <select className={sel} value={s.meterRange} onChange={(e) => { s.set({ meterRange: Number(e.target.value) }); setTimeout(() => s.applyMeters(), 0); }}>{[1, 2.5, 10, 50, 250].map((r) => <option key={r} value={r}>{r} V</option>)}</select></label>
        ) : rk && (
          <label className="text-zinc-400">Aralık <select className={sel} value={manual ?? 'auto'} onChange={(e) => setManual(e.target.value === 'auto' ? null : Number(e.target.value))}><option value="auto">otomatik</option>{RANGES[rk].map((r) => <option key={r} value={r}>{formatSI(r, rk === 'v' ? 'V' : rk === 'a' ? 'A' : rk === 'ohm' ? 'Ω' : rk === 'cap' ? 'F' : 'Hz')}</option>)}</select></label>
        )}
        {analog && <span className="text-zinc-500">İç direnç = 20 kΩ/V × {s.meterRange} V = {formatSI(20000 * s.meterRange, 'Ω')} (devreyi yükler)</span>}
        {!analog && (mode === 'vdc' || mode === 'vac' || mode === 'vtrms') && <span className="text-zinc-500">Giriş direnci 10 MΩ</span>}
        {(mode === 'adc' || mode === 'aac') && !analog && <span className="text-zinc-500">Şönt 10 mΩ, sigorta 10 A</span>}
        <button className={btn} disabled={value === null} onClick={() => s.logMeas(analog ? 'Analog' : `DMM ${mode}`, `${value === null ? text : formatSI(value, unit, 4)}${range ? ` (aralık ${range})` : ''}`)}>Ölçümü kaydet</button>
      </div>
      <ProbesNote ok={!!red && !!black} />
    </div>
  );
}

function AnalogGauge({ value, range, ready }: { value: number; range: number; ready: boolean }) {
  const frac = Math.max(-0.05, Math.min(1.05, value / range));
  const ang = -50 + 100 * frac;
  const ticks = Array.from({ length: 11 }, (_, i) => i / 10);
  return (
    <svg viewBox="0 0 240 140" className="w-72 rounded border border-zinc-700 bg-[#f1e9d2]">
      {ticks.map((f) => { const a = ((-50 + 100 * f) * Math.PI) / 180; return (<g key={f}><line x1={120 + 80 * Math.sin(a)} y1={125 - 80 * Math.cos(a)} x2={120 + 92 * Math.sin(a)} y2={125 - 92 * Math.cos(a)} stroke="#222" strokeWidth={f * 10 % 5 === 0 ? 2 : 1} /><text x={120 + 106 * Math.sin(a)} y={129 - 104 * Math.cos(a)} fontSize="9" textAnchor="middle" fill="#222">{Number((f * range).toPrecision(2))}</text></g>); })}
      <text x="120" y="70" fontSize="11" textAnchor="middle" fill="#444">V ⎓</text>
      <g style={{ transform: `rotate(${ang}deg)`, transformOrigin: '120px 125px', transition: 'transform 0.4s cubic-bezier(.3,1.6,.5,1)' }}><line x1="120" y1="125" x2="120" y2="40" stroke={ready ? '#b91c1c' : '#777'} strokeWidth="2" /></g>
      <circle cx="120" cy="125" r="6" fill="#222" />
    </svg>
  );
}

function Lcr({ esr }: { esr?: boolean }) {
  const { s } = useRefs();
  const { red, black } = s.probes;
  const [f, setF] = useState(esr ? 100000 : 1000);
  const hot = energized(s.circuit) && !s.powerOff;
  const z = useStatic(() => (red && black && !hot ? measureImpedance(circuitForStatic(s), red, black, f) : null), [s.circuit, s.hiddenFaults, red, black, f, hot]);
  return (
    <div className="space-y-3">
      {hot ? <Display text="ERR" warn="Devre enerjili. LCR/ESR ölçümü için parçayı devreden izole edin veya enerjiyi kesin (soldaki “enerjiyi kes”)." />
        : !z ? <Display text="----" /> : 'error' in z ? <Display text="ERR" warn={z.error} />
        : esr ? <Display text={`ESR ${formatSI(z.rs, 'Ω', 4)}`} sub={`@ ${formatSI(f, 'Hz')}  |Z| = ${formatSI(z.mag, 'Ω', 4)}  θ = ${z.phaseDeg.toFixed(1)}°`} warn={z.rs < 1e-6 ? 'Kondansatör modelinde ESR yok (ideal): ölçüm yalnızca devredeki seri dirençleri gösterir. ESR/ESL modeli planlanıyor.' : undefined} />
        : <Display text={z.cs ? `C ${formatSI(z.cs, 'F', 4)}` : z.ls ? `L ${formatSI(z.ls, 'H', 4)}` : `R ${formatSI(z.rs, 'Ω', 4)}`} sub={`|Z| ${formatSI(z.mag, 'Ω', 4)}  θ ${z.phaseDeg.toFixed(1)}°  Rs ${formatSI(z.rs, 'Ω', 3)}  Q ${Number.isFinite(z.q) ? z.q.toFixed(2) : '∞'}  @ ${formatSI(f, 'Hz')}`} />}
      <label className="text-xs text-zinc-400">Test frekansı <select className={sel} value={f} onChange={(e) => setF(Number(e.target.value))}>{[100, 1000, 10000, 100000].map((x) => <option key={x} value={x}>{formatSI(x, 'Hz')}</option>)}</select></label>
      <button className={btn} disabled={!z || 'error' in z} onClick={() => { if (z && !('error' in z)) s.logMeas(esr ? 'ESR' : 'LCR', `|Z|=${formatSI(z.mag, 'Ω', 4)} θ=${z.phaseDeg.toFixed(1)}° Rs=${formatSI(z.rs, 'Ω', 3)}${z.cs ? ` Cs=${formatSI(z.cs, 'F', 4)}` : ''}${z.ls ? ` Ls=${formatSI(z.ls, 'H', 4)}` : ''} @${formatSI(f, 'Hz')}`); }}>Ölçümü kaydet</button>
      <ProbesNote ok={!!red && !!black} />
    </div>
  );
}

function Counter() {
  const { s } = useRefs();
  const diff = useDiff(s.probes.red, s.probes.black);
  const f = diff ? frequency(diff.t, diff.y) : null;
  return (
    <div className="space-y-3">
      <Display text={f ? (f.freq ? formatSI(f.freq, 'Hz', 5) : '0 Hz') : '----'} sub={f && f.freq ? `periyot ${formatSI(f.period, 's', 4)} · doluluk ${(f.duty * 100).toFixed(1)} % · ${f.crossings} periyot` : 'Çalıştır; probelar sinyal ve referans noktası'} />
      <button className={btn} disabled={!f} onClick={() => f && s.logMeas('Frekans sayacı', `${formatSI(f.freq, 'Hz', 5)} (T=${formatSI(f.period, 's', 4)}, doluluk ${(f.duty * 100).toFixed(1)} %)`)}>Ölçümü kaydet</button>
      <ProbesNote ok={!!s.probes.red && !!s.probes.black} />
    </div>
  );
}

function Power() {
  const { s } = useRefs();
  const run = getRunner();
  useLab((st) => st.live);
  const comps = s.circuit.components.filter((c) => !['ground', 'none'].includes(getDef(c.type).model));
  const id = s.watchComp ?? '';
  const buf = id && run ? run.compBuf[id] : undefined;
  const n = buf ? Math.min(SAMPLES, buf.v.length, run!.t.length) : 0;
  const stats = buf && n > 8 ? (() => {
    const t = run!.t.slice(-n), v = buf.v.slice(-n), i = buf.i.slice(-n);
    const ps = powerStats(t, v, i);
    const fr = frequency(t, v);
    return { ps, fr, thdV: fr.freq ? thd(t, v, fr.freq) : 0, thdI: fr.freq ? thd(t, i, fr.freq) : 0, dur: t[n - 1] - t[0] };
  })() : null;
  return (
    <div className="space-y-3">
      <label className="text-xs text-zinc-400">Ölçülen parça <select className={sel} value={id} onChange={(e) => { s.set({ watchComp: e.target.value || null }); setTimeout(() => s.applyMeters(), 0); }}><option value="">seç…</option>{comps.map((c) => <option key={c.id} value={c.id}>{c.ref}</option>)}</select></label>
      {!stats ? <Display text="----" sub="Parçayı seçip Çalıştır (periyodik sinyallerde THD/PF anlamlıdır)" /> : (
        <div className="grid grid-cols-2 gap-2 max-w-xl text-sm">
          {([['Vrms', formatSI(stats.ps.vrms, 'V', 4)], ['Irms', formatSI(stats.ps.irms, 'A', 4)], ['P (gerçek)', formatSI(stats.ps.p, 'W', 4)], ['S (görünür)', formatSI(stats.ps.s, 'VA', 4)], ['Q (reaktif)', formatSI(stats.ps.q, 'var', 4)], ['Güç faktörü', stats.ps.pf.toFixed(3)], ['Vdc / Idc', `${formatSI(stats.ps.vdc, 'V', 3)} / ${formatSI(stats.ps.idc, 'A', 3)}`], ['Frekans', stats.fr.freq ? formatSI(stats.fr.freq, 'Hz', 4) : '—'], ['THD (V)', stats.fr.freq ? `${stats.thdV.toFixed(2)} %` : '—'], ['THD (I)', stats.fr.freq ? `${stats.thdI.toFixed(2)} %` : '—'], ['Pencere enerjisi', formatSI(stats.ps.p * stats.dur, 'J', 3)]] as [string, string][]).map(([k, v]) => (
            <div key={k} className="rounded border border-zinc-800 bg-black px-3 py-2"><div className="text-[10px] text-zinc-500">{k}</div><div className="font-mono text-emerald-400">{v}</div></div>
          ))}
        </div>
      )}
      <div className="text-[11px] text-zinc-500">Akım yönü: parçanın pin1 → pin2. Kaynaklarda teslim edilen güç negatif görünür. Pencere: son ~{SAMPLES} örnek.</div>
      <button className={btn} disabled={!stats} onClick={() => stats && s.logMeas('Güç analizörü', `P=${formatSI(stats.ps.p, 'W', 4)} S=${formatSI(stats.ps.s, 'VA', 4)} PF=${stats.ps.pf.toFixed(3)} Vrms=${formatSI(stats.ps.vrms, 'V', 4)} Irms=${formatSI(stats.ps.irms, 'A', 4)}`)}>Ölçümü kaydet</button>
    </div>
  );
}

function Logic() {
  const { s, pinOpts } = useRefs();
  const live = useLab((st) => st.live);
  const [pins, setPins] = useState<string[]>([]);
  const [thr, setThr] = useState(1.65);
  const [tb, setTb] = useState(1e-3);
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current, run = getRunner();
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.width = r.width; c.height = r.height;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#06090c'; ctx.fillRect(0, 0, r.width, r.height);
    if (!run || run.t.length < 4 || !live) { ctx.fillStyle = '#6b7280'; ctx.font = '12px sans-serif'; ctx.fillText('Çalıştır ve kanallara pin ekle', 10, 20); return; }
    const span = tb * 10, tEnd = run.t[run.t.length - 1], t0 = Math.max(run.t[0], tEnd - span);
    let i0 = 0; while (i0 < run.t.length && run.t[i0] < t0) i0++;
    ctx.strokeStyle = '#1b2a22';
    for (let i = 0; i <= 10; i++) { ctx.beginPath(); ctx.moveTo((r.width * i) / 10, 0); ctx.lineTo((r.width * i) / 10, r.height); ctx.stroke(); }
    const lane = r.height / Math.max(pins.length, 1);
    pins.forEach((pv, k) => {
      const p = toPin(pv)!;
      const net = live.pinNet.get(`${p.comp}:${p.pin}`);
      const y = net !== undefined ? run.nets[net]?.slice(i0) : undefined;
      if (!y) return;
      const d = digitize(y, thr, 0.15);
      const colors = ['#facc15', '#22d3ee', '#f472b6', '#4ade80', '#fb923c', '#a78bfa', '#e5e7eb', '#f87171'];
      ctx.strokeStyle = colors[k % colors.length]; ctx.lineWidth = 1.5; ctx.beginPath();
      const top = k * lane + 8, bot = (k + 1) * lane - 8;
      d.forEach((hi, j) => { const x = ((run.t[i0 + j] - t0) / span) * r.width, yy = hi ? top : bot; j ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); });
      ctx.stroke();
      ctx.fillStyle = colors[k % colors.length]; ctx.font = '10px sans-serif';
      const o = pinOpts.find((q) => q.v === pv); ctx.fillText(o?.label ?? pv, 4, top + 10);
    });
  }, [live, pins, thr, tb, pinOpts]);
  return (
    <div className="space-y-2 h-full flex flex-col">
      <div className="flex gap-2 flex-wrap items-center text-xs">
        <select className={sel} value="" onChange={(e) => { if (e.target.value && pins.length < 8) setPins([...pins, e.target.value]); }}><option value="">+ kanal ekle ({pins.length}/8)</option>{pinOpts.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>
        <label className="text-zinc-400">Eşik <input type="number" step="0.1" value={thr} onChange={(e) => setThr(Number(e.target.value))} className={`${sel} w-16`} /> V</label>
        <label className="text-zinc-400">Zaman/div <select className={sel} value={tb} onChange={(e) => setTb(Number(e.target.value))}>{[1e-5, 1e-4, 1e-3, 1e-2, 1e-1, 1].map((x) => <option key={x} value={x}>{formatSI(x, 's')}</option>)}</select></label>
        <button className={btn} onClick={() => setPins([])}>Temizle</button>
        <span className="text-zinc-500">UART/I²C/SPI çözümü için “Protokol çözücü” sekmesi.</span>
      </div>
      <canvas ref={cv} className="flex-1 min-h-24 w-full border border-zinc-800 rounded" />
      <div className="text-[11px] text-zinc-600">{s.circuit.components.length ? '' : ''}</div>
    </div>
  );
}

function Insulation() {
  const { s } = useRefs();
  const { red, black } = s.probes;
  const [v, setV] = useState(500);
  const [run, setRun] = useState(0);
  const hot = energized(s.circuit) && !s.powerOff;
  const res = useStatic(() => (run && red && black && !hot ? insulationTest(circuitForStatic(s), red, black, v) : null), [run, red, black, v, hot]);
  return (
    <div className="space-y-3">
      <div className="rounded border border-red-900 bg-red-950/30 text-red-200 text-xs p-2 max-w-xl">⚠ İzolasyon test cihazı (megger) 250–1000 V uygular. Gerçekte yalnızca enerjisi kesilmiş ve boşaltılmış devrelerde, yetkili kişilerce kullanılır; elektronik bileşenlere uygulanması bileşeni bozar. Bu simülasyon sanaldır.</div>
      <label className="text-xs text-zinc-400">Test gerilimi <select className={sel} value={v} onChange={(e) => { setV(Number(e.target.value)); setRun(0); }}>{[250, 500, 1000].map((x) => <option key={x} value={x}>{x} V</option>)}</select></label>
      <button className={btn} disabled={!red || !black} onClick={() => setRun(run + 1)}>Testi uygula</button>
      {hot ? <Display text="ERR" warn="Devre enerjili. Önce enerjiyi kesin." />
        : !run ? <Display text="----" /> : !res ? <Display text="----" /> : 'error' in res ? <Display text="ERR" warn={res.error} />
        : <Display text={Number.isFinite(res.ohms) && res.ohms < 1e12 ? formatSI(res.ohms, 'Ω', 3) : '> 1 TΩ'} sub={`${v} V · kaçak akım ${formatSI(res.amps, 'A', 3)}`} warn={res.ohms < 1e6 ? 'Yalıtım direnci 1 MΩ altında: yalıtım hatası olası (genel ölçüt; ilgili standarda bakınız).' : undefined} />}
      <button className={btn} disabled={!res || 'error' in res} onClick={() => res && !('error' in res) && s.logMeas('Megger', `${v} V: ${Number.isFinite(res.ohms) ? formatSI(res.ohms, 'Ω', 3) : '>1 TΩ'}`)}>Ölçümü kaydet</button>
      <ProbesNote ok={!!red && !!black} />
    </div>
  );
}

export function DevicesTab() {
  const { s, pinOpts } = useRefs();
  const run = getRunner();
  useEffect(() => { s.applyMeters(); }, [s.instKind, s.meterOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const addNote = () => useProgress.getState().addNote({ title: 'Ölçüm kayıtları', note: '', data: s.measLog.map((m) => `[${m.t}] ${m.inst}: ${m.text}`) });
  const csv = () => download('olcumler.csv', ['zaman,cihaz,deger', ...s.measLog.map((m) => `"${m.t}","${m.inst}","${m.text.replace(/"/g, '""')}"`)].join('\r\n'), 'text/csv');
  const probeSel = (which: 'red' | 'black', label: string, color: string) => (
    <div className="flex items-center gap-1">
      <span className={`w-3 h-3 rounded-full shrink-0 ${color}`} />
      <select className={`${sel} flex-1 min-w-0`} value={pinKey(s.probes[which])} onChange={(e) => s.setProbe(which, toPin(e.target.value))}><option value="">{label}</option>{pinOpts.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>
      <button className={`${btn} ${s.probeTarget === which ? '!bg-cyan-800' : ''}`} title="3D sahnede bir pine tıklayarak ata" onClick={() => s.set({ probeTarget: s.probeTarget === which ? null : which })}>⌖</button>
    </div>
  );
  return (
    <div className="flex h-full text-sm">
      <div className="w-52 shrink-0 border-r border-zinc-800 p-2 space-y-2 overflow-y-auto">
        <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Cihaz</div>
        {INSTRUMENTS.map(([k, label]) => <button key={k} onClick={() => s.set({ instKind: k })} className={`block w-full text-left px-2 py-1 rounded text-xs ${s.instKind === k ? 'bg-emerald-800 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}>{label}</button>)}
        <div className="text-[10px] text-zinc-500 uppercase tracking-wide pt-1">Problar</div>
        {probeSel('red', 'kırmızı (+)', 'bg-red-500')}
        {probeSel('black', 'siyah (−)', 'bg-zinc-400')}
        {s.probeTarget && <div className="text-[11px] text-cyan-300">3D sahnede {s.probeTarget === 'red' ? 'kırmızı' : 'siyah'} prob için bir pine tıklayın.</div>}
        <label className="flex items-center gap-1 text-[11px] text-zinc-400"><input type="checkbox" checked={s.meterOn} onChange={(e) => { s.set({ meterOn: e.target.checked }); setTimeout(() => s.applyMeters(), 0); }} />Cihaz devreye bağlı (yükler)</label>
        <label className="flex items-center gap-1 text-[11px] text-zinc-400"><input type="checkbox" checked={s.powerOff} onChange={(e) => s.set({ powerOff: e.target.checked })} />Enerjiyi kes (Ω/C/L/megger ölçümü için)</label>
        {run?.fuseBlown && <button className={`${btn} !border-red-700`} onClick={s.resetFuse}>🔧 DMM sigortasını değiştir</button>}
        <button className={btn} onClick={() => s.set({ thermalView: !s.thermalView })}>🌡 Isıl kamera {s.thermalView ? '(açık)' : ''}</button>
      </div>
      <div className="flex-1 min-w-0 p-3 overflow-y-auto">
        {s.instKind === 'dmm' && <Dmm analog={false} />}
        {s.instKind === 'analog' && <Dmm analog />}
        {s.instKind === 'lcr' && <Lcr />}
        {s.instKind === 'esr' && <Lcr esr />}
        {s.instKind === 'counter' && <Counter />}
        {s.instKind === 'power' && <Power />}
        {s.instKind === 'logic' && <Logic />}
        {s.instKind === 'insulation' && <Insulation />}
        {s.instKind === 'bode' && <Bode />}
      </div>
      <div className="w-56 shrink-0 border-l border-zinc-800 p-2 overflow-y-auto">
        <div className="flex justify-between items-center mb-1"><div className="text-[10px] text-zinc-500 uppercase tracking-wide">Ölçüm kaydı</div></div>
        <div className="flex gap-1 mb-2"><button className={btn} disabled={!s.measLog.length} onClick={csv}>CSV</button><button className={btn} disabled={!s.measLog.length} onClick={addNote}>Deftere</button><button className={btn} onClick={() => s.set({ measLog: [] })}>Temizle</button></div>
        {s.measLog.map((m) => <div key={m.id} className="text-[11px] border-t border-zinc-800 py-1"><span className="text-zinc-600">{m.t}</span> <b>{m.inst}</b><div className="text-zinc-300">{m.text}</div></div>)}
        {!s.measLog.length && <div className="text-[11px] text-zinc-600">Kayıt yok.</div>}
      </div>
    </div>
  );
}
