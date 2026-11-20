import { useEffect, useMemo, useRef, useState } from 'react';
import { useLab, WIRE_COLORS } from '../store/lab';
import { COMPONENTS, getDef } from '../library/components';
import { categoriesInUse, searchParts, simOf } from '../library/search';
import type { Category } from '../library/types';
import { Workspace } from '../three/Workspace';
import { Scope, Measurements, LogView } from './Instruments';
import { FailuresView, FaultSection, ThermalSection } from './FaultPanel';
import { CodeTab, GpioTab, SerialTab } from './McuPanel';
import { LessonPanel } from './LessonPanel';
import { DevicesTab } from './Devices';
import { ProtocolTab } from './Protocol';
import { AssistantTab } from './Assistant';
import { AnalysisTab } from './Analysis';
import { liveHints } from '../core/hints';
import { thermalColor } from '../core/thermal/thermal';
import { bomCsv, download, parseProjectFile, saveProject, toProjectFile } from '../store/persist';
import { getDict } from '../i18n';
import { formatSI, parseSI } from '../core/units';
import type { ComponentDef } from '../library/types';
import type { PlacedComponent } from '../core/circuit/types';
import type { AlignMode } from '../core/circuit/selection';

const btn = 'px-2.5 py-1 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-800';
const primary = 'px-3 py-1 rounded text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white';

