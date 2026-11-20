/**
 * AvrRuntime: runs REAL ATmega328P machine code (Intel HEX from Arduino IDE / arduino-cli) on avr8js.
 *
 * Supported: all AVR instructions avr8js implements, interrupts, GPIO ports B/C/D (+ pin-change / INT0/1),
 *   Timer0/1/2 (millis, delay, PWM), USART0 (TX -> onSerial, serialWrite -> RX), ADC (A0..A5, volts from host),
 *   32 KB flash. PWM: avr8js timers drive the pin through the port override, so port listeners see every edge;
 *   we measure the high-time fraction over the last ~4 ms of emulated time (16 buckets x 0.25 ms) and report
 *   it as `duty` with mode 'pwm' (only when both levels occurred in that window). drives() carries the
 *   instantaneous level, i.e. the solver sees real edges.
 * Halt: avr8js wraps the PC modulo flash size (like the chip), so halted() only fires if PC is >= flash words (practically never).
 * TWI (I2C master) and SPI (master): avr8js peripherals hooked to the simulated bus layer (bus.ts) when a bus link is set
 *   (setBus). TRANSACTION-LEVEL: every TWI/SPI step completes instantly in emulated time (the SCL/SCK rate is not enforced),
 *   no clock stretching, no slave mode. Pull-ups on SDA/SCL are required (the MCU's internal ones are not counted), without
 *   them the address phase is NACKed (status 0x20) and "SDA/SCL pull-up yok" is reported. Without a bus link TWI/SPI use is
 *   only detected and reported in warnings().
 * Not supported: EEPROM, watchdog reset, pin-sharing of D0/D1 with USART (pins stay plain GPIO),
 *   analog comparator, sleep modes (SLEEP is a no-op).
 * Time: emulated time = cpu.cycles / cpuHz. Each advance() is capped (MAX_CYCLES_PER_CALL); if the browser
 *   cannot keep up, a backlog (max 4 caps) is kept, the rest is dropped and a warning is issued.
 * Input: host voltage is sampled once per advance() (Schmitt trigger: >=0.6*vcc high, <=0.3*vcc low).
 */
import {
  CPU,
  avrInstruction,
  AVRIOPort,
  AVRTimer,
  AVRUSART,
  AVRADC,
  PinState,
  portBConfig,
  portCConfig,
  portDConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  usart0Config,
  adcConfig,
  AVRTWI,
  twiConfig,
  AVRSPI,
  spiConfig,
  type TWIEventHandler,
} from 'avr8js';
import type { Diagnostic, GpioInfo, McuBoardSpec, McuHost, McuRuntime, PinDrive } from '../types';
import { FLASH_BYTES, parseIntelHex } from './hex';
import type { I2cPort, McuBusLink, SpiPort } from '../bus';

export const MAX_CYCLES_PER_CALL = 3_000_000;
const CHUNK = 2000; // cycles between serial-RX feed checks
const BUCKET_CYCLES = 4000; // 0.25 ms @ 16 MHz
const NBUCKETS = 16;
const TWCR = 0xbc;
const SPCR = 0x4c;

interface PinRef {
  num: number;
  port: 0 | 1 | 2; // B, C, D
  bit: number;
}

function pinRef(num: number): PinRef | null {
  if (num >= 0 && num <= 7) return { num, port: 2, bit: num };
  if (num >= 8 && num <= 13) return { num, port: 0, bit: num - 8 };
  if (num >= 14 && num <= 19) return { num, port: 1, bit: num - 14 };
  return null;
}

/** avr8js TWI event handler -> I2C bus port (transaction-level; every step completes immediately) */
class TwiBus implements TWIEventHandler {
  constructor(
    private twi: AVRTWI,
    private port: () => I2cPort,
    private now: () => number,
  ) {}
  start(): void {
    this.twi.completeStart();
  }
  stop(): void {
    this.port().stop();
    this.twi.completeStop();
  }
  connectToSlave(addr: number, write: boolean): void {
    this.twi.completeConnect(this.port().begin(addr, write, this.now()));
  }
  writeByte(value: number): void {
    this.port().write([value & 255]);
    this.twi.completeWrite(true);
  }
  readByte(): void {
    this.twi.completeRead(this.port().read(1)[0] ?? 0xff);
  }
}

