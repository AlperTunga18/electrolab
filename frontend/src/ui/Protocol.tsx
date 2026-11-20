import { useEffect, useMemo, useRef, useState } from 'react';
import { getRunner, useLab } from '../store/lab';
import { getDef } from '../library/components';
import { formatSI } from '../core/units';
import { decodeI2c, decodeSpi, decodeUart, detectBaud, toTrace, type DigitalTrace, type Frame } from '../core/instruments/decode';

const btn = 'px-2 py-1 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40';
const sel = 'bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-xs';
const COLORS = ['#facc15', '#22d3ee', '#f472b6', '#4ade80'];

type Proto = 'uart' | 'i2c' | 'spi';
const SIGNALS: Record<Proto, [string, string][]> = {
  uart: [['line', 'Hat (RX/TX)']],
  i2c: [['sda', 'SDA'], ['scl', 'SCL']],
  spi: [['sck', 'SCK'], ['mosi', 'MOSI'], ['miso', 'MISO'], ['cs', 'CS']],
};

const frameColor = (f: Frame): string => (f.error ? '#ef4444' : f.type === 'addr' ? '#38bdf8' : f.type === 'start' || f.type === 'stop' ? '#a3a3a3' : f.type === 'spi' ? '#a78bfa' : '#4ade80');

