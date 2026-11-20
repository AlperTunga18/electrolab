/**
 * Simulated I2C / SPI bus layer between MCU runtimes and behavioural bus devices ('busdev' parts).
 *
 * HONEST SCOPE: TRANSACTION-LEVEL only. There is no bit-level timing, no SCL clock stretching, no arbitration,
 * no rise-time / capacitance model and no multi-master. A transaction is "START, address, bytes, STOP" handed to a
 * device object; the master side (sketch Wire/SPI or the avr8js TWI/SPI peripheral) pays an approximate time cost
 * (9 bits per I2C byte at the configured clock, 8 bits per SPI byte), the AVR TWI/SPI complete instantly.
 *
 * What IS decided from the circuit (nets), every call:
 *  - connectivity: device SDA/SCL (or CLK/MOSI/MISO) pins must be on the same nets as the MCU's bus pins;
 *  - pull-ups (I2C): SDA and SCL nets each need resistor(s) to a rail >= 0.6*VCC of the MCU, 1 kOhm..100 kOhm combined.
 *    The MCU's internal pull-ups are deliberately NOT counted. Without them the address is NACKed and the diagnostic
 *    "SDA/SCL pull-up yok" is reported;
 *  - power: VCC-GND of the device must exceed its minimum supply, otherwise it does not answer;
 *  - SPI chip select: CS tied to the device GND = always selected, CS on an MCU pin = selected while that pin is
 *    logically low, anything else = never selected.
 */
import type { ComponentDef } from '../../library/types';
import type { McuBoardSpec } from './types';
import { createBusDevice, type BusDevice } from './busdevices';

export interface I2CDevice {
  /** 7-bit address (may follow a component parameter) */
  addr: number;
  /** a transaction addressed this device (write = master writes) */
  begin?(write: boolean): void;
  /** master -> device bytes (may be called repeatedly inside one transaction) */
  write(bytes: number[]): void;
  /** device -> master bytes */
  read(n: number): number[];
  /** STOP condition */
  stop?(): void;
  /** false = the chip does not answer its address right now (unpowered, internal write cycle) */
  online?(): boolean;
}

export interface SpiDevice {
  /** full-duplex exchange of one byte while selected */
  transfer(byte: number): number;
  /** chip select asserted (true) / released (false) */
  select?(active: boolean): void;
  online?(): boolean;
}

/** Master-side handle on the I2C bus of one MCU. */
export interface I2cPort {
  /** START + address; false = NACK (no device, bus not usable, device busy) */
  begin(addr: number, write: boolean, t: number): boolean;
  write(bytes: number[]): void;
  read(n: number): number[];
  stop(): void;
}

/** Master-side handle on the SPI bus of one MCU. */
export interface SpiPort {
  /** board pin ids that are chip-select lines of devices on this bus */
  csPins(): string[];
  /** logical level of a board pin changed (false = low) */
  pin(boardPin: string, high: boolean): void;
  transfer(byte: number, t: number): number;
}

export interface McuBusLink {
  /** diagnostics sink (the runtime turns these into deduplicated warnings) */
  onWarn: (msg: string) => void;
  /** I2C port on the given board pin ids (default: the board's SDA/SCL) */
  i2c(sda?: string, scl?: string): I2cPort;
  /** SPI port on the given board pin ids (default: the board's hardware SPI) */
  spi(pins?: { mosi?: string; miso?: string; sck?: string }): SpiPort;
}

export interface BusEnv {
  /** net index of component pin, undefined if not part of the netlist */
  pinNet(comp: string, pin: string): number | undefined;
  /** voltage of a net relative to the solver ground */
  netVoltage(net: number): number;
}

export interface BusCircuit {
  components: { id: string; ref: string; type: string; params: Record<string, number | string | boolean> }[];
}

export const PULLUP_MISSING_MSG = 'I2C: SDA/SCL pull-up yok (SDA ve SCL hatlarından VCC\'ye 1k–100k direnç gerekir; MCU içi pull-up sayılmaz): cihazlar yanıt vermedi (NACK)';
export const PULLUP_MIN = 1000;
export const PULLUP_MAX = 100_000;