class DutyTracker {
  hi = new Float64Array(NBUCKETS);
  id = new Float64Array(NBUCKETS).fill(-1);
  lastLevel = false;
  lastCycle = 0;
  /** add high time of [c0,c1) */
  addHigh(c0: number, c1: number): void {
    c0 = Math.max(c0, c1 - BUCKET_CYCLES * NBUCKETS);
    while (c0 < c1) {
      const b = Math.floor(c0 / BUCKET_CYCLES);
      const end = Math.min(c1, (b + 1) * BUCKET_CYCLES);
      const slot = b % NBUCKETS;
      if (this.id[slot] !== b) {
        this.id[slot] = b;
        this.hi[slot] = 0;
      }
      this.hi[slot] += end - c0;
      c0 = end;
    }
  }
  edge(level: boolean, cycle: number): void {
    if (this.lastLevel) this.addHigh(this.lastCycle, cycle);
    this.lastLevel = level;
    this.lastCycle = cycle;
  }
  /** high fraction over the last window ending at `now`; null if the pin was (nearly) constant in the window */
  duty(now: number): number | null {
    if (this.lastLevel) {
      this.addHigh(this.lastCycle, now);
      this.lastCycle = now;
    }
    const startB = Math.floor(now / BUCKET_CYCLES) - NBUCKETS + 1;
    let hi = 0;
    for (let s = 0; s < NBUCKETS; s++) if (this.id[s] >= startB) hi += this.hi[s];
    const span = Math.min(now, NBUCKETS * BUCKET_CYCLES);
    if (span <= 0) return null;
    const d = Math.min(1, hi / span);
    return d > 0.0005 && d < 0.9995 ? d : null;
  }
}

export class AvrRuntime implements McuRuntime {
  readonly kind = 'avr' as const;
  onSerial: (text: string) => void = () => {};

  private image: Uint8Array | null = null;
  private cpu: CPU | null = null;
  private ports: AVRIOPort[] = [];
  private adc: AVRADC | null = null;
  private usart: AVRUSART | null = null;
  private pins: PinRef[] = [];
  private trackers = new Map<number, DutyTracker>();
  private inState = new Map<number, boolean>();
  private rxQueue: number[] = [];
  private lastSim = 0;
  private targetCycles = 0;
  private haltReason: string | null = null;
  private lagging = false;
  private warned = new Set<string>();
  private bus: McuBusLink | null = null;
  private i2c: I2cPort | null = null;
  private spiPort: SpiPort | null = null;
  private twiOn = false;
  private spiOn = false;

  constructor(private spec: McuBoardSpec) {
    for (let n = 0; n <= 19; n++) {
      const r = pinRef(n);
      if (r && spec.pinMap[n] !== undefined) this.pins.push(r);
    }
  }

  load(hexText: string): { ok: boolean; diagnostics: Diagnostic[] } {
    const res = parseIntelHex(hexText);
    if (!res.ok) return { ok: false, diagnostics: res.diagnostics };
    this.image = res.image;
    this.reset();
    return { ok: true, diagnostics: res.diagnostics };
  }

