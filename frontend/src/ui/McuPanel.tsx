import { useEffect, useMemo, useRef, useState } from 'react';
import { useLab } from '../store/lab';
import { getDef } from '../library/components';
import { CodeEditor } from './CodeEditor';
import { TEMPLATES } from '../core/mcu/templates';
import { formatSI } from '../core/units';
import type { Diagnostic } from '../core/mcu/types';

const btn = 'px-2.5 py-1 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-800';
const EMPTY: Diagnostic[] = [];

/** MCU boards in the circuit + the one the tabs are showing. */
function useTarget() {
  const circuit = useLab((s) => s.circuit);
  const sel = useLab((s) => s.selection);
  const target = useLab((s) => s.mcuTarget);
  const boards = circuit.components.filter((c) => getDef(c.type).mcu);
  const selected = sel?.kind === 'comp' && boards.some((b) => b.id === sel.id) ? sel.id : null;
  const id = target && boards.some((b) => b.id === target) ? target : selected ?? boards[0]?.id ?? null;
  return { boards, comp: boards.find((b) => b.id === id) ?? null };
}

function BoardSelect() {
  const set = useLab((s) => s.set);
  const { boards, comp } = useTarget();
  return (
    <select value={comp?.id ?? ''} onChange={(e) => set({ mcuTarget: e.target.value })} className="bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-xs">
      {boards.map((b) => <option key={b.id} value={b.id}>{b.ref} — {getDef(b.type).name}</option>)}
    </select>
  );
}

const NoBoard = () => <div className="p-4 text-sm text-zinc-500">Devrede mikrodenetleyici kartı yok. Kütüphaneden Arduino Uno/Nano/Mega, ESP32 DevKit V1 veya Raspberry Pi Pico ekleyin (Mikrodenetleyici kategorisi). Diğer kartlar yalnızca kütüphane bilgisidir.</div>;

interface Toolchain { id: string; name: string; available: boolean; status: string }

