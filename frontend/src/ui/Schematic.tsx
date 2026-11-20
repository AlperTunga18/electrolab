import { useEffect, useMemo, useRef, useState } from 'react';
import { groupIds, useLab } from '../store/lab';
import { COMPONENTS, getDef } from '../library/components';
import { symbolFor, pinPos } from '../core/schematic/symbols';
import { autoLayout, type Layout } from '../core/schematic/layout';
import { nearestOnPolyline, routeAllWires, snapOnSegment } from '../core/schematic/wiring';
import { alignSch, distributeSch, marqueeSch, rotateSchGroup, translateSch } from '../core/schematic/group';
import { bestRotation, suggestPlacement } from '../core/schematic/orient';
import type { AlignMode } from '../core/circuit/selection';
import { erc } from '../core/schematic/erc';
import { formatSI } from '../core/units';
import { downloadReportPdf, downloadSchematicSvg, downloadKicad } from './exports';
import { HintBar, Inspector } from './Lab';
import type { PlacedComponent } from '../core/circuit/types';

const btn = 'px-2.5 py-1 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40';
const SNAP = 10;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;
const ALIGN_BTNS: [AlignMode, string, string][] = [['left', '⇤', 'Sola hizala'], ['hcenter', '⇔', 'Yatay ortala'], ['right', '⇥', 'Sağa hizala'], ['top', '⤒', 'Üste hizala'], ['vcenter', '⇕', 'Dikey ortala'], ['bottom', '⤓', 'Alta hizala']];

function valueText(c: PlacedComponent): string {
  const def = getDef(c.type);
  for (const k of ['r', 'c', 'l', 'v', 'vz', 'i']) {
    const p = def.params.find((q) => q.key === k);
    if (p && typeof c.params[k] === 'number') return formatSI(Number(c.params[k]), p.unit);
  }
  return def.mpn ?? '';
}