  reset(): void {
    this.lastSim = 0;
    this.targetCycles = 0;
    this.haltReason = null;
    this.lagging = false;
    this.warned.clear();
    this.rxQueue = [];
    this.inState.clear();
    this.trackers.clear();
    this.i2c = null;
    this.spiPort = null;
    this.twiOn = this.spiOn = false;
    if (!this.image) {
      this.cpu = null;
      return;
    }
    const prog = new Uint16Array(FLASH_BYTES / 2);
    new Uint8Array(prog.buffer).set(this.image);
    const cpu = new CPU(prog);
    this.cpu = cpu;
    const portB = new AVRIOPort(cpu, portBConfig);
    const portC = new AVRIOPort(cpu, portCConfig);
    const portD = new AVRIOPort(cpu, portDConfig);
    this.ports = [portB, portC, portD];
    new AVRTimer(cpu, timer0Config);
    new AVRTimer(cpu, timer1Config);
    new AVRTimer(cpu, timer2Config);
    const usart = new AVRUSART(cpu, usart0Config, this.spec.cpuHz);
    usart.onByteTransmit = (b) => this.onSerial(String.fromCharCode(b));
    this.usart = usart;
    const adc = new AVRADC(cpu, adcConfig);
    adc.avcc = this.spec.adcVref;
    adc.aref = this.spec.adcVref;
    this.adc = adc;
    if (this.bus) {
      const link = this.bus;
      const twi = new AVRTWI(cpu, twiConfig, this.spec.cpuHz);
      twi.eventHandler = new TwiBus(twi, () => (this.i2c ??= link.i2c()), () => cpu.cycles / this.spec.cpuHz);
      const spi = new AVRSPI(cpu, spiConfig, this.spec.cpuHz);
      spi.onTransfer = (v) => {
        const port = (this.spiPort ??= link.spi());
        this.syncCs(port);
        const lsb = spi.dataOrder === 'lsbFirst';
        const rev = (b: number): number => { let r = 0; for (let i = 0; i < 8; i++) r |= ((b >> i) & 1) << (7 - i); return r; };
        const rx = port.transfer(lsb ? rev(v) : v, cpu.cycles / this.spec.cpuHz);
        return lsb ? rev(rx) : rx;
      };
      this.twiOn = this.spiOn = true;
    }
    for (const p of this.pins) this.trackers.set(p.num, new DutyTracker());
    // one listener per port: record edges of output pins for PWM duty measurement
    this.ports.forEach((port, pi) => {
      port.addListener((value, old) => {
        const diff = value ^ old;
        if (!diff) return;
        for (const p of this.pins) {
          if (p.port === pi && diff & (1 << p.bit)) {
            this.trackers.get(p.num)!.edge(!!(value & (1 << p.bit)), cpu.cycles);
            if (this.bus) (this.spiPort ??= this.bus.spi()).pin(this.spec.pinMap[p.num], !!(value & (1 << p.bit)));
          }
        }
      });
    });
  }

  setBus(link: McuBusLink | null): void {
    this.bus = link;
    if (link) link.onWarn = (m) => this.warned.add(m);
    if (this.image) this.reset(); // peripherals are created at reset()
  }

  /** refresh the logical level of every chip-select pin of the SPI bus from the AVR port state before a transfer */
  private syncCs(port: SpiPort): void {
    for (const id of port.csPins()) {
      const p = this.pins.find((q) => this.spec.pinMap[q.num] === id);
      if (!p) continue;
      port.pin(id, this.ports[p.port].pinState(p.bit) !== PinState.Low);
    }
  }

  restartAt(t: number): void {
    this.reset();
    this.lastSim = t;
  }

  advance(simTime: number, host: McuHost): void {
    const cpu = this.cpu;
    if (!cpu || this.haltReason) {
      this.lastSim = simTime;
      return;
    }
    const dt = simTime - this.lastSim;
    this.lastSim = simTime;
    if (dt <= 0) return;
    this.targetCycles += dt * this.spec.cpuHz;
    this.sampleInputs(host);

    const limit = cpu.cycles + MAX_CYCLES_PER_CALL;
    const target = Math.min(this.targetCycles, limit);
    const words = cpu.progMem.length;
    while (cpu.cycles < target) {
      this.feedRx();
      const stop = Math.min(target, cpu.cycles + CHUNK);
      while (cpu.cycles < stop) {
        if (cpu.pc >= words) {
          this.haltReason = `Program sayacı flash dışına çıktı (PC=0x${(cpu.pc * 2).toString(16)}).`;
          return;
        }
        avrInstruction(cpu);
        cpu.tick();
      }
    }
    const backlog = this.targetCycles - cpu.cycles;
    if (backlog > 1) {
      this.lagging = true;
      if (backlog > 4 * MAX_CYCLES_PER_CALL) this.targetCycles = cpu.cycles + 4 * MAX_CYCLES_PER_CALL;
    } else {
      this.lagging = false;
    }
  }

