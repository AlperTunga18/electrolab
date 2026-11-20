/**
 * Rp2040Runtime: runs REAL RP2040 (Raspberry Pi Pico) machine code from a UF2 (arduino-cli / arduino-pico output) on rp2040js.
 *
 * Supported (as far as rp2040js implements them): Cortex-M0+ core (core 0 only), SIO GPIO, IO_BANK0/PADS, UART0/UART1 (UART0 -> onSerial,
 *   serialWrite -> UART0 RX), ADC (GP26..GP29 = ADC0..3, volts from host), PWM, timers/alarms, SysTick, DMA. I2C/SPI/PIO objects exist in
 *   rp2040js but are NOT wired to the simulated bus layer here (no bus support).
 * Boot: the 16 KB BOOTROM is NOT bundled in rp2040js and is not shipped with this project. Without it the runtime does a "direct boot":
 *   boot2 (first 256 B of flash) is skipped, VTOR = 0x10000100 and SP/PC are taken from that vector table. ROM helper functions that
 *   the Pico SDK / arduino-pico call through the ROM function table (0x14/0x18) are therefore NOT available unless a bootrom image
 *   is passed (constructor option `bootrom`, 4096 words). See warnings()/halted().
 * Not emulated: second core (core1 never starts), USB (Arduino-Pico `Serial` is USB-CDC; only Serial1 = UART0 reaches onSerial),
 *   Wi-Fi/BT (Pico W), flash writes (SSI), EEPROM emulation, brown-out. Drives report the instantaneous level only (no PWM duty estimate).
 * Time: simulated time = cpu cycles at CPU_HZ = 125 MHz (rp2040js' fixed model; the board spec's 133 MHz is not used). WFI/WFE sleeps skip
 *   straight to the next alarm. Each advance() executes at most MAX_CYCLES_PER_CALL active cycles; if the browser cannot keep up, a backlog
 *   (max 4 caps) is kept, the rest is dropped and a warning is issued.
 * Input: host voltage is sampled once per advance() (Schmitt trigger: >=0.6*vcc high, <=0.3*vcc low).
 */
import { RP2040, GPIOPinState } from 'rp2040js';
import type { Diagnostic, GpioInfo, McuBoardSpec, McuHost, McuRuntime, PinDrive } from '../types';
import { RomShim, STUB_END } from './romShim';
import { base64ToBytes, FLASH_BASE, parseUf2 } from './uf2';

export const CPU_HZ = 125_000_000;
export const MAX_CYCLES_PER_CALL = 3_000_000;
const NANOS_PER_CYCLE = 1e9 / CPU_HZ;
const VECTOR_TABLE = FLASH_BASE + 0x100; // boot2 occupies the first 256 bytes
const NUM_GPIO = 29; // GP0..GP28
const ADC_FIRST_PIN = 26;

/** rp2040js does not export its SimulationClock through the package exports map; RP2040 builds one by default. */
interface SimClock {
  readonly nanos: number;
  readonly nanosToNextAlarm: number;
  tick(deltaNanos: number): void;
}

export interface Rp2040Options {
  /** optional 16 KB bootrom image (4096 words); not bundled */
  bootrom?: Uint32Array;
}

export class Rp2040Runtime implements McuRuntime {
  readonly kind = 'rp2040' as const;
  onSerial: (text: string) => void = () => {};

  private image: Uint8Array | null = null;
  private chip: RP2040 | null = null;
  private clock: SimClock | null = null;
  private lastSim = 0;
  private targetCycles = 0;
  private executed = 0; // active (non-sleeping) cycles executed
  private rxQueue: number[] = [];
  private inState = new Map<number, boolean>();
  private haltReason: string | null = null;
  private lagging = false;
  private warned = new Set<string>();
  private shim: RomShim | null = null;

  constructor(
    private spec: McuBoardSpec,
    private opts: Rp2040Options = {},
  ) {}

