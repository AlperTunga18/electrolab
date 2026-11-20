import type { Circuit, Fault } from '../circuit/types';
import { Sim, SimError, type CompResult, type MeterSpec } from './mna';
import { checkStress, type Overstress } from './stress';
import { effectiveCircuit } from './faults';
import { buildReport, evaluateDamage, heatPower, thermalStates, type FailureReport, type ThermalState } from './damage';
import { stepThermal, thermalSpec, effectiveRth } from '../thermal/thermal';
import { getDef } from '../../library/components';
import { createRuntime } from '../mcu/factory';
import { BusFabric } from '../mcu/bus';
import type { Diagnostic, GpioInfo, McuBoardSpec, McuRuntime } from '../mcu/types';

export interface LiveSnapshot {
  t: number;
  netNames: string[];
  netV: number[];
  comps: Record<string, CompResult>;
  stress: Overstress[];
  pinNet: Map<string, number>;
  thermal: Record<string, ThermalState>;
  /** user-injected + model-generated structural/param faults currently active */
  faults: Record<string, Fault>;
  /** true when thermal values are steady-state (DC solve) instead of time-integrated */
  thermalSteady?: boolean;
  /** GPIO table per MCU component */
  gpio: Record<string, GpioInfo[]>;
  /** MCU pins destroyed by the damage model: comp id -> pins */
  deadPins: Record<string, string[]>;
}

export interface McuHooks {
  serial: (comp: string, text: string) => void;
  log: (comp: string, level: 'info' | 'warn' | 'error', text: string, diagnostics?: Diagnostic[]) => void;
}

interface McuInst { id: string; ref: string; rt: McuRuntime; spec: McuBoardSpec; warned: Set<string>; halted: boolean; /** held in brown-out reset */ brown: boolean }

const MAX_SAMPLES = 8000;

/**
 * Real-time transient session: advances a Sim at `speed` simulated seconds per wall-clock second,
 * runs MCU firmware against the same simulated clock, integrates the lumped thermal model
 * (thermalSpeed thermal-seconds per simulated second) and applies the damage model.
 */
export class LiveRunner {
  sim: Sim | null = null;
  speed = 0.01;
  thermalSpeed = 1000;
  ambient = 25;
  damageEnabled = true;
  running = false;
  t: number[] = [];
  nets: number[][] = [];
  netNames: string[] = [];
  temps: Record<string, number> = {};
  damage: Record<string, Fault> = {};
  mcus = new Map<string, McuInst>();
  /** simulated I2C/SPI buses + behavioural bus devices (device state lives for one simulation session) */
  private fabric = new BusFabric(getDef);
  /** virtual instruments loading the circuit */
  meters: MeterSpec[] = [];
  /** meter currents (a->b) per substep, keyed by meter id */
  meterBuf: Record<string, number[]> = {};
  /** per-component series (v,i) recorded for instruments (power analyzer) */
  watch = new Set<string>();
  compBuf: Record<string, { v: number[]; i: number[] }> = {};
  fuseBlown = false;
  deadPins: Record<string, Set<string>> = {};
  private power: Record<string, number> = {};
  private raf = 0;
  private last = 0;
  private sub = 0;
  private circuit: Circuit | null = null;
  private eff: Circuit | null = null;
  private reports = 0;
  /** simulated seconds each polarized capacitor has spent above 1 V reverse */
  private reverseDwell: Record<string, number> = {};
  private lastPub = 0;

  constructor(
    private onFrame: (s: LiveSnapshot) => void,
    private onError: (e: SimError | Error) => void,
    private onStress: (t: number, s: Overstress[]) => void,
    private onDamage: (r: FailureReport) => void,
    private hooks: McuHooks = { serial: () => {}, log: () => {} },
  ) {}

  private faults(circuit: Circuit): Record<string, Fault> {
    return { ...(circuit.faults ?? {}), ...this.damage };
  }

  private build(circuit: Circuit, from?: Sim): void {
    const faults = this.faults(circuit);
    const eff = effectiveCircuit(circuit, faults);
    const meters = this.meters.map((m) => (m.kind === 'a' && this.fuseBlown ? { ...m, r: 1e9 } : m));
    const sim = new Sim(eff, { init: 'ic', method: 'trap', faults, meters });
    if (from) sim.adopt(from);
    else sim.init();
    for (const [cid, pins] of Object.entries(this.deadPins)) for (const p of pins) sim.killPin(cid, p);
    this.sim = sim;
    this.circuit = circuit;
    this.eff = eff;
    this.fabric.setCircuit(eff, { pinNet: (c, p) => this.sim?.nets.pinNet.get(`${c}:${p}`), netVoltage: (n) => this.sim?.nodeVoltage(n) ?? 0 });
    if (this.netNames.length !== sim.nets.names.length || !from) {
      this.netNames = sim.nets.names.slice();
      this.t = []; this.nets = sim.nets.names.map(() => []); this.meterBuf = {}; this.compBuf = {};
    }
  }