  private feedRx(): void {
    const u = this.usart;
    if (!u || this.rxQueue.length === 0) return;
    if (u.rxEnable && !u.rxBusy) u.writeByte(this.rxQueue.shift()!);
  }

  private sampleInputs(host: McuHost): void {
    const vcc = this.spec.vcc;
    for (const p of this.pins) {
      const port = this.ports[p.port];
      const st = port.pinState(p.bit);
      if (st !== PinState.Input && st !== PinState.InputPullUp) continue;
      const v = host.readVoltage(this.spec.pinMap[p.num]);
      let level = this.inState.get(p.num) ?? false;
      if (v >= 0.6 * vcc) level = true;
      else if (v <= 0.3 * vcc) level = false;
      this.inState.set(p.num, level);
      port.setPin(p.bit, level);
    }
    const adc = this.adc!;
    for (let ch = 0; ch < 6; ch++) {
      const id = this.spec.pinMap[14 + ch];
      if (id !== undefined) adc.channelValues[ch] = Math.max(0, host.readVoltage(id));
    }
  }

  private modeOf(p: PinRef): PinDrive['mode'] {
    const st = this.ports[p.port].pinState(p.bit);
    if (st === PinState.Input) return 'in';
    if (st === PinState.InputPullUp) return 'pullup';
    return 'out';
  }

  drives(_simTime: number): Map<string, PinDrive> {
    const m = new Map<string, PinDrive>();
    if (!this.cpu) return m;
    for (const p of this.pins) {
      const st = this.ports[p.port].pinState(p.bit);
      m.set(this.spec.pinMap[p.num], { mode: this.modeOf(p), high: st === PinState.High });
    }
    return m;
  }

  serialWrite(text: string): void {
    for (let i = 0; i < text.length; i++) {
      if (this.rxQueue.length < 256) this.rxQueue.push(text.charCodeAt(i) & 0xff);
    }
  }

  gpio(_simTime: number): GpioInfo[] {
    const out: GpioInfo[] = [];
    for (let n = 0; n <= 19; n++) {
      const pin = this.spec.pinMap[n];
      if (pin === undefined) continue;
      const p = pinRef(n)!;
      if (!this.cpu) {
        out.push({ pin, num: n, mode: 'unconfigured', high: false });
        continue;
      }
      const st = this.ports[p.port].pinState(p.bit);
      const info: GpioInfo = { pin, num: n, mode: this.modeOf(p), high: st === PinState.High };
      if (info.mode === 'out') {
        const d = this.trackers.get(n)!.duty(this.cpu.cycles);
        if (d !== null) {
          info.mode = 'pwm';
          info.duty = d;
        }
      }
      out.push(info);
    }
    return out;
  }

  warnings(): string[] {
    const cpu = this.cpu;
    if (cpu) {
      if (!this.twiOn && cpu.data[TWCR] & 0x04) this.warned.add('Program TWI/Wire (I2C) kullanıyor; AVR emülatöründe I2C desteklenmiyor.');
      if (!this.spiOn && cpu.data[SPCR] & 0x40) this.warned.add('Program SPI kullanıyor; AVR emülatöründe SPI desteklenmiyor.');
    }
    const w = [...this.warned];
    if (this.lagging) w.push('Emülasyon gerçek zamanın gerisinde kalıyor (CPU yükü yüksek); simülasyon zamanı kayabilir.');
    return w;
  }

  halted(): string | null {
    return this.haltReason;
  }
}
