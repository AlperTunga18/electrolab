import { useEffect, useMemo, useRef, useState } from 'react';
import { useLab } from '../store/lab';
import { getDef } from '../library/components';
import { autoPlace, ensureDesign, resolveFootprint, worldPads } from '../core/pcb/design';
import { isPhysical } from '../core/pcb/footprints';
import { emcChecks, extractConnectivity, ipcClearanceMm, ipcCurrent, ipcTraceWidth, microstripWidthForZ0, microstripZ0, diffMicrostripZ, runDrc, viaCurrentA, viaResistanceMilliohm } from '../core/pcb/drc';
import { autoroute } from '../core/pcb/router';
import { netLengthReport } from '../core/pcb/length';
import { findDiffPairs } from '../core/pcb/diffpair';
import { liveViolations, snapDir } from '../core/pcb/manual';
import { solveDCOnce } from '../core/sim/mna';
import { buildNets } from '../core/circuit/nets';
import { Pcb3D } from '../three/Pcb3D';
import { downloadFabrication, downloadKicad, downloadReportPdf } from './exports';
import { DEFAULT_CLASS, classOfKey, netClassList, netKeys, netLabel } from '../core/pcb/netclass';
import type { NetClass, PcbRules, Zone, ZoneLayer } from '../core/pcb/types';
import { FootprintEditor } from './FootprintEditor';
import { footprintCatalog } from '../core/pcb/landPatterns';
import { offsetPoly, outlinePoly, polyBBox } from '../core/pcb/geom';
import { applyKicadPatch, importKicadPcb, type KicadImportResult } from '../core/export/kicadImport';

const btn = 'px-2.5 py-1 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40';
const inp = 'bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-xs w-20';
const TOP = '#d9534f', BOT = '#3b82f6';
type Tool = 'select' | 'track' | 'via' | 'zone' | 'zonepoly' | 'outline' | 'hole';
const TOOL_LABEL: Record<Tool, string> = { select: '⬚ Seç/taşı', track: '╱ İz', via: '◎ Via', zone: '▦ Zone', zonepoly: '▱ Zone çokgen', outline: '⬠ Kart sınırı', hole: '⊙ Montaj deliği' };
const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const snapTo = (v: number, g: number) => Math.round(v / g) * g;

function Calc({ rules }: { rules: PcbRules }) {
  const [cur, setCur] = useState('1');
  const [dT, setDT] = useState('10');
  const [w, setW] = useState('0.4');
  const [volt, setVolt] = useState(String(rules.voltage));
  const [z0, setZ0] = useState('50');
  const [h, setH] = useState('0.2');
  const [sp, setSp] = useState('0.2');
  const n = (v: string) => Number(v) || 0;
  const t = 0.035 * rules.copperOz;
  const row = (k: string, v: string) => <div className="flex justify-between text-xs border-t border-zinc-800 py-0.5"><span className="text-zinc-400">{k}</span><b className="text-emerald-300">{v}</b></div>;
  const num = (label: string, v: string, set: (x: string) => void) => <label className="text-[11px] text-zinc-400 block">{label}<input className={`${inp} w-full`} value={v} onChange={(e) => set(e.target.value)} /></label>;
  return (
    <div className="space-y-3 text-xs">
      <div className="text-zinc-500">IPC-2221 / IPC-2141 formülleri; yaklaşık mühendislik hesabıdır, üretici ve standart ile doğrulayın.</div>
      <div>
        <b>Akım taşıma (IPC-2221)</b>
        <div className="grid grid-cols-2 gap-2 mt-1">{num('Akım (A)', cur, setCur)}{num('ΔT (°C)', dT, setDT)}{num('İz genişliği (mm)', w, setW)}</div>
        {row('Gereken genişlik (dış kat.)', `${ipcTraceWidth(n(cur), n(dT), rules.copperOz, true).toFixed(3)} mm`)}
        {row('Gereken genişlik (iç kat.)', `${ipcTraceWidth(n(cur), n(dT), rules.copperOz, false).toFixed(3)} mm`)}
        {row(`${w} mm iz taşır (dış, ΔT ${dT})`, `${ipcCurrent(n(w), n(dT), rules.copperOz, true).toFixed(2)} A`)}
      </div>
      <div>
        <b>Gerilim aralığı (IPC-2221 Tablo 6-1)</b>
        <div className="mt-1">{num('Tepe gerilim (V)', volt, setVolt)}</div>
        {row('İç katman (B1)', `${ipcClearanceMm(n(volt), 'internal').toFixed(2)} mm`)}
        {row('Dış, kaplamasız (B2)', `${ipcClearanceMm(n(volt), 'external-uncoated').toFixed(2)} mm`)}
        {row('Dış, kaplı (B4)', `${ipcClearanceMm(n(volt), 'external-coated').toFixed(2)} mm`)}
        <div className="text-zinc-500 mt-1">Şebeke (230 Vrms ≈ 325 V tepe) için ek olarak creepage (kaçak yolu) ve takviyeli yalıtım gereksinimleri: IEC 60664-1 / IEC 62368-1. Örnek: 250 Vrms, kirlilik 2, malzeme grubu III ≈ 2.5 mm creepage (standarda bakınız).</div>
      </div>
      <div>
        <b>Mikroşerit empedans (IPC-2141)</b>
        <div className="grid grid-cols-2 gap-2 mt-1">{num('İz genişliği (mm)', w, setW)}{num('Dielektrik h (mm)', h, setH)}{num('Hedef Z0 (Ω)', z0, setZ0)}{num('Fark çifti aralığı s (mm)', sp, setSp)}</div>
        {row(`Z0 (εr ${rules.er}, t ${t.toFixed(3)} mm)`, `${microstripZ0(n(w), n(h), t, rules.er).toFixed(1)} Ω`)}
        {row(`Z0 = ${z0} Ω için genişlik`, `${microstripWidthForZ0(n(z0), n(h), t, rules.er).toFixed(3)} mm`)}
        {row('Fark empedansı Zdiff', `${diffMicrostripZ(n(w), n(h), t, rules.er, n(sp)).toFixed(1)} Ω`)}
        <div className="text-zinc-500 mt-1">Yalnızca dış katman mikroşerit yaklaşımı; stripline, referans düzlem boşlukları ve üretici stack-up hassasiyeti dahil değil.</div>
      </div>
      <div>
        <b>Via</b>
        {row(`Via (${rules.viaDrill} mm delik, ${rules.thickness} mm) direnci`, `${viaResistanceMilliohm(rules.viaDrill, rules.thickness).toFixed(2)} mΩ`)}
        {row('Via akım kapasitesi (ΔT 10 °C)', `${viaCurrentA(rules.viaDrill).toFixed(2)} A`)}
      </div>
    </div>
  );
}

/** Which current each net carries: from the DC solution (max over the parts touching the net). */
function useNetCurrents() {
  const circuit = useLab((s) => s.circuit);
  return useMemo(() => {
    try {
      const { results } = solveDCOnce(circuit);
      const nets = buildNets(circuit);
      const out: Record<number, number> = {};
      for (const c of circuit.components) {
        const r = results[c.id];
        if (!r) continue;
        const i = Math.abs(r.vals.ic ?? r.vals.id ?? r.i);
        for (const p of getDef(c.type).pins) { const n = nets.pinNet.get(`${c.id}:${p.id}`); if (n !== undefined && n > 0) out[n] = Math.max(out[n] ?? 0, i); }
      }
      return out;
    } catch { return {}; }
  }, [circuit]);
}

