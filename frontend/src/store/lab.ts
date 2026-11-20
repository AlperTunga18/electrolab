import { create } from 'zustand';
import type { Circuit, Fault, Firmware, HeatsinkSize, ParamValue, PinRef, PlacedComponent, Wire } from '../core/circuit/types';
import { defaultParams, getDef } from '../library/components';
import { LiveRunner, type LiveSnapshot } from '../core/sim/runner';
import { Sim, SimError, type MeterSpec } from '../core/sim/mna';
import { effectiveCircuit } from '../core/sim/faults';
import { heatPower, type FailureReport, type ThermalState } from '../core/sim/damage';
import { effectiveRth, thermalSpec } from '../core/thermal/thermal';
import { checkStress, type Overstress } from '../core/sim/stress';
import { autosave, readAutosave } from './persist';
import type { Lang } from '../i18n';
import type { Diagnostic } from '../core/mcu/types';
import { createRuntime } from '../core/mcu/factory';
import { LESSONS } from '../education/content';
import { ensureDesign } from '../core/pcb/design';
import type { PcbDesign } from '../core/pcb/types';
import { pruneTaps } from '../core/circuit/taps';
import { alignComponents, distributeComponents, internalWires, pasteGroup, removeGroup, rotateGroup, translateComponents, type AlignMode, type DistributeAxis } from '../core/circuit/selection';

export type View = 'home' | 'schematic' | 'pcb' | 'lesson' | 'notebook' | 'mculab' | 'lab' | 'library' | 'projects' | 'academy' | 'simcenter' | 'settings' | 'planned';
export type InstKind = 'dmm' | 'analog' | 'lcr' | 'esr' | 'counter' | 'power' | 'logic' | 'insulation' | 'bode';
export type DmmMode = 'vdc' | 'vac' | 'vtrms' | 'adc' | 'aac' | 'ohm' | 'diode' | 'cont' | 'cap' | 'freq';
export interface MeasEntry { id: number; t: string; inst: string; text: string }
export type Selection = { kind: 'comp'; id: string } | { kind: 'wire'; id: string } | null;
export interface LogEntry { id: number; time: string; level: 'info' | 'warn' | 'error'; text: string }

const HISTORY_MAX = 100;
const WIRE_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#e5e7eb', '#111827', '#06b6d4'];
export { WIRE_COLORS };

let idCounter = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

interface LabState {
  view: View;
  plannedTitle: string;
  lang: Lang;
  libVersion: number;
  /** lesson shown on the lesson page */
  lessonId: string | null;
  /** lesson the lab is currently running as an experiment/challenge/fault hunt */
  activeLesson: { id: string; mode: 'lab' | 'challenge' | 'hunt' } | null;
  /** faults of a fault-hunt exercise: applied to the simulation but hidden from every UI list */
  hiddenFaults: Record<string, Fault>;
  rightTab: 'props' | 'lesson';

  projectName: string;
  projectId: string | null;
  projectSource: 'backend' | 'local' | null;
  dirty: boolean;

  circuit: Circuit;
  past: Circuit[];
  future: Circuit[];
  selection: Selection;
  /** multi-selection (component ids). Empty unless 2+ parts are selected together */
  multi: string[];
  clipboard: PlacedComponent[];
  /** wires between the copied parts */
  clipboardWires: Wire[];
  /** orthogonal auto-routing of wires in the 3D view */
  autoRoute: boolean;

  armedType: string | null;
  pendingPin: PinRef | null;
  wireColor: string;
  wireWidth: number;
  grid: number;
  showLabels: boolean;
  showVoltage: boolean;
  dragging: boolean;