/** 2D schematic editor. It edits the SAME circuit as the 3D lab: a wire drawn here exists in 3D and vice versa. */
export function Schematic() {
  const s = useLab();
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: -40, y: -40, w: 900, h: 560 });
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; moved: boolean; ids: string[]; orig: Layout } | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [tapStart, setTapStart] = useState<{ wire: string; x: number; y: number } | null>(null);
  const [pan, setPan] = useState<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const [showNets, setShowNets] = useState(true);
  const [add, setAdd] = useState('');
  const [msg, setMsg] = useState('');

  const layout: Layout = useMemo(() => autoLayout(s.circuit, true), [s.circuit]);
  const wiring = useMemo(() => routeAllWires(s.circuit, layout, { autoRoute: s.autoRoute }), [s.circuit, layout, s.autoRoute]);
  const wires = wiring.routes, dots = wiring.dots;
  const issues = useMemo(() => erc(s.circuit), [s.circuit]);
  const live = s.live;
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000); };

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: view.x + ((e.clientX - r.left) / r.width) * view.w, y: view.y + ((e.clientY - r.top) / r.height) * view.h };
  };

  // persist the auto layout once so that dragging starts from a stable state
  const needsPersist = s.circuit.components.some((c) => !c.sch);
  useEffect(() => { if (needsPersist && s.circuit.components.length) s.setAllSch(layout); }, [needsPersist]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const st = useLab.getState();
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (k === 'r' && !mod && st.multi.length >= 2) st.setSchMany(rotateSchGroup(autoLayout(st.circuit, true), st.multi));
      else if (k === 'r' && !mod && st.selection?.kind === 'comp') {
        const id = st.selection.id, l = autoLayout(st.circuit, true)[id];
        if (l) st.setSch(id, { ...l, rot: ((l.rot + 1) & 3) as 0 | 1 | 2 | 3 });
      } else if (mod && k === 'a') { e.preventDefault(); st.selectAll(); }
      else if (mod && k === 'c') st.copy();
      else if (mod && k === 'v') st.paste();
      else if (mod && k === 'd') { e.preventDefault(); st.duplicateSelected(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') st.deleteSelected();
      else if (e.key === 'Escape') { st.setPendingPin(null); st.select(null); setTapStart(null); setMarquee(null); }
      else if (k === 'z' && mod) { e.preventDefault(); e.shiftKey ? st.redo() : st.undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fit = () => {
    const xs: number[] = [], ys: number[] = [];
    for (const c of s.circuit.components) { const l = layout[c.id]; if (l) { xs.push(l.x); ys.push(l.y); } }
    if (!xs.length) return;
    const x0 = Math.min(...xs) - 100, x1 = Math.max(...xs) + 100, y0 = Math.min(...ys) - 100, y1 = Math.max(...ys) + 100;
    setView({ x: x0, y: y0, w: Math.max(x1 - x0, 300), h: Math.max(y1 - y0, 200) });
  };

  const onPinClick = (comp: string, pin: string) => {
    const st = useLab.getState();
    const ref = { comp, pin };
    if (tapStart) {
      if (!st.addTapWire(ref, tapStart.wire, tapStart.x, tapStart.y)) flash('Bu pin zaten o telin ucu veya zaten bağlı.');
      setTapStart(null);
      return;
    }
    if (!st.pendingPin) st.setPendingPin(ref);
    else { if (st.pendingPin.comp !== comp || st.pendingPin.pin !== pin) st.addWire(st.pendingPin, ref); st.setPendingPin(null); }
  };

  const addPart = (type: string) => {
    if (!type) return;
    let c: { x: number; y: number; rot: 0 | 1 | 2 | 3 } = { x: snap(view.x + view.w / 2), y: snap(view.y + view.h / 2), rot: 0 };
    // a pin is waiting for its wire: put the new part next to it, rotated so its first pin faces that pin
    const sug = s.pendingPin ? suggestPlacement(s.circuit, layout, s.pendingPin, type) : null;
    if (sug) { c = sug; flash('Parça, bekleyen pine bakacak şekilde yerleştirildi (ilk pini tıklayıp tel çekin).'); }
    const id = s.addComponent(type, 0, 0);
    s.setSch(id, c, false);
    setAdd('');
  };

  const autoOrient = () => {
    const ids = groupIds(s);
    const patch: Layout = {};
    for (const id of ids) { const l = layout[id]; if (l) { const rot = bestRotation(s.circuit, layout, id); if (rot !== l.rot) patch[id] = { ...l, rot }; } }
    const n = Object.keys(patch).length;
    if (n) { s.setSchMany(patch); flash(`${n} parça döndürüldü.`); } else flash('Döndürmeye gerek yok (yön zaten uygun veya bağlı tel yok).');
  };

  const pending = s.pendingPin;
  const pendingPos = pending ? (() => { const c = s.circuit.components.find((q) => q.id === pending.comp); const l = c && layout[c.id]; return c && l ? pinPos(symbolFor(getDef(c.type)), l.rot, l.x, l.y, pending.pin) : null; })() : null;
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1 min-h-11 border-b border-zinc-800 bg-zinc-900 shrink-0 flex-wrap">
        <button className={btn} onClick={() => s.go('home')}>← Ana ekran</button>
        <b className="text-sm">Şematik — {s.projectName}</b>
        <button className={btn} onClick={() => s.go('lab')}>3D laboratuvar</button>
        <button className={btn} onClick={() => s.go('pcb')}>PCB</button>
        <span className="w-px h-5 bg-zinc-700" />
        <select className="bg-zinc-950 border border-zinc-700 rounded px-1 py-1 text-xs max-w-44" value={add} onChange={(e) => addPart(e.target.value)}>
          <option value="">+ Bileşen ekle…</option>
          {COMPONENTS.filter((c) => !c.userMade).slice(0, 400).map((c) => <option key={c.type} value={c.type}>{c.name}</option>)}
        </select>
        <button className={btn} onClick={() => { s.setAllSch(autoLayout(s.circuit, false)); setTimeout(fit, 0); }}>Otomatik yerleştir</button>
        <button className={btn} onClick={fit}>Sığdır</button>
        <button className={btn} onClick={s.undo} disabled={!s.past.length}>↶</button>
        <button className={btn} onClick={s.redo} disabled={!s.future.length}>↷</button>
        <button className={btn} disabled={!groupIds(s).length} title="Seçili parçaları bağlı oldukları pinlere göre otomatik döndür" onClick={autoOrient}>Oto. yön</button>
        <label className="text-xs text-zinc-400 flex items-center gap-1" title="Kabloları parça gövdelerinden kaçınan dik açılı yollarla çiz"><input type="checkbox" checked={s.autoRoute} onChange={(e) => s.setAutoRoute(e.target.checked)} />Oto. kablo</label>
        {s.multi.length >= 2 && (
          <div className="flex items-center gap-1" title={`${s.multi.length} parça seçili`}>
            <span className="w-px h-5 bg-zinc-700" />
            {ALIGN_BTNS.map(([m, ic, tip]) => <button key={m} className={btn} title={tip} onClick={() => s.setSchMany(alignSch(layout, s.multi, m))}>{ic}</button>)}
            <button className={btn} title="Yatayda eşit dağıt" disabled={s.multi.length < 3} onClick={() => s.setSchMany(distributeSch(layout, s.multi, 'x'))}>⇹</button>
            <button className={btn} title="Dikeyde eşit dağıt" disabled={s.multi.length < 3} onClick={() => s.setSchMany(distributeSch(layout, s.multi, 'y'))}>⥮</button>
            <button className={btn} title="Grubu döndür (R)" onClick={() => s.setSchMany(rotateSchGroup(layout, s.multi))}>⟳</button>
          </div>
        )}
        <label className="text-xs text-zinc-400 flex items-center gap-1"><input type="checkbox" checked={showNets} onChange={(e) => setShowNets(e.target.checked)} />Düğüm gerilimleri</label>
        <div className="flex-1" />
        <button className={btn} onClick={() => downloadSchematicSvg(s.circuit, s.projectName)}>SVG</button>
        <button className={btn} onClick={async () => { try { await downloadReportPdf(s.circuit, s.projectName); } catch (e) { flash((e as Error).message); } }}>PDF rapor</button>
        <button className={btn} onClick={() => downloadKicad(s.circuit, s.projectName)} title="Deneysel: KiCad netlist (.net) ve .kicad_pcb">KiCad</button>
        {msg && <span className="text-xs text-amber-300">{msg}</span>}
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 bg-white relative">
          <svg
            ref={svg} className="w-full h-full select-none" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            onWheel={(e) => { const p = toLocal(e), k = e.deltaY > 0 ? 1.15 : 1 / 1.15; setView({ x: p.x - (p.x - view.x) * k, y: p.y - (p.y - view.y) * k, w: view.w * k, h: view.h * k }); }}
            onPointerDown={(e) => {
              if (e.target === svg.current || (e.target as SVGElement).dataset.bg) {
                setTapStart(null);
                if (e.shiftKey) { const p = toLocal(e); setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); return; }
                s.select(null); s.setPendingPin(null); setPan({ sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
              }
            }}
            onPointerMove={(e) => {
              setCursor(toLocal(e));
              if (marquee) { const p = toLocal(e); setMarquee({ ...marquee, x1: p.x, y1: p.y }); return; }
              if (pan) { const r = svg.current!.getBoundingClientRect(); setView({ ...view, x: pan.vx - ((e.clientX - pan.sx) / r.width) * view.w, y: pan.vy - ((e.clientY - pan.sy) / r.height) * view.h }); }
              if (drag) {
                const p = toLocal(e), nx = snap(p.x + drag.dx), ny = snap(p.y + drag.dy);
                const o = drag.orig[drag.id], l = layout[drag.id];
                if (o && l && (l.x !== nx || l.y !== ny)) {
                  if (!drag.moved) { s.beginHistory(); setDrag({ ...drag, moved: true }); }
                  s.setSchMany(translateSch(drag.orig, drag.ids, nx - o.x, ny - o.y), false); // whole group moves by the anchor's delta
                }
              }
            }}
            onPointerUp={() => { if (marquee) { s.setMulti(marqueeSch(layout, { x: marquee.x0, y: marquee.y0 }, { x: marquee.x1, y: marquee.y1 })); setMarquee(null); } setDrag(null); setPan(null); }}
            onPointerLeave={() => { setMarquee(null); setDrag(null); setPan(null); }}
          >
            <defs><pattern id="g" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.6" fill="#d4d4d8" /></pattern></defs>
            <rect data-bg="1" x={view.x - 5000} y={view.y - 5000} width={view.w + 10000} height={view.h + 10000} fill="url(#g)" />
            {wires.map((w) => {
              const wire = s.circuit.wires.find((x) => x.id === w.wireId);
              const sel = s.selection?.kind === 'wire' && s.selection.id === w.wireId;
              const pts = w.pts.map((p) => p.join(',')).join(' ');
              const onWire = (e: React.PointerEvent) => {
                e.stopPropagation();
                const st = useLab.getState();
                const lp = toLocal(e), n = nearestOnPolyline(w.pts, lp);
                const q = n ? snapOnSegment(w.pts, n) : lp;
                if (st.pendingPin) { // T-junction: finish the pending pin's wire in the middle of this wire
                  if (!st.addTapWire(st.pendingPin, w.wireId, q.x, q.y)) flash('Bu pin zaten o telin ucu veya zaten bağlı.');
                  st.setPendingPin(null);
                } else if (e.altKey) { setTapStart({ wire: w.wireId, x: q.x, y: q.y }); flash('T-bağlantı: şimdi bağlanacak pine tıklayın (Esc: iptal).'); }
                else st.select({ kind: 'wire', id: w.wireId });
              };
              return (
                <g key={w.wireId}>
                  <polyline points={pts} fill="none" stroke={sel ? '#0ea5e9' : wire?.broken ? '#f59e0b' : '#15803d'} strokeWidth={sel ? 3 : 1.6} strokeDasharray={wire?.broken ? '4 3' : undefined} pointerEvents="none" />
                  <polyline points={pts} fill="none" stroke="transparent" strokeWidth={8} style={{ cursor: 'pointer' }} onPointerDown={onWire} />
                </g>
              );
            })}
            {dots.map((d, i) => <circle key={i} cx={d[0]} cy={d[1]} r={3} fill="#15803d" />)}
            {s.circuit.components.map((c) => {
              const l = layout[c.id];
              if (!l) return null;
              const def = getDef(c.type), sym = symbolFor(def);
              const selected = (s.selection?.kind === 'comp' && s.selection.id === c.id) || s.multi.includes(c.id);
              const stress = live?.stress.some((x) => x.comp === c.id);
              return (
                <g key={c.id}>
                  <g transform={`translate(${l.x} ${l.y}) rotate(${l.rot * 90})`} stroke={stress ? '#dc2626' : selected ? '#0284c7' : '#111'} fill="none" strokeWidth={selected ? 2 : 1.4}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (e.shiftKey || e.ctrlKey || e.metaKey) { s.toggleMulti(c.id); return; }
                      const st = useLab.getState();
                      if (!st.multi.includes(c.id)) s.select({ kind: 'comp', id: c.id });
                      const ids = st.multi.includes(c.id) ? st.multi : [c.id];
                      const orig: Layout = {};
                      for (const id of ids) if (layout[id]) orig[id] = layout[id];
                      const p = toLocal(e);
                      setDrag({ id: c.id, dx: l.x - p.x, dy: l.y - p.y, moved: false, ids, orig });
                    }}
                    onDoubleClick={() => s.toggleSwitch(c.id)} style={{ cursor: 'move' }}>
                    <rect x={-sym.w / 2} y={-sym.h / 2} width={sym.w} height={sym.h} fill="transparent" stroke="none" />
                    {sym.shapes.map((sh, i) => sh.t === 'path' ? <path key={i} d={sh.d} fill={sh.fill ? '#111' : 'none'} />
                      : sh.t === 'circle' ? <circle key={i} cx={sh.cx} cy={sh.cy} r={sh.r} fill={sh.fill ? '#111' : 'none'} />
                      : sh.t === 'rect' ? <rect key={i} x={sh.x} y={sh.y} width={sh.w} height={sh.h} />
                      : <text key={i} x={sh.x} y={sh.y} fontSize="9" textAnchor={sh.anchor ?? 'middle'} fill="#111" stroke="none" transform={`rotate(${-l.rot * 90} ${sh.x} ${sh.y})`}>{sh.text}</text>)}
                  </g>
                  <text x={l.x + sym.ref.x} y={l.y + sym.ref.y} fontSize="10" fill="#1d4ed8" fontWeight="bold" textAnchor="middle">{c.ref}</text>
                  <text x={l.x + sym.value.x} y={l.y + sym.value.y} fontSize="9" fill="#444" textAnchor="middle">{valueText(c)}</text>
                  {def.pins.map((p) => {
                    const pp = pinPos(sym, l.rot, l.x, l.y, p.id);
                    const net = live?.pinNet.get(`${c.id}:${p.id}`);
                    const isPending = pending?.comp === c.id && pending.pin === p.id;
                    return (
                      <g key={p.id}>
                        <circle cx={pp.x} cy={pp.y} r={isPending ? 5 : 3.5} fill={isPending ? '#06b6d4' : '#fff'} stroke="#b45309" strokeWidth="1.2" style={{ cursor: 'crosshair' }} onPointerDown={(e) => { e.stopPropagation(); onPinClick(c.id, p.id); }}><title>{`${c.ref}.${p.label}${net !== undefined && live ? ' = ' + formatSI(live.netV[net], 'V') : ''}`}</title></circle>
                        {showNets && live && net !== undefined && s.simStatus !== 'error' && <text x={pp.x + (pp.dir === 'l' ? -6 : pp.dir === 'r' ? 6 : 0)} y={pp.y + (pp.dir === 'u' ? -7 : pp.dir === 'd' ? 12 : -4)} fontSize="8" fill="#0369a1" textAnchor={pp.dir === 'l' ? 'end' : pp.dir === 'r' ? 'start' : 'middle'}>{formatSI(live.netV[net], 'V', 3)}</text>}
                      </g>
                    );
                  })}
                </g>
              );
            })}
            {marquee && <rect x={Math.min(marquee.x0, marquee.x1)} y={Math.min(marquee.y0, marquee.y1)} width={Math.abs(marquee.x1 - marquee.x0)} height={Math.abs(marquee.y1 - marquee.y0)} fill="rgba(14,165,233,0.12)" stroke="#0ea5e9" strokeDasharray="4 3" pointerEvents="none" />}
            {tapStart && <circle cx={tapStart.x} cy={tapStart.y} r={5} fill="#06b6d4" pointerEvents="none" />}
            {pendingPos && cursor && <line x1={pendingPos.x} y1={pendingPos.y} x2={cursor.x} y2={cursor.y} stroke="#06b6d4" strokeDasharray="4 3" />}
          </svg>
          <HintBar />
          {!s.circuit.components.length && <div className="absolute inset-0 flex items-center justify-center text-zinc-400 text-sm pointer-events-none">Boş şematik. “+ Bileşen ekle” ile başlayın veya bir ders/örnek açın.</div>}
        </div>
        <div className="w-80 shrink-0 border-l border-zinc-800 bg-zinc-900 flex flex-col min-h-0">
          <div className="px-3 py-2 text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-800">Özellikler</div>
          <div className="flex-1 min-h-0 overflow-y-auto"><Inspector schematic /></div>
          <div className="border-t border-zinc-800 max-h-56 overflow-y-auto p-2 text-xs">
            <div className="flex justify-between mb-1"><b>ERC ({issues.filter((i) => i.severity === 'error').length} hata, {issues.filter((i) => i.severity === 'warning').length} uyarı)</b></div>
            {!issues.length && <div className="text-emerald-400">Sorun bulunmadı.</div>}
            {issues.map((i, k) => (
              <div key={k} onClick={() => i.comp && s.select({ kind: 'comp', id: i.comp })} className={`py-0.5 cursor-pointer ${i.severity === 'error' ? 'text-red-300' : i.severity === 'warning' ? 'text-amber-300' : 'text-zinc-400'}`}>
                {i.severity === 'error' ? '✖' : i.severity === 'warning' ? '⚠' : 'ℹ'} {i.message}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="px-3 py-1 text-[11px] text-zinc-500 border-t border-zinc-800 bg-zinc-900 shrink-0">Pine tıkla → pine tıkla: kablo (3D’de de oluşur) · pin bekliyorken tele tıkla veya Alt+tel tıkla → pine tıkla: T-bağlantı · Shift/Ctrl+tık: çoklu seçim · Shift+sürükle: kutu · Ctrl+A/C/V/D · R: döndür · Del: sil · çift tık: anahtar</div>
    </div>
  );
}