export function Pcb() {
  const s = useLab();
  const svg = useRef<SVGSVGElement>(null);
  const design = useMemo(() => ensureDesign(s.circuit), [s.circuit]);
  const pads = useMemo(() => worldPads(s.circuit, design), [s.circuit, design]);
  const conn = useMemo(() => extractConnectivity(s.circuit, design), [s.circuit, design]);
  const currents = useNetCurrents();
  const drc = useMemo(() => runDrc(s.circuit, design, { currents }), [s.circuit, design, currents]);
  const emc = useMemo(() => emcChecks(s.circuit, design), [s.circuit, design]);
  const lengths = useMemo(() => netLengthReport(s.circuit, design, conn), [s.circuit, design, conn]);
  const pairs = useMemo(() => findDiffPairs(s.circuit, design), [s.circuit, design]);
  const [tool, setTool] = useState<Tool>('select');
  const [layer, setLayer] = useState<ZoneLayer>('top');
  const [tab, setTab] = useState<'rules' | 'drc' | 'calc' | 'board' | 'len'>('drc');
  const [lock45, setLock45] = useState(true); // manual tracks: 45-degree lock (Shift = free angle)
  const [freeAngle, setFreeAngle] = useState(false);
  const [routeDiag, setRouteDiag] = useState(true); // autoroute: 45-degree moves
  const [ripRounds, setRipRounds] = useState(3); // autoroute: retry rounds for failed connections
  const [routeDiff, setRouteDiff] = useState(false); // autoroute: derive differential pairs
  const [holeDrill, setHoleDrill] = useState(3.2); // M3 clearance hole; edit as needed
  const [zoneNet, setZoneNet] = useState<number | null>(null);
  const [view3d, setView3d] = useState(false);
  const [view, setView] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [pts, setPts] = useState<[number, number][]>([]);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const [pan, setPan] = useState<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const [sel, setSel] = useState<{ kind: 'track' | 'via' | 'zone'; id: string } | null>(null);
  const [hl, setHl] = useState<{ x: number; y: number } | null>(null);
  const [fpEdit, setFpEdit] = useState(false);
  const [msg, setMsg] = useState('');
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 5000); };
  const [kimp, setKimp] = useState<{ name: string; res: KicadImportResult } | null>(null); // pending KiCad import awaiting confirmation
  const kfile = useRef<HTMLInputElement>(null);
  const pickKicad = async (f: File | undefined) => {
    if (!f) return;
    try { setKimp({ name: f.name, res: importKicadPcb(await f.text(), s.circuit, design) }); }
    catch (e) { flash(`Dosya okunamadı: ${(e as Error).message}`); }
  };
  const R = design.rules;
  const boardPoly = outlinePoly(design.outline);
  /** drawn shape of a zone: its own polygon, else the board inset by the edge clearance */
  const zoneShape = (z: Zone): [number, number][] => (z.poly && z.poly.length >= 3 ? z.poly : (() => { const o = offsetPoly(boardPoly, R.edgeClearance); return o.length >= 3 ? o : boardPoly; })());
  const v = view ?? { x: -5, y: -5, w: design.outline.w + 10, h: design.outline.h + 10 };
  const copper: 'top' | 'bottom' = layer === 'bottom' ? 'bottom' : 'top';
  const keys = useMemo(() => netKeys(s.circuit), [s.circuit]);
  /** net class of the pad a track starts/ends on (Default when it touches no pad) */
  const classAt = (list: [number, number][]): NetClass => {
    for (const p of [list[0], list[list.length - 1]]) {
      if (!p) continue;
      const pad = pads.find((q) => Math.abs(p[0] - q.x) <= q.w / 2 + 0.05 && Math.abs(p[1] - q.y) <= q.h / 2 + 0.05 && q.net >= 0);
      if (pad) return classOfKey(design, keys[pad.net]);
    }
    return classOfKey(design, undefined);
  };

  const toMm = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = svg.current!.getBoundingClientRect();
    return [v.x + ((e.clientX - r.left) / r.width) * v.w, v.y + ((e.clientY - r.top) / r.height) * v.h];
  };
  const padAt = (x: number, y: number) => pads.find((p) => Math.abs(x - p.x) <= p.w / 2 + 0.3 && Math.abs(y - p.y) <= p.h / 2 + 0.3 && p.layers.includes(copper));

  const finishTrack = (list: [number, number][]) => {
    if (list.length >= 2) s.editPcb((d) => ({ ...d, tracks: [...d.tracks, { id: uid('t'), layer: copper, width: classAt(list).width, pts: list }] }));
    setPts([]);
  };
  /** closes the polygon being drawn: zone polygon (anchored on the chosen net's first pad) or the board outline */
  const finishPoly = (list: [number, number][]) => {
    const poly = list.filter((p, i) => i === 0 || p[0] !== list[i - 1][0] || p[1] !== list[i - 1][1]);
    if (poly.length > 1 && poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1]) poly.pop();
    setPts([]);
    if (poly.length < 3) { flash('Çokgen için en az 3 köşe gerekir.'); return; }
    if (tool === 'outline') {
      const bb = polyBBox(poly);
      s.editPcb((d) => ({ ...d, outline: { w: Math.ceil(bb[2]), h: Math.ceil(bb[3]), poly } }));
      flash('Kart sınırı çokgen olarak ayarlandı. Parçalar/izler yeni sınırın dışında kalabilir: DRC’yi kontrol edin.');
    } else {
      const net = zoneNet ?? boardNets[0];
      const anchor = pads.find((p) => p.net === net);
      if (!anchor) { flash('Zone için kartta pad’i olan bir net seçin (Kart sekmesi).'); return; }
      s.editPcb((d) => ({ ...d, zones: [...d.zones, { id: uid('z'), layer, anchor: { comp: anchor.comp, pin: anchor.pin }, clearance: d.rules.minClearance, poly, priority: Math.max(-1, ...d.zones.filter((z) => z.layer === layer).map((z) => z.priority ?? 0)) + 1 }] }));
      flash(`${layer} katmanına çokgen zone eklendi (net: ${anchor.ref}.${anchor.pin}).`);
    }
  };
  const orth = (last: [number, number], p: [number, number], free: boolean): [number, number] => snapDir(last, p, free ? 'free' : lock45 ? '45' : 'orth');
  /** the vertex the next click would add, and the DRC conflicts the track being drawn would cause (red preview) */
  const nextPt = tool === 'track' && pts.length > 0 && cursor ? orth(pts[pts.length - 1], [snapTo(cursor[0], 0.25), snapTo(cursor[1], 0.25)], freeAngle) : null;
  const liveKey = nextPt ? `${pts.length}|${nextPt[0]}|${nextPt[1]}|${copper}|${design.tracks.length}|${design.vias.length}` : '';
  const live = useMemo(() => (nextPt ? liveViolations(s.circuit, design, { layer: copper, width: classAt(pts).width, pts: [...pts, nextPt] }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveKey, s.circuit, design]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const st = useLab.getState();
      const k = e.key.toLowerCase();
      if (k === 'escape') { setPts([]); setSel(null); }
      else if (k === 'enter') { if (tool === 'zonepoly' || tool === 'outline') finishPoly(pts); else setPts((p) => { finishTrack(p); return []; }); }
      else if (k === 'v' && pts.length) {
        const last = pts[pts.length - 1];
        const cls = classAt(pts);
        st.editPcb((d) => ({ ...d, tracks: pts.length >= 2 ? [...d.tracks, { id: uid('t'), layer: copper, width: cls.width, pts }] : d.tracks, vias: [...d.vias, { id: uid('v'), x: last[0], y: last[1], dia: cls.viaDia, drill: cls.viaDrill }] }));
        setLayer(copper === 'top' ? 'bottom' : 'top'); setPts([last]);
      } else if (k === 'delete' || k === 'backspace') {
        if (sel) { st.editPcb((d) => ({ ...d, tracks: sel.kind === 'track' ? d.tracks.filter((t) => t.id !== sel.id) : d.tracks, vias: sel.kind === 'via' ? d.vias.filter((x) => x.id !== sel.id) : d.vias, zones: sel.kind === 'zone' ? d.zones.filter((z) => z.id !== sel.id) : d.zones })); setSel(null); }
      } else if ((k === 'r' || k === 'f') && st.selection?.kind === 'comp') {
        const id = st.selection.id;
        st.editPcb((d) => { const p = d.placements[id]; return p ? { ...d, placements: { ...d.placements, [id]: k === 'r' ? { ...p, rot: (((p.rot + 90) % 360) as 0 | 90 | 180 | 270) } : { ...p, side: p.side === 'top' ? 'bottom' : 'top' } } } : d; });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onBoardDown = (e: React.PointerEvent) => {
    const [x, y] = toMm(e);
    if (tool === 'track') {
      const pad = padAt(x, y);
      const p: [number, number] = pad ? [pad.x, pad.y] : [snapTo(x, 0.25), snapTo(y, 0.25)];
      if (!pts.length) { setPts([p]); return; }
      const next = pad ? p : orth(pts[pts.length - 1], p, e.shiftKey);
      const list: [number, number][] = [...pts, next];
      if (pad) finishTrack(list); else setPts(list);
    } else if (tool === 'via') {
      const vc = classAt([[x, y]]);
      s.editPcb((d) => ({ ...d, vias: [...d.vias, { id: uid('v'), x: snapTo(x, 0.25), y: snapTo(y, 0.25), dia: vc.viaDia, drill: vc.viaDrill }] }));
    } else if (tool === 'zonepoly' || tool === 'outline') {
      const p: [number, number] = [snapTo(x, 0.5), snapTo(y, 0.5)];
      setPts((l) => (l.length && l[l.length - 1][0] === p[0] && l[l.length - 1][1] === p[1] ? l : [...l, p]));
    } else if (tool === 'hole') {
      s.editPcb((d) => ({ ...d, holes: [...(d.holes ?? []), { x: snapTo(x, 0.5), y: snapTo(y, 0.5), drill: holeDrill }] }));
    } else if (tool === 'zone') {
      const pad = padAt(x, y);
      if (!pad) { flash('Zone için bir pad’e tıklayın (zone o pad’in net’ine bağlanır).'); return; }
      s.editPcb((d) => ({ ...d, zones: [...d.zones.filter((z) => z.layer !== layer), { id: uid('z'), layer, anchor: { comp: pad.comp, pin: pad.pin }, clearance: d.rules.minClearance }] }));
      flash(`${layer} katmanına ${pad.ref}.${pad.pin} net’ine bağlı zone eklendi.`);
    } else {
      setSel(null);
      setPan({ sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y });
    }
  };

  const doAutoroute = () => {
    const t0 = performance.now();
    const r = autoroute(s.circuit, design, { diagonal: routeDiag, ripupRounds: ripRounds, diffPairs: routeDiff });
    s.editPcb((d) => ({ ...d, tracks: [...d.tracks, ...r.tracks], vias: [...d.vias, ...r.vias] }));
    const dp = r.diffPairs?.length ? ` Fark çifti: ${r.diffPairs.filter((p) => p.status === 'derived').length} türetildi, ${r.diffPairs.filter((p) => p.status === 'failed').length} başarısız${r.diffPairs.filter((p) => p.status === 'failed').map((p) => ` (${p.reason})`).join('')}.` : '';
    flash(`Yönlendirme: ${r.routed} bağlantı, ${r.tracks.length} iz, ${r.vias.length} via, ${r.failed.length} başarısız${r.passes ? `, ${r.passes} geçiş` : ''} (${((performance.now() - t0) / 1000).toFixed(2)} s).${dp}`);
  };

  const errs = drc.filter((d) => d.severity === 'error').length;
  const warns = drc.filter((d) => d.severity === 'warning').length;
  const setRule = (k: keyof PcbRules, val: number) => s.editPcb((d) => ({ ...d, rules: { ...d.rules, [k]: val } }));
  const netNames = useMemo(() => buildNets(s.circuit).names, [s.circuit]);
  const classes = netClassList(design);
  const boardNets = useMemo(() => [...new Set(pads.filter((p) => p.net >= 0).map((p) => p.net))].sort((a, b) => a - b), [pads]);
  const custom = (d: { rules: PcbRules }): NetClass[] => (d.rules.netClasses ?? []).filter((c) => c.name !== DEFAULT_CLASS);
  const editClasses = (fn: (list: NetClass[]) => NetClass[]) => s.editPcb((d) => ({ ...d, rules: { ...d.rules, netClasses: fn(custom(d)) } }));
  const addClass = () => editClasses((l) => {
    let i = l.length + 1;
    while (l.some((c) => c.name === `Sınıf ${i}`)) i++;
    return [...l, { name: `Sınıf ${i}`, width: R.defaultWidth, clearance: R.minClearance, viaDia: R.viaDia, viaDrill: R.viaDrill }];
  });
  const patchClass = (name: string, patch: Partial<NetClass>) => editClasses((l) => l.map((c) => (c.name === name ? { ...c, ...patch } : c)));
  const renameClass = (old: string, nu: string) => {
    const name = nu.trim();
    if (!name || name === DEFAULT_CLASS || classes.some((c) => c.name === name && c.name !== old)) { flash('Sınıf adı boş, "Default" veya yinelenen olamaz.'); return; }
    s.editPcb((d) => ({ ...d, rules: { ...d.rules, netClasses: custom(d).map((c) => (c.name === old ? { ...c, name } : c)) }, netClassOf: Object.fromEntries(Object.entries(d.netClassOf ?? {}).map(([k, v]) => [k, v === old ? name : v])) }));
  };
  const removeClass = (name: string) => s.editPcb((d) => ({ ...d, rules: { ...d.rules, netClasses: custom(d).filter((c) => c.name !== name) }, netClassOf: Object.fromEntries(Object.entries(d.netClassOf ?? {}).filter(([, v]) => v !== name)) }));
  const assignClass = (key: string, name: string) => s.editPcb((d) => {
    const m = { ...(d.netClassOf ?? {}) };
    if (name === DEFAULT_CLASS) delete m[key]; else m[key] = name;
    return { ...d, netClassOf: m };
  });
  const renameNet = (key: string, name: string) => s.editPcb((d) => {
    const m = { ...(d.netNames ?? {}) };
    if (name.trim()) m[key] = name.trim(); else delete m[key];
    return { ...d, netNames: m };
  });

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 min-h-11 py-1 border-b border-zinc-800 bg-zinc-900 shrink-0 flex-wrap">
        <button className={btn} onClick={() => s.go('home')}>← Ana ekran</button>
        <b className="text-sm">PCB — {s.projectName}</b>
        <button className={btn} onClick={() => s.go('schematic')}>Şematik</button>
        <button className={btn} onClick={() => s.go('lab')}>3D laboratuvar</button>
        <span className="w-px h-5 bg-zinc-700" />
        {(Object.keys(TOOL_LABEL) as Tool[]).map((t) => <button key={t} className={`${btn} ${tool === t ? '!bg-emerald-800 !border-emerald-600' : ''}`} onClick={() => { setTool(t); setPts([]); }}>{TOOL_LABEL[t]}</button>)}
        <select className="bg-zinc-950 border border-zinc-700 rounded px-1 py-1 text-xs" value={layer} onChange={(e) => setLayer(e.target.value as ZoneLayer)}>
          <option value="top">Üst bakır</option><option value="bottom">Alt bakır</option>{R.layers === 4 && <><option value="in1">İç 1 (düzlem)</option><option value="in2">İç 2 (düzlem)</option></>}
        </select>
        <span className="w-px h-5 bg-zinc-700" />
        <button className={btn} onClick={() => s.editPcb((d) => { const a = autoPlace(s.circuit, d.rules); return { ...a, outline: d.outline.poly ? d.outline : a.outline, holes: d.holes, tracks: [], vias: [], zones: d.zones, netClassOf: d.netClassOf, netNames: d.netNames, netLengthTargets: d.netLengthTargets, diffPairs: d.diffPairs }; })}>Otomatik yerleştir</button>
        <button className={btn} onClick={doAutoroute}>Otomatik yönlendir</button>
        <label className="text-[11px] text-zinc-400 flex items-center gap-1" title="Otomatik yönlendirme 45° köşegen adımlar kullanır (kapalı: yalnız dik açı)"><input type="checkbox" checked={routeDiag} onChange={(e) => setRouteDiag(e.target.checked)} />45°</label>
        <label className="text-[11px] text-zinc-400 flex items-center gap-1" title="Başarısız bağlantılar için yeniden deneme turu (net sırası değişir, deterministik)">rip-up <select className="bg-zinc-950 border border-zinc-700 rounded text-[11px]" value={ripRounds} onChange={(e) => setRipRounds(Number(e.target.value))}>{[0, 1, 3, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label className="text-[11px] text-zinc-400 flex items-center gap-1" title="Fark çifti aralığı (diffGap) tanımlı _P/_N netlerini eşli yönlendir"><input type="checkbox" checked={routeDiff} onChange={(e) => setRouteDiff(e.target.checked)} />fark çifti</label>
        <label className="text-[11px] text-zinc-400 flex items-center gap-1" title="Elle iz çizerken 45° kilidi (Shift = serbest açı)"><input type="checkbox" checked={lock45} onChange={(e) => setLock45(e.target.checked)} />45° kilit</label>
        <button className={btn} onClick={() => s.editPcb((d) => ({ ...d, tracks: [], vias: [] }))}>İzleri temizle</button>
        <button className={`${btn} ${view3d ? '!bg-sky-800' : ''}`} onClick={() => setView3d(!view3d)}>3D PCB</button>
        <div className="flex-1" />
        <span className={`text-xs ${errs ? 'text-red-300' : 'text-emerald-400'}`}>DRC: {errs} hata, {warns} uyarı, ratsnest {conn.unrouted.length}</span>
        <button className={btn} onClick={() => { const w = downloadFabrication(s.circuit, s.projectName); flash(`Üretim ZIP indirildi. ${w.join(' · ')}`); }}>Gerber ZIP</button>
        <button className={btn} onClick={() => downloadKicad(s.circuit, s.projectName)} title="Deneysel">KiCad</button>
        <button className={btn} onClick={() => kfile.current?.click()} title="Kısıtlı ve deneysel: yalnız kendi dışa aktardığımız biçimle sınandı">KiCad içe aktar</button>
        <input ref={kfile} type="file" accept=".kicad_pcb,text/plain" className="hidden" onChange={(e) => { void pickKicad(e.target.files?.[0]); e.target.value = ''; }} />
        <button className={btn} onClick={async () => { try { await downloadReportPdf(s.circuit, s.projectName); } catch (e) { flash((e as Error).message); } }}>PDF</button>
      </div>
      {msg && <div className="px-3 py-1 text-xs text-amber-300 bg-amber-950/40 border-b border-amber-900">{msg}</div>}
      {kimp && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-label="KiCad içe aktar">
          <div className="bg-zinc-900 border border-zinc-700 rounded p-4 max-w-xl w-full max-h-[85vh] overflow-auto text-xs space-y-2">
            <b className="text-sm">KiCad içe aktar — {kimp.name}</b>
            {!kimp.res.ok || !kimp.res.patch || !kimp.res.summary ? (
              <div className="text-red-300">Hata: {kimp.res.error}</div>
            ) : (
              <>
                <div className="text-amber-300">Mevcut PCB tasarımının izleri, via’ları, zone’ları ve montaj delikleri bu dosyadakilerle DEĞİŞTİRİLİR; eşleşen parçaların konumu/dönüşü/yüzü güncellenir (geri al ile dönülebilir).</div>
                <div>
                  Eşleşen footprint: <b>{kimp.res.summary.footprintsMatched}</b>, eşleşmeyen: <b>{kimp.res.summary.footprintsUnmatched}</b> · iz: <b>{kimp.res.summary.tracks}</b> · via: <b>{kimp.res.summary.vias}</b> · zone: <b>{kimp.res.summary.zones}</b> · delik: <b>{kimp.res.summary.holes}</b> · kart: <b>{{ poly: 'çokgen', rect: 'dikdörtgen', none: 'bulunamadı (korunur)' }[kimp.res.summary.outline]}</b> · katman: <b>{kimp.res.summary.layers ?? 'korunur'}</b>
                </div>
              </>
            )}
            {kimp.res.warnings.length > 0 && (
              <div>
                <b>Uyarılar ({kimp.res.warnings.length})</b>
                <ul className="list-disc pl-4 text-zinc-300 space-y-0.5">{kimp.res.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </div>
            )}
            <div className="text-zinc-500">Yalnız kendi dışa aktardığımız .kicad_pcb ile sınandı; gerçek KiCad dosyaları için sonuçları kontrol edin.</div>
            <div className="flex gap-2 justify-end">
              <button className={btn} onClick={() => setKimp(null)}>Vazgeç</button>
              {kimp.res.ok && kimp.res.patch && (
                <button className={`${btn} !bg-emerald-800 !border-emerald-600`} onClick={() => { const p = kimp.res.patch!; s.editPcb((d) => applyKicadPatch(d, p)); setKimp(null); flash('KiCad dosyası uygulandı.'); }}>Üzerine yaz ve uygula</button>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 relative bg-zinc-950">
          {view3d ? <Pcb3D /> : (
            <svg
              ref={svg} className="w-full h-full select-none" viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`}
              onWheel={(e) => { const [px, py] = toMm(e), k = e.deltaY > 0 ? 1.15 : 1 / 1.15; setView({ x: px - (px - v.x) * k, y: py - (py - v.y) * k, w: v.w * k, h: v.h * k }); }}
              onPointerDown={onBoardDown}
              onDoubleClick={() => { if (tool === 'track') finishTrack(pts); else if (tool === 'zonepoly' || tool === 'outline') finishPoly(pts); }}
              onPointerMove={(e) => {
                const m = toMm(e); setCursor(m); if (e.shiftKey !== freeAngle) setFreeAngle(e.shiftKey);
                if (pan) { const r = svg.current!.getBoundingClientRect(); setView({ ...v, x: pan.vx - ((e.clientX - pan.sx) / r.width) * v.w, y: pan.vy - ((e.clientY - pan.sy) / r.height) * v.h }); }
                if (drag) {
                  const nx = snapTo(m[0] + drag.dx, 0.5), ny = snapTo(m[1] + drag.dy, 0.5);
                  const p = design.placements[drag.id];
                  if (p && (p.x !== nx || p.y !== ny)) {
                    if (!drag.moved) { s.beginHistory(); setDrag({ ...drag, moved: true }); }
                    s.editPcb((d) => ({ ...d, placements: { ...d.placements, [drag.id]: { ...d.placements[drag.id], x: nx, y: ny } } }), false);
                  }
                }
              }}
              onPointerUp={() => { setDrag(null); setPan(null); }}
              onPointerLeave={() => { setDrag(null); setPan(null); }}
            >
              <defs><pattern id="pg" width="2.54" height="2.54" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="0.08" fill="#27272a" /></pattern></defs>
              <rect x={-1000} y={-1000} width={3000} height={3000} fill="url(#pg)" />
              <polygon points={boardPoly.map((p) => p.join(',')).join(' ')} fill="#0b2a1c" stroke="#eab308" strokeWidth={0.3} />
              {design.zones.filter((z) => z.layer === 'top' || z.layer === 'bottom').map((z) => <polygon key={z.id} points={zoneShape(z).map((p) => p.join(',')).join(' ')} fill={z.layer === 'top' ? TOP : BOT} opacity={sel?.id === z.id ? 0.4 : 0.15} onPointerDown={(e) => { if (tool === 'select') { e.stopPropagation(); setSel({ kind: 'zone', id: z.id }); } }} />)}
              {(['bottom', 'top'] as const).map((L) => design.tracks.filter((t) => t.layer === L).map((t) => (
                <polyline key={t.id} points={t.pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={L === 'top' ? TOP : BOT} strokeWidth={t.width} strokeLinecap="round" strokeLinejoin="round" opacity={copper === L ? 0.95 : 0.55}
                  style={sel?.id === t.id ? { filter: 'drop-shadow(0 0 0.4px #fff)' } : undefined} onPointerDown={(e) => { if (tool === 'select') { e.stopPropagation(); setSel({ kind: 'track', id: t.id }); } }} />
              )))}
              {(design.holes ?? []).map((m, i) => <g key={`h${i}`}><circle cx={m.x} cy={m.y} r={m.drill / 2 + 0.3} fill="none" stroke="#a1a1aa" strokeWidth={0.12} /><circle cx={m.x} cy={m.y} r={m.drill / 2} fill="#09090b" stroke="#71717a" strokeWidth={0.1} /></g>)}
              {design.vias.map((x) => <g key={x.id} onPointerDown={(e) => { if (tool === 'select') { e.stopPropagation(); setSel({ kind: 'via', id: x.id }); } }}><circle cx={x.x} cy={x.y} r={x.dia / 2} fill="#a1a1aa" stroke={sel?.id === x.id ? '#fff' : '#52525b'} strokeWidth={0.1} /><circle cx={x.x} cy={x.y} r={x.drill / 2} fill="#09090b" /></g>)}
              {s.circuit.components.filter((c) => isPhysical(getDef(c.type)) && design.placements[c.id]).map((c) => {
                const pl = design.placements[c.id], fp = resolveFootprint(getDef(c.type), pl, design).fp;
                const selected = s.selection?.kind === 'comp' && s.selection.id === c.id;
                return (
                  <g key={c.id}>
                    <g transform={`translate(${pl.x} ${pl.y}) rotate(${pl.rot}) scale(${pl.side === 'bottom' ? -1 : 1} 1)`} onPointerDown={(e) => { if (tool !== 'select') return; e.stopPropagation(); s.select({ kind: 'comp', id: c.id }); const m = toMm(e); setDrag({ id: c.id, dx: pl.x - m[0], dy: pl.y - m[1], moved: false }); }} style={{ cursor: tool === 'select' ? 'move' : 'default' }}>
                      <rect x={-fp.width / 2} y={-fp.height / 2} width={fp.width} height={fp.height} fill="#ffffff08" stroke={selected ? '#22d3ee' : '#a3a3a3'} strokeWidth={selected ? 0.25 : 0.12} />
                    </g>
                    <text x={pl.x} y={pl.y - fp.height / 2 - 0.5} fontSize="1.8" fill="#fde68a" textAnchor="middle">{c.ref}</text>
                  </g>
                );
              })}
              {pads.map((p) => (
                <g key={`${p.comp}:${p.pin}`} onPointerEnter={() => setHl({ x: p.x, y: p.y })}>
                  {p.shape === 'circle' ? <circle cx={p.x} cy={p.y} r={p.w / 2} fill={p.layers.includes('top') ? '#c9a227' : '#7aa7e8'} /> : <rect x={p.x - p.w / 2} y={p.y - p.h / 2} width={p.w} height={p.h} rx={p.shape === 'oval' ? Math.min(p.w, p.h) / 2 : 0} fill={p.layers.includes('top') ? '#c9a227' : '#7aa7e8'} />}
                  {p.drill > 0 && <circle cx={p.x} cy={p.y} r={p.drill / 2} fill="#09090b" />}
                  <title>{`${p.ref}.${p.pin} — ${netLabel(design, keys[p.net], netNames[p.net] ?? '')} [${classOfKey(design, keys[p.net]).name}]`}</title>
                </g>
              ))}
              {conn.unrouted.map((u, i) => <line key={i} x1={u.ax} y1={u.ay} x2={u.bx} y2={u.by} stroke="#facc15" strokeWidth={0.12} strokeDasharray="0.6 0.4" />)}
              {drc.filter((d) => d.x !== undefined && d.severity !== 'info').map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={1.1} fill="none" stroke={d.severity === 'error' ? '#ef4444' : '#f59e0b'} strokeWidth={0.2} />)}
              {hl && null}
              {(tool === 'zonepoly' || tool === 'outline') && pts.length > 0 && (
                <polyline points={[...pts, ...(cursor ? [[snapTo(cursor[0], 0.5), snapTo(cursor[1], 0.5)]] : [])].map((p) => p.join(',')).join(' ')} fill={tool === 'zonepoly' ? (layer === 'bottom' ? BOT : TOP) + '33' : 'none'} stroke={tool === 'outline' ? '#eab308' : layer === 'bottom' ? BOT : TOP} strokeWidth={0.2} strokeDasharray="0.6 0.4" />
              )}
              {(tool === 'track' || tool === 'via') && pts.length > 0 && cursor && (
                <>
                  <polyline points={[...pts, nextPt ?? pts[pts.length - 1]].map((p) => p.join(',')).join(' ')} fill="none" stroke={live.length ? '#ff2d2d' : copper === 'top' ? TOP : BOT} strokeWidth={classAt(pts).width} opacity={0.75} strokeLinecap="round" />
                  {live.map((d, i) => <circle key={`lv${i}`} cx={d.x} cy={d.y} r={0.9} fill="#ff2d2d33" stroke="#ff2d2d" strokeWidth={0.15} />)}
                </>
              )}
            </svg>
          )}
          <div className="absolute left-2 bottom-2 text-[11px] text-zinc-400 bg-black/60 rounded px-2 py-1 pointer-events-none">
            {tool === 'track' ? 'İz: tıkla = köşe, pad’e tıkla = bitir, V = via + katman değiştir, Enter/çift tık = bitir, 45° kilit (Shift = serbest açı), kırmızı = aralık ihlali, Esc = iptal' : tool === 'via' ? 'Via: tıkla' : tool === 'zone' ? 'Zone: bir pad’e tıkla (seçili katmana tam kart bakır alanı)' : tool === 'zonepoly' ? 'Zone çokgen: tıkla = köşe, çift tık/Enter = bitir, Esc = iptal (net: Kart sekmesinden, katman: üstteki seçici)' : tool === 'outline' ? 'Kart sınırı: tıkla = köşe, çift tık/Enter = bitir (mevcut sınırın yerine geçer), Esc = iptal' : tool === 'hole' ? `Montaj deliği: tıkla = yerleştir (Ø ${holeDrill} mm, Kart sekmesinden değişir; NPTH)` : 'Sürükle: parça · R: döndür · F: alt/üst yüz · Del: seçili iz/via/zone sil · kaydır: arka plan sürükle'} · y = {cursor ? cursor[1].toFixed(2) : '—'} x = {cursor ? cursor[0].toFixed(2) : '—'} mm
          </div>
        </div>
        <div className="w-80 shrink-0 border-l border-zinc-800 bg-zinc-900 flex flex-col min-h-0">
          <div className="flex border-b border-zinc-800 text-xs">
            {(['drc', 'rules', 'board', 'len', 'calc'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`flex-1 px-2 py-2 ${tab === t ? 'bg-zinc-800 text-white' : 'text-zinc-500'}`}>{t === 'drc' ? 'DRC / ERC' : t === 'rules' ? 'Kurallar' : t === 'board' ? 'Kart' : t === 'len' ? 'Uzunluk' : 'Hesaplar'}</button>)}
          </div>
          <div className="flex-1 overflow-y-auto p-3 text-xs">
            {tab === 'drc' && (
              <div className="space-y-2">
                {!drc.length && <div className="text-emerald-400">DRC sorunsuz (tasarım kurallarına göre).</div>}
                {drc.map((d, i) => <div key={i} onClick={() => d.x !== undefined && setView({ x: d.x - 12, y: (d.y ?? 0) - 8, w: 24, h: 16 })} className={`cursor-pointer ${d.severity === 'error' ? 'text-red-300' : d.severity === 'warning' ? 'text-amber-300' : 'text-zinc-400'}`}>{d.severity === 'error' ? '✖' : d.severity === 'warning' ? '⚠' : 'ℹ'} <b>{d.code}</b> {d.message}</div>)}
                <div className="pt-2 border-t border-zinc-800 text-zinc-500">EMC ön kontrolleri (sezgisel)</div>
                {emc.map((d, i) => <div key={i} className="text-zinc-300">• {d.message}</div>)}
                {!emc.length && <div className="text-zinc-500">Bulgu yok.</div>}
                <div className="text-zinc-600 pt-2">Üretim öncesi: yerel DRC yalnızca bu uygulamadaki kuralları denetler; üreticinin kendi DFM kontrolünü de kullanın. Footprint’ler genel üretilmiş şablonlardır, datasheet land pattern’i değildir.</div>
              </div>
            )}
            {tab === 'rules' && (
              <div className="space-y-2">
                {([['minWidth', 'Min. iz genişliği (mm)'], ['minClearance', 'Min. boşluk (mm)'], ['minDrill', 'Min. delik (mm)'], ['minAnnular', 'Min. annular ring (mm)'], ['edgeClearance', 'Kenar boşluğu (mm)'], ['defaultWidth', 'Varsayılan iz (mm)'], ['viaDia', 'Via çapı (mm)'], ['viaDrill', 'Via deliği (mm)'], ['copperOz', 'Bakır (oz)'], ['voltage', 'Çalışma gerilimi, tepe (V)'], ['thickness', 'Kart kalınlığı (mm)'], ['er', 'εr']] as [keyof PcbRules, string][]).map(([k, label]) => (
                  <label key={k} className="flex items-center justify-between gap-2 text-zinc-400">{label}<input className={inp} type="number" step="0.05" value={R[k] as number} onChange={(e) => setRule(k, Number(e.target.value))} /></label>
                ))}
                <label className="flex items-center justify-between text-zinc-400">Katman sayısı<select className={inp} value={R.layers} onChange={(e) => setRule('layers', Number(e.target.value))}><option value={2}>2</option><option value={4}>4 (iç düzlem)</option></select></label>
                <label className="flex items-center justify-between text-zinc-400">Kart (mm) G × Y
                  <span><input className={`${inp} w-14`} type="number" disabled={!!design.outline.poly} title={design.outline.poly ? 'Çokgen kart: Kart sekmesinden köşeleri düzenleyin' : undefined} value={design.outline.w} onChange={(e) => s.editPcb((d) => ({ ...d, outline: { ...d.outline, w: Number(e.target.value) } }))} /> × <input className={`${inp} w-14`} type="number" disabled={!!design.outline.poly} value={design.outline.h} onChange={(e) => s.editPcb((d) => ({ ...d, outline: { ...d.outline, h: Number(e.target.value) } }))} /></span>
                </label>
                <div className="pt-2 border-t border-zinc-800 text-zinc-300"><b>Net sınıfları</b></div>
                <table className="w-full text-[11px]">
                  <thead><tr className="text-zinc-500 text-left"><th>Ad</th><th>İz</th><th>Boşluk</th><th>Via Ø</th><th>Delik</th><th /></tr></thead>
                  <tbody>
                    {classes.map((c) => {
                      const def = c.name === DEFAULT_CLASS;
                      const num = (k: 'width' | 'clearance' | 'viaDia' | 'viaDrill') => <input className={`${inp} !w-11`} type="number" step="0.05" min="0" disabled={def} value={c[k]} onChange={(e) => patchClass(c.name, { [k]: Number(e.target.value) })} />;
                      return (
                        <tr key={c.name}>
                          <td>{def ? <span title="Genel kurallardan gelir">{c.name}</span> : <input className={`${inp} !w-16`} defaultValue={c.name} onBlur={(e) => { if (e.target.value !== c.name) renameClass(c.name, e.target.value); }} />}</td>
                          <td>{num('width')}</td><td>{num('clearance')}</td><td>{num('viaDia')}</td><td>{num('viaDrill')}</td>
                          <td>{!def && <button className="text-red-400 px-1" title="Sınıfı sil" onClick={() => removeClass(c.name)}>✕</button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <button className={btn} onClick={addClass}>+ Sınıf ekle</button>
                {classes.filter((c) => c.name !== DEFAULT_CLASS).map((c) => (
                  <div key={c.name} className="flex items-center gap-1 text-[11px] text-zinc-400 flex-wrap">
                    <span className="w-14 truncate">{c.name}</span>
                    <label>fark aralığı <input className={`${inp} !w-11`} type="number" step="0.05" min="0" value={c.diffGap ?? ''} placeholder="—" onChange={(e) => patchClass(c.name, { diffGap: Number(e.target.value) > 0 ? Number(e.target.value) : undefined })} /></label>
                    <label>hedef uz. <input className={`${inp} !w-12`} type="number" step="0.5" min="0" value={c.targetLength ?? ''} placeholder="—" onChange={(e) => patchClass(c.name, { targetLength: Number(e.target.value) > 0 ? Number(e.target.value) : undefined })} /></label>
                    <label>tol. <input className={`${inp} !w-10`} type="number" step="0.1" min="0" value={c.lengthTol ?? ''} placeholder="1" onChange={(e) => patchClass(c.name, { lengthTol: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                  </div>
                ))}
                <div className="pt-2 border-t border-zinc-800 text-zinc-300"><b>Fark çiftleri</b></div>
                {pairs.map((p) => (
                  <div key={`${p.p}-${p.n}`} className="flex items-center gap-1 text-zinc-400">
                    <span className="flex-1 truncate">{netLabel(design, keys[p.p], netNames[p.p] ?? '')} / {netLabel(design, keys[p.n], netNames[p.n] ?? '')} · aralık {p.gap} mm · {p.source === 'auto' ? 'otomatik (_P/_N)' : 'seçim'}</span>
                    {p.source === 'user' && <button className="text-red-400 px-1" title="Çifti sil" onClick={() => s.editPcb((d) => ({ ...d, diffPairs: (d.diffPairs ?? []).filter((q) => !(q.p === keys[p.p] && q.n === keys[p.n])) }))}>✕</button>}
                  </div>
                ))}
                {!pairs.length && <div className="text-zinc-500">Çift yok. Otomatik: aralığı (fark aralığı) tanımlı sınıftaki X_P / X_N adlı iki net. Elle: aşağıdan iki net seç.</div>}
                <div className="flex items-center gap-1">
                  <select className={`${inp} !w-24`} id="dp-p" defaultValue="">{[<option key="" value="">P net</option>, ...boardNets.map((n) => <option key={n} value={keys[n]}>{netLabel(design, keys[n], netNames[n] ?? '')}</option>)]}</select>
                  <select className={`${inp} !w-24`} id="dp-n" defaultValue="">{[<option key="" value="">N net</option>, ...boardNets.map((n) => <option key={n} value={keys[n]}>{netLabel(design, keys[n], netNames[n] ?? '')}</option>)]}</select>
                  <button className={btn} onClick={() => { const a = (document.getElementById('dp-p') as HTMLSelectElement).value, b = (document.getElementById('dp-n') as HTMLSelectElement).value; if (!a || !b || a === b) { flash('İki farklı net seçin.'); return; } s.editPcb((d) => ({ ...d, diffPairs: [...(d.diffPairs ?? []).filter((q) => q.p !== a && q.n !== b && q.p !== b && q.n !== a), { p: a, n: b }] })); }}>Çift ekle</button>
                </div>
                <div className="text-zinc-500">Otomatik yönlendirmede “fark çifti” açıksa P net normal yönlendirilir, N net sabit ofsetle türetilir ve DRC ile doğrulanır; geçemezse “başarısız” bildirilir ve N normal yönlendirilir. Yalnız 2 pinli netler; empedans/uzunluk eşitleme yok. Aralık: sınıfın fark aralığı (yoksa sınıf boşluğu).</div>
                <div className="text-zinc-500">Default satırı genel kuralları (varsayılan iz, min. boşluk, via) yansıtır. Boşlukta iki sınıfın büyüğü, iz genişliği alt sınırında sınıfın izi kullanılır.</div>
                <div className="pt-2 border-t border-zinc-800 text-zinc-300"><b>Net adları ve sınıfları</b></div>
                {boardNets.map((n) => (
                  <div key={keys[n]} className="flex items-center gap-1">
                    <input className={`${inp} !w-28`} placeholder={netNames[n]} defaultValue={design.netNames?.[keys[n]] ?? ''} onBlur={(e) => { if (e.target.value.trim() !== (design.netNames?.[keys[n]] ?? '')) renameNet(keys[n], e.target.value); }} title={`Net anahtarı ${keys[n]}`} />
                    <select className={`${inp} !w-24`} value={classOfKey(design, keys[n]).name} onChange={(e) => assignClass(keys[n], e.target.value)}>
                      {classes.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                ))}
                {!boardNets.length && <div className="text-zinc-500">Kartta pad’i olan net yok.</div>}
                <div className="text-zinc-500">Atama kararlı net anahtarına bağlıdır (netin en küçük pin anahtarı): devre değişince kaymaz; o pin ağdan çıkarsa atama kaybolabilir.</div>
                <div className="text-zinc-500">Kurallar üretici yeteneklerine göre ayarlanmalıdır (ucuz prototip hizmetleri tipik olarak 0.15–0.2 mm iz/boşluk, 0.3 mm delik).</div>
              </div>
            )}
            {tab === 'board' && (
              <div className="space-y-2">
                {(() => {
                  const sc = s.selection?.kind === 'comp' ? s.circuit.components.find((c) => c.id === s.selection!.id) : undefined;
                  const def = sc ? getDef(sc.type) : undefined;
                  const pl = sc ? design.placements[sc.id] : undefined;
                  if (!sc || !def || !pl || !isPhysical(def)) return <div className="text-zinc-500">Footprint seçmek için karttan bir parça seçin.</div>;
                  const keys2 = [...footprintCatalog().filter((f) => f.pins === def.pins.length).map((f) => f.key), ...Object.keys(design.customFootprints ?? {})];
                  const r = resolveFootprint(def, pl, design);
                  return (
                    <div className="space-y-1 pb-2 border-b border-zinc-800">
                      <div className="text-zinc-300"><b>Footprint — {sc.ref}</b> <span className="text-zinc-500">({def.pins.length} pin; etkin: {r.fp.name})</span></div>
                      <select className={`${inp} !w-44`} value={pl.footprint ?? ''} onChange={(e) => s.editPcb((d) => ({ ...d, placements: { ...d.placements, [sc.id]: { ...d.placements[sc.id], footprint: e.target.value || undefined } } }))}>
                        <option value="">Otomatik (varsayılan)</option>
                        {keys2.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                      {r.warning && <div className="text-amber-400">{r.warning}</div>}
                      <div className="text-zinc-500">Boyutlar tipiktir, datasheet land pattern’i değildir (doğrulanmadı).</div>
                      {fpEdit
                        ? <FootprintEditor initial={r.fp} onCancel={() => setFpEdit(false)} onSave={(key, fp) => { s.editPcb((d) => ({ ...d, customFootprints: { ...(d.customFootprints ?? {}), [key]: fp }, placements: { ...d.placements, [sc.id]: { ...d.placements[sc.id], footprint: key } } })); setFpEdit(false); }} />
                        : <button className={btn} onClick={() => setFpEdit(true)}>Özel footprint düzenle…</button>}
                    </div>
                  );
                })()}
                <div className="text-zinc-300"><b>Kart sınırı</b></div>
                {!design.outline.poly ? (
                  <>
                    <div className="text-zinc-500">Dikdörtgen {design.outline.w} × {design.outline.h} mm. Köşeleri düzenlemek için çokgene çevirin ya da “⬠ Kart sınırı” aracıyla çizin.</div>
                    <button className={btn} onClick={() => s.editPcb((d) => ({ ...d, outline: { ...d.outline, poly: [[0, 0], [d.outline.w, 0], [d.outline.w, d.outline.h], [0, d.outline.h]] } }))}>Dikdörtgeni çokgene çevir</button>
                  </>
                ) : (
                  <>
                    {design.outline.poly.map((p, i) => (
                      <div key={i} className="flex items-center gap-1 text-zinc-400">{i + 1}.
                        {([0, 1] as const).map((k) => <input key={k} className={`${inp} !w-16`} type="number" step="0.5" value={p[k]} onChange={(e) => s.editPcb((d) => { const poly = (d.outline.poly ?? []).map((q, j) => (j === i ? (k === 0 ? [Number(e.target.value), q[1]] : [q[0], Number(e.target.value)]) as [number, number] : q)); const bb = polyBBox(poly); return { ...d, outline: { w: Math.ceil(bb[2]), h: Math.ceil(bb[3]), poly } }; })} />)}
                        <button className="text-red-400 px-1 disabled:opacity-30" disabled={(design.outline.poly?.length ?? 0) <= 3} title="Köşeyi sil" onClick={() => s.editPcb((d) => { const poly = (d.outline.poly ?? []).filter((_, j) => j !== i); const bb = polyBBox(poly); return { ...d, outline: { w: Math.ceil(bb[2]), h: Math.ceil(bb[3]), poly } }; })}>✕</button>
                      </div>
                    ))}
                    <button className={btn} onClick={() => s.editPcb((d) => { const bb = polyBBox(d.outline.poly ?? []); return { ...d, outline: { w: Math.ceil(bb[2]), h: Math.ceil(bb[3]) } }; })}>Dikdörtgene dön (sınır kutusu)</button>
                  </>
                )}
                <div className="pt-2 border-t border-zinc-800 text-zinc-300"><b>Zone’lar</b></div>
                <label className="flex items-center justify-between gap-2 text-zinc-400">Yeni çokgen zone net’i
                  <select className={`${inp} !w-32`} value={zoneNet ?? boardNets[0] ?? ''} onChange={(e) => setZoneNet(Number(e.target.value))}>
                    {boardNets.map((n) => <option key={n} value={n}>{netLabel(design, keys[n], netNames[n] ?? '')}</option>)}
                  </select>
                </label>
                {!design.zones.length && <div className="text-zinc-500">Zone yok.</div>}
                {design.zones.map((z) => {
                  const net = pads.find((p) => p.comp === z.anchor.comp && p.pin === z.anchor.pin)?.net ?? -1;
                  const patch = (p: Partial<Zone>) => s.editPcb((d) => ({ ...d, zones: d.zones.map((q) => (q.id === z.id ? { ...q, ...p } : q)) }));
                  return (
                    <div key={z.id} className={`border rounded p-1 space-y-1 ${sel?.id === z.id ? 'border-emerald-600' : 'border-zinc-800'}`}>
                      <div className="flex items-center gap-1 text-zinc-300">
                        <span className="flex-1 truncate" title={`${z.anchor.comp}.${z.anchor.pin}`}>{net >= 0 ? netLabel(design, keys[net], netNames[net] ?? '') : 'net yok'}</span>
                        <select className={`${inp} !w-24`} value={z.layer} onChange={(e) => patch({ layer: e.target.value as ZoneLayer })}>
                          <option value="top">Üst</option><option value="bottom">Alt</option>{R.layers === 4 && <><option value="in1">İç 1</option><option value="in2">İç 2</option></>}
                        </select>
                        <button className="text-red-400 px-1" title="Zone’u sil" onClick={() => { s.editPcb((d) => ({ ...d, zones: d.zones.filter((q) => q.id !== z.id) })); setSel(null); }}>✕</button>
                      </div>
                      <div className="flex items-center gap-2 text-zinc-400">
                        <label>Öncelik <input className={`${inp} !w-10`} type="number" step="1" value={z.priority ?? 0} onChange={(e) => patch({ priority: Math.round(Number(e.target.value)) })} /></label>
                        <label>Boşluk <input className={`${inp} !w-12`} type="number" step="0.05" min="0" value={z.clearance} onChange={(e) => patch({ clearance: Number(e.target.value) })} /></label>
                        <span className="text-zinc-500">{z.poly ? `${z.poly.length} köşe` : 'tam kart'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-zinc-400">
                        <label className="flex items-center gap-1"><input type="checkbox" checked={!!z.thermal} onChange={(e) => patch({ thermal: e.target.checked ? { gap: 0.3, spokeW: 0.3 } : undefined })} />termal</label>
                        {z.thermal && <>
                          <label>aralık <input className={`${inp} !w-12`} type="number" step="0.05" min="0.05" value={z.thermal.gap} onChange={(e) => patch({ thermal: { gap: Number(e.target.value), spokeW: z.thermal!.spokeW } })} /></label>
                          <label>spoke <input className={`${inp} !w-12`} type="number" step="0.05" min="0.05" value={z.thermal.spokeW} onChange={(e) => patch({ thermal: { gap: z.thermal!.gap, spokeW: Number(e.target.value) } })} /></label>
                        </>}
                      </div>
                    </div>
                  );
                })}
                <div className="text-zinc-500">Aynı katmanda yüksek öncelikli zone alçakların üstüne dolar. Termal rölyef Gerber’de aynı net pad’lerine 4 spoke yazar. Çokgen zone kart sınırına kırpılmaz: sınırın içinde çizin (DRC ZONE_OUTSIDE uyarır). Ada temizliği ve min. kalınlık uygulaması yok.</div>
                <div className="pt-2 border-t border-zinc-800 text-zinc-300"><b>Montaj delikleri (NPTH)</b></div>
                <label className="flex items-center justify-between gap-2 text-zinc-400">Yeni delik Ø (mm)<input className={inp} type="number" step="0.1" min="0.5" value={holeDrill} onChange={(e) => setHoleDrill(Number(e.target.value) || 3.2)} /></label>
                {(design.holes ?? []).map((m, i) => {
                  const patch = (p: Partial<typeof m>) => s.editPcb((d) => ({ ...d, holes: (d.holes ?? []).map((q, j) => (j === i ? { ...q, ...p } : q)) }));
                  return (
                    <div key={i} className="flex items-center gap-1 text-zinc-400">{i + 1}.
                      <input className={`${inp} !w-14`} type="number" step="0.5" value={m.x} title="x" onChange={(e) => patch({ x: Number(e.target.value) })} />
                      <input className={`${inp} !w-14`} type="number" step="0.5" value={m.y} title="y" onChange={(e) => patch({ y: Number(e.target.value) })} />
                      <input className={`${inp} !w-12`} type="number" step="0.1" min="0.3" value={m.drill} title="delik Ø" onChange={(e) => patch({ drill: Number(e.target.value) })} />
                      <button className="text-red-400 px-1" title="Deliği sil" onClick={() => s.editPcb((d) => ({ ...d, holes: (d.holes ?? []).filter((_, j) => j !== i) }))}>✕</button>
                    </div>
                  );
                })}
                {!(design.holes ?? []).length && <div className="text-zinc-500">Montaj deliği yok. “⊙ Montaj deliği” aracıyla kartta tıklayarak ekleyin.</div>}
              </div>
            )}
            {tab === 'len' && (
              <div className="space-y-2">
                <div className="text-zinc-500">Net uzunluğu = o neta bağlı iz parçalarının orta çizgi toplamı + her via için kart kalınlığı ({R.thickness} mm). Dallı netlerde tüm dallar toplanır (noktadan noktaya yol uzunluğu değil); pad içi bakır ve zone dahil değil. Hedef (net başına, ya da sınıf) tolerans dışındaysa DRC LENGTH uyarısı verir.</div>
                <table className="w-full text-[11px]">
                  <thead><tr className="text-zinc-500 text-left"><th>Net</th><th>Sınıf</th><th className="text-right">İz</th><th className="text-right">Via</th><th className="text-right">Toplam</th><th className="text-right">Hedef</th><th className="text-right">Sapma</th></tr></thead>
                  <tbody>
                    {lengths.map((r) => (
                      <tr key={r.key} className={r.violates ? 'text-amber-300' : r.complete ? 'text-zinc-300' : 'text-zinc-500'} title={r.complete ? undefined : 'Bağlanmamış hat var: uzunluk eksik'}>
                        <td className="truncate max-w-[5rem]">{r.name}</td><td>{r.className}</td>
                        <td className="text-right">{r.trackMm.toFixed(2)}</td><td className="text-right">{r.viaCount}</td><td className="text-right"><b>{r.totalMm.toFixed(2)}</b></td>
                        <td className="text-right"><input className={`${inp} !w-12 text-right`} type="number" min="0" step="0.5" placeholder="—" defaultValue={design.netLengthTargets?.[r.key]?.mm ?? ''} key={`${r.key}:${design.netLengthTargets?.[r.key]?.mm ?? ''}`}
                          onBlur={(e) => { const v = Number(e.target.value); s.editPcb((d) => { const m = { ...(d.netLengthTargets ?? {}) }; if (v > 0) m[r.key] = { mm: v, tol: m[r.key]?.tol }; else delete m[r.key]; return { ...d, netLengthTargets: m }; }); }} /></td>
                        <td className="text-right">{r.deviationMm === undefined ? '' : `${r.deviationMm > 0 ? '+' : ''}${r.deviationMm.toFixed(2)}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!lengths.length && <div className="text-zinc-500">Kartta pad’i olan net yok.</div>}
                <div className="text-zinc-500">Sapma = toplam − hedef. Tolerans: net hedefinde varsayılan ±1 mm, sınıf için Kurallar sekmesindeki “hedef uzunluk/tolerans”. Uzunluk eşitleme (serpantin) yok.</div>
              </div>
            )}
            {tab === 'calc' && <Calc rules={R} />}
          </div>
        </div>
      </div>
    </div>
  );
}