export function ProtocolTab() {
  const live = useLab((s) => s.live);
  const circuit = useLab((s) => s.circuit);
  const [proto, setProto] = useState<Proto>('uart');
  const [pins, setPins] = useState<Record<string, string>>({});
  const [thr, setThr] = useState(1.65);
  const [baud, setBaud] = useState(0); // 0 = auto
  const [dataBits, setDataBits] = useState<5 | 6 | 7 | 8 | 9>(8);
  const [parity, setParity] = useState<'none' | 'even' | 'odd'>('none');
  const [stopBits, setStopBits] = useState<1 | 2>(1);
  const [lsb, setLsb] = useState(true);
  const [invert, setInvert] = useState(false);
  const [mode, setMode] = useState<0 | 1 | 2 | 3>(0);
  const [msb, setMsb] = useState(true);
  const [csLow, setCsLow] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState(0);
  const cv = useRef<HTMLCanvasElement>(null);

  const pinOpts = useMemo(() => circuit.components.flatMap((c) => getDef(c.type).pins.map((p) => ({ v: `${c.id}|${p.id}`, label: `${c.ref}.${p.label}` }))), [circuit]);

  const run = getRunner();
  const sigs = SIGNALS[proto];

  /** data source: the live runner's recorded net buffers (same as the logic analyzer) */
  const data = useMemo(() => {
    const r = getRunner();
    if (!live || !r || r.t.length < 4) return null;
    const traces: Record<string, DigitalTrace | null> = {};
    for (const [k] of SIGNALS[proto]) {
      const pv = pins[k];
      if (!pv) { traces[k] = null; continue; }
      const [comp, pin] = pv.split('|');
      const net = live.pinNet.get(`${comp}:${pin}`);
      const y = net !== undefined ? r.nets[net] : undefined;
      traces[k] = y ? toTrace(r.t, y, thr, 0.15) : null;
    }
    const n = r.t.length;
    return { traces, t0: r.t[0], t1: r.t[n - 1], dt: (r.t[n - 1] - r.t[0]) / Math.max(n - 1, 1) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, proto, pins, thr]);

  const result = useMemo(() => {
    if (!data) return { frames: [] as Frame[], note: 'Önce devreyi çalıştırın (canlı kayıt tamponu kullanılır).', baud: null as number | null };
    const tr = data.traces;
    if (proto === 'uart') {
      if (!tr.line) return { frames: [], note: 'Bir hat (pin) seçin.', baud: null };
      const r = decodeUart(tr.line, { baud: baud || undefined, dataBits, parity, stopBits, lsbFirst: lsb, invert });
      return { frames: r.frames, note: r.baud ? '' : 'Baud hızı belirlenemedi (kenar yok).', baud: r.baud };
    }
    if (proto === 'i2c') {
      if (!tr.sda || !tr.scl) return { frames: [], note: 'SDA ve SCL pinlerini seçin.', baud: null };
      return { frames: decodeI2c(tr.sda, tr.scl), note: '', baud: null };
    }
    if (!tr.sck || (!tr.mosi && !tr.miso)) return { frames: [], note: 'SCK ile en az bir veri hattı (MOSI/MISO) seçin.', baud: null };
    return { frames: decodeSpi(tr.sck, tr.mosi, tr.miso, tr.cs, { mode, bitOrder: msb ? 'msb' : 'lsb', csActiveLow: csLow }), note: '', baud: null };
  }, [data, proto, baud, dataBits, parity, stopBits, lsb, invert, mode, msb, csLow]);

  // resolution warning: edge timing is only as good as the transient time step
  const warn = useMemo(() => {
    if (!data) return '';
    if (proto === 'uart' && result.baud && data.dt > 1 / result.baud / 4) return `Örnekleme adımı ${formatSI(data.dt, 's')}; bit süresi ${formatSI(1 / result.baud, 's')}. Bit başına < 4 örnek: çözüm güvenilmez olabilir. Simülasyon hızını düşürün.`;
    if (proto === 'uart' && !result.baud) { const b = data.traces.line ? detectBaud(data.traces.line) : null; if (b && data.dt > 1 / b / 4) return 'Örnekleme adımı bit süresine göre çok kaba. Simülasyon hızını düşürün.'; }
    return '';
  }, [data, proto, result.baud]);

  const view = useMemo(() => {
    if (!data) return { a: 0, b: 1 };
    const span = (data.t1 - data.t0) / zoom;
    const a = data.t0 + (data.t1 - data.t0 - span) * pos;
    return { a, b: a + span };
  }, [data, zoom, pos]);

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width, H = r.height;
    ctx.fillStyle = '#06090c'; ctx.fillRect(0, 0, W, H);
    if (!data) { ctx.fillStyle = '#6b7280'; ctx.font = '12px sans-serif'; ctx.fillText('Çalıştırın; sonra pinleri atayın.', 10, 20); return; }
    const x = (t: number) => ((t - view.a) / (view.b - view.a)) * W;
    const used = sigs.filter(([k]) => data.traces[k]);
    const laneH = (H - 26) / Math.max(used.length, 1);
    used.forEach(([k, label], li) => {
      const tr = data.traces[k]!;
      const top = 22 + li * laneH + 6, bot = 22 + (li + 1) * laneH - 6;
      ctx.strokeStyle = COLORS[li % COLORS.length]; ctx.lineWidth = 1.4; ctx.beginPath();
      let started = false, prevY = 0;
      for (let i = 0; i < tr.t.length; i++) {
        if (tr.t[i] > view.b && started && i > 0 && tr.t[i - 1] > view.b) break;
        if (tr.t[i] < view.a && tr.t[i + 1] !== undefined && tr.t[i + 1] < view.a) continue;
        const xx = x(tr.t[i]), yy = tr.v[i] ? top : bot;
        if (!started) { ctx.moveTo(xx, yy); started = true; } else { ctx.lineTo(xx, prevY); ctx.lineTo(xx, yy); }
        prevY = yy;
      }
      ctx.lineTo(W, prevY);
      ctx.stroke();
      ctx.fillStyle = COLORS[li % COLORS.length]; ctx.font = '10px sans-serif'; ctx.fillText(label, 4, top + 10);
    });
    // annotated frames
    ctx.font = '10px sans-serif';
    for (const f of result.frames) {
      if (f.t1 < view.a || f.t0 > view.b) continue;
      const x0 = x(f.t0), x1 = Math.max(x(f.t1), x0 + 2);
      ctx.fillStyle = frameColor(f) + '33'; ctx.fillRect(x0, 4, x1 - x0, H - 8);
      ctx.strokeStyle = frameColor(f); ctx.lineWidth = 1; ctx.strokeRect(x0, 4, x1 - x0, H - 8);
      if (x1 - x0 > 28) { ctx.save(); ctx.beginPath(); ctx.rect(x0, 4, x1 - x0, 16); ctx.clip(); ctx.fillStyle = '#e5e7eb'; ctx.fillText(f.text, x0 + 3, 15); ctx.restore(); }
    }
    ctx.fillStyle = '#6b7280';
    ctx.fillText(`${formatSI(view.a, 's')} … ${formatSI(view.b, 's')}`, W - 130, H - 3);
  }, [data, result, view, sigs]);

  const errors = result.frames.filter((f) => f.error).length;
  const setPin = (k: string, v: string) => setPins({ ...pins, [k]: v });
  return (
    <div className="flex h-full text-xs">
      <div className="w-60 shrink-0 border-r border-zinc-800 p-2 overflow-y-auto space-y-2">
        <div className="flex gap-1">
          {(['uart', 'i2c', 'spi'] as Proto[]).map((p) => <button key={p} onClick={() => setProto(p)} className={`${btn} flex-1 ${proto === p ? '!bg-emerald-800 !border-emerald-600' : ''}`}>{p === 'i2c' ? 'I²C' : p.toUpperCase()}</button>)}
        </div>
        <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Pinler (devreden)</div>
        {sigs.map(([k, label], i) => (
          <label key={k} className="flex items-center gap-1 text-zinc-400">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="w-10">{label}</span>
            <select className={`${sel} flex-1 min-w-0`} value={pins[k] ?? ''} onChange={(e) => setPin(k, e.target.value)}>
              <option value="">—</option>
              {pinOpts.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </label>
        ))}
        <label className="block text-zinc-400">Mantık eşiği (V)
          <input type="number" step="0.1" value={thr} onChange={(e) => setThr(Number(e.target.value))} className={`${sel} w-full`} />
        </label>
        {proto === 'uart' && (
          <>
            <label className="block text-zinc-400">Baud
              <select className={`${sel} w-full`} value={baud} onChange={(e) => setBaud(Number(e.target.value))}>
                <option value={0}>otomatik (en kısa darbe)</option>
                {[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600].map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
            <div className="flex gap-1">
              <select className={sel} value={dataBits} onChange={(e) => setDataBits(Number(e.target.value) as typeof dataBits)} title="Veri biti">{[5, 6, 7, 8, 9].map((b) => <option key={b} value={b}>{b} bit</option>)}</select>
              <select className={sel} value={parity} onChange={(e) => setParity(e.target.value as typeof parity)} title="Eşlik">{[['none', 'N (yok)'], ['even', 'E (çift)'], ['odd', 'O (tek)']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <select className={sel} value={stopBits} onChange={(e) => setStopBits(Number(e.target.value) as 1 | 2)} title="Dur biti">{[1, 2].map((b) => <option key={b} value={b}>{b} dur</option>)}</select>
            </div>
            <label className="flex items-center gap-1 text-zinc-400"><input type="checkbox" checked={lsb} onChange={(e) => setLsb(e.target.checked)} />Önce en düşük bit (LSB)</label>
            <label className="flex items-center gap-1 text-zinc-400"><input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />Ters hat (boşta düşük)</label>
            <div className="text-zinc-500">Biçim: {dataBits}{parity === 'none' ? 'N' : parity === 'even' ? 'E' : 'O'}{stopBits}{result.baud ? ` · ${Math.round(result.baud)} baud` : ''}</div>
          </>
        )}
        {proto === 'spi' && (
          <>
            <label className="block text-zinc-400">Mod (CPOL/CPHA)
              <select className={`${sel} w-full`} value={mode} onChange={(e) => setMode(Number(e.target.value) as typeof mode)}>
                {[0, 1, 2, 3].map((m) => <option key={m} value={m}>Mod {m} (CPOL {m >> 1}, CPHA {m & 1})</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1 text-zinc-400"><input type="checkbox" checked={msb} onChange={(e) => setMsb(e.target.checked)} />Önce en yüksek bit (MSB)</label>
            <label className="flex items-center gap-1 text-zinc-400"><input type="checkbox" checked={csLow} onChange={(e) => setCsLow(e.target.checked)} />CS aktif-düşük</label>
          </>
        )}
        <div className="text-[10px] text-zinc-500 uppercase tracking-wide pt-1">Görünüm</div>
        <label className="block text-zinc-400">Yakınlaştırma
          <select className={`${sel} w-full`} value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>{[1, 2, 5, 10, 20, 50].map((z) => <option key={z} value={z}>{z}×</option>)}</select>
        </label>
        <input type="range" min={0} max={1} step={0.001} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="w-full" disabled={zoom === 1} />
        <div className="text-zinc-600">Veri kaynağı: canlı çalıştırmanın kayıt tamponu (mantık analizörüyle aynı){run && data ? ` · ${run.t.length} örnek, adım ≈ ${formatSI(data.dt, 's')}` : ''}.</div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        {(warn || result.note) && <div className="px-2 py-1 text-amber-300 border-b border-zinc-800">{warn || result.note}</div>}
        <canvas ref={cv} className="w-full h-40 shrink-0 border-b border-zinc-800" />
        <div className="flex-1 overflow-auto p-2">
          <div className="text-zinc-500 mb-1">{result.frames.length} çerçeve{errors ? ` · ${errors} hata` : ''}</div>
          <table className="w-full">
            <thead><tr className="text-zinc-500 text-left"><th className="w-8">#</th><th className="w-24">Başlangıç</th><th className="w-24">Süre</th><th className="w-20">Tür</th><th>Çözüm</th></tr></thead>
            <tbody>
              {result.frames.map((f, i) => (
                <tr key={i} className={`border-t border-zinc-800 ${f.error ? 'text-red-300' : 'text-zinc-300'}`}>
                  <td className="text-zinc-600">{i + 1}</td><td>{formatSI(f.t0, 's', 4)}</td><td>{formatSI(f.t1 - f.t0, 's', 3)}</td><td>{f.type}</td><td className="font-mono">{f.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