function Resizer({ dir, onDelta }: { dir: 'h' | 'v'; onDelta: (d: number) => void }) {
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    let last = dir === 'h' ? e.clientX : e.clientY;
    const move = (ev: PointerEvent) => {
      const cur = dir === 'h' ? ev.clientX : ev.clientY;
      onDelta(cur - last); last = cur;
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return <div onPointerDown={down} className={`${dir === 'h' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'} bg-zinc-800 hover:bg-emerald-600 shrink-0`} />;
}

function Toolbar() {
  const s = useLab();
  const t = getDict(s.lang);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500); };
  const save = async () => {
    try {
      const r = await saveProject(s.projectId, s.projectName, s.circuit, s.projectSource);
      s.set({ projectId: r.id, projectSource: r.source, dirty: false });
      flash(`Kaydedildi (${r.source === 'backend' ? 'sunucu' : 'yerel'})`);
    } catch (e) { flash('Kayıt hatası: ' + (e as Error).message); }
  };
  return (
    <div className="flex items-center gap-2 px-3 h-11 border-b border-zinc-800 bg-zinc-900 shrink-0 flex-wrap">
      <button className={btn} onClick={() => s.go('home')}>← {t.home}</button>
      <button className={btn} onClick={() => s.go('schematic')} title="2D şematik (aynı devre)">Şematik</button>
      <button className={btn} onClick={() => s.go('pcb')} title="PCB tasarımı">PCB</button>
      <input value={s.projectName} onChange={(e) => s.set({ projectName: e.target.value, dirty: true })} className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm w-44" />
      <button className={btn} onClick={save}>{t.save}{s.dirty ? ' •' : ''}</button>
      <span className="w-px h-5 bg-zinc-700" />
      {s.simStatus === 'running'
        ? <button className="px-3 py-1 rounded text-xs font-semibold bg-red-600 hover:bg-red-500" onClick={s.stopSim}>■ {t.stop}</button>
        : <button className={primary} onClick={s.run}>▶ {t.run}</button>}
      <button className={btn} onClick={s.resetSim}>⟲ {t.reset}</button>
      <button className={btn} onClick={s.dcSolve} title="Kaynakları sabit değerde tutarak DC çalışma noktasını çözer">{t.dcSolve}</button>
      <label className="text-xs text-zinc-400 flex items-center gap-1">{t.speed}
        <select value={s.simSpeed} onChange={(e) => s.setSpeed(Number(e.target.value))} className="bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5">
          {[0.0001, 0.001, 0.01, 0.1, 1].map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </label>
      <span className="w-px h-5 bg-zinc-700" />
      <button className={btn} onClick={s.undo} disabled={!s.past.length}>↶ {t.undo}</button>
      <button className={btn} onClick={s.redo} disabled={!s.future.length}>↷ {t.redo}</button>
      <span className="w-px h-5 bg-zinc-700" />
      <button className={btn} onClick={() => download(`${s.projectName}.electrolab.json`, toProjectFile(s.projectName, s.circuit))}>{t.export} JSON</button>
      <button className={btn} onClick={() => fileRef.current?.click()}>{t.import}</button>
      <input ref={fileRef} type="file" accept=".json" hidden onChange={async (e) => {
        const f = e.target.files?.[0]; if (!f) return;
        try { const p = parseProjectFile(await f.text()); s.loadCircuit(p.circuit, p.name); flash('İçe aktarıldı'); } catch (err) { flash((err as Error).message); }
        e.target.value = '';
      }} />
      <button className={btn} onClick={() => download(`${s.projectName}-bom.csv`, bomCsv(s.circuit), 'text/csv')}>{t.bom}</button>
      {s.multi.length >= 2 && <AlignBar />}
      <div className="flex-1" />
      <button className={`${btn} ${s.thermalView ? '!bg-orange-700 !border-orange-500' : ''}`} onClick={() => s.set({ thermalView: !s.thermalView })} title="Termal kamera görünümü">🌡 Isıl kamera</button>
      <label className="text-xs text-zinc-400 flex items-center gap-1" title="Ortam sıcaklığı">Ortam
        <input type="number" value={s.circuit.ambient ?? 25} onChange={(e) => s.setAmbient(Number(e.target.value))} className="w-14 bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5" />°C
      </label>
      <label className="text-xs text-zinc-400 flex items-center gap-1" title="Isıl saniye / benzetim saniyesi">Isıl hız ×
        <select value={s.thermalSpeed} onChange={(e) => s.setThermalSpeed(Number(e.target.value))} className="bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5">
          {[1, 10, 100, 1000, 10000, 100000].map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </label>
      <label className="text-xs text-zinc-400 flex items-center gap-1" title="Aşırı yüklenen parçalar gerçekten arızalanır"><input type="checkbox" checked={s.damageEnabled} onChange={(e) => s.setDamageEnabled(e.target.checked)} />Hasar uygula</label>
      <label className="text-xs text-zinc-400 flex items-center gap-1"><input type="checkbox" checked={s.showLabels} onChange={(e) => s.set({ showLabels: e.target.checked })} />{t.labels}</label>
      <label className="text-xs text-zinc-400 flex items-center gap-1" title="Kabloları parça gövdelerinden kaçınan dik açılı yollarla çiz"><input type="checkbox" checked={s.autoRoute} onChange={(e) => s.setAutoRoute(e.target.checked)} />Oto. kablo</label>
      <label className="text-xs text-zinc-400 flex items-center gap-1"><input type="checkbox" checked={s.showVoltage} onChange={(e) => s.set({ showVoltage: e.target.checked })} />{t.voltageTags}</label>
      <label className="text-xs text-zinc-400 flex items-center gap-1">{t.grid}
        <select value={s.grid} onChange={(e) => s.set({ grid: Number(e.target.value) })} className="bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5">
          {[0, 0.25, 0.5, 1].map((v) => <option key={v} value={v}>{v === 0 ? 'kapalı' : `${v} cm`}</option>)}
        </select>
      </label>
      {(['left', 'right', 'bottom'] as const).map((k) => (
        <button key={k} className={btn} onClick={() => s.set({ panels: { ...s.panels, [k]: !s.panels[k] } })}>{k === 'left' ? '◧' : k === 'right' ? '◨' : '⬓'}</button>
      ))}
      {msg && <span className="text-xs text-emerald-400">{msg}</span>}
    </div>
  );
}

const ALIGN_BTNS: [AlignMode, string, string][] = [['left', '⇤', 'Sola hizala'], ['hcenter', '⇔', 'Yatay ortala'], ['right', '⇥', 'Sağa hizala'], ['top', '⤒', 'Üste hizala'], ['vcenter', '⇕', 'Dikey ortala'], ['bottom', '⤓', 'Alta hizala']];

/** align / distribute buttons, shown while 2+ parts are selected */
function AlignBar() {
  const s = useLab();
  return (
    <div className="flex items-center gap-1" title={`${s.multi.length} parça seçili`}>
      <span className="w-px h-5 bg-zinc-700" />
      {ALIGN_BTNS.map(([m, ic, tip]) => <button key={m} className={btn} title={tip} onClick={() => s.alignSelected(m)}>{ic}</button>)}
      <button className={btn} title="Yatayda eşit dağıt" disabled={s.multi.length < 3} onClick={() => s.distributeSelected('x')}>⇹</button>
      <button className={btn} title="Dikeyde eşit dağıt" disabled={s.multi.length < 3} onClick={() => s.distributeSelected('z')}>⥮</button>
    </div>
  );
}

function LibraryPanel() {
  const s = useLab();
  const t = getDict(s.lang);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Category | 'all'>('all');
  const list = useMemo(() => searchParts(q, cat), [q, cat, s.libVersion]);
  const cats = categoriesInUse();
  return (
    <div className="flex flex-col h-full bg-zinc-900">
      <div className="p-2 border-b border-zinc-800 space-y-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t.search} (${COMPONENTS.length})`} className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm" />
        <div className="flex gap-1 flex-wrap">
          {(['all', ...cats] as const).map((c) => (
            <button key={c} onClick={() => setCat(c)} className={`px-2 py-0.5 rounded text-[11px] ${cat === c ? 'bg-emerald-700 text-white' : 'bg-zinc-800 text-zinc-300'}`}>
              {c === 'all' ? t.all : (t.category as Record<string, string>)[c] ?? c}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {list.map((c: ComponentDef) => (
          <div
            key={c.type} draggable
            onDragStart={(e) => { e.dataTransfer.setData('application/x-electrolab', c.type); e.dataTransfer.effectAllowed = 'copy'; }}
            onClick={() => s.arm(s.armedType === c.type ? null : c.type)}
            className={`px-2 py-1.5 rounded border cursor-grab text-sm ${s.armedType === c.type ? 'border-cyan-400 bg-cyan-950/40' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'}`}
            title={c.description}
          >
            <div className="flex justify-between gap-2"><span className="truncate">{s.lang === 'tr' ? c.name : c.nameEn}</span><span className="text-zinc-500 text-xs shrink-0">{c.prefix}</span></div>
            <div className="flex justify-between text-[10px] text-zinc-500"><span className="truncate">{[c.manufacturer, c.package].filter(Boolean).join(' · ')}</span>{simOf(c) !== 'full' && <span className={simOf(c) === 'none' ? 'text-zinc-500' : 'text-amber-400/80'}>{simOf(c) === 'none' ? 'model yok' : 'kısmi'}</span>}</div>
          </div>
        ))}
        {!list.length && <div className="text-xs text-zinc-500 p-2">Sonuç yok.</div>}
      </div>
      <div className="p-2 text-[11px] text-zinc-500 border-t border-zinc-800">
        Sürükle-bırak ya da tıkla → sahneye tıkla. Pinlere sırayla tıklayarak kablo çek. Çift tık: anahtar/buton.
        {s.armedType && <div className="text-cyan-300">Yerleştirme modu: sahneye tıklayın (Shift: tekrar). Esc: iptal.</div>}
      </div>
    </div>
  );
}

function ParamField({ id, ids, p, value }: { id: string; ids?: string[]; p: ComponentDef['params'][number]; value: number | string | boolean }) {
  const setOne = useLab((s) => s.setParam);
  const setMany = useLab((s) => s.setParamMulti);
  const set = (_id: string, key: string, v: number | string | boolean) => (ids ? setMany(ids, key, v) : setOne(_id, key, v));
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  if (p.type === 'boolean') return <input type="checkbox" checked={value === true} onChange={(e) => set(id, p.key, e.target.checked)} />;
  if (p.type === 'select') {
    return (
      <select value={String(value)} onChange={(e) => set(id, p.key, e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-sm">
        {p.options!.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    );
  }
  const shown = editing ? text : p.si ? formatSI(Number(value), '') : String(value);
  const commit = () => {
    setEditing(false);
    const v = parseSI(text);
    if (v === null || !Number.isFinite(v)) return;
    const lo = p.min ?? -Infinity, hi = p.max ?? Infinity;
    set(id, p.key, Math.min(Math.max(v, lo), hi));
  };
  return (
    <div className="flex items-center gap-1">
      <input
        value={shown}
        onFocus={() => { setEditing(true); setText(p.si ? formatSI(Number(value), '') : String(value)); }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="w-full bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-sm"
        title="SI önekleri: 4.7k, 100n, 10u, 2.2m"
      />
      <span className="text-xs text-zinc-500 w-8">{p.unit}</span>
    </div>
  );
}

export function Inspector({ schematic }: { schematic?: boolean } = {}) {
  const s = useLab();
  const t = getDict(s.lang);
  const sel = s.selection;
  if (s.multi.length >= 2) {
    const parts = s.multi.map((id) => s.circuit.components.find((x) => x.id === id)).filter((x): x is PlacedComponent => !!x);
    const sameType = parts.length > 0 && parts.every((x) => x.type === parts[0].type);
    const def = sameType ? getDef(parts[0].type) : null;
    return (
      <div className="p-3 space-y-3 text-sm overflow-y-auto h-full">
        <div className="font-semibold">{parts.length} parça seçili</div>
        <div className="text-xs text-zinc-400">{parts.map((x) => x.ref).join(', ')}</div>
        {def ? (
          <div className="space-y-2">
            <div className="text-xs text-zinc-500">Ortak parametreler ({s.lang === 'tr' ? def.name : def.nameEn}): değişiklik tüm seçili parçalara uygulanır.</div>
            {def.params.map((p) => {
              const vals = parts.map((x) => x.params[p.key] ?? p.default);
              const same = vals.every((v) => v === vals[0]);
              return (
                <label key={p.key} className="block text-xs text-zinc-400">{p.label}{!same && <span className="text-amber-400"> (farklı)</span>}
                  <ParamField key={same ? 'same' : 'mixed'} id={parts[0].id} ids={s.multi} p={p} value={vals[0]} />
                </label>
              );
            })}
          </div>
        ) : <div className="text-xs text-zinc-500">Seçili parçalar farklı türde: ortak parametre düzenlenemez.</div>}
        <div className="flex gap-2 flex-wrap">
          {!schematic && <button className={btn} onClick={s.rotateSelected}>{t.rotate}</button>}
          <button className={btn} onClick={s.duplicateSelected}>{t.duplicate}</button>
          <button className={btn} onClick={s.deleteSelected}>{t.delete}</button>
          <button className={btn} onClick={s.clearMulti}>Seçimi bırak</button>
        </div>
        {!schematic && <div className="flex gap-1 flex-wrap items-center text-xs text-zinc-400">Hizala:
          {ALIGN_BTNS.map(([m, ic, tip]) => <button key={m} className={btn} title={tip} onClick={() => s.alignSelected(m)}>{ic}</button>)}
          <button className={btn} title="Yatayda eşit dağıt" disabled={parts.length < 3} onClick={() => s.distributeSelected('x')}>⇹</button>
          <button className={btn} title="Dikeyde eşit dağıt" disabled={parts.length < 3} onClick={() => s.distributeSelected('z')}>⥮</button>
        </div>}
      </div>
    );
  }
  if (!sel) return <div className="p-3 text-sm text-zinc-500">{t.noSelection}</div>;
  if (sel.kind === 'wire') {
    const w = s.circuit.wires.find((x) => x.id === sel.id);
    if (!w) return null;
    return (
      <div className="p-3 space-y-3 text-sm">
        <div className="font-semibold">Kablo</div>
        <div className="text-zinc-400 text-xs">{w.a.comp}.{w.a.pin} ↔ {w.b.comp}.{w.b.pin}</div>
        <div className="flex gap-1.5 flex-wrap">
          {WIRE_COLORS.map((c) => <button key={c} onClick={() => s.setWireStyle(w.id, { color: c })} style={{ background: c }} className={`w-6 h-6 rounded border-2 ${w.color === c ? 'border-white' : 'border-zinc-700'}`} />)}
        </div>
        <label className="text-xs text-zinc-400 block">{t.wireWidth}: {w.width}
          <input type="range" min={1} max={8} value={w.width} onChange={(e) => s.setWireStyle(w.id, { width: Number(e.target.value) })} className="w-full" />
        </label>
        <label className="text-xs text-amber-300 flex items-center gap-2"><input type="checkbox" checked={w.broken ?? false} onChange={(e) => s.setWireBroken(w.id, e.target.checked)} />Kopuk kablo (arıza: iletmez)</label>
        <div className="text-xs space-y-1">
          <label className="text-amber-300 flex items-center gap-2"><input type="checkbox" checked={!!w.loose} onChange={(e) => s.setWireLoose(w.id, e.target.checked ? { rmax: 1000 } : null)} />Gevşek konnektör (arıza)</label>
          {w.loose && (
            <label className="text-zinc-400 block">Maks. temas direnci (Ω)
              <input className="w-full bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-sm" defaultValue={w.loose.rmax ?? 1000} onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n > 0.1) s.setWireLoose(w.id, { rmax: n }); }} />
            </label>
          )}
          <div className="text-zinc-600">Temas direnci 0.05 Ω ile bu değer arasında rastgele değişir (kablo kimliğinden tohumlanan, tekrarlanabilir), ara sıra tamamen açılır; yük geriliminde ani düşüşler görülür.</div>
        </div>
        <button className={btn} onClick={s.deleteSelected}>{t.delete}</button>
      </div>
    );
  }
  const c = s.circuit.components.find((x) => x.id === sel.id);
  if (!c) return null;
  const def = getDef(c.type);
  const r = s.live?.comps[c.id];
  const stress = s.live?.stress.filter((x) => x.comp === c.id) ?? [];
  return (
    <div className="p-3 space-y-3 text-sm overflow-y-auto h-full">
      <div>
        <div className="font-semibold">{c.ref} — {s.lang === 'tr' ? def.name : def.nameEn}</div>
        <div className="text-xs text-zinc-400 mt-1">{def.description}</div>
      </div>
      <div className="space-y-2">
        {def.params.map((p) => (
          <label key={p.key} className="block text-xs text-zinc-400">{p.label}
            <ParamField id={c.id} p={p} value={c.params[p.key] ?? p.default} />
          </label>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap">
        {!schematic && <button className={btn} onClick={s.rotateSelected}>{t.rotate}</button>}
        <button className={btn} onClick={s.duplicateSelected}>{t.duplicate}</button>
        <button className={btn} onClick={s.deleteSelected}>{t.delete}</button>
      </div>
      {r && (
        <div className="rounded border border-zinc-800 bg-zinc-950 p-2 text-xs space-y-0.5">
          <div className="text-zinc-400 font-semibold mb-1">Anlık değerler {s.live && s.live.t > 0 ? `(t=${formatSI(s.live.t, 's')})` : '(DC)'}</div>
          <div>V: <b>{formatSI(r.v, 'V')}</b></div>
          <div>I: <b>{formatSI(r.i, 'A')}</b></div>
          <div>P: <b>{formatSI(r.p, 'W')}</b> {r.p < 0 && <span className="text-emerald-400">(üretiyor)</span>}</div>
          {Object.entries(r.vals).map(([k, v]) => <div key={k}>{k}: <b>{formatSI(v, k.startsWith('v') ? 'V' : k.startsWith('i') ? 'A' : '')}</b></div>)}
        </div>
      )}
      <ThermalSection comp={c} />
      <FaultSection comp={c} />
      {stress.map((x) => (
        <div key={x.key} className="rounded border border-red-700 bg-red-950/40 p-2 text-xs text-red-200">
          <b>{t.exceeded}:</b> {x.label} — {x.value.toPrecision(3)} {x.unit} &gt; {x.limit} {x.unit} ({x.ratio.toFixed(1)}×)
          <div className="text-red-300/70 mt-1">Bu yalnızca sınır aşımı uyarısıdır; gerçek arıza süresi tahmini henüz yoktur.</div>
        </div>
      ))}
      <details className="text-xs text-zinc-400">
        <summary className="cursor-pointer">{t.missingData} / {t.dataSource}</summary>
        <div className="mt-1">{t.genericModel}</div>
        <ul className="list-disc ml-4 mt-1">{def.missing.map((m) => <li key={m}>{m}</li>)}</ul>
      </details>
    </div>
  );
}

function Bottom() {
  const s = useLab();
  const t = getDict(s.lang);
  const tabs: [typeof s.bottomTab, string][] = [['scope', t.scope], ['meas', t.measurements], ['devices', 'Cihazlar'], ['protocol', 'Protokol çözücü'], ['assistant', '🤖 Asistan'], ['analysis', 'Monte Carlo / Gürültü'], ['faults', `Arızalar${s.failures.length ? ` (${s.failures.length})` : ''}`], ['code', 'Kod'], ['serial', t.serial], ['gpio', 'GPIO'], ['log', t.log]];
  return (
    <div className="flex flex-col h-full bg-zinc-900">
      <div className="flex items-center gap-1 px-2 border-b border-zinc-800 h-8 shrink-0">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => s.set({ bottomTab: k })} className={`px-3 py-1 text-xs rounded-t ${s.bottomTab === k ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`}>{label}</button>
        ))}
        <div className="flex-1" />
        <span className={`text-xs ${s.simStatus === 'running' ? 'text-emerald-400' : s.simStatus === 'error' ? 'text-red-400' : 'text-zinc-500'}`}>
          ● {s.simStatus === 'running' ? `çalışıyor t=${formatSI(s.live?.t ?? 0, 's')}` : s.simStatus === 'error' ? 'hata' : 'durdu'}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        {s.bottomTab === 'scope' && <Scope />}
        {s.bottomTab === 'meas' && <Measurements />}
        {s.bottomTab === 'devices' && <DevicesTab />}
        {s.bottomTab === 'protocol' && <ProtocolTab />}
        {s.bottomTab === 'assistant' && <AssistantTab />}
        {s.bottomTab === 'analysis' && <AnalysisTab />}
        {s.bottomTab === 'faults' && <FailuresView />}
        {s.bottomTab === 'code' && <CodeTab />}
        {s.bottomTab === 'serial' && <SerialTab />}
        {s.bottomTab === 'gpio' && <GpioTab />}
        {s.bottomTab === 'log' && <LogView />}
      </div>
    </div>
  );
}

export function HintBar() {
  const circuit = useLab((x) => x.circuit);
  const pending = useLab((x) => x.pendingPin);
  const select = useLab((x) => x.select);
  const [open, setOpen] = useState(true);
  const hints = useMemo(() => liveHints(circuit), [circuit]);
  if (circuit.components.length === 0) return null;
  const errs = hints.filter((h) => h.severity === 'error').length;
  const warns = hints.filter((h) => h.severity === 'warning').length;
  const tone = errs ? 'border-red-700 text-red-200' : warns ? 'border-amber-700 text-amber-200' : 'border-emerald-800 text-emerald-300';
  return (
    <div className="absolute left-3 top-3 max-w-sm z-10 text-[11px] space-y-1">
      <button onClick={() => setOpen(!open)} className={`rounded border bg-black/75 px-2 py-0.5 ${tone}`}>
        {errs ? `✖ ${errs} hata` : warns ? `⚠ ${warns} uyarı` : hints.length ? `ℹ ${hints.length} ipucu` : '✓ bağlantılar tutarlı'}{open ? ' ▾' : ' ▸'}
      </button>
      {pending && <div className="rounded border border-sky-700 bg-black/75 text-sky-200 px-2 py-1">Telin diğer ucu için ikinci pini seçin (Esc: iptal).</div>}
      {open && hints.slice(0, 6).map((h, i) => (
        <div key={i} onClick={() => h.comp && select({ kind: 'comp', id: h.comp })} className={`rounded border bg-black/75 px-2 py-1 cursor-pointer ${h.severity === 'error' ? 'border-red-800 text-red-200' : h.severity === 'warning' ? 'border-amber-800 text-amber-200' : 'border-zinc-700 text-zinc-300'}`}>
          {h.severity === 'error' ? '✖ ' : h.severity === 'warning' ? '⚠ ' : '💡 '}{h.message}
        </div>
      ))}
    </div>
  );
}

function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  useEffect(() => { const f = () => setOpen((o) => !o); window.addEventListener('lab-help', f); return () => window.removeEventListener('lab-help', f); }, []);
  if (!open) return <button onClick={() => setOpen(true)} className="absolute right-3 bottom-3 z-10 rounded border border-zinc-700 bg-black/70 text-zinc-400 text-[11px] px-2 py-0.5" title="Kısayollar (?)">? Kısayollar</button>;
  const rows: [string, string][] = [['Sürükle', 'Parçayı taşı'], ['Pin → pin tıkla', 'Tel çek'], ['R', 'Seçiliyi döndür'], ['Del', 'Seçiliyi sil'], ['Ctrl+Z / Y', 'Geri al / yinele'], ['Ctrl+C / V / D', 'Kopyala / yapıştır / çoğalt'], ['Shift/Ctrl+tık', 'Çoklu seçim'], ['Shift+sürükle', 'Kutu ile seç'], ['Ctrl+A', 'Tümünü seç'], ['Esc', 'İptal / seçimi bırak'], ['?', 'Bu pencere']];
  return (
    <div className="absolute right-3 bottom-3 z-10 rounded border border-zinc-700 bg-black/85 text-[11px] text-zinc-200 p-2 w-60" onClick={() => setOpen(false)}>
      <div className="font-semibold mb-1">Kısayollar <span className="text-zinc-500 font-normal">(kapatmak için tıkla)</span></div>
      {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-2"><kbd className="text-emerald-300">{k}</kbd><span className="text-zinc-400">{v}</span></div>)}
    </div>
  );
}

export function Lab() {
  const s = useLab();
  const t = getDict(s.lang);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const st = useLab.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === '?') { window.dispatchEvent(new Event('lab-help')); return; }
      if (e.key === 'Escape') { st.arm(null); st.setPendingPin(null); st.select(null); st.clearMulti(); }
      else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); st.selectAll(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') st.deleteSelected();
      else if (e.key.toLowerCase() === 'r' && !mod) st.rotateSelected();
      else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? st.redo() : st.undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); st.redo(); }
      else if (mod && e.key.toLowerCase() === 'c') st.copy();
      else if (mod && e.key.toLowerCase() === 'v') st.paste();
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); st.duplicateSelected(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const P = s.panels;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  return (
    <div className="h-full flex flex-col">
      <Toolbar />
      <div className="flex flex-1 min-h-0">
        {P.left && <><div style={{ width: P.leftW }} className="shrink-0 border-r border-zinc-800 min-h-0"><LibraryPanel /></div><Resizer dir="h" onDelta={(d) => s.set({ panels: { ...P, leftW: clamp(P.leftW + d, 180, 480) } })} /></>}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 min-h-0 relative"><Workspace /><HintBar /><ShortcutHelp />
            {s.thermalView && (
              <div className="absolute left-3 bottom-3 rounded bg-black/70 border border-zinc-700 p-2 text-[10px] text-zinc-300 pointer-events-none">
                <div className="mb-1 font-semibold">Isıl kamera (Tj, ortam → limit)</div>
                <div className="h-2 w-40 rounded" style={{ background: `linear-gradient(90deg, ${[0, 0.25, 0.45, 0.65, 0.9, 1].map((f) => thermalColor(25 + f * 125, 25, 150)).join(',')})` }} />
                <div className="flex justify-between w-40"><span>soğuk</span><span>normal</span><span>yüksek</span><span>kritik</span></div>
                <div>beyaz = termal hasar</div>
              </div>
            )}
            {s.circuit.components.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-zinc-500 text-sm text-center px-6">
                Boş çalışma alanı. Soldan bir bileşeni sürükleyin ya da Ana ekran → Eğitim Merkezi’nden hazır bir devre açın.
              </div>
            )}
          </div>
          {P.bottom && <><Resizer dir="v" onDelta={(d) => s.set({ panels: { ...P, bottomH: clamp(P.bottomH - d, 120, 600) } })} /><div style={{ height: P.bottomH }} className="shrink-0"><Bottom /></div></>}
        </div>
        {P.right && <><Resizer dir="h" onDelta={(d) => s.set({ panels: { ...P, rightW: clamp(P.rightW - d, 220, 520) } })} /><div style={{ width: P.rightW }} className="shrink-0 border-l border-zinc-800 bg-zinc-900 min-h-0 overflow-y-auto"><div className="flex px-2 pt-1 border-b border-zinc-800 gap-1 text-xs"><button onClick={() => s.set({ rightTab: 'props' })} className={`px-3 py-1.5 rounded-t ${s.rightTab === 'props' || !s.activeLesson ? 'bg-zinc-800 text-white' : 'text-zinc-500'}`}>{t.properties}</button>{s.activeLesson && <button onClick={() => s.set({ rightTab: 'lesson' })} className={`px-3 py-1.5 rounded-t ${s.rightTab === 'lesson' ? 'bg-zinc-800 text-white' : 'text-zinc-500'}`}>📘 Ders</button>}</div>{s.activeLesson && s.rightTab === 'lesson' ? <LessonPanel /> : <Inspector />}</div></>}
      </div>
    </div>
  );
}