export function CodeTab() {
  const s = useLab();
  const { comp } = useTarget();
  const [tools, setTools] = useState<Toolchain[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { void fetch('/api/mcu/toolchains').then((r) => (r.ok ? r.json() : null)).then((j) => setTools(Array.isArray(j) ? j : null)).catch(() => setTools(null)); }, []);
  if (!comp) return <NoBoard />;
  const def = getDef(comp.type);
  const spec = def.mcu!;
  const fw = s.circuit.firmware?.[comp.id];
  const kind = fw?.kind ?? 'sketch';
  const uf2Ok = def.type === 'mod_raspberry_pi_pico';
  const hexOk = def.type === 'mod_arduino_uno_r3' || def.type === 'mod_arduino_nano';
  const diags = s.diagnostics[comp.id] ?? EMPTY;
  const cli = tools?.find((t) => t.id === 'arduino-cli');
  const boardKey: Record<string, string> = { mod_arduino_uno_r3: 'uno', mod_arduino_nano: 'nano', mod_arduino_mega_2560: 'mega', mod_esp32_devkit_v1: 'esp32', mod_raspberry_pi_pico: 'pico' };

  const compile = async () => {
    if (!fw) return;
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/mcu/compile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ board: boardKey[def.type], source: kind === 'sketch' ? fw.source : '' }) });
      const j = await r.json();
      if (r.status === 503) { setMsg('Sunucuda arduino-cli kurulu değil: gerçek derleme yapılamadı.'); return; }
      if (!r.ok) { setMsg(`Hata ${r.status}: ${JSON.stringify(j.detail ?? j)}`); return; }
      s.set({ diagnostics: { ...s.diagnostics, [comp.id]: (j.diagnostics ?? []).map((d: { line: number | null; message: string; severity: 'error' | 'warning' }) => ({ line: d.line ?? 1, message: d.message, severity: d.severity })) } });
      if (j.ok && j.uf2_b64 && uf2Ok) { s.setFirmware(comp.id, { kind: 'uf2', source: j.uf2_b64 }); setMsg('Derlendi: UF2 RP2040 emülatörüne hazır (Derlenmiş firmware’ı çalıştır).'); }
      else if (j.ok && j.hex) { s.setFirmware(comp.id, { kind: 'hex', source: j.hex }); setMsg('Derlendi: HEX AVR emülatörüne hazır (Yükle).'); }
      else if (j.ok) setMsg(`Derlendi (${j.artifact ?? 'çıktı'}), ancak bu kart için emülatör yok: yalnızca derleme doğrulandı.`);
      else setMsg('Derleme hatası (altta).');
    } catch (e) { setMsg(`Sunucuya ulaşılamadı: ${(e as Error).message}`); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-zinc-800 flex-wrap">
        <BoardSelect />
        <select value={kind} onChange={(e) => s.setFirmware(comp.id, { kind: e.target.value as 'sketch' | 'hex' | 'uf2', source: e.target.value === 'hex' || e.target.value === 'uf2' ? '' : (fw?.kind === 'sketch' ? fw.source : TEMPLATES[0].code) })} className="bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-xs">
          <option value="sketch">Arduino sketch (yorumlayıcı)</option>
          <option value="uf2" disabled={!uf2Ok}>Derlenmiş UF2 (RP2040 emülatörü){uf2Ok ? '' : ' — bu kartta yok'}</option>
          <option value="hex" disabled={!hexOk}>Derlenmiş HEX (AVR emülatörü){hexOk ? '' : ' — bu kartta yok'}</option>
        </select>
        <select value="" onChange={(e) => { const t = TEMPLATES.find((x) => x.id === e.target.value); if (t) s.setFirmware(comp.id, { kind: 'sketch', source: t.code }); }} className="bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-xs">
          <option value="">Örnek kod ekle…</option>
          {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button className={btn} onClick={() => s.checkFirmware(comp.id)} disabled={!fw}>{kind === 'hex' ? 'HEX doğrula' : kind === 'uf2' ? 'UF2 doğrula' : 'Çözümle'}</button>
        <button className={`${btn} !bg-emerald-800 !border-emerald-600`} onClick={() => s.loadFirmware(comp.id)} disabled={!fw} title="Çalışıyorsa karta yükler ve yeniden başlatır; durmuşsa yalnızca doğrular. Çalıştır ile başlatın.">⬆ Yükle</button>
        <button className={btn} onClick={compile} disabled={!fw || busy || !cli?.available || kind === 'hex' || kind === 'uf2'} title={cli?.available ? 'Sunucudaki arduino-cli ile gerçek derleme' : 'arduino-cli kurulu değil (sunucu)'}>{busy ? 'Derleniyor…' : 'Derle (arduino-cli)'}</button>
        {kind === 'uf2' && fw && <button className={`${btn} !bg-emerald-800 !border-emerald-600`} onClick={() => { if (s.checkFirmware(comp.id)) { s.loadFirmware(comp.id); if (s.simStatus !== 'running') s.run(); } }} disabled={!fw.source} title="UF2’yi rp2040js emülatörüne yükler ve simülasyonu başlatır">▶ Derlenmiş firmware’ı çalıştır</button>}
        <span className="text-[11px] text-zinc-500">{spec.family.toUpperCase()} · {spec.vcc} V · int={spec.intBits} bit</span>
        {msg && <span className="text-[11px] text-amber-300">{msg}</span>}
      </div>
      {!fw ? (
        <div className="p-4 text-sm text-zinc-400 space-y-2">
          <div>Bu kart için yazılım yok.</div>
          <button className={btn} onClick={() => s.setFirmware(comp.id, { kind: 'sketch', source: TEMPLATES[0].code })}>Blink örneğiyle başla</button>
          <div className="text-xs text-zinc-500 max-w-xl">Sketch yorumlayıcısı Arduino C++ alt kümesini (pinMode/digitalWrite/analogRead/analogWrite/Serial/delay…) simüle zaman üzerinde çalıştırır; gerçek derleyici/emülatör değildir. Uno/Nano için gerçek derlenmiş HEX, avr8js AVR emülatöründe çalıştırılabilir. I2C/SPI/Wi-Fi çağrıları desteklenmez ve uyarı verir.</div>
        </div>
      ) : kind === 'uf2' ? (
        <div className="flex-1 min-h-0 p-2">
          <div className="text-xs text-zinc-400 mb-1">Derlenmiş Raspberry Pi Pico UF2 (base64). Önce sketch’i “Derle (arduino-cli)” ile derleyin; UF2 buraya gelir. rp2040js tek çekirdek Cortex-M0+ çalıştırır; gerçek bootrom yoktur (ROM yardımcıları taklit edilir), USB/PIO/ikinci çekirdek/I2C/SPI modellenmez, Serial1 = UART0. Sketch’e dönmek için yukarıdan “Arduino sketch” seçin.</div>
          <textarea value={fw.source} onChange={(e) => s.setFirmware(comp.id, { kind: 'uf2', source: e.target.value })} className="w-full h-[calc(100%-4rem)] bg-zinc-950 border border-zinc-700 rounded p-2 font-mono text-[11px]" placeholder="VUYyCh5XXZ4…" spellCheck={false} />
        </div>
      ) : kind === 'hex' ? (
        <div className="flex-1 min-h-0 p-2">
          <div className="text-xs text-zinc-400 mb-1">Arduino IDE’den (Taslak → Derlenmiş ikili dosyayı dışa aktar) alınan Intel HEX içeriğini yapıştırın. ATmega328P (Uno/Nano) gerçek makine kodu emülasyonu.</div>
          <textarea value={fw.source} onChange={(e) => s.setFirmware(comp.id, { kind: 'hex', source: e.target.value })} className="w-full h-[calc(100%-1.5rem)] bg-zinc-950 border border-zinc-700 rounded p-2 font-mono text-[11px]" placeholder=":100000000C945C00…" spellCheck={false} />
        </div>
      ) : (
        <div className="flex-1 min-h-0"><CodeEditor value={fw.source} onChange={(v) => s.setFirmware(comp.id, { kind: 'sketch', source: v })} diagnostics={diags} /></div>
      )}
      {diags.length > 0 && (
        <div className="max-h-20 overflow-y-auto border-t border-zinc-800 px-2 py-1 text-[11px] font-mono">
          {diags.map((d, i) => <div key={i} className={d.severity === 'error' ? 'text-red-400' : 'text-amber-300'}>satır {d.line}: {d.message}</div>)}
        </div>
      )}
    </div>
  );
}

