/**
 * SketchRuntime: interprets an Arduino-API-compatible C++ SUBSET (not a compiler/emulator) against SIMULATED time.
 * The sketch is transpiled to JS generator functions; every statement costs 16 CPU cycles of simulated time,
 * delay() advances it, and the generator yields whenever local time passes the requested simTime.
 *
 * INTERRUPTS (attachInterrupt): edges are detected on the pin INPUT voltage once per advance() call, i.e. at STEP
 * GRANULARITY. Resolution limit = the simulation step dt of the caller: pulses shorter than dt are missed, and two edges
 * inside one step collapse into one (flag semantics, like a real interrupt flag that is not yet serviced). The ISR runs as
 * its own generator at the next safe point (the boundary between two advance() slices, which always lies between statements
 * or inside a delay()), never preempting a statement. While the main program sleeps in delay() the ISR runs at the time of
 * the edge, and millis()/micros() inside it show that time. noInterrupts()/cli() defer pending ISRs. delay() inside an ISR
 * is ignored with a warning; an ISR that does not finish within a few steps raises a warning (it starves the main program).
 * LOW/HIGH level interrupts and nested interrupts are not modelled.
 *
 * Wire/SPI: transaction-level master over the bus link (bus.ts): no bit timing, no slave mode / onReceive / onRequest.
 * A transaction costs simulated CPU time (9 bits per I2C byte at the Wire clock, 8 bits per SPI byte at the SPI clock).
 */
import type { Diagnostic, GpioInfo, McuBoardSpec, McuHost, McuRuntime, PinDrive } from '../types';
import type { I2cPort, McuBusLink, SpiPort } from '../bus';
import { CompileError, lex } from './lexer';
import { Parser, prescan } from './parser';
import { arduinoConsts, Gen } from './codegen';

class Halt extends Error {}

interface Pin {
  configured: boolean;
  out: boolean;
  /** output latch; on an input pin it is the pull-up enable (AVR PORT bit) */
  latch: boolean;
  pwm: number | null;
  tone: { f: number; t0: number; t1: number } | null;
  read: boolean;
}

interface Program {
  init: () => Generator<number, void, unknown>;
  setup: () => Generator<number, void, unknown>;
  loop: () => Generator<number, void, unknown>;
}

type Gen0 = Generator<number, void, unknown>;
interface Irq {
  fn: () => Gen0;
  mode: number;
  level: boolean;
}
const rev8 = (b: number): number => {
  let r = 0;
  for (let i = 0; i < 8; i++) r |= ((b >> i) & 1) << (7 - i);
  return r;
};
/** AVR SPI_CLOCK_DIVn constant -> divider */
const SPI_DIV: Record<number, number> = { 0: 4, 1: 16, 2: 64, 3: 128, 4: 2, 5: 8, 6: 32 };

type Arr = unknown[] & { d?: unknown };
const frac = (x: number): number => x - Math.floor(x);

export class SketchRuntime implements McuRuntime {
  readonly kind = 'sketch' as const;
  onSerial: (text: string) => void = () => {};

  // ---- state touched by generated code ----
  tl = 0;
  tg = 0;
  n = 0;
  lim = 200000;
  d = 0;
  c: number;

  private factory: ((rt: SketchRuntime) => Program) | null = null;
  private gen: Generator<number, void, unknown> | null = null;
  private host: McuHost | null = null;
  private halt: string | null = null;
  private pins = new Map<number, Pin>();
  private rwarn: string[] = [];
  private rx = '';
  private rngState = 1;
  private adcRes: number;
  private pwmRes = 8;
  private consts: Record<string, number>;
  // interrupts
  private irq = new Map<number, Irq>();
  private pend = new Set<number>();
  private ie = true;
  private isr: Gen0 | null = null;
  private isrSleep = false;
  private isrSaved = 0;
  private isrAdv = 0;
  private lastT = 0;
  // buses
  private bus: McuBusLink | null = null;
  private i2cPort: I2cPort | null = null;
  private spiPort: SpiPort | null = null;
  private wSdaId: string | undefined;
  private wSclId: string | undefined;
  private wHz = 100000;
  private wTx: { addr: number; buf: number[] } | null = null;
  private wRx: number[] = [];
  private sPins: { mosi: string; miso: string; sck: string } | undefined;
  private spiHz = 4e6;
  private spiLsb = false;
  private spiPending = { hz: 4e6, lsb: false };

  constructor(private spec: McuBoardSpec) {
    this.c = 16 / spec.cpuHz;
    this.adcRes = spec.adcBits;
    this.consts = arduinoConsts(spec);
  }