  panels: { left: boolean; right: boolean; bottom: boolean; leftW: number; rightW: number; bottomH: number };
  bottomTab: 'scope' | 'meas' | 'devices' | 'protocol' | 'assistant' | 'analysis' | 'faults' | 'code' | 'serial' | 'gpio' | 'log';
  probes: { red: PinRef | null; black: PinRef | null };
  /** which probe the next pin click assigns */
  probeTarget: 'red' | 'black' | null;
  instKind: InstKind;
  dmmMode: DmmMode;
  /** analog meter full-scale (V) */
  meterRange: number;
  /** instrument is connected to the circuit (loads it) */
  meterOn: boolean;
  /** power-off static measurements: de-energise sources virtually */
  powerOff: boolean;
  watchComp: string | null;
  measLog: MeasEntry[];
  /** serial monitor text per MCU component */
  serial: Record<string, string>;
  /** compile/parse diagnostics per MCU component */
  diagnostics: Record<string, Diagnostic[]>;
  /** MCU component currently shown in code/serial/gpio tabs */
  mcuTarget: string | null;

  simStatus: 'stopped' | 'running' | 'error';
  simSpeed: number;
  live: LiveSnapshot | null;
  peakStress: Record<string, Overstress & { t: number }>;
  log: LogEntry[];
  thermalView: boolean;
  damageEnabled: boolean;
  thermalSpeed: number;
  failures: FailureReport[];

  // actions
  go: (v: View, plannedTitle?: string) => void;
  setLang: (l: Lang) => void;
  commit: (c: Circuit) => void;
  beginDrag: () => void;
  addComponent: (type: string, x: number, z: number) => string;
  moveComponent: (id: string, x: number, z: number) => void;
  rotateSelected: () => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  copy: () => void;
  paste: () => void;
  setParam: (id: string, key: string, v: ParamValue) => void;
  toggleSwitch: (id: string) => void;
  addWire: (a: PinRef, b: PinRef) => void;
  setWireStyle: (id: string, patch: Partial<Pick<Wire, 'color' | 'width'>>) => void;
  select: (s: Selection) => void;
  toggleMulti: (id: string) => void;
  setMulti: (ids: string[]) => void;
  clearMulti: () => void;
  selectAll: () => void;
  /** live group drag (no history; call beginDrag first): moves every selected part by the anchor's delta */
  moveMulti: (anchorId: string, x: number, z: number) => void;
  alignSelected: (mode: AlignMode) => void;
  distributeSelected: (axis: DistributeAxis) => void;
  setParamMulti: (ids: string[], key: string, v: ParamValue) => void;
  setAutoRoute: (on: boolean) => void;
  arm: (type: string | null) => void;
  setPendingPin: (p: PinRef | null) => void;
  set: (patch: Partial<LabState>) => void;
  undo: () => void;
  redo: () => void;
  loadCircuit: (circuit: Circuit, name: string, id?: string | null, source?: 'backend' | 'local' | null) => void;
  newProject: () => void;
  log_: (level: LogEntry['level'], text: string) => void;
  run: () => void;
  stopSim: () => void;
  resetSim: () => void;
  dcSolve: () => void;
  setSpeed: (v: number) => void;
  setSch: (id: string, p: { x: number; y: number; rot: 0 | 1 | 2 | 3 }, history?: boolean) => void;
  setAllSch: (layout: Record<string, { x: number; y: number; rot: 0 | 1 | 2 | 3 }>) => void;
  /** patch the schematic placement of several parts at once (one undo step when history) */
  setSchMany: (patch: Record<string, { x: number; y: number; rot: 0 | 1 | 2 | 3 }>, history?: boolean) => void;
  /** T-junction: wire from `pin` to the middle of wire `host` at schematic point (x, y). Returns false when invalid */
  addTapWire: (pin: PinRef, host: string, x: number, y: number) => boolean;
  /** edit the PCB design (undoable together with the circuit) */
  editPcb: (fn: (d: PcbDesign) => PcbDesign, history?: boolean) => void;
  beginHistory: () => void;
  setProbe: (which: 'red' | 'black', pin: PinRef | null) => void;
  applyMeters: () => void;
  resetFuse: () => void;
  logMeas: (inst: string, text: string) => void;
  openLesson: (id: string) => void;
  startLesson: (id: string, mode: 'lab' | 'challenge' | 'hunt') => void;
  endLesson: () => void;
  setFault: (id: string, f: Fault | null) => void;
  setWireBroken: (id: string, broken: boolean) => void;
  /** loose connector on a wire (rmax = max contact resistance in ohm); null removes it */
  setWireLoose: (id: string, loose: { rmax?: number } | null) => void;
  setThermalAccessory: (id: string, patch: { heatsink?: HeatsinkSize; fan?: boolean }) => void;
  setAmbient: (t: number) => void;
  setDamageEnabled: (on: boolean) => void;
  setThermalSpeed: (v: number) => void;
  clearFailures: () => void;
  setFirmware: (id: string, fw: Firmware | null) => void;
  checkFirmware: (id: string) => boolean;
  loadFirmware: (id: string) => void;
  serialSend: (id: string, text: string) => void;
  clearSerial: (id: string) => void;
}