export function SerialTab() {
  const s = useLab();
  const { comp } = useTarget();
  const [input, setInput] = useState('');
  const [plot, setPlot] = useState(false);
  const box = useRef<HTMLPreElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = comp ? s.serial[comp.id] ?? '' : '';
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [text]);
  const series = useMemo(() => {
    if (!plot) return [] as number[][];
    const lines = text.split('\n').slice(-300);
    const out: number[][] = [];
    for (const l of lines) {
      const nums = l.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
      if (nums && nums.length) nums.forEach((n, k) => { (out[k] ??= []).push(n); });
    }
    return out.slice(0, 4);
  }, [text, plot]);
  useEffect(() => {
    const cv = canvas.current;
    if (!plot || !cv) return;
    const r = cv.getBoundingClientRect();
    cv.width = r.width; cv.height = r.height;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#06090c'; ctx.fillRect(0, 0, r.width, r.height);
    const all = series.flat();
    if (!all.length) return;
    const lo = Math.min(...all), hi = Math.max(...all, lo + 1e-9);
    const colors = ['#facc15', '#22d3ee', '#f472b6', '#4ade80'];
    series.forEach((ser, k) => {
      ctx.strokeStyle = colors[k]; ctx.beginPath();
      ser.forEach((v, i) => { const x = (i / Math.max(ser.length - 1, 1)) * r.width, y = r.height - 6 - ((v - lo) / (hi - lo)) * (r.height - 12); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    });
    ctx.fillStyle = '#9ca3af'; ctx.font = '10px sans-serif'; ctx.fillText(`${hi}`, 4, 10); ctx.fillText(`${lo}`, 4, r.height - 2);
  }, [series, plot]);
  if (!comp) return <NoBoard />;
  const send = () => { s.serialSend(comp.id, input + '\n'); setInput(''); };
  return (
    <div className="flex flex-col h-full p-2 gap-1">
      <div className="flex items-center gap-2 text-xs">
        <BoardSelect />
        <button className={btn} onClick={() => s.clearSerial(comp.id)}>Temizle</button>
        <label className="flex items-center gap-1 text-zinc-400"><input type="checkbox" checked={plot} onChange={(e) => setPlot(e.target.checked)} />Seri çizici (sayıları çiz)</label>
        <span className="text-zinc-600">Baud hızı simüle edilmez (karakterler anında gelir).</span>
      </div>
      <div className="flex-1 min-h-0 flex gap-2">
        <pre ref={box} className="flex-1 overflow-auto bg-zinc-950 border border-zinc-800 rounded p-2 text-[11px] font-mono text-emerald-300 whitespace-pre-wrap">{text || 'Seri çıktı yok. Çalıştır’a basın; sketch Serial.begin()/println() kullanmalı.'}</pre>
        {plot && <canvas ref={canvas} className="flex-1 bg-zinc-950 border border-zinc-800 rounded" />}
      </div>
      <div className="flex gap-1">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} placeholder="Karta gönder (Enter)" className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs font-mono" />
        <button className={btn} onClick={send}>Gönder</button>
      </div>
    </div>
  );
}