  /** `source` = base64 of a .uf2 file (what /api/mcu/compile returns as uf2_b64) */
  load(source: string): { ok: boolean; diagnostics: Diagnostic[] } {
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(source);
    } catch {
      return { ok: false, diagnostics: [{ line: 1, message: 'UF2: base64 çözülemedi.', severity: 'error' }] };
    }
    return this.loadBytes(bytes);
  }

  loadBytes(bytes: Uint8Array): { ok: boolean; diagnostics: Diagnostic[] } {
    const res = parseUf2(bytes);
    if (!res.ok) return { ok: false, diagnostics: res.diagnostics };
    this.image = res.image;
    this.reset();
    return { ok: true, diagnostics: res.diagnostics };
  }

  reset(): void {
    this.lastSim = 0;
    this.targetCycles = 0;
    this.executed = 0;
    this.haltReason = null;
    this.lagging = false;
    this.warned.clear();
    this.rxQueue = [];
    this.inState.clear();
    if (!this.image) {
      this.chip = null;
      this.clock = null;
      return;
    }
    const chip = new RP2040();
    this.shim = null;
    chip.logger = { debug() {}, info() {}, warn() {}, error() {} };
    if (this.opts.bootrom) chip.loadBootrom(this.opts.bootrom);
    chip.flash.set(this.image); // after loadBootrom: reset() fills flash with 0xFF
    const core = chip.core;
    if (this.opts.bootrom) {
      core.reset(); // bootrom runs boot2 and jumps to flash itself
    } else {
      core.VTOR = VECTOR_TABLE;
      core.SP = chip.readUint32(VECTOR_TABLE);
      core.PC = chip.readUint32(VECTOR_TABLE + 4) & 0xfffffffe;
      this.shim = new RomShim(chip);
      this.warned.add("Gerçek bootrom yok: doğrudan flash'tan başlatıldı (boot2 atlandı); ROM yardımcı işlevleri (popcount/clz/ctz/rev/memset/memcpy) JS ile taklit edilir.");
    }
    chip.uart[0].onByte = (b) => this.onSerial(String.fromCharCode(b));
    this.chip = chip;
    this.clock = chip.clock as unknown as SimClock;
  }

  restartAt(t: number): void {
    this.reset();
    this.lastSim = t;
  }

  advance(simTime: number, host: McuHost): void {
    const chip = this.chip;
    const clock = this.clock;
    if (!chip || !clock || this.haltReason) {
      this.lastSim = simTime;
      return;
    }
    const dt = simTime - this.lastSim;
    this.lastSim = simTime;
    if (dt <= 0) return;
    this.sampleInputs(host);
    this.feedRx();
    this.targetCycles += dt * CPU_HZ;
    const core = chip.core;
    const targetNanos = this.targetCycles * NANOS_PER_CYCLE;
    const limit = this.executed + MAX_CYCLES_PER_CALL;
    try {
      while (clock.nanos < targetNanos && this.executed < limit) {
        if (core.waiting) {
          clock.tick(Math.max(1, Math.min(clock.nanosToNextAlarm, targetNanos - clock.nanos)));
        } else if (this.shim && core.PC < STUB_END) {
          const cycles = this.shim.handle(core);
          if (cycles === 0) throw new Error(`bootrom'a atlandı (PC=0x${core.PC.toString(16)}), taklit yok`);
          this.executed += cycles;
          clock.tick(cycles * NANOS_PER_CYCLE);
        } else {
          const cycles = core.executeInstruction();
          this.executed += cycles;
          clock.tick(cycles * NANOS_PER_CYCLE);
        }
      }
    } catch (e) {
      const miss = this.shim && this.shim.unknown.size ? ` Desteklenmeyen ROM işlevleri: ${[...this.shim.unknown].join(', ')}.` : '';
      this.haltReason = `RP2040 çekirdeği hata verdi: ${e instanceof Error ? e.message : String(e)}.${miss}`;
      return;
    }
    const backlog = (targetNanos - clock.nanos) / NANOS_PER_CYCLE;
    if (backlog > 1) {
      this.lagging = true;
      if (backlog > 4 * MAX_CYCLES_PER_CALL) this.targetCycles -= backlog - 4 * MAX_CYCLES_PER_CALL;
    } else {
      this.lagging = false;
    }
  }

  /** emulated time (s) the chip has reached */
  get chipTime(): number {
    return this.clock ? this.clock.nanos / 1e9 : 0;
  }

  /** pad level of GPn: driven level for outputs, last host level for inputs */
  gpioLevel(n: number): boolean {
    const p = this.chip?.gpio[n];
    return p ? p.value === GPIOPinState.High : false;
  }

  private feedRx(): void {
    const u = this.chip?.uart[0];
    if (!u) return;
    while (this.rxQueue.length && u.rxEnabled) u.feedByte(this.rxQueue.shift()!);
  }

  private sampleInputs(host: McuHost): void {
    const chip = this.chip!;
    const vcc = this.spec.vcc;
    for (let n = 0; n < NUM_GPIO; n++) {
      const id = this.spec.pinMap[n];
      if (id === undefined) continue;
      const pin = chip.gpio[n];
      if (pin.outputEnable) continue;
      const v = host.readVoltage(id);
      let level = this.inState.get(n) ?? false;
      if (v >= 0.6 * vcc) level = true;
      else if (v <= 0.3 * vcc) level = false;
      this.inState.set(n, level);
      pin.setInputValue(level);
    }
    for (let ch = 0; ch < 4; ch++) {
      const id = this.spec.pinMap[ADC_FIRST_PIN + ch];
      if (id === undefined) continue;
      const v = Math.max(0, Math.min(this.spec.adcVref, host.readVoltage(id)));
      chip.adc.channelValues[ch] = Math.round((v / this.spec.adcVref) * 4095);
    }
  }

  private modeOf(n: number): PinDrive['mode'] {
    const pin = this.chip!.gpio[n];
    if (pin.outputEnable) return 'out';
    return pin.pullupEnabled ? 'pullup' : 'in';
  }

  drives(_simTime: number): Map<string, PinDrive> {
    const m = new Map<string, PinDrive>();
    const chip = this.chip;
    if (!chip) return m;
    for (let n = 0; n < NUM_GPIO; n++) {
      const id = this.spec.pinMap[n];
      if (id === undefined) continue;
      m.set(id, { mode: this.modeOf(n), high: chip.gpio[n].outputValue });
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
    for (let n = 0; n < NUM_GPIO; n++) {
      const pin = this.spec.pinMap[n];
      if (pin === undefined) continue;
      if (!this.chip) {
        out.push({ pin, num: n, mode: 'unconfigured', high: false });
        continue;
      }
      const g = this.chip.gpio[n];
      out.push({ pin, num: n, mode: this.modeOf(n), high: g.outputEnable ? g.outputValue : (this.inState.get(n) ?? false) });
    }
    return out;
  }

  warnings(): string[] {
    const w = [...this.warned];
    if (this.lagging) w.push('Emülasyon gerçek zamanın gerisinde kalıyor (CPU yükü yüksek); simülasyon zamanı kayabilir.');
    return w;
  }

  halted(): string | null {
    return this.haltReason;
  }
}