  // ================= McuRuntime =================
  load(source: string): { ok: boolean; diagnostics: Diagnostic[] } {
    const diags: Diagnostic[] = [];
    let js = '';
    this.factory = null;
    try {
      const predef: Record<string, string> = { ARDUINO: '10819', [`ARDUINO_ARCH_${this.spec.family.toUpperCase()}`]: '1', IRAM_ATTR: '', ICACHE_RAM_ATTR: '' };
      const lx = lex(source, predef);
      for (const w of lx.warns) diags.push({ line: w.line, message: w.message, severity: 'warning' });
      const un = prescan(lx.toks);
      if (un.length) for (const u of un) diags.push({ line: u.line, message: u.message, severity: 'error' });
      else {
        const ast = new Parser(lx.toks, { intBits: this.spec.intBits, family: this.spec.family }).parseProgram();
        const g = new Gen(this.spec);
        js = g.compile(ast);
        for (const e of g.errs) diags.push({ line: e.line, message: e.message, severity: 'error' });
      }
    } catch (e) {
      if (e instanceof CompileError) diags.push({ line: e.line, message: e.message, severity: 'error' });
      else diags.push({ line: 1, message: `Dahili derleme hatası: ${(e as Error).message}`, severity: 'error' });
    }
    diags.sort((a, b) => a.line - b.line);
    const ok = !diags.some((d) => d.severity === 'error');
    if (ok) {
      try {
        this.factory = new Function('$', js) as (rt: SketchRuntime) => Program;
      } catch (e) {
        diags.push({ line: 1, message: `Dahili derleme hatası: ${(e as Error).message}`, severity: 'error' });
        return { ok: false, diagnostics: diags };
      }
    }
    this.reset();
    return { ok, diagnostics: diags };
  }

  reset(): void {
    this.tl = 0;
    this.tg = 0;
    this.n = 0;
    this.d = 0;
    this.halt = null;
    this.pins.clear();
    this.rwarn = [];
    this.rx = '';
    this.rngState = 1;
    this.adcRes = this.spec.adcBits;
    this.pwmRes = 8;
    this.gen = null;
    this.irq.clear();
    this.pend.clear();
    this.ie = true;
    this.isr = null;
    this.isrSleep = false;
    this.isrAdv = 0;
    this.lastT = 0;
    this.i2cPort = null;
    this.spiPort = null;
    this.wSdaId = this.wSclId = undefined;
    this.wHz = 100000;
    this.wTx = null;
    this.wRx = [];
    this.sPins = undefined;
    this.spiHz = 4e6;
    this.spiLsb = false;
    this.spiPending = { hz: 4e6, lsb: false };
    if (!this.factory) return;
    try {
      const prog = this.factory(this);
      this.gen = (function* () {
        yield* prog.init();
        yield* prog.setup();
        for (;;) yield* prog.loop();
      })();
    } catch (e) {
      this.halt = `Program başlatılamadı: ${(e as Error).message}`;
    }
  }

  restartAt(t: number): void {
    this.reset();
    this.tl = t; this.tg = t; this.lastT = t;
  }

  advance(simTime: number, host: McuHost): void {
    this.host = host;
    if (this.halt || !this.gen) return;
    this.tg = simTime;
    this.n = 0;
    try {
      this.pollIrq();
      this.lastT = simTime;
      while (this.n <= this.lim) {
        if (!this.isr) this.startIsr();
        if (this.isr) {
          if (this.tl > simTime) break;
          if (this.isr.next().done) this.endIsr();
          continue;
        }
        if (this.tl > simTime) break;
        if (this.gen.next().done) {
          this.gen = null;
          break;
        }
      }
      if (this.isr && ++this.isrAdv > 4) this.wr('ISR bitmiyor: kesme işlevi çok uzun sürüyor veya sonsuz döngüde (ISR içinde bekleme/döngü kullanmayın, yalnızca bayrak/sayaç güncelleyin)');
    } catch (e) {
      this.gen = null;
      if (e instanceof Halt) this.halt = e.message;
      else if (e instanceof RangeError) this.halt = 'Yığın taşması: özyineleme çok derin';
      else this.halt = `Çalışma zamanı hatası: ${(e as Error).message}`;
    }
  }

  drives(simTime: number): Map<string, PinDrive> {
    const m = new Map<string, PinDrive>();
    for (const [num, p] of this.pins) {
      const id = this.spec.pinMap[num];
      if (!p.configured || id === undefined) continue;
      m.set(id, p.out ? { mode: 'out', high: this.level(p, simTime) } : { mode: p.latch ? 'pullup' : 'in', high: false });
    }
    return m;
  }

  gpio(simTime: number): GpioInfo[] {
    return Object.keys(this.spec.pinMap)
      .map(Number)
      .sort((a, b) => a - b)
      .map((num) => {
        const pin = this.spec.pinMap[num];
        const p = this.pins.get(num);
        if (!p || !p.configured) return { pin, num, mode: 'unconfigured', high: false } as GpioInfo;
        if (p.out) {
          const high = this.level(p, simTime);
          return p.pwm !== null ? { pin, num, mode: 'pwm', high, duty: p.pwm } : { pin, num, mode: 'out', high };
        }
        return { pin, num, mode: p.latch ? 'pullup' : 'in', high: this.sense(num, p) } as GpioInfo;
      });
  }