const nextRef = (c: Circuit, prefix: string): string => {
  let n = 1;
  const used = new Set(c.components.map((x) => x.ref));
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
};

/** ids the group actions work on: the multi-selection, else the single selected part */
export const groupIds = (s: Pick<LabState, 'multi' | 'selection'>): string[] => (s.multi.length ? s.multi : s.selection?.kind === 'comp' ? [s.selection.id] : []);

const readAutoRoute = (): boolean => { try { return localStorage.getItem('electrolab.autoRoute') === '1'; } catch { return false; } };

const fmtTime = () => new Date().toLocaleTimeString('tr-TR');

const saved = readAutosave();
let runnerRef: LiveRunner | null = null;
export const getRunner = (): LiveRunner | null => runnerRef;

export const useLab = create<LabState>((set, get) => {
  const runner = new LiveRunner(
    (live) => set({ live }),
    (e) => {
      set({ simStatus: 'error' });
      get().log_('error', e.message);
    },
    (t, stress) => {
      const peak = { ...get().peakStress };
      let changed = false;
      for (const s of stress) {
        const prev = peak[s.key];
        if (!prev || s.ratio > prev.ratio) {
          if (!prev) get().log_('warn', `${s.ref}: ${s.label} aşıldı (${s.value.toPrecision(3)} ${s.unit} > ${s.limit} ${s.unit}) t=${t.toExponential(2)} s${s.note ? ' — ' + s.note : ''}`);
          peak[s.key] = { ...s, t: prev ? prev.t : t };
          changed = true;
        }
      }
      if (changed) set({ peakStress: peak });
    },
    (rep) => {
      set((st) => ({ failures: [...st.failures, rep], bottomTab: 'faults' }));
      get().log_('error', `ARIZA ${rep.ref} (${rep.name}): ${rep.cause === 'thermal' ? 'aşırı ısınma' : rep.limitLabel + ' aşıldı'} → ${rep.mode} t=${rep.t.toExponential(2)} s`);
    },
    {
      serial: (comp, text) => set((st) => ({ serial: { ...st.serial, [comp]: ((st.serial[comp] ?? '') + text).slice(-20000) } })),
      log: (comp, level, text, diagnostics) => {
        get().log_(level, text);
        if (diagnostics) {
          set((st) => ({ diagnostics: { ...st.diagnostics, [comp]: diagnostics } }));
          diagnostics.slice(0, 8).forEach((d) => get().log_(d.severity === 'error' ? 'error' : 'warn', `  satır ${d.line}: ${d.message}`));
        }
      },
    },
  );

  runnerRef = runner;

  const simCircuit = (c: Circuit): Circuit => {
    const h = get().hiddenFaults;
    return Object.keys(h).length ? { ...c, faults: { ...(c.faults ?? {}), ...h } } : c;
  };

  const edit = (fn: (c: Circuit) => Circuit, keepHistory = true) => {
    const s = get();
    const next = fn(s.circuit);
    if (next === s.circuit) return;
    set({
      circuit: next,
      past: keepHistory ? [...s.past, s.circuit].slice(-HISTORY_MAX) : s.past,
      future: keepHistory ? [] : s.future,
      dirty: true,
    });
    if (runner.running) runner.update(simCircuit(next));
  };

  return {
    view: 'home',
    plannedTitle: '',
    libVersion: 0,
    lessonId: null,
    activeLesson: null,
    hiddenFaults: {},
    rightTab: 'props',
    lang: (localStorage.getItem('electrolab.lang') as Lang) || 'tr',
    projectName: saved?.name ?? 'Adsız proje',
    projectId: null,
    projectSource: null,
    dirty: false,
    circuit: saved?.circuit ?? { components: [], wires: [] },
    past: [],
    future: [],
    selection: null,
    multi: [],
    clipboard: [],
    clipboardWires: [],
    autoRoute: readAutoRoute(),
    armedType: null,
    pendingPin: null,
    wireColor: WIRE_COLORS[0],
    wireWidth: 3,
    grid: 0.5,
    showLabels: true,
    showVoltage: true,
    dragging: false,
    panels: { left: true, right: true, bottom: true, leftW: 260, rightW: 300, bottomH: 260 },
    bottomTab: 'scope',
    probes: { red: null, black: null },
    probeTarget: null,
    instKind: 'dmm',
    dmmMode: 'vdc',
    meterRange: 10,
    meterOn: true,
    powerOff: false,
    watchComp: null,
    measLog: [],
    serial: {},
    diagnostics: {},
    mcuTarget: null,
    simStatus: 'stopped',
    simSpeed: 0.01,
    live: null,
    peakStress: {},
    log: [],
    thermalView: false,
    damageEnabled: true,
    thermalSpeed: 1000,
    failures: [],

    go: (view, plannedTitle = '') => set({ view, plannedTitle }),
    setLang: (lang) => { localStorage.setItem('electrolab.lang', lang); set({ lang }); },
    set: (patch) => set(patch),
    select: (selection) => set({ selection, multi: [] }),
    toggleMulti: (id) => {
      const base = groupIds(get());
      const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
      get().setMulti(next);
    },
    setMulti: (ids) => {
      const valid = new Set(get().circuit.components.map((c) => c.id));
      const next = [...new Set(ids)].filter((i) => valid.has(i));
      if (next.length >= 2) set({ multi: next, selection: null });
      else set({ multi: [], selection: next.length ? { kind: 'comp', id: next[0] } : null });
    },
    clearMulti: () => set({ multi: [], selection: null }),
    selectAll: () => get().setMulti(get().circuit.components.map((c) => c.id)),
    moveMulti: (anchorId, x, z) => {
      const s = get();
      const a = s.circuit.components.find((c) => c.id === anchorId);
      if (!a) return;
      const ids = s.multi.includes(anchorId) ? s.multi : [anchorId];
      set({ circuit: { ...s.circuit, components: translateComponents(s.circuit.components, ids, x - a.x, z - a.z) }, dirty: true });
      if (runner.running) runner.update(simCircuit(get().circuit));
    },
    alignSelected: (mode) => { const ids = get().multi; if (ids.length >= 2) edit((c) => ({ ...c, components: alignComponents(c.components, ids, mode, get().grid) })); },
    distributeSelected: (axis) => { const ids = get().multi; if (ids.length >= 3) edit((c) => ({ ...c, components: distributeComponents(c.components, ids, axis, get().grid) })); },
    setParamMulti: (ids, key, v) => {
      const s = new Set(ids);
      edit((c) => ({ ...c, components: c.components.map((x) => (s.has(x.id) ? { ...x, params: { ...x.params, [key]: v } } : x)) }));
    },
    setAutoRoute: (autoRoute) => { try { localStorage.setItem('electrolab.autoRoute', autoRoute ? '1' : '0'); } catch { /* no storage */ } set({ autoRoute }); },
    arm: (armedType) => set({ armedType, pendingPin: null }),
    setPendingPin: (pendingPin) => set({ pendingPin }),

    commit: (c) => edit(() => c),

    beginDrag: () => {
      const s = get();
      set({ past: [...s.past, s.circuit].slice(-HISTORY_MAX), future: [], dragging: true });
    },

    addComponent: (type, x, z) => {
      const def = getDef(type);
      const id = uid('c');
      const comp: PlacedComponent = { id, type, ref: nextRef(get().circuit, def.prefix), x, z, rot: 0, params: defaultParams(type) };
      edit((c) => ({ ...c, components: [...c.components, comp] }));
      set({ selection: { kind: 'comp', id }, multi: [] });
      return id;
    },

    moveComponent: (id, x, z) => {
      const s = get();
      const comps = s.circuit.components.map((c) => (c.id === id ? { ...c, x, z } : c));
      set({ circuit: { ...s.circuit, components: comps }, dirty: true });
      if (runner.running) runner.update(simCircuit(get().circuit));
    },

    rotateSelected: () => {
      const s = get();
      if (s.multi.length >= 2) { const ids = s.multi; edit((c) => ({ ...c, components: rotateGroup(c.components, ids, s.grid) })); return; }
      const sel = s.selection;
      if (sel?.kind !== 'comp') return;
      edit((c) => ({ ...c, components: c.components.map((x) => (x.id === sel.id ? { ...x, rot: ((x.rot + 1) & 3) as 0 | 1 | 2 | 3 } : x)) }));
    },

    deleteSelected: () => {
      const s = get();
      if (s.multi.length) { const ids = s.multi; edit((c) => removeGroup(c, ids)); set({ selection: null, multi: [] }); return; }
      const sel = s.selection;
      if (!sel) return;
      edit((c) =>
        sel.kind === 'comp'
          ? { components: c.components.filter((x) => x.id !== sel.id), wires: pruneTaps(c.wires.filter((w) => w.a.comp !== sel.id && w.b.comp !== sel.id)) }
          : { ...c, wires: pruneTaps(c.wires.filter((w) => w.id !== sel.id)) },
      );
      set({ selection: null, multi: [] });
    },

    duplicateSelected: () => { get().copy(); get().paste(); },
    copy: () => {
      const s = get();
      const ids = groupIds(s);
      const set_ = new Set(ids);
      const comps = s.circuit.components.filter((x) => set_.has(x.id));
      if (comps.length) set({ clipboard: comps, clipboardWires: internalWires(s.circuit.wires, ids) });
    },
    paste: () => {
      const s = get();
      if (!s.clipboard.length) return;
      const res = pasteGroup(s.circuit, s.clipboard, s.clipboardWires, 1.5, 1.5, uid, (existing, type) => nextRef({ components: existing, wires: [] }, getDef(type).prefix), 20);
      edit(() => res.circuit);
      get().setMulti(res.ids);
      set({ clipboard: s.clipboard.map((c) => ({ ...c, x: c.x + 1.5, z: c.z + 1.5, ...(c.sch ? { sch: { ...c.sch, x: c.sch.x + 20, y: c.sch.y + 20 } } : {}) })) });
    },

    setParam: (id, key, v) =>
      edit((c) => ({ ...c, components: c.components.map((x) => (x.id === id ? { ...x, params: { ...x.params, [key]: v } } : x)) })),

    toggleSwitch: (id) => {
      const c = get().circuit.components.find((x) => x.id === id);
      if (c && getDef(c.type).model === 'switch') get().setParam(id, 'closed', !(c.params.closed === true));
    },

    addWire: (a, b) => {
      if (a.comp === b.comp && a.pin === b.pin) return;
      const s = get();
      const dup = s.circuit.wires.some((w) => (w.a.comp === a.comp && w.a.pin === a.pin && w.b.comp === b.comp && w.b.pin === b.pin) || (w.a.comp === b.comp && w.a.pin === b.pin && w.b.comp === a.comp && w.b.pin === a.pin));
      if (dup) return;
      const w: Wire = { id: uid('w'), a, b, color: s.wireColor, width: s.wireWidth };
      edit((c) => ({ ...c, wires: [...c.wires, w] }));
    },

    setWireStyle: (id, patch) => edit((c) => ({ ...c, wires: c.wires.map((w) => (w.id === id ? { ...w, ...patch } : w)) })),

    undo: () => {
      const s = get();
      if (!s.past.length) return;
      const prev = s.past[s.past.length - 1];
      set({ circuit: prev, past: s.past.slice(0, -1), future: [s.circuit, ...s.future], selection: null, multi: [], dirty: true });
      if (runner.running) runner.update(simCircuit(prev));
    },
    redo: () => {
      const s = get();
      if (!s.future.length) return;
      const next = s.future[0];
      set({ circuit: next, future: s.future.slice(1), past: [...s.past, s.circuit], selection: null, multi: [], dirty: true });
      if (runner.running) runner.update(simCircuit(next));
    },

    loadCircuit: (circuit, name, id = null, source = null) => {
      runner.stop();
      set({ circuit, projectName: name, projectId: id, projectSource: source, past: [], future: [], selection: null, multi: [], dirty: false, simStatus: 'stopped', live: null, peakStress: {}, failures: [], pendingPin: null, armedType: null, activeLesson: null, hiddenFaults: {}, rightTab: 'props' });
    },
    newProject: () => get().loadCircuit({ components: [], wires: [] }, 'Adsız proje'),

    log_: (level, text) => set((s) => ({ log: [...s.log.slice(-300), { id: s.log.length ? s.log[s.log.length - 1].id + 1 : 1, time: fmtTime(), level, text }] })),

    run: () => {
      const s = get();
      runner.speed = s.simSpeed;
      runner.thermalSpeed = s.thermalSpeed;
      runner.damageEnabled = s.damageEnabled;
      runner.ambient = s.circuit.ambient ?? 25;
      set({ simStatus: 'running', peakStress: {}, failures: [], serial: {} });
      runner.start(simCircuit(s.circuit));
      if (!runner.running) return; // error already reported
      if (runner.sim?.ignored.length) s.log_('warn', `Elektriksel modeli olmayan parçalar açık devre sayıldı: ${runner.sim.ignored.join(', ')}`);
      s.log_('info', `Simülasyon başladı (hız ${s.simSpeed} sim-s/gerçek-s, trapezoidal, IC başlangıç).`);
    },
    stopSim: () => { runner.stop(); set({ simStatus: 'stopped' }); get().log_('info', 'Simülasyon durduruldu.'); },
    resetSim: () => {
      const s = get();
      runner.speed = s.simSpeed;
      runner.reset(simCircuit(s.circuit));
      set({ peakStress: {}, failures: [], live: null, simStatus: runner.running ? 'running' : 'stopped' });
    },

    setSpeed: (v) => { runner.speed = v; set({ simSpeed: v }); },

    setSch: (id, p, history = true) => {
      if (!history) {
        const s = get();
        set({ circuit: { ...s.circuit, components: s.circuit.components.map((c) => (c.id === id ? { ...c, sch: p } : c)) }, dirty: true });
        return;
      }
      edit((c) => ({ ...c, components: c.components.map((x) => (x.id === id ? { ...x, sch: p } : x)) }));
    },
    setSchMany: (patch, history = true) => {
      const apply = (c: Circuit): Circuit => ({ ...c, components: c.components.map((x) => (patch[x.id] ? { ...x, sch: patch[x.id] } : x)) });
      if (!history) { set({ circuit: apply(get().circuit), dirty: true }); return; }
      edit(apply);
    },
    addTapWire: (pin, host, x, y) => {
      const s = get();
      const h = s.circuit.wires.find((w) => w.id === host);
      if (!h) return false;
      const same = (p: PinRef, q: PinRef) => p.comp === q.comp && p.pin === q.pin;
      if (same(pin, h.a) || same(pin, h.b)) return false; // that pin already is an end of the host wire
      if (s.circuit.wires.some((w) => w.tap?.wire === host && same(w.a, pin))) return false;
      const w: Wire = { id: uid('w'), a: pin, b: h.a, color: h.color, width: h.width, tap: { wire: host, x, y } };
      edit((c) => ({ ...c, wires: [...c.wires, w] }));
      return true;
    },
    setAllSch: (layout) => edit((c) => ({ ...c, components: c.components.map((x) => (layout[x.id] ? { ...x, sch: layout[x.id] } : x)) })),
    editPcb: (fn, history = true) => {
      const s = get();
      const next = { ...s.circuit, pcb: fn(ensureDesign(s.circuit)) };
      if (!history) { set({ circuit: next, dirty: true }); return; }
      edit(() => next);
    },
    beginHistory: () => { const s = get(); set({ past: [...s.past, s.circuit].slice(-HISTORY_MAX), future: [] }); },
    setProbe: (which, pin) => { set({ probes: { ...get().probes, [which]: pin } }); get().applyMeters(); },
    applyMeters: () => {
      const s = get();
      const { red, black } = s.probes;
      const specs: MeterSpec[] = [];
      if (s.meterOn && red && black) {
        if (s.instKind === 'analog') specs.push({ id: 'm1', a: red, b: black, r: 20000 * s.meterRange, kind: 'v' });
        else if (s.instKind === 'dmm' && ['vdc', 'vac', 'vtrms', 'freq'].includes(s.dmmMode)) specs.push({ id: 'm1', a: red, b: black, r: 10e6, kind: 'v' });
        else if (s.instKind === 'dmm' && ['adc', 'aac'].includes(s.dmmMode)) specs.push({ id: 'm1', a: red, b: black, r: 0.01, kind: 'a' });
      }
      runner.meters = specs;
      runner.watch = new Set(s.watchComp ? [s.watchComp] : []);
      if (runner.running) runner.update(simCircuit(s.circuit));
    },
    resetFuse: () => { runner.fuseBlown = false; if (runner.running) runner.update(simCircuit(get().circuit)); get().log_('info', 'DMM sigortası değiştirildi.'); },
    logMeas: (inst, text) => set((st) => ({ measLog: [...st.measLog, { id: (st.measLog.at(-1)?.id ?? 0) + 1, t: new Date().toLocaleTimeString('tr-TR'), inst, text }] })),

    openLesson: (id) => set({ view: 'lesson', lessonId: id }),
    startLesson: (id, mode) => {
      const l = LESSONS.find((x) => x.id === id);
      if (!l) return;
      const circuit = mode === 'challenge' && l.challenge ? l.challenge.start() : mode === 'hunt' && l.faultHunt ? l.faultHunt.circuit() : l.build();
      get().loadCircuit(circuit, mode === 'hunt' && l.faultHunt ? `Arıza avı: ${l.faultHunt.title}` : mode === 'challenge' && l.challenge ? `Görev: ${l.challenge.title}` : l.title);
      if (l.speed) get().setSpeed(l.speed);
      set({ activeLesson: { id, mode }, hiddenFaults: mode === 'hunt' && l.faultHunt ? l.faultHunt.hidden : {}, rightTab: 'lesson', view: 'lab', lessonId: id });
    },
    endLesson: () => { runner.stop(); set({ activeLesson: null, hiddenFaults: {}, rightTab: 'props', simStatus: 'stopped' }); },

    dcSolve: () => {
      const s = get();
      try {
        const sc = simCircuit(s.circuit);
        const faults = sc.faults ?? {};
        const eff = effectiveCircuit(sc, faults);
        const sim = new Sim(eff, { faults });
        sim.solveDC();
        const results = sim.results();
        const stress = checkStress(eff, results);
        const amb = s.circuit.ambient ?? 25;
        const thermal: Record<string, ThermalState> = {};
        for (const c of eff.components) {
          const spec = thermalSpec(getDef(c.type), c);
          if (!spec) continue;
          const { rth, cth } = effectiveRth(spec, c);
          const P = results[c.id] ? heatPower(results[c.id]) : 0;
          thermal[c.id] = { T: amb + P * rth, tjmax: spec.tjmax, rth, cth, P };
        }
        set({ live: { t: 0, netNames: sim.nets.names, netV: sim.netVoltages(), comps: results, stress, pinNet: sim.nets.pinNet, thermal, faults, thermalSteady: true, gpio: {}, deadPins: {} }, simStatus: 'stopped' });
        if (sim.ignored.length) s.log_('warn', `Elektriksel modeli olmayan parçalar açık devre sayıldı: ${sim.ignored.join(', ')}`);
        s.log_('info', `DC çalışma noktası çözüldü (${sim.nets.netCount} düğüm). Isıl değerler kararlı hal (steady-state) tahminidir.`);
        stress.forEach((x) => s.log_('warn', `${x.ref}: ${x.label} aşıldı (${x.value.toPrecision(3)} ${x.unit} > ${x.limit} ${x.unit})`));
        eff.components.forEach((c) => { const th = thermal[c.id]; if (th && th.T >= th.tjmax) s.log_('warn', `${c.ref}: kararlı hal Tj ≈ ${th.T.toFixed(0)} °C ≥ ${th.tjmax} °C (termal hasar riski)`); });
      } catch (e) {
        s.log_('error', e instanceof SimError ? e.message : String(e));
        set({ simStatus: 'error' });
      }
    },

    setFault: (id, f) => {
      edit((c) => {
        const faults = { ...(c.faults ?? {}) };
        if (f) faults[id] = f; else delete faults[id];
        return { ...c, faults };
      });
      const ref = get().circuit.components.find((x) => x.id === id)?.ref ?? id;
      get().log_(f ? 'warn' : 'info', f ? `Arıza enjekte edildi: ${ref} → ${f.kind}${f.amount !== undefined ? ` (${f.amount})` : ''}` : `Arıza kaldırıldı: ${ref}`);
    },
    setWireBroken: (id, broken) => edit((c) => ({ ...c, wires: c.wires.map((w) => (w.id === id ? { ...w, broken } : w)) })),
    setWireLoose: (id, loose) => edit((c) => ({ ...c, wires: c.wires.map((w) => { if (w.id !== id) return w; const { loose: _old, ...rest } = w; return loose ? { ...rest, loose } : rest; }) })),
    setThermalAccessory: (id, patch) =>
      edit((c) => ({ ...c, components: c.components.map((x) => (x.id === id ? { ...x, thermal: { heatsink: 'none', fan: false, ...x.thermal, ...patch } } : x)) })),
    setAmbient: (t) => { runner.ambient = t; edit((c) => ({ ...c, ambient: t })); },
    setDamageEnabled: (on) => { runner.damageEnabled = on; set({ damageEnabled: on }); },
    setThermalSpeed: (v) => { runner.thermalSpeed = v; set({ thermalSpeed: v }); },
    clearFailures: () => set({ failures: [] }),

    setFirmware: (id, fw) => {
      edit((c) => {
        const firmware = { ...(c.firmware ?? {}) };
        if (fw) firmware[id] = fw; else delete firmware[id];
        return { ...c, firmware };
      });
    },
    /** parse/compile check without running; fills diagnostics */
    checkFirmware: (id) => {
      const s = get();
      const comp = s.circuit.components.find((x) => x.id === id);
      const fw = s.circuit.firmware?.[id];
      const spec = comp ? getDef(comp.type).mcu : undefined;
      if (!comp || !spec || !fw) return false;
      const rt = createRuntime(fw.kind, spec);
      if (!rt) { s.log_('error', `${comp.ref}: bu kart için ${fw.kind === 'uf2' ? 'RP2040 (UF2) emülatörü' : fw.kind === 'hex' ? 'HEX emülatörü' : 'sketch yorumlayıcısı'} yok.`); return false; }
      const res = rt.load(fw.source);
      set({ diagnostics: { ...get().diagnostics, [id]: res.diagnostics } });
      const errs = res.diagnostics.filter((d) => d.severity === 'error').length;
      s.log_(res.ok ? 'info' : 'error', `${comp.ref}: ${res.ok ? 'çözümleme başarılı' : `${errs} hata`}${res.diagnostics.length && res.ok ? `, ${res.diagnostics.length} uyarı` : ''}.`);
      return res.ok;
    },
    /** "Yükle": (re)load firmware into the running board, or just validate when stopped */
    loadFirmware: (id) => {
      const s = get();
      if (!get().checkFirmware(id)) return;
      set({ serial: { ...s.serial, [id]: '' } });
      if (runner.running) { runner.setupMcus(simCircuit(s.circuit), id); }
    },
    serialSend: (id, text) => runner.serialToMcu(id, text),
    clearSerial: (id) => set({ serial: { ...get().serial, [id]: '' } }),
  };
});

// Debounced autosave
let timer: ReturnType<typeof setTimeout> | undefined;
useLab.subscribe((s, prev) => {
  if (s.circuit === prev.circuit && s.projectName === prev.projectName) return;
  clearTimeout(timer);
  timer = setTimeout(() => autosave(s.projectName, s.circuit), 600);
});