interface I2cRes {
  devs: { comp: string; ref: string; dev: I2CDevice }[];
  sda: number;
  scl: number;
}
interface SpiRes {
  devs: { comp: string; ref: string; dev: SpiDevice; cs: 'always' | 'never' | string }[];
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export class BusFabric {
  readonly clock = { t: 0 };
  private circuit: BusCircuit = { components: [] };
  private env: BusEnv | null = null;
  private devs = new Map<string, { type: string; dev: BusDevice }>();
  private ver = 0;
  private cache = new Map<string, unknown>();
  /** SPI select state per device (comp id) */
  private selected = new Map<string, boolean>();

  constructor(private getDef: (type: string) => ComponentDef) {}

  /** Call whenever the circuit or the solver changed (nets/voltages). Device state (EEPROM contents, ...) survives. */
  setCircuit(circuit: BusCircuit, env: BusEnv): void {
    this.circuit = circuit;
    this.env = env;
    this.ver++;
    this.cache.clear();
    const live = new Set(circuit.components.map((c) => c.id));
    for (const id of [...this.devs.keys()]) if (!live.has(id) || this.devs.get(id)!.type !== circuit.components.find((c) => c.id === id)?.type) this.devs.delete(id);
  }

  private param(id: string, key: string): number | string | boolean | undefined {
    return this.circuit.components.find((c) => c.id === id)?.params[key];
  }

  private net(comp: string, pin: string | undefined): number | undefined {
    return pin === undefined ? undefined : this.env?.pinNet(comp, pin);
  }
  private volt(net: number | undefined): number {
    return net === undefined || !this.env ? 0 : this.env.netVoltage(net);
  }

  /** device object for a busdev component (created once, kept while the component lives) */
  private device(c: BusCircuit['components'][number], def: ComponentDef): BusDevice {
    const have = this.devs.get(c.id);
    if (have) return have.dev;
    const spec = def.busdev!;
    const pins = spec.pins;
    const roleV = (role: string): number => this.volt(this.net(c.id, pins[role])) - this.volt(this.net(c.id, pins.gnd ?? pins.agnd));
    const dev = createBusDevice(spec.kind, {
      clock: this.clock,
      param: (k) => this.param(c.id, k),
      supply: () => (pins.vcc && this.net(c.id, pins.vcc) !== undefined && this.net(c.id, pins.gnd) !== undefined ? roleV('vcc') : 0),
      volt: roleV,
    });
    this.devs.set(c.id, { type: c.type, dev });
    return dev;
  }

  private memo<T>(key: string, f: () => T): T {
    if (this.cache.has(key)) return this.cache.get(key) as T;
    const v = f();
    this.cache.set(key, v);
    return v;
  }

  /** resistors that connect `net` to a rail of at least 0.6*vcc, combined (parallel) */
  private pullupR(net: number, vcc: number): number {
    let g = 0;
    for (const c of this.circuit.components) {
      const d = this.getDef(c.type);
      if (d.model !== 'resistor') continue;
      const a = this.net(c.id, '1'), b = this.net(c.id, '2');
      if (a === undefined || b === undefined || a === b) continue;
      const other = a === net ? b : b === net ? a : undefined;
      if (other === undefined) continue;
      if (this.volt(other) < 0.6 * vcc) continue;
      const r = num(c.params.r, d.params.find((p) => p.key === 'r')?.default as number);
      if (r > 0) g += 1 / r;
    }
    return g > 0 ? 1 / g : Infinity;
  }

  private i2c(mcu: string, sda: string, scl: string): I2cRes | null {
    return this.memo(`i2c:${mcu}:${sda}:${scl}`, () => {
      const ns = this.net(mcu, sda), nc = this.net(mcu, scl);
      if (ns === undefined || nc === undefined) return null;
      const devs: I2cRes['devs'] = [];
      for (const c of this.circuit.components) {
        const d = this.getDef(c.type);
        if (d.model !== 'busdev' || d.busdev?.bus !== 'i2c') continue;
        const p = d.busdev.pins;
        if (this.net(c.id, p.sda) !== ns || this.net(c.id, p.scl) !== nc) continue;
        devs.push({ comp: c.id, ref: c.ref, dev: this.device(c, d) as I2CDevice });
      }
      return { devs, sda: ns, scl: nc };
    });
  }

  /** pull-ups are voltage dependent (rail must be up), so they are evaluated per transaction, not memoised */
  private pullOk(r: I2cRes, spec: McuBoardSpec): boolean {
    const ok = (net: number): boolean => { const x = this.pullupR(net, spec.vcc); return x >= PULLUP_MIN && x <= PULLUP_MAX; };
    return ok(r.sda) && ok(r.scl);
  }

  private spi(mcu: string, spec: McuBoardSpec, mosi: string, miso: string, sck: string): SpiRes | null {
    return this.memo(`spi:${mcu}:${mosi}:${miso}:${sck}`, () => {
      const nm = this.net(mcu, mosi), ni = this.net(mcu, miso), nk = this.net(mcu, sck);
      if (nm === undefined || ni === undefined || nk === undefined) return null;
      const devs: SpiRes['devs'] = [];
      for (const c of this.circuit.components) {
        const d = this.getDef(c.type);
        if (d.model !== 'busdev' || d.busdev?.bus !== 'spi') continue;
        const p = d.busdev.pins;
        if (this.net(c.id, p.mosi) !== nm || this.net(c.id, p.miso) !== ni || this.net(c.id, p.clk) !== nk) continue;
        const csNet = this.net(c.id, p.cs);
        let cs: SpiRes['devs'][number]['cs'] = 'never';
        if (csNet !== undefined) {
          if (csNet === this.net(c.id, p.gnd ?? p.dgnd)) cs = 'always';
          else {
            const pin = Object.values(spec.pinMap).find((id) => this.net(mcu, id) === csNet);
            if (pin !== undefined) cs = pin;
          }
        }
        devs.push({ comp: c.id, ref: c.ref, dev: this.device(c, d) as SpiDevice, cs });
      }
      return { devs };
    });
  }

  /** bus handle for one MCU component */
  link(mcu: string, spec: McuBoardSpec): McuBusLink {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const fab = this;
    this.selected.clear();
    const id = (n: number | undefined): string | undefined => (n === undefined ? undefined : spec.pinMap[n]);
    const warned = new Set<string>();
    const link: McuBusLink = {
      onWarn: () => {},
      i2c(sdaPin, sclPin) {
        const sda = sdaPin ?? id(spec.constants.SDA), scl = sclPin ?? id(spec.constants.SCL);
        let cur: I2CDevice | null = null;
        const say = (m: string): void => { if (!warned.has(m)) { warned.add(m); link.onWarn(m); } };
        return {
          begin(addr, write, t) {
            fab.clock.t = t;
            cur = null;
            if (!sda || !scl) return false;
            const r = fab.i2c(mcu, sda, scl);
            if (!r || r.devs.length === 0) return false;
            if (!fab.pullOk(r, spec)) { say(PULLUP_MISSING_MSG); return false; }
            const hits = r.devs.filter((d) => d.dev.addr === addr);
            if (hits.length > 1) say(`I2C: 0x${addr.toString(16)} adresinde ${hits.length} cihaz var (${hits.map((h) => h.ref).join(', ')}): adres çakışması, ilk cihaz yanıtlar`);
            const d = hits[0]?.dev;
            if (!d || (d.online && !d.online())) return false;
            d.begin?.(write);
            cur = d;
            return true;
          },
          write(bytes) { cur?.write(bytes); },
          read(n) { return cur ? cur.read(n) : []; },
          stop() { cur?.stop?.(); cur = null; },
        };
      },
      spi(p) {
        const mosi = p?.mosi ?? id(spec.spi?.mosi), miso = p?.miso ?? id(spec.spi?.miso), sck = p?.sck ?? id(spec.spi?.sck);
        const say = (m: string): void => { if (!warned.has(m)) { warned.add(m); link.onWarn(m); } };
        const res = (): SpiRes | null => (mosi && miso && sck ? fab.spi(mcu, spec, mosi, miso, sck) : null);
        const setSel = (d: SpiRes['devs'][number], on: boolean): void => {
          if ((fab.selected.get(d.comp) ?? false) === on) return;
          fab.selected.set(d.comp, on);
          d.dev.select?.(on);
        };
        return {
          csPins() { return (res()?.devs ?? []).map((d) => d.cs).filter((c) => c !== 'always' && c !== 'never'); },
          pin(boardPin, high) { for (const d of res()?.devs ?? []) if (d.cs === boardPin) setSel(d, !high); },
          transfer(byte, t) {
            fab.clock.t = t;
            let out = 0;
            let answered = false;
            for (const d of res()?.devs ?? []) {
              if (d.cs === 'always') setSel(d, true);
              if (!fab.selected.get(d.comp)) continue;
              if (d.dev.online && !d.dev.online()) { say(`SPI: ${d.ref} beslenmiyor (VCC–GND yetersiz): yanıt vermiyor, MISO 0 okunur`); continue; }
              const r = d.dev.transfer(byte & 255);
              if (answered) out &= r; else { out = r; answered = true; }
            }
            return out & 255;
          },
        };
      },
    };
    return link;
  }
}