  serialWrite(text: string): void {
    this.rx += text;
  }
  setBus(link: McuBusLink | null): void {
    this.bus = link;
    this.i2cPort = null;
    this.spiPort = null;
    if (link) link.onWarn = (m) => this.wr(m);
  }
  warnings(): string[] {
    return [...this.rwarn];
  }
  halted(): string | null {
    return this.halt;
  }

  // ================= internals =================
  private level(p: Pin, t: number): boolean {
    if (p.tone) {
      if (t >= p.tone.t1 || t < p.tone.t0) return false;
      return frac((t - p.tone.t0) * p.tone.f) < 0.5;
    }
    if (p.pwm !== null) return frac(t * this.spec.pwmHz) < p.pwm;
    return p.latch;
  }

  private sense(num: number, p: Pin): boolean {
    const id = this.spec.pinMap[num];
    if (!this.host || id === undefined) return p.read;
    const v = this.host.readVoltage(id);
    if (v >= 0.6 * this.spec.vcc) p.read = true;
    else if (v <= 0.3 * this.spec.vcc) p.read = false;
    return p.read;
  }

  /** sample all attached interrupt pins (same Schmitt levels as sense()) and flag edges matching the trigger mode */
  private pollIrq(): void {
    if (!this.irq.size || !this.host) return;
    const vcc = this.spec.vcc;
    for (const [num, e] of this.irq) {
      const id = this.spec.pinMap[num];
      if (id === undefined) continue;
      const v = this.host.readVoltage(id);
      let lv = e.level;
      if (v >= 0.6 * vcc) lv = true;
      else if (v <= 0.3 * vcc) lv = false;
      if (lv === e.level) continue;
      e.level = lv;
      if (e.mode === this.consts.CHANGE || (e.mode === this.consts.RISING && lv) || (e.mode === this.consts.FALLING && !lv)) this.pend.add(num);
    }
  }

  private startIsr(): void {
    if (!this.ie) return;
    while (this.pend.size) {
      const num = this.pend.values().next().value as number;
      this.pend.delete(num);
      const e = this.irq.get(num);
      if (!e) continue;
      this.isrSleep = this.tl > this.tg; // main program idles in delay(): the ISR runs at the time of the edge
      if (this.isrSleep) {
        this.isrSaved = this.tl;
        this.tl = Math.min(this.lastT, this.tg);
      }
      this.isrAdv = 0;
      this.isr = e.fn();
      return;
    }
  }

  private endIsr(): void {
    this.isr = null;
    this.ie = true; // RETI
    if (this.isrSleep) this.tl = Math.max(this.tl, this.isrSaved);
    this.isrSleep = false;
  }

  private levelOf(num: number, prev: boolean): boolean {
    const id = this.spec.pinMap[num];
    if (!this.host || id === undefined) return prev;
    const v = this.host.readVoltage(id);
    return v >= 0.6 * this.spec.vcc ? true : v <= 0.3 * this.spec.vcc ? false : prev;
  }

  private wr(msg: string): void {
    if (!this.rwarn.includes(msg)) this.rwarn.push(msg);
  }

  private pin(num: number, fn: string): Pin | null {
    num = Math.trunc(num);
    if (this.spec.pinMap[num] === undefined) {
      this.wr(`Pin ${num} bu kartta tanımlı değil: ${fn}() yok sayıldı`);
      return null;
    }
    let p = this.pins.get(num);
    if (!p) {
      p = { configured: false, out: false, latch: false, pwm: null, tone: null, read: false };
      this.pins.set(num, p);
    }
    return p;
  }