export function GpioTab() {
  const live = useLab((s) => s.live);
  const { comp } = useTarget();
  if (!comp) return <NoBoard />;
  const def = getDef(comp.type);
  const spec = def.mcu!;
  const r = live?.comps[comp.id];
  const gpio = live?.gpio[comp.id];
  const dead = new Set(live?.deadPins[comp.id] ?? []);
  const num = new Map(Object.entries(spec.pinMap).map(([n, pin]) => [pin, Number(n)]));
  const rows = gpio ?? [];
  return (
    <div className="h-full overflow-auto p-2 text-xs">
      <div className="flex gap-3 items-center mb-2"><BoardSelect />
        {r && spec.supplies.map((sp) => <span key={sp.pin} className="text-zinc-300">{sp.label}: <b>{formatSI(r.vals[`v_${sp.pin}`] ?? 0, 'V')}</b> / {formatSI(r.vals[`i_${sp.pin}`] ?? 0, 'A')}</span>)}
      </div>
      {!rows.length && <div className="text-zinc-500">GPIO tablosu için firmware yükleyip Çalıştır’a basın. (Firmware olmayan kartın pinleri yüksek empedanslıdır.)</div>}
      <table className="w-full"><thead><tr className="text-left text-zinc-500"><th>Pin</th><th>No</th><th>Mod</th><th>Seviye</th><th>PWM</th><th>V (pin)</th><th>I</th></tr></thead><tbody>
        {rows.filter((g) => g.mode !== 'unconfigured' || (r?.vals[`v_${g.pin}`] ?? 0) > 0.1).map((g) => {
          const v = r?.vals[`v_${g.pin}`] ?? 0, i = r?.vals[`i_${g.pin}`] ?? 0;
          const bad = dead.has(g.pin) || Math.abs(i) > spec.imaxPin;
          return (
            <tr key={g.pin} className={`border-t border-zinc-800 ${bad ? 'text-red-300' : ''}`}>
              <td className="py-0.5 font-semibold">{g.pin}{dead.has(g.pin) ? ' ☠' : ''}</td><td>{num.get(g.pin) ?? '—'}</td><td>{g.mode}</td>
              <td>{g.mode === 'out' || g.mode === 'pwm' ? (g.high ? 'HIGH' : 'LOW') : v >= spec.vcc * 0.6 ? 'H' : v <= spec.vcc * 0.3 ? 'L' : '?'}</td>
              <td>{g.duty !== undefined ? `${(g.duty * 100).toFixed(0)} %` : ''}</td><td>{formatSI(v, 'V')}</td><td>{formatSI(i, 'A')}</td>
            </tr>
          );
        })}
      </tbody></table>
    </div>
  );
}