  start(circuit: Circuit): void {
    this.stop();
    this.fabric = new BusFabric(getDef);
    this.temps = {}; this.damage = {}; this.power = {}; this.deadPins = {}; this.reverseDwell = {}; this.lastPub = 0; this.fuseBlown = false; this.meterBuf = {}; this.compBuf = {};
    this.ambient = circuit.ambient ?? this.ambient;
    try {
      this.build(circuit);
    } catch (e) { this.onError(e as Error); return; }
    this.setupMcus(circuit);
    // Boot phase: let setup()'s pinMode calls take electrical effect (e.g. INPUT_PULLUP) before loop() samples inputs.
    if (this.mcus.size && this.sim) {
      try { for (let k = 1; k <= 25; k++) { this.stepMcus(k * 2e-6); this.sim.init(); } } catch (e) { this.onError(e as Error); return; }
    }
    this.running = true;
    this.last = performance.now();
    this.publish();
    this.raf = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  reset(circuit: Circuit): void {
    const was = this.running;
    this.stop();
    this.sim = null; this.t = []; this.nets = []; this.temps = {}; this.damage = {}; this.power = {}; this.deadPins = {}; this.mcus.clear();
    if (was) this.start(circuit);
  }

  /** Circuit edited while running: keep state if possible. */
  update(circuit: Circuit): void {
    if (!this.running || !this.sim) return;
    try { this.build(circuit, this.sim); } catch (e) { this.stop(); this.onError(e as Error); }
  }

  /** (Re)load firmware of MCU boards (all, or one after the user pressed "Yükle"). */
  setupMcus(circuit: Circuit, only?: string): void {
    for (const c of circuit.components) {
      const def = getDef(c.type);
      if (!def.mcu || (only && c.id !== only)) continue;
      this.mcus.delete(c.id);
      const fw = circuit.firmware?.[c.id];
      if (!fw) continue;
      const rt = createRuntime(fw.kind, def.mcu);
      if (!rt) { this.hooks.log(c.id, 'error', `${c.ref}: bu kart için ${fw.kind === 'uf2' ? 'RP2040 (UF2) emülatörü' : fw.kind === 'hex' ? 'HEX emülatörü' : 'sketch yorumlayıcısı'} yok.`); continue; }
      const res = rt.load(fw.source);
      this.hooks.log(c.id, res.ok ? 'info' : 'error', res.ok ? `${c.ref}: yazılım yüklendi (${fw.kind === 'uf2' ? 'RP2040 UF2 emülatörü' : fw.kind === 'hex' ? 'AVR HEX emülatörü' : 'Arduino sketch yorumlayıcısı'}).` : `${c.ref}: yazılım derlenemedi, çalıştırılmadı.`, res.diagnostics);
      if (!res.ok) continue;
      rt.onSerial = (text) => this.hooks.serial(c.id, text);
      rt.setBus?.(this.fabric.link(c.id, def.mcu));
      this.mcus.set(c.id, { id: c.id, ref: c.ref, rt, spec: def.mcu, warned: new Set(), halted: false, brown: false });
    }
  }

  serialToMcu(id: string, text: string): void { this.mcus.get(id)?.rt.serialWrite(text); }

  private loop = (now: number): void => {
    if (!this.running || !this.sim || !this.eff) return;
    const real = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    const adv = this.speed * real;
    const n = 20;
    const dt = Math.max(adv / n, 1e-9);
    const pAcc: Record<string, number> = {};
    try {
      for (let i = 0; i < n; i++) {
        this.stepMcus(this.sim.t + dt);
        this.sim.step(dt);
        this.t.push(this.sim.t);
        this.sim.netVoltages().forEach((v, k) => this.nets[k].push(v));
        const r = this.sim.results();
        for (const id in r) pAcc[id] = (pAcc[id] ?? 0) + heatPower(r[id]) * dt;
        for (const id of this.watch) { const q = r[id]; if (q) { const b = (this.compBuf[id] ??= { v: [], i: [] }); b.v.push(q.v); b.i.push(q.i); } }
        for (const m of this.sim.meterCurrents()) {
          (this.meterBuf[m.id] ??= []).push(m.i);
          const spec = this.meters.find((q) => q.id === m.id);
          if (spec?.kind === 'a' && !this.fuseBlown && Math.abs(m.i) > 10) {
            this.fuseBlown = true; this.sim.openMeter(m.id);
            this.hooks.log('', 'error', `DMM sigortası attı: akım ölçme girişinden ${Math.abs(m.i).toFixed(0)} A geçti (10 A sigorta). Ampermetre uçları gerilim kaynağına/yüke PARALEL bağlanmamalı; devreyi açıp SERİ bağlayın.`);
          }
        }
      }
    } catch (e) {
      this.stop(); this.onError(e as Error); return;
    }
    const total = dt * n;
    for (const id in pAcc) this.power[id] = pAcc[id] / total;
    this.integrateThermal(total * this.thermalSpeed);
    if (this.t.length > MAX_SAMPLES) {
      const cut = this.t.length - MAX_SAMPLES;
      this.t.splice(0, cut); this.nets.forEach((a) => a.splice(0, cut));
      for (const k in this.meterBuf) this.meterBuf[k].splice(0, Math.min(cut, this.meterBuf[k].length));
      for (const k in this.compBuf) { this.compBuf[k].v.splice(0, cut); this.compBuf[k].i.splice(0, cut); }
    }
    if (++this.sub % 2 === 0) this.publish();
    this.raf = requestAnimationFrame(this.loop);
  };

  private stepMcus(tNext: number): void {
    const sim = this.sim;
    if (!sim || !this.mcus.size) return;
    for (const m of this.mcus.values()) {
      if (!this.eff?.components.some((c) => c.id === m.id)) { this.mcus.delete(m.id); continue; }
      // Brown-out: the logic rail (supply pin at the board's VCC) below the part's BOD threshold holds the MCU in reset, outputs Hi-Z.
      const bo = m.spec.brownoutV;
      const rail = bo === undefined ? undefined : m.spec.supplies.find((x) => x.v === m.spec.vcc)?.pin;
      let eSpec = m.spec;
      if (rail !== undefined && bo !== undefined) {
        const vdd = sim.pinVoltage(m.id, rail);
        if (vdd < bo) {
          if (!m.brown) { m.brown = true; this.hooks.log(m.id, 'warn', `${m.ref}: brownout — besleme ${vdd.toFixed(2)} V < ${bo} V eşiği, MCU reset tutuluyor (çıkışlar Hi-Z).`); }
          for (const pin of Object.values(m.spec.pinMap)) sim.setPinDrive(m.id, pin, null, m.spec);
          continue;
        }
        if (m.brown) {
          m.brown = false; m.halted = false;
          m.rt.restartAt(tNext);
          this.hooks.log(m.id, 'info', `${m.ref}: besleme ${vdd.toFixed(2)} V — brownout bitti, program baştan başlatıldı.`);
        }
        if (vdd < 0.98 * m.spec.vcc) eSpec = { ...m.spec, vcc: vdd }; // logic-high level follows the sagging rail
      }
      m.rt.advance(tNext, { readVoltage: (pin) => sim.pinVoltage(m.id, pin) });
      const drives = m.rt.drives(tNext);
      for (const pin of Object.values(m.spec.pinMap)) sim.setPinDrive(m.id, pin, drives.get(pin) ?? null, eSpec);
    }
  }

  private mcuDamage(comps: Record<string, CompResult>): void {
    if (!this.eff || !this.sim) return;
    const sim = this.sim, eff = this.eff;
    for (const c of eff.components) {
      const def = getDef(c.type);
      const spec = def.mcu;
      const r = comps[c.id];
      if (!spec || !r) continue;
      const sup = new Set(spec.supplies.map((s) => s.pin));
      for (const pin of Object.values(spec.pinMap)) {
        if (sup.has(pin) || this.deadPins[c.id]?.has(pin)) continue;
        const v = r.vals[`v_${pin}`] ?? 0, iSigned = r.vals[`i_${pin}`] ?? 0, i = Math.abs(iSigned);
        const overV = v > spec.vcc + 1.5 || v < -1.5;
        const overI = i >= 2 * spec.imaxPin;
        if (!overV && !overI) continue;
        (this.deadPins[c.id] ??= new Set()).add(pin);
        sim.killPin(c.id, pin);
        const net = sim.nets.pinNet.get(`${c.id}:${pin}`);
        const others = [...sim.nets.pinNet.entries()]
          .filter(([k, n]) => n === net && !k.startsWith(`${c.id}:`))
          .map(([k]) => { const [cid, p] = k.split(':'); return `${eff.components.find((x) => x.id === cid)?.ref ?? cid}.${p}`; });
        this.onDamage({
          id: ++this.reports, comp: c.id, ref: `${c.ref}.${pin}`, name: `${def.name} — GPIO`, t: sim.t, mode: 'open',
          cause: overV ? 'overvoltage' : 'overcurrent', limitLabel: overV ? 'GPIO gerilimi' : 'GPIO akımı',
          value: overV ? v : i, limit: overV ? spec.vcc + spec.vInMargin : spec.imaxPin, unit: overV ? 'V' : 'A',
          v, i: iSigned, p: v * iSigned,
          connections: [`${pin} → ${others.join(', ') || '(başka bağlantı yok)'}`],
          sameCurrent: [],
          prevent: overV ? ['Seviye dönüştürücü / gerilim bölücü', 'Seri direnç + kıskaç diyot'] : ['Seri akım sınırlama direnci', 'Transistör/MOSFET sürücü'],
          fix: overV
            ? [`Pin ${v.toFixed(1)} V gördü; ${spec.vcc} V mantıklı kartta pin gerilimi ≤ ${(spec.vcc + spec.vInMargin).toFixed(1)} V olmalı. 5 V sinyali bölücü (örn. 1.8k/3.3k) veya seviye dönüştürücü ile 3.3 V’a indirin.`]
            : [`Pin ${(i * 1000).toFixed(0)} mA verdi/çekti (sınır ${(spec.imaxPin * 1000).toFixed(0)} mA). Yükü pinden doğrudan sürmeyin: transistör/MOSFET ile sürün veya seri direnç kullanın; çıkışları birbirine kısa devre etmeyin.`],
          uncertainty: 'Kural tabanlı tahmin: gerçek çipte aşırı gerilim/akım hasarı kademeli olabilir (latch-up, pin/çip ölümü); burada pin kalıcı olarak devre dışı (açık) sayılır.',
        });
      }
    }
  }

  private integrateThermal(dtT: number): void {
    if (!this.eff) return;
    for (const c of this.eff.components) {
      const spec = thermalSpec(getDef(c.type), c);
      if (!spec) continue;
      const { rth, cth } = effectiveRth(spec, c);
      const T0 = this.temps[c.id] ?? this.ambient;
      this.temps[c.id] = stepThermal(T0, Math.max(this.power[c.id] ?? 0, 0), this.ambient, rth, cth, dtT);
    }
  }

  publish(): void {
    if (!this.sim || !this.eff || !this.circuit) return;
    const comps = this.sim.results();
    const stress = checkStress(this.eff, comps);
    const thermal = thermalStates(this.eff, this.power, this.temps, this.ambient);
    if (stress.length) this.onStress(this.sim.t, stress);
    if (this.damageEnabled && this.running) this.mcuDamage(comps);
    const gpio: Record<string, GpioInfo[]> = {};
    for (const m of this.mcus.values()) {
      gpio[m.id] = m.rt.gpio(this.sim.t);
      for (const w of m.rt.warnings()) if (!m.warned.has(w)) { m.warned.add(w); this.hooks.log(m.id, 'warn', `${m.ref}: ${w}`); }
      const h = m.rt.halted();
      if (h && !m.halted) { m.halted = true; this.hooks.log(m.id, 'error', `${m.ref}: program durdu — ${h}`); }
    }
    const dtPub = Math.max(this.sim.t - this.lastPub, 0);
    this.lastPub = this.sim.t;
    const rev = new Set(stress.filter((s) => s.key.endsWith('|polarity')).map((s) => s.comp));
    for (const id of Object.keys(this.reverseDwell)) if (!rev.has(id)) delete this.reverseDwell[id];
    for (const id of rev) this.reverseDwell[id] = (this.reverseDwell[id] ?? 0) + dtPub;
    if (this.damageEnabled && this.running) {
      const cands = evaluateDamage(this.eff, comps, thermal, this.faults(this.circuit), stress, this.reverseDwell);
      if (cands.length) {
        const pinNet = this.sim.nets.pinNet, names = this.sim.nets.names;
        for (const cand of cands) {
          this.damage[cand.comp.id] = { ...cand.fault, t: this.sim.t };
          this.onDamage(buildReport(++this.reports, this.eff, cand, comps, thermal, pinNet, names, this.sim.t, this.ambient));
        }
        try { this.build(this.circuit, this.sim); } catch (e) { this.stop(); this.onError(e as Error); return; }
      }
    }
    this.onFrame({
      t: this.sim.t, netNames: this.netNames, netV: this.sim.netVoltages(), comps, stress, pinNet: this.sim.nets.pinNet,
      thermal, faults: this.faults(this.circuit), gpio,
      deadPins: Object.fromEntries(Object.entries(this.deadPins).map(([k, v]) => [k, [...v]])),
    });
  }
}