  private rand(): number {
    // mulberry32
    this.rngState = (this.rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(this.rngState ^ (this.rngState >>> 15), 1 | this.rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ================= API used by generated code =================
  so(): never {
    throw new Halt('Yığın taşması: özyineleme çok derin (sonsuz özyineleme?)');
  }
  noop(label: string, ..._args: unknown[]): number {
    this.wr(`${label} modeli yok: çağrı yok sayıldı`);
    return 0;
  }

  // arithmetic with diagnostics
  dv(a: number, b: number): number {
    if (b === 0) {
      this.wr('Sıfıra bölme: sonuç 0 kabul edildi');
      return 0;
    }
    return Math.trunc(a / b);
  }
  md(a: number, b: number): number {
    if (b === 0) {
      this.wr('Sıfıra bölme (%): sonuç 0 kabul edildi');
      return 0;
    }
    return a % b;
  }
  fd(a: number, b: number): number {
    if (b === 0) {
      this.wr('Sıfıra bölme: sonuç 0 kabul edildi');
      return 0;
    }
    return a / b;
  }
  fmod(a: number, b: number): number {
    return b === 0 ? this.fd(a, b) : a % b;
  }
  rad(x: number): number {
    return x * (Math.PI / 180);
  }
  deg(x: number): number {
    return x * (180 / Math.PI);
  }

  // arrays / strings
  mk(n: number, def: unknown, init?: unknown[]): Arr {
    const a: Arr = new Array(n).fill(def);
    if (init) for (let i = 0; i < init.length; i++) a[i] = init[i];
    a.d = def;
    return a;
  }
  aget(a: Arr, i: number): unknown {
    if (!(i >= 0 && i < a.length)) {
      this.wr(`Dizi indeksi sınır dışı: ${i} (uzunluk ${a.length}), okuma 0 döndü`);
      return a.d ?? 0;
    }
    return a[i];
  }
  aset(a: Arr, i: number, v: unknown): unknown {
    if (!(i >= 0 && i < a.length)) this.wr(`Dizi indeksi sınır dışı: ${i} (uzunluk ${a.length}), yazma yok sayıldı`);
    else a[i] = v;
    return v;
  }
  sch(s: string, i: number): number {
    if (!(i >= 0 && i < s.length)) {
      this.wr(`String indeksi sınır dışı: ${i} (uzunluk ${s.length})`);
      return 0;
    }
    return s.charCodeAt(i);
  }
  sub(s: string, a: number, b?: number): string {
    return b === undefined ? s.substring(Math.max(0, a)) : s.substring(Math.max(0, a), Math.max(0, b));
  }
  indexOf(s: string, x: string, from = 0): number {
    return s.indexOf(x, from);
  }
  lastIndexOf(s: string, x: string, from?: number): number {
    return from === undefined ? s.lastIndexOf(x) : s.lastIndexOf(x, from);
  }
  cmp(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  toInt(s: string): number {
    const m = /^\s*([+-]?\d+)/.exec(s);
    return m ? Math.max(-2147483648, Math.min(2147483647, parseInt(m[1], 10))) : 0;
  }
  toFloat(s: string): number {
    const m = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s);
    return m ? parseFloat(m[0]) : 0;
  }
  cs(a: Arr): string {
    let s = '';
    for (const c of a) {
      if (c === 0) break;
      s += String.fromCharCode(c as number);
    }
    return s;
  }

  // formatting / serial
  ff(v: number, dec: number): string {
    if (Number.isNaN(v)) return 'nan';
    if (!Number.isFinite(v)) return v < 0 ? '-inf' : 'inf';
    return v.toFixed(Math.max(0, Math.min(20, Math.trunc(dec))));
  }
  fi(v: number, base: number): string {
    if (base === 10 || base < 2 || base > 36) return String(v);
    return (v >>> 0).toString(base).toUpperCase();
  }
  out(s: string, nl: boolean): number {
    this.onSerial(nl ? s + '\r\n' : s);
    return s.length + (nl ? 2 : 0);
  }
  avail(): number {
    return this.rx.length;
  }
  read(): number {
    if (!this.rx) return -1;
    const c = this.rx.charCodeAt(0);
    this.rx = this.rx.slice(1);
    return c;
  }
  peek(): number {
    return this.rx ? this.rx.charCodeAt(0) : -1;
  }
  readString(): string {
    const s = this.rx;
    this.rx = '';
    return s;
  }
  readUntil(ch: number): string {
    const i = this.rx.indexOf(String.fromCharCode(ch));
    const s = i < 0 ? this.rx : this.rx.slice(0, i);
    this.rx = i < 0 ? '' : this.rx.slice(i + 1);
    return s;
  }
  parseInt(): number {
    const m = /^[^0-9-]*(-?\d+)/.exec(this.rx);
    if (!m) {
      this.rx = '';
      return 0;
    }
    this.rx = this.rx.slice(m[0].length);
    return parseInt(m[1], 10) | 0;
  }
  parseFloat(): number {
    const m = /^[^0-9.-]*(-?\d*\.?\d+)/.exec(this.rx);
    if (!m) {
      this.rx = '';
      return 0;
    }
    this.rx = this.rx.slice(m[0].length);
    return parseFloat(m[1]);
  }
  printf(fmt: string, args: unknown[]): number {
    let i = 0;
    const s = fmt.replace(/%([-+ 0#]*)(\d+)?(?:\.(\d+))?(?:hh|h|ll|l|z|j|t)?([diuxXfFeEgGsc%])/g, (_m: string, fl: string, w: string | undefined, p: string | undefined, cv: string) => {
      if (cv === '%') return '%';
      const a = args[i++];
      const x = Number(a);
      let r: string;
      switch (cv) {
        case 'd':
        case 'i':
          r = String(Math.trunc(x));
          if (fl.includes('+') && x >= 0) r = '+' + r;
          break;
        case 'u':
          r = String(x >>> 0);
          break;
        case 'x':
          r = (x >>> 0).toString(16);
          break;
        case 'X':
          r = (x >>> 0).toString(16).toUpperCase();
          break;
        case 'f':
        case 'F':
          r = x.toFixed(p === undefined ? 6 : +p);
          break;
        case 'e':
        case 'E':
          r = x.toExponential(p === undefined ? 6 : +p);
          break;
        case 'g':
        case 'G':
          r = String(+x.toPrecision(p === undefined ? 6 : Math.max(1, +p)));
          break;
        case 's':
          r = String(a);
          if (p !== undefined) r = r.slice(0, +p);
          break;
        default:
          r = typeof a === 'number' ? String.fromCharCode(a) : String(a);
      }
      if (w && r.length < +w) r = fl.includes('-') ? r.padEnd(+w) : fl.includes('0') && cv !== 's' && cv !== 'c' ? r.padStart(+w, '0') : r.padStart(+w);
      return r;
    });
    return this.out(s, false);
  }

  // time
  *delay(ms: number): Generator<number, void, unknown> {
    if (this.isr) {
      this.wr('ISR içinde delay() çağrıldı: yok sayıldı (kesme işlevi engellenmemeli; bayrak/sayaç kullanın)');
      return;
    }
    this.tl += ms / 1000;
    if (this.tl > this.tg) yield 0;
  }
  *delayUs(us: number): Generator<number, void, unknown> {
    this.tl += us / 1e6;
    if (this.tl > this.tg) yield 0;
  }
  millis(): number {
    return Math.floor(this.tl * 1000) >>> 0;
  }
  micros(): number {
    return Math.floor(this.tl * 1e6) >>> 0;
  }

  // math
  random(a: number, b?: number): number {
    a = Math.trunc(a);
    if (b === undefined) return a <= 0 ? 0 : Math.floor(this.rand() * a);
    b = Math.trunc(b);
    return a >= b ? a : a + Math.floor(this.rand() * (b - a));
  }
  randomSeed(s: number): void {
    this.rngState = Math.trunc(s) | 0;
  }
  map(x: number, a: number, b: number, c: number, d: number): number {
    [x, a, b, c, d] = [x, a, b, c, d].map(Math.trunc);
    if (b === a) {
      this.wr('map(): giriş aralığı sıfır uzunlukta (sıfıra bölme), sonuç 0');
      return 0;
    }
    return (Math.trunc(((x - a) * (d - c)) / (b - a)) + c) | 0;
  }
  constrain(x: number, a: number, b: number): number {
    return x < a ? a : x > b ? b : x;
  }
  round(x: number): number {
    return (x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5)) | 0;
  }
  bitRead(v: number, n: number): number {
    return n >= 0 && n < 32 ? (v >>> n) & 1 : 0;
  }
  lowByte(v: number): number {
    return v & 255;
  }
  highByte(v: number): number {
    return (v >> 8) & 255;
  }
  bit(n: number): number {
    return n >= 0 && n < 32 ? (1 << n) >>> 0 : 0;
  }
  toupper(c: number): number {
    return c >= 97 && c <= 122 ? c - 32 : c;
  }
  tolower(c: number): number {
    return c >= 65 && c <= 90 ? c + 32 : c;
  }
  cls(name: string, c: number): number {
    const dg = c >= 48 && c <= 57;
    const up = c >= 65 && c <= 90;
    const lo = c >= 97 && c <= 122;
    let r: boolean;
    switch (name) {
      case 'isDigit': r = dg; break;
      case 'isAlpha': r = up || lo; break;
      case 'isAlphaNumeric': r = dg || up || lo; break;
      case 'isUpperCase': r = up; break;
      case 'isLowerCase': r = lo; break;
      case 'isSpace': r = c === 32 || (c >= 9 && c <= 13); break;
      case 'isPunct': r = (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126); break;
      case 'isHexadecimalDigit': r = dg || (c >= 65 && c <= 70) || (c >= 97 && c <= 102); break;
      case 'isAscii': r = c >= 0 && c < 128; break;
      case 'isControl': r = (c >= 0 && c < 32) || c === 127; break;
      case 'isPrintable': r = c >= 32 && c < 127; break;
      default: r = c > 32 && c < 127;
    }
    return r ? 1 : 0;
  }

  // ---- GPIO ----
  pinMode(num: number, mode: number): void {
    const p = this.pin(num, 'pinMode');
    if (!p) return;
    p.pwm = null;
    p.tone = null;
    if (mode === this.consts.OUTPUT) {
      if (this.spec.inputOnly.includes(Math.trunc(num))) {
        this.wr(`GPIO${Math.trunc(num)} yalnızca giriş: çıkış yapılamaz`);
        p.out = false;
      } else p.out = true;
    } else {
      p.out = false;
      p.latch = mode === this.consts.INPUT_PULLUP;
    }
    p.configured = true;
    this.csNotify(Math.trunc(num), p);
  }

  digitalWrite(num: number, v: number): void {
    const p = this.pin(num, 'digitalWrite');
    if (!p) return;
    p.pwm = null;
    p.tone = null;
    const lv = v !== 0;
    if (p.out) p.latch = lv;
    else if (this.spec.family === 'avr') {
      p.latch = lv; // PORT bit on an input pin = pull-up
      p.configured = true;
    } else this.wr(`GPIO${Math.trunc(num)} çıkış olarak ayarlanmadan digitalWrite: etkisiz`);
    this.csNotify(Math.trunc(num), p);
  }

  digitalRead(num: number): number {
    const p = this.pin(num, 'digitalRead');
    return p && this.sense(Math.trunc(num), p) ? 1 : 0;
  }

  analogRead(num: number): number {
    num = Math.trunc(num);
    const s = this.spec;
    let pin = num;
    if (!s.adcPins.includes(pin)) {
      const a0 = s.constants.A0;
      if (a0 !== undefined && s.adcPins.includes(a0 + num)) pin = a0 + num;
      else {
        this.wr(`Pin ${num} analog giriş değil: analogRead() 0 döndürdü`);
        return 0;
      }
    }
    const id = s.pinMap[pin];
    const max = 2 ** this.adcRes - 1;
    if (id === undefined || !this.host) return 0;
    const v = this.host.readVoltage(id);
    return Math.max(0, Math.min(max, Math.floor((v / s.adcVref) * max)));
  }

  analogReadResolution(bits: number): void {
    this.adcRes = Math.max(1, Math.min(16, Math.trunc(bits)));
  }
  analogWriteResolution(bits: number): void {
    this.pwmRes = Math.max(1, Math.min(16, Math.trunc(bits)));
  }

  analogWrite(num: number, v: number): void {
    const p = this.pin(num, 'analogWrite');
    if (!p) return;
    if (this.spec.inputOnly.includes(Math.trunc(num))) {
      this.wr(`GPIO${Math.trunc(num)} yalnızca giriş: analogWrite etkisiz`);
      return;
    }
    const max = 2 ** this.pwmRes - 1;
    v = Math.max(0, Math.min(max, Math.trunc(v)));
    p.out = true;
    p.configured = true;
    p.tone = null;
    p.pwm = null;
    if (this.spec.pwmPins.includes(Math.trunc(num))) {
      const duty = v / max;
      if (duty <= 0) p.latch = false;
      else if (duty >= 1) p.latch = true;
      else p.pwm = duty;
    } else {
      if (this.spec.family !== 'avr') this.wr(`Pin ${Math.trunc(num)} PWM desteklemiyor: analogWrite dijital çıkış gibi davrandı`);
      p.latch = v >= (max + 1) / 2;
    }
  }

  tone(num: number, freq: number, dur?: number): void {
    const p = this.pin(num, 'tone');
    if (!p) return;
    if (this.spec.inputOnly.includes(Math.trunc(num))) {
      this.wr(`GPIO${Math.trunc(num)} yalnızca giriş: tone etkisiz`);
      return;
    }
    if (!(freq > 0)) return;
    p.out = true;
    p.configured = true;
    p.pwm = null;
    p.tone = { f: freq, t0: this.tl, t1: dur && dur > 0 ? this.tl + dur / 1000 : Infinity };
  }
  noTone(num: number): void {
    const p = this.pin(num, 'noTone');
    if (!p) return;
    p.tone = null;
    p.latch = false;
  }

  // ---- interrupts ----
  /** AVR: interrupt number -> pin; other families: the argument is the pin itself */
  private intPin(n: number): number | null {
    n = Math.trunc(n);
    if (this.spec.intPins) {
      const p = n >= 0 ? this.spec.intPins[n] : undefined;
      if (p === undefined) {
        this.wr(`attachInterrupt: ${n} numaralı harici kesme bu kartta yok (geçerli: 0..${this.spec.intPins.length - 1}, pinler ${this.spec.intPins.join(', ')}); digitalPinToInterrupt(pin) kullanın`);
        return null;
      }
      return p;
    }
    if (this.spec.pinMap[n] === undefined) {
      this.wr(`attachInterrupt: pin ${n} bu kartta tanımlı değil`);
      return null;
    }
    return n;
  }
  digitalPinToInterrupt(pin: number): number {
    pin = Math.trunc(pin);
    if (this.spec.intPins) {
      const i = this.spec.intPins.indexOf(pin);
      if (i < 0) {
        this.wr(`Pin ${pin} harici kesme pini değil (bu kartta: ${this.spec.intPins.join(', ')}): digitalPinToInterrupt() -1 döndürdü`);
        return -1;
      }
      return i;
    }
    if (this.spec.pinMap[pin] === undefined) {
      this.wr(`Pin ${pin} bu kartta tanımlı değil: digitalPinToInterrupt() -1 döndürdü`);
      return -1;
    }
    return pin;
  }
  attachInterrupt(n: number, fn: () => Gen0, mode: number): void {
    const pin = this.intPin(n);
    if (pin === null) return;
    mode = Math.trunc(mode);
    if (mode !== this.consts.RISING && mode !== this.consts.FALLING && mode !== this.consts.CHANGE) {
      this.wr('attachInterrupt: yalnızca RISING/FALLING/CHANGE desteklenir (LOW/HIGH seviye kesmesi yok): çağrı yok sayıldı');
      return;
    }
    this.irq.set(pin, { fn, mode, level: this.levelOf(pin, false) });
    this.pend.delete(pin);
  }
  detachInterrupt(n: number): void {
    const pin = this.intPin(n);
    if (pin === null) return;
    this.irq.delete(pin);
    this.pend.delete(pin);
  }
  noInterrupts(): void {
    this.ie = false;
  }
  interrupts(): void {
    if (!this.isr) this.ie = true;
  }
  cli(): void {
    this.noInterrupts();
  }
  sei(): void {
    this.interrupts();
  }

  // ---- Wire (I2C master) ----
  private getI2c(): I2cPort | null {
    if (!this.bus) {
      this.wr('I2C: bu çalıştırmada bus modeli bağlı değil: Wire çağrıları cihaz bulamaz');
      return null;
    }
    return (this.i2cPort ??= this.bus.i2c(this.wSdaId, this.wSclId));
  }
  private wCap(): number {
    return this.spec.family === 'avr' ? 32 : 128;
  }
  wBegin(a: number[]): void {
    if (a.length === 1) this.wr('Wire.begin(adres): I2C slave modu yok (yalnızca master modeli)');
    else if (a.length >= 2) {
      if (this.spec.family === 'esp32') {
        const sda = this.spec.pinMap[Math.trunc(a[0])], scl = this.spec.pinMap[Math.trunc(a[1])];
        if (sda === undefined || scl === undefined) this.wr(`Wire.begin(${a[0]}, ${a[1]}): pin bu kartta tanımlı değil, varsayılan SDA/SCL kullanıldı`);
        else {
          this.wSdaId = sda;
          this.wSclId = scl;
          this.i2cPort = null;
        }
        if (a[2] > 0) this.wHz = a[2];
      } else this.wr('Wire.begin(sda, scl) bu kartta yok: varsayılan SDA/SCL kullanıldı (Pico için Wire.setSDA/setSCL)');
    }
  }
  wEnd0(): void {}
  wClock(hz: number): void {
    this.wHz = Math.max(1000, Math.min(3.4e6, hz));
  }
  private wPin(n: number, which: 'SDA' | 'SCL'): void {
    if (this.spec.family !== 'rp2040') {
      this.wr(`Wire.set${which}() yalnızca RP2040 çekirdeğinde var: yok sayıldı`);
      return;
    }
    const id = this.spec.pinMap[Math.trunc(n)];
    if (id === undefined) {
      this.wr(`Wire.set${which}(${n}): pin bu kartta tanımlı değil`);
      return;
    }
    if (which === 'SDA') this.wSdaId = id;
    else this.wSclId = id;
    this.i2cPort = null;
  }
  wSda(n: number): void {
    this.wPin(n, 'SDA');
  }
  wScl(n: number): void {
    this.wPin(n, 'SCL');
  }
  wBeginTx(addr: number): void {
    this.wTx = { addr: Math.trunc(addr) & 0x7f, buf: [] };
  }
  private wPush(b: number): number {
    if (!this.wTx) {
      this.wr('Wire.write(): beginTransmission() olmadan çağrıldı (slave yazımı yok): bayt atıldı');
      return 0;
    }
    if (this.wTx.buf.length >= this.wCap()) {
      this.wr(`Wire.write(): ara bellek dolu (${this.wCap()} bayt): fazla bayt atıldı`);
      return 0;
    }
    this.wTx.buf.push(b & 255);
    return 1;
  }
  wWrite(v: number): number {
    return this.wPush(v);
  }
  wWriteS(s: string): number {
    let n = 0;
    for (let i = 0; i < s.length; i++) n += this.wPush(s.charCodeAt(i));
    return n;
  }
  wWriteA(a: Arr, len: number): number {
    const n = len < 0 ? a.length : Math.min(len, a.length);
    let k = 0;
    for (let i = 0; i < n; i++) k += this.wPush(Number(a[i]));
    return k;
  }
  /** Arduino status: 0 ok, 2 NACK on address, 4 other error */
  wEndTx(stop = 1): number {
    const tx = this.wTx;
    this.wTx = null;
    if (!tx) return 4;
    const port = this.getI2c();
    if (!port) return 2;
    const ok = port.begin(tx.addr, true, this.tl);
    this.tl += (9 * (ok ? 1 + tx.buf.length : 1)) / this.wHz;
    if (!ok) return 2;
    if (tx.buf.length) port.write(tx.buf);
    if (stop) port.stop();
    return 0;
  }
  wRequest(addr: number, n: number, stop = 1): number {
    this.wRx = [];
    const port = this.getI2c();
    if (!port) return 0;
    n = Math.max(0, Math.min(Math.trunc(n), this.wCap()));
    const ok = port.begin(Math.trunc(addr) & 0x7f, false, this.tl);
    this.tl += (9 * (ok ? 1 + n : 1)) / this.wHz;
    if (!ok) return 0;
    this.wRx = port.read(n).slice(0, n);
    if (stop) port.stop();
    return this.wRx.length;
  }
  wAvail(): number {
    return this.wRx.length;
  }
  wRead(): number {
    return this.wRx.length ? this.wRx.shift()! : -1;
  }
  wPeek(): number {
    return this.wRx.length ? this.wRx[0] : -1;
  }

  // ---- SPI (master) ----
  private getSpi(): SpiPort | null {
    if (!this.bus) {
      this.wr('SPI: bu çalıştırmada bus modeli bağlı değil: SPI çağrıları cihaz bulamaz');
      return null;
    }
    if (!this.spiPort) {
      if (!this.spec.spi && !this.sPins) {
        this.wr('SPI: bu kartın modelinde donanım SPI pinleri tanımlı değil (ör. Mega D50–D53 çıkarılmamış)');
        return null;
      }
      this.spiPort = this.bus.spi(this.sPins);
    }
    return this.spiPort;
  }
  /** chip-select tracking: logical pin level (output latch; inputs count as high) is forwarded to the bus */
  private csNotify(num: number, p: Pin): void {
    if (!this.bus || (!this.spec.spi && !this.sPins)) return;
    const id = this.spec.pinMap[num];
    if (id === undefined) return;
    (this.spiPort ??= this.bus.spi(this.sPins)).pin(id, p.out ? p.latch : true);
  }
  sBegin(a: number[]): void {
    if (a.length >= 3 && this.spec.family === 'esp32') {
      const sck = this.spec.pinMap[Math.trunc(a[0])], miso = this.spec.pinMap[Math.trunc(a[1])], mosi = this.spec.pinMap[Math.trunc(a[2])];
      if (sck === undefined || miso === undefined || mosi === undefined) this.wr('SPI.begin(sck, miso, mosi): pin bu kartta tanımlı değil, varsayılan SPI pinleri kullanıldı');
      else {
        this.sPins = { sck, miso, mosi };
        this.spiPort = null;
      }
    } else if (a.length) this.wr('SPI.begin(pinler) yalnızca ESP32 için (sck, miso, mosi, ss): varsayılan SPI pinleri kullanıldı');
  }
  sEnd(): void {}
  spiSet(clock: number, order: number, _mode: number): number {
    this.spiPending = { hz: Math.max(1, clock), lsb: Math.trunc(order) === this.consts.LSBFIRST };
    return 0;
  }
  sTxBegin(_settings: number): void {
    this.spiHz = Math.min(this.spiPending.hz, this.spec.cpuHz / 2);
    this.spiLsb = this.spiPending.lsb;
  }
  sTxEnd(): void {}
  sDiv(d: number): void {
    const div = SPI_DIV[Math.trunc(d)];
    if (div === undefined) this.wr(`SPI.setClockDivider(${d}): bilinmeyen bölücü`);
    else this.spiHz = this.spec.cpuHz / div;
  }
  sMode(_m: number): void {}
  sOrder(o: number): void {
    this.spiLsb = Math.trunc(o) === this.consts.LSBFIRST;
  }
  sNoop(_n: number): void {}
  sXfer(b: number): number {
    const port = this.getSpi();
    this.tl += 8 / this.spiHz;
    if (!port) return 0;
    const tx = this.spiLsb ? rev8(b & 255) : b & 255;
    const rx = port.transfer(tx, this.tl);
    return this.spiLsb ? rev8(rx) : rx;
  }
  sXfer16(w: number): number {
    const hi = (w >> 8) & 255, lo = w & 255;
    if (this.spiLsb) {
      const l = this.sXfer(lo);
      return (this.sXfer(hi) << 8) | l;
    }
    const h = this.sXfer(hi);
    return (h << 8) | this.sXfer(lo);
  }
  sXferA(a: Arr, n: number): void {
    n = Math.trunc(n);
    if (n > a.length) this.wr(`SPI.transfer(dizi, ${n}): dizi uzunluğu ${a.length}, fazlası yok sayıldı`);
    for (let i = 0; i < Math.min(n, a.length); i++) a[i] = this.sXfer(Number(a[i]));
  }
}
