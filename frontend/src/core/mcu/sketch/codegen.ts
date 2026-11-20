/**
 * AST -> JavaScript generator-function source. Only constructs generated here reach `new Function`:
 * user identifiers are prefixed (v_/f_/s<N>_), string literals go through JSON.stringify, numbers are formatted by us.
 */
import type { McuBoardSpec } from '../types';
import type { Expr, Func, Stmt, Top, Ty } from './parser';

/** per-statement cost + cooperative yield check (against simulated time) */
export const TICK = '$.tl+=$.c;if(++$.n>$.lim||$.tl>$.tg)yield 0;';

type Decl = Extract<Stmt, { k: 'decl' }>;
type R = { c: string; t: Ty };
interface Sym {
  js: string;
  ty: Ty;
  ro: boolean;
  cv?: number;
}
interface FnSig {
  ret: Ty;
  params: Ty[];
  defined: boolean;
}

const INFO: Record<string, [number, boolean]> = {
  bool: [8, false],
  char: [8, true],
  i8: [8, true],
  u8: [8, false],
  i16: [16, true],
  u16: [16, false],
  i32: [32, true],
  u32: [32, false],
};
const SMALL = new Set(['bool', 'char', 'i8', 'u8', 'i16', 'u16']);

const isArr = (t: Ty): t is { arr: Ty; n: number } => typeof t === 'object';
const isInt = (t: Ty): boolean => typeof t === 'string' && t in INFO;
const isFlt = (t: Ty): boolean => t === 'f32' || t === 'f64';
const isNum = (t: Ty): boolean => isInt(t) || isFlt(t);
const isStr = (t: Ty): boolean => t === 'str' || t === 'cstr';
const sameTy = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function range(t: string): [number, number] {
  if (t === 'bool') return [0, 1];
  const [b, s] = INFO[t];
  return s ? [-(2 ** (b - 1)), 2 ** (b - 1) - 1] : [0, 2 ** b - 1];
}
const fits = (a: string, b: string): boolean => {
  const [al, ah] = range(a);
  const [bl, bh] = range(b);
  return al >= bl && ah <= bh;
};

function wrap(t: string, c: string): string {
  switch (t) {
    case 'bool':
      return `(${c}?1:0)`;
    case 'char':
    case 'i8':
      return `((${c})<<24>>24)`;
    case 'u8':
      return `((${c})&255)`;
    case 'i16':
      return `((${c})<<16>>16)`;
    case 'u16':
      return `((${c})&65535)`;
    case 'i32':
      return `((${c})|0)`;
    default:
      return `((${c})>>>0)`;
  }
}

/** constants visible to sketches (board-specific ones override) */
export function arduinoConsts(spec: McuBoardSpec): Record<string, number> {
  return { HIGH: 1, LOW: 0, INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2, DEC: 10, HEX: 16, BIN: 2, OCT: 8, LSBFIRST: 0, MSBFIRST: 1, CHANGE: 1, FALLING: 2, RISING: 3, SPI_MODE0: 0, SPI_MODE1: 1, SPI_MODE2: 2, SPI_MODE3: 3, SPI_CLOCK_DIV4: 0, SPI_CLOCK_DIV16: 1, SPI_CLOCK_DIV64: 2, SPI_CLOCK_DIV128: 3, SPI_CLOCK_DIV2: 4, SPI_CLOCK_DIV8: 5, SPI_CLOCK_DIV32: 6, ...spec.constants };
}
const FCONST: Record<string, number> = { PI: Math.PI, TWO_PI: 2 * Math.PI, HALF_PI: Math.PI / 2, DEG_TO_RAD: Math.PI / 180, RAD_TO_DEG: 180 / Math.PI, EULER: Math.E };

/** [min args, max args, return: 'v' void | 'i' int | explicit type] for `$.name(...)` API calls with numeric args */
const SIMPLE: Record<string, [number, number, string]> = {
  pinMode: [2, 2, 'v'],
  digitalWrite: [2, 2, 'v'],
  analogWrite: [2, 2, 'v'],
  analogReadResolution: [1, 1, 'v'],
  analogWriteResolution: [1, 1, 'v'],
  noTone: [1, 1, 'v'],
  tone: [2, 3, 'v'],
  randomSeed: [1, 1, 'v'],
  digitalRead: [1, 1, 'i'],
  digitalPinToInterrupt: [1, 1, 'i'],
  detachInterrupt: [1, 1, 'v'],
  interrupts: [0, 0, 'v'],
  noInterrupts: [0, 0, 'v'],
  cli: [0, 0, 'v'],
  sei: [0, 0, 'v'],
  analogRead: [1, 1, 'i'],
  millis: [0, 0, 'u32'],
  micros: [0, 0, 'u32'],
  random: [1, 2, 'i32'],
  map: [5, 5, 'i32'],
  bitRead: [2, 2, 'i'],
  lowByte: [1, 1, 'u8'],
  highByte: [1, 1, 'u8'],
  bit: [1, 1, 'u32'],
  toupper: [1, 1, 'i'],
  tolower: [1, 1, 'i'],
};
const CLS = new Set(['isDigit', 'isAlpha', 'isAlphaNumeric', 'isUpperCase', 'isLowerCase', 'isSpace', 'isPunct', 'isHexadecimalDigit', 'isAscii', 'isControl', 'isPrintable', 'isGraph']);
const MATH1: Record<string, string> = { sqrt: 'Math.sqrt', sin: 'Math.sin', cos: 'Math.cos', tan: 'Math.tan', asin: 'Math.asin', acos: 'Math.acos', atan: 'Math.atan', exp: 'Math.exp', log: 'Math.log', log10: 'Math.log10', floor: 'Math.floor', ceil: 'Math.ceil', fabs: 'Math.abs', radians: '$.rad', degrees: '$.deg' };
const MATH2: Record<string, string> = { pow: 'Math.pow', atan2: 'Math.atan2', fmod: '$.fmod' };
const NOOP_FN: Record<string, string> = {
  pulseIn: 'pulseIn',
  pulseInLong: 'pulseInLong',
  shiftOut: 'shiftOut',
  shiftIn: 'shiftIn',
  analogReference: 'analogReference',
};
const NOOP_OBJ: Record<string, string> = { WiFi: 'WiFi', EEPROM: 'EEPROM', Serial1: 'Serial1', Serial2: 'Serial2', Serial3: 'Serial3' };

export class Gen {
  errs: { line: number; message: string }[] = [];
  private ib: 16 | 32;
  private INT: Ty;
  private FD: Ty;
  private SZ: Ty;
  private consts: Record<string, number>;
  private scopes: Map<string, Sym>[] = [new Map()];
  private funcs = new Map<string, FnSig>();
  private initTemps: string[] = [];
  private temps: string[] = this.initTemps;
  private tc = 0;
  private sc = 0;
  private hoist: string[] = [];
  private globals: string[] = [];
  private initCode: string[] = [];
  private fnCode: string[] = [];
  private curRet: Ty = 'void';
  private loops = 0;
  private brk = 0;

  constructor(private spec: McuBoardSpec) {
    this.ib = spec.intBits;
    this.INT = `i${this.ib}`;
    this.FD = spec.family === 'avr' ? 'f32' : 'f64';
    this.SZ = spec.family === 'avr' ? 'u16' : 'u32';
    this.consts = arduinoConsts(spec);
  }

  // ---------- helpers ----------
  private err(line: number, message: string): void {
    if (!this.errs.some((e) => e.line === line && e.message === message)) this.errs.push({ line, message });
  }
  private bad(): R {
    return { c: '0', t: this.INT };
  }
  private tmp(): string {
    const n = `$t${++this.tc}`;
    this.temps.push(n);
    return n;
  }
  private look(name: string): Sym | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const s = this.scopes[i].get(name);
      if (s) return s;
    }
    return undefined;
  }
  private declare(name: string, sym: Sym, line: number): void {
    const sc = this.scopes[this.scopes.length - 1];
    if (sc.has(name)) this.err(line, `'${name}' aynı kapsamda zaten tanımlı`);
    sc.set(name, sym);
  }
  private promote(t: string): string {
    if (!isInt(t)) return t;
    return INFO[t][0] < this.ib ? this.INT as string : t;
  }
  private common(a: Ty, b: Ty): string {
    if (a === 'f64' || b === 'f64') return 'f64';
    if (isFlt(a) || isFlt(b)) return 'f32';
    const pa = this.promote(a as string);
    const pb = this.promote(b as string);
    const [ba, sa] = INFO[pa];
    const [bb, sb] = INFO[pb];
    if (ba !== bb) return ba > bb ? pa : pb;
    if (!sa) return pa;
    if (!sb) return pb;
    return pa;
  }
  private fr(t: string, c: string): string {
    return t === 'f32' ? `Math.fround(${c})` : c;
  }
  private dflt(t: Ty): string {
    return t === 'str' ? '""' : '0';
  }
  private lit(v: number, ty: Ty): string {
    if (ty === 'f32') v = Math.fround(v);
    const s = String(v);
    return v < 0 || Object.is(v, -0) ? `(${s})` : s;
  }

  /** implicit/explicit numeric conversion */
  private conv(from: Ty, to: Ty, c: string): string {
    if (from === to) return c;
    if (to === 'bool') return `(${c}?1:0)`;
    if (to === 'f32') return isFlt(from) ? (from === 'f64' ? `Math.fround(${c})` : c) : SMALL.has(from as string) ? c : `Math.fround(${c})`;
    if (to === 'f64') return c;
    if (isFlt(from)) return wrap(to as string, `Math.trunc(${c})`);
    if (fits(from as string, to as string)) return c;
    return wrap(to as string, c);
  }

  /** assignment-style conversion with type checking */
  private asn(to: Ty, r: R, line: number): string {
    if (isStr(to)) {
      if (isStr(r.t)) return r.c;
      this.err(line, `${this.tn(r.t)} değeri String'e atanamaz: String(...) kullanın`);
      return '""';
    }
    if (isNum(to)) {
      if (isNum(r.t)) return this.conv(r.t, to, r.c);
      this.err(line, `${this.tn(r.t)} değeri sayısal değişkene atanamaz`);
      return '0';
    }
    this.err(line, 'bu türe atama yapılamaz');
    return '0';
  }
  private tn(t: Ty): string {
    if (isArr(t)) return 'dizi';
    if (t === 'str' || t === 'cstr') return t === 'cstr' ? 'metin sabiti' : 'String';
    if (t === 'void') return 'void';
    return 'sayı';
  }
  private num(r: R, line: number, what: string): R {
    if (!isNum(r.t)) {
      this.err(line, `${what}: sayısal değer bekleniyor (${this.tn(r.t)} verildi)`);
      return this.bad();
    }
    return r;
  }

  private cfold(e: Expr): number | null {
    switch (e.k) {
      case 'num':
      case 'chr':
        return e.v;
      case 'id': {
        const s = this.look(e.name);
        if (s) return s.cv ?? null;
        if (e.name === 'true') return 1;
        if (e.name === 'false') return 0;
        return this.consts[e.name] ?? null;
      }
      case 'un': {
        const v = this.cfold(e.e);
        if (v === null) return null;
        return e.op === '-' ? -v : e.op === '+' ? v : e.op === '~' ? ~v : e.op === '!' ? (v ? 0 : 1) : null;
      }
      case 'cast': {
        const v = this.cfold(e.e);
        return v !== null && isInt(e.ty) ? Math.trunc(v) : v;
      }
      case 'bin': {
        const a = this.cfold(e.l);
        const b = this.cfold(e.r);
        if (a === null || b === null) return null;
        const ints = Number.isInteger(a) && Number.isInteger(b);
        switch (e.op) {
          case '+': return a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/': return b === 0 ? null : ints ? Math.trunc(a / b) : a / b;
          case '%': return b === 0 ? null : a % b;
          case '<<': return a << b;
          case '>>': return a >> b;
          case '&': return a & b;
          case '|': return a | b;
          case '^': return a ^ b;
          default: return null;
        }
      }
      default:
        return null;
    }
  }

  // ---------- program ----------
  compile(prog: Top[]): string {
    for (const t of prog) {
      if (t.k !== 'func') continue;
      const ps = t.params.map((p) => p.ty);
      const old = this.funcs.get(t.name);
      if (old && (old.ret !== t.ret || !sameTy(old.params, ps))) this.err(t.line, `'${t.name}' fonksiyonu farklı imzalarla bildirilmiş`);
      else if (!old) this.funcs.set(t.name, { ret: t.ret, params: ps, defined: false });
    }
    for (const t of prog) {
      if (t.k === 'func') {
        if (t.body) this.compileFunc(t);
      } else this.globalDecl(t);
    }
    for (const n of ['setup', 'loop']) {
      const f = this.funcs.get(n);
      if (!f || !f.defined) this.err(1, `${n}() fonksiyonu tanımlı değil`);
      else if (f.ret !== 'void' || f.params.length) this.err(1, `${n}() fonksiyonu 'void ${n}()' biçiminde olmalı`);
    }
    for (const [n, f] of this.funcs) if (!f.defined && n !== 'setup' && n !== 'loop') this.err(1, `'${n}' fonksiyonu bildirilmiş ama tanımlanmamış`);
    const lets = [...this.globals, ...this.hoist];
    return [
      '"use strict";',
      lets.length ? `let ${lets.join(',')};` : '',
      ...this.fnCode,
      `function* $init(){${this.initTemps.length ? `let ${this.initTemps.join(',')};` : ''}${this.initCode.join('\n')}}`,
      'return {init:$init,setup:f_setup,loop:f_loop};',
    ].join('\n');
  }

  private compileFunc(f: Func): void {
    const sig = this.funcs.get(f.name)!;
    if (sig.defined) {
      this.err(f.line, `'${f.name}' fonksiyonu birden çok kez tanımlanmış`);
      return;
    }
    sig.defined = true;
    this.temps = [];
    this.scopes = [this.scopes[0], new Map()];
    this.curRet = f.ret;
    this.loops = 0;
    this.brk = 0;
    const ps = f.params.map((p, i) => {
      const js = p.name ? `v_${p.name}` : `p$${i}`;
      if (p.name) this.declare(p.name, { js, ty: p.ty, ro: false }, f.line);
      return js;
    });
    const body = f.body!.map((s) => this.st(s)).join('\n');
    const tail = f.ret === 'void' ? '' : `return ${this.dflt(f.ret)};`;
    this.fnCode.push(`function* f_${f.name}(${ps.join(',')}){if(++$.d>500)$.so();try{${this.temps.length ? `let ${this.temps.join(',')};` : ''}${TICK}\n${body}\n${tail}}finally{$.d--;}}`);
    this.scopes = [this.scopes[0]];
    this.temps = this.initTemps;
  }

  private globalDecl(d: Decl): void {
    for (const v of d.vars) {
      const { ty, code, cv } = this.varInit(d, v);
      const js = `v_${v.name}`;
      this.declare(v.name, { js, ty, ro: d.isConst, cv }, v.line);
      this.globals.push(js);
      this.initCode.push(`${js}=${code};`);
    }
  }

  // ---------- declarations ----------
  private varInit(d: Decl, v: Decl['vars'][number]): { ty: Ty; code: string; cv?: number } {
    let ty: Ty = d.ty;
    if (ty === 'void') {
      this.err(v.line, 'void türünde değişken olamaz');
      ty = this.INT;
    }
    if (v.arr !== null) {
      const elem = ty;
      if (typeof elem === 'string' && elem.startsWith('obj:')) this.err(v.line, `${elem.slice(4)} dizisi desteklenmiyor`);
      let items: Expr[] | null = null;
      let strInit: string | null = null;
      if (Array.isArray(v.init)) items = v.init;
      else if (v.init && v.init.k === 'str' && elem === 'char') strInit = v.init.v;
      else if (v.init) this.err(v.line, 'dizi başlatıcısı {...} biçiminde olmalı');
      let n = 1;
      if (v.arr === 'auto') {
        if (items) n = items.length;
        else if (strInit !== null) n = [...strInit].length + 1;
        else this.err(v.line, 'dizi boyutu belirtilmeli veya başlatıcı verilmeli');
      } else {
        const f = this.cfold(v.arr);
        if (f === null || !Number.isInteger(f) || f <= 0) this.err(v.line, 'dizi boyutu pozitif bir tamsayı sabiti olmalı');
        else n = f;
      }
      let init: string[] | null = null;
      if (items) {
        if (items.length > n) this.err(v.line, `dizi başlatıcısında çok fazla eleman (${items.length} > ${n})`);
        init = items.map((e) => this.asn(elem, this.ex(e), e.line));
      } else if (strInit !== null) {
        const cs = [...strInit];
        if (cs.length + 1 > n) this.err(v.line, 'metin dizi boyutuna sığmıyor');
        init = [...cs.map((ch) => String(ch.codePointAt(0))), '0'];
      }
      return { ty: { arr: elem, n }, code: `$.mk(${n},${this.dflt(elem)}${init ? `,[${init.join(',')}]` : ''})` };
    }
    if (Array.isArray(v.init)) this.err(v.line, 'süslü parantez başlatıcı yalnızca dizilerde desteklenir');
    let code = this.dflt(ty);
    let cv: number | undefined;
    if (v.init && !Array.isArray(v.init)) {
      code = this.asn(ty, this.ex(v.init), v.line);
      if (d.isConst && isNum(ty)) {
        const f = this.cfold(v.init);
        if (f !== null) cv = isInt(ty) ? Math.trunc(f) : f;
      }
    }
    return { ty, code, cv };
  }

  private localDecl(d: Decl): string {
    const pieces: string[] = [];
    const extra: string[] = [];
    for (const v of d.vars) {
      const { ty, code, cv } = this.varInit(d, v);
      if (d.isStatic) {
        const js = `s${++this.sc}_${v.name}`;
        this.hoist.push(js, `${js}$i=false`);
        this.declare(v.name, { js, ty, ro: d.isConst, cv }, v.line);
        extra.push(`if(!${js}$i){${js}$i=true;${js}=${code};}`);
      } else {
        const js = `v_${v.name}`;
        this.declare(v.name, { js, ty, ro: d.isConst, cv }, v.line);
        pieces.push(`${js}=${code}`);
      }
    }
    return (pieces.length ? `let ${pieces.join(',')};` : '') + extra.join('');
  }

  // ---------- statements ----------
  private sub(s: Stmt): string {
    this.scopes.push(new Map());
    const r = this.st(s);
    this.scopes.pop();
    return `{${r}}`;
  }

  private cond(e: Expr): string {
    const r = this.ex(e);
    if (!isNum(r.t)) {
      this.err(e.line, `koşul sayısal/mantıksal olmalı (${this.tn(r.t)} verildi)`);
      return '0';
    }
    return r.c;
  }

  private st(s: Stmt): string {
    switch (s.k) {
      case 'empty':
        return TICK;
      case 'block': {
        this.scopes.push(new Map());
        const b = s.body.map((x) => this.st(x)).join('\n');
        this.scopes.pop();
        return `{${b}}`;
      }
      case 'decl':
        return TICK + this.localDecl(s);
      case 'expr': {
        const e = s.e.k === 'inc' && !s.e.pre ? { ...s.e, pre: true } : s.e;
        return `${TICK}${this.ex(e).c};`;
      }
      case 'if':
        return `${TICK}if(${this.cond(s.c)})${this.sub(s.t)}${s.f ? `else ${this.sub(s.f)}` : ''}`;
      case 'while': {
        const c = this.cond(s.c);
        this.loops++;
        this.brk++;
        const b = this.sub(s.body);
        this.loops--;
        this.brk--;
        return `while(${c}){${TICK}${b}}`;
      }
      case 'do': {
        this.loops++;
        this.brk++;
        const b = this.sub(s.body);
        this.loops--;
        this.brk--;
        return `do{${TICK}${b}}while(${this.cond(s.c)});`;
      }
      case 'for': {
        this.scopes.push(new Map());
        let init = '';
        if (s.init) {
          if (s.init.k === 'decl') {
            if (s.init.isStatic || s.init.vars.some((v) => v.arr !== null)) this.err(s.line, 'for başlatıcısında static/dizi desteklenmiyor');
            init = this.localDecl(s.init).replace(/;$/, '');
          } else if (s.init.k === 'expr') init = this.ex(s.init.e).c;
        }
        const c = s.c ? this.cond(s.c) : '';
        const u = s.u ? this.ex(s.u.k === 'inc' && !s.u.pre ? { ...s.u, pre: true } : s.u).c : '';
        this.loops++;
        this.brk++;
        const b = this.sub(s.body);
        this.loops--;
        this.brk--;
        this.scopes.pop();
        return `for(${init};${c};${u}){${TICK}${b}}`;
      }
      case 'switch': {
        const e = this.ex(s.e);
        if (!isInt(e.t)) this.err(s.line, 'switch ifadesi tamsayı olmalı');
        this.scopes.push(new Map());
        this.brk++;
        const seen = new Set<number | null>();
        const body = s.cases
          .map((c) => {
            let label = 'default:';
            if (c.test) {
              const v = this.cfold(c.test);
              if (v === null) {
                this.err(c.line, 'case etiketi sabit bir tamsayı olmalı');
                label = 'case 0:';
              } else {
                if (seen.has(v)) this.err(c.line, `case ${v} tekrar ediyor`);
                seen.add(v);
                label = `case ${this.lit(v, 'i32')}:`;
              }
            } else {
              if (seen.has(null)) this.err(c.line, 'birden çok default etiketi');
              seen.add(null);
            }
            return `${label}\n${c.body.map((x) => this.st(x)).join('\n')}`;
          })
          .join('\n');
        this.brk--;
        this.scopes.pop();
        return `${TICK}switch(${e.c}){${body}}`;
      }
      case 'break':
        if (!this.brk) this.err(s.line, 'break yalnızca döngü veya switch içinde kullanılabilir');
        return `${TICK}break;`;
      case 'continue':
        if (!this.loops) this.err(s.line, 'continue yalnızca döngü içinde kullanılabilir');
        return `${TICK}continue;`;
      case 'return': {
        if (this.curRet === 'void') {
          if (s.e) this.err(s.line, 'void fonksiyon değer döndüremez');
          return `${TICK}return;`;
        }
        if (!s.e) {
          this.err(s.line, 'fonksiyon bir değer döndürmeli');
          return `${TICK}return ${this.dflt(this.curRet)};`;
        }
        return `${TICK}return ${this.asn(this.curRet, this.ex(s.e), s.line)};`;
      }
    }
  }

  // ---------- expressions ----------
  private toS(r: R, line: number): string {
    if (isStr(r.t)) return r.c;
    if (r.t === 'char') return `String.fromCharCode(${r.c})`;
    if (isFlt(r.t)) return `$.ff(${r.c},2)`;
    if (isInt(r.t)) return `String(${r.c})`;
    this.err(line, 'bu değer metne çevrilemez');
    return '""';
  }

  /** text of a value as Serial.print / String() would show it */
  private fmtArg(r: R, a2: R | undefined, line: number): string {
    if (isStr(r.t)) return r.c;
    if (isArr(r.t) && r.t.arr === 'char') return `$.cs(${r.c})`;
    if (r.t === 'char') return a2 ? `$.fi(${r.c},${a2.c})` : `String.fromCharCode(${r.c})`;
    if (isFlt(r.t)) return `$.ff(${r.c},${a2 ? a2.c : 2})`;
    if (isInt(r.t)) return a2 ? `$.fi(${r.c},${a2.c})` : `String(${r.c})`;
    this.err(line, 'bu değer yazdırılamaz');
    return '""';
  }

  private binop(op: string, a: R, b: R, line: number): R {
    const INT = this.INT;
    if (isStr(a.t) || isStr(b.t)) {
      if (op === '+') {
        if (a.t === 'cstr' && !isStr(b.t)) this.err(line, 'metin sabiti + sayı: işaretçi aritmetiği olur; String("...") + sayı yazın');
        else if (b.t === 'cstr' && !isStr(a.t)) this.err(line, 'sayı + metin sabiti: işaretçi aritmetiği olur; String(sayı) + "..." yazın');
        else if (a.t === 'cstr' && b.t === 'cstr') this.err(line, 'iki metin sabiti toplanamaz: birini String("...") yapın');
        return { c: `(${this.toS(a, line)}+${this.toS(b, line)})`, t: 'str' };
      }
      if (['==', '!=', '<', '>', '<=', '>='].includes(op)) {
        if (!isStr(a.t) || !isStr(b.t)) this.err(line, 'String yalnızca String ile karşılaştırılabilir');
        else if (a.t === 'cstr' && b.t === 'cstr') this.err(line, 'iki metin sabiti karşılaştırılamaz (işaretçi karşılaştırması): String kullanın');
        const js = op === '==' ? '===' : op === '!=' ? '!==' : op;
        return { c: `(${a.c}${js}${b.c}?1:0)`, t: 'bool' };
      }
      this.err(line, `'${op}' işleci String ile kullanılamaz`);
      return this.bad();
    }
    if (!isNum(a.t) || !isNum(b.t)) {
      this.err(line, `'${op}' işleci bu türlerle kullanılamaz`);
      return this.bad();
    }
    if (['==', '!=', '<', '>', '<=', '>='].includes(op)) {
      let ca = a.c;
      let cb = b.c;
      if (isInt(a.t) && isInt(b.t)) {
        const T = this.common(a.t, b.t);
        ca = this.conv(a.t, T, ca);
        cb = this.conv(b.t, T, cb);
      }
      const js = op === '==' ? '===' : op === '!=' ? '!==' : op;
      return { c: `(${ca}${js}${cb}?1:0)`, t: 'bool' };
    }
    const T = this.common(a.t, b.t);
    const flt = isFlt(T);
    switch (op) {
      case '+':
      case '-':
        return { c: flt ? this.fr(T, `(${a.c}${op}${b.c})`) : wrap(T, `${a.c}${op}${b.c}`), t: T };
      case '*':
        if (flt) return { c: this.fr(T, `(${a.c}*${b.c})`), t: T };
        if (INFO[T][0] === 32) return { c: INFO[T][1] ? `Math.imul(${a.c},${b.c})` : `(Math.imul(${a.c},${b.c})>>>0)`, t: T };
        return { c: wrap(T, `${a.c}*${b.c}`), t: T };
      case '/':
        if (flt) return { c: this.fr(T, `$.fd(${a.c},${b.c})`), t: T };
        return { c: wrap(T, `$.dv(${this.conv(a.t, T, a.c)},${this.conv(b.t, T, b.c)})`), t: T };
      case '%':
        if (flt) {
          this.err(line, "'%' işleci yalnızca tamsayılarla kullanılabilir");
          return this.bad();
        }
        return { c: wrap(T, `$.md(${this.conv(a.t, T, a.c)},${this.conv(b.t, T, b.c)})`), t: T };
      case '&':
      case '|':
      case '^':
        if (flt) {
          this.err(line, `'${op}' işleci yalnızca tamsayılarla kullanılabilir`);
          return this.bad();
        }
        return { c: wrap(T, `${a.c}${op}${b.c}`), t: T };
      case '<<':
      case '>>': {
        if (flt || isFlt(b.t)) {
          this.err(line, `'${op}' işleci yalnızca tamsayılarla kullanılabilir`);
          return this.bad();
        }
        const P = this.promote(a.t as string);
        if (op === '<<') return { c: wrap(P, `${a.c}<<${b.c}`), t: P };
        return { c: INFO[P][1] ? `(${a.c}>>${b.c})` : `(${a.c}>>>${b.c})`, t: P };
      }
    }
    this.err(line, `'${op}' işleci desteklenmiyor`);
    return { c: '0', t: INT };
  }

  private lval(e: Expr): { t: Ty; get: string; set: (v: string) => string; init: string; ro: boolean } | null {
    if (e.k === 'id') {
      const s = this.look(e.name);
      if (!s) {
        this.err(e.line, `'${e.name}' tanımlı değil`);
        return null;
      }
      if (isArr(s.ty)) {
        this.err(e.line, `'${e.name}' bir dizi: elemanlarına tek tek atayın`);
        return null;
      }
      return { t: s.ty, get: s.js, set: (v) => `(${s.js}=${v})`, init: '', ro: s.ro };
    }
    if (e.k === 'idx') {
      const base = this.ex(e.a);
      if (!isArr(base.t)) {
        this.err(e.line, isStr(base.t) ? 'String karakterlerine atama yapılamaz' : 'dizi olmayan değer indekslenemiyor');
        return null;
      }
      const i = this.ex(e.i);
      this.num(i, e.line, 'dizi indeksi');
      const t = this.tmp();
      const ro = e.a.k === 'id' ? this.look(e.a.name)?.ro ?? false : false;
      return { t: base.t.arr, get: `$.aget(${base.c},${t})`, set: (v) => `$.aset(${base.c},${t},${v})`, init: `${t}=${this.conv(i.t, 'i32', i.c)}`, ro };
    }
    this.err(e.line, 'atama hedefi geçersiz');
    return null;
  }

  private ex(e: Expr): R {
    const INT = this.INT;
    switch (e.k) {
      case 'num':
        return { c: this.lit(e.v, e.ty), t: e.ty };
      case 'str':
        return { c: JSON.stringify(e.v), t: 'cstr' };
      case 'chr':
        return { c: String(e.v), t: 'char' };
      case 'id': {
        const s = this.look(e.name);
        if (s) return { c: s.js, t: s.ty };
        if (e.name === 'true') return { c: '1', t: 'bool' };
        if (e.name === 'false') return { c: '0', t: 'bool' };
        if (e.name === 'Serial') return { c: '1', t: 'bool' };
        if (e.name in FCONST) return { c: this.lit(FCONST[e.name], this.FD), t: this.FD };
        if (Object.prototype.hasOwnProperty.call(this.consts, e.name)) {
          const v = this.consts[e.name];
          const [lo, hi] = range(INT as string);
          return { c: this.lit(v, INT), t: v >= lo && v <= hi ? INT : v > 2147483647 ? 'u32' : 'i32' };
        }
        if (this.funcs.has(e.name)) this.err(e.line, `'${e.name}' bir fonksiyon: çağırmak için () kullanın`);
        else this.err(e.line, `'${e.name}' tanımlı değil`);
        return this.bad();
      }
      case 'un': {
        const r = this.ex(e.e);
        if (e.op === '!') {
          if (!isNum(r.t)) {
            this.err(e.line, "'!' işleci sayısal değer bekler");
            return this.bad();
          }
          return { c: `(${r.c}?0:1)`, t: 'bool' };
        }
        if (!isNum(r.t)) {
          this.err(e.line, `'${e.op}' işleci sayısal değer bekler`);
          return this.bad();
        }
        if (isFlt(r.t)) {
          if (e.op === '~') {
            this.err(e.line, "'~' işleci yalnızca tamsayılarla kullanılabilir");
            return this.bad();
          }
          return { c: e.op === '-' ? `(-${r.c})` : r.c, t: r.t };
        }
        const P = this.promote(r.t as string);
        if (e.op === '+') return { c: r.c, t: P };
        return { c: wrap(P, `${e.op}${r.c}`), t: P };
      }
      case 'bin': {
        if (e.op === '&&' || e.op === '||') {
          const a = this.num(this.ex(e.l), e.line, `'${e.op}'`);
          const b = this.num(this.ex(e.r), e.line, `'${e.op}'`);
          return { c: `((${a.c})${e.op}(${b.c})?1:0)`, t: 'bool' };
        }
        return this.binop(e.op, this.ex(e.l), this.ex(e.r), e.line);
      }
      case 'asg': {
        const lv = this.lval(e.l);
        const rr = this.ex(e.r);
        if (!lv) return this.bad();
        if (lv.ro) this.err(e.line, 'const değişkene atama yapılamaz');
        let val: string;
        if (e.op === '=') val = this.asn(lv.t, rr, e.line);
        else {
          const res = this.binop(e.op.slice(0, -1), { c: lv.get, t: lv.t }, rr, e.line);
          val = this.asn(lv.t, res, e.line);
        }
        return { c: `(${lv.init ? lv.init + ',' : ''}${lv.set(val)})`, t: lv.t };
      }
      case 'inc': {
        const lv = this.lval(e.e);
        if (!lv) return this.bad();
        if (lv.ro) this.err(e.line, 'const değişkene atama yapılamaz');
        if (!isNum(lv.t)) {
          this.err(e.line, `'${e.op}' işleci sayısal değişken bekler`);
          return this.bad();
        }
        const op = e.op === '++' ? '+' : '-';
        const nv = (cur: string): string => this.asn(lv.t, this.binop(op, { c: cur, t: lv.t }, { c: '1', t: INT }, e.line), e.line);
        const init = lv.init ? lv.init + ',' : '';
        if (e.pre) return { c: `(${init}${lv.set(nv(lv.get))})`, t: lv.t };
        const t = this.tmp();
        return { c: `(${init}${t}=${lv.get},${lv.set(nv(t))},${t})`, t: lv.t };
      }
      case 'cond': {
        const c = this.cond(e.c);
        const a = this.ex(e.a);
        const b = this.ex(e.b);
        if (isNum(a.t) && isNum(b.t)) {
          const T = isFlt(a.t) || isFlt(b.t) ? this.common(a.t, b.t) : a.t === b.t ? (a.t as string) : this.common(a.t, b.t);
          return { c: `(${c}?${this.conv(a.t, T, a.c)}:${this.conv(b.t, T, b.c)})`, t: T };
        }
        if (isStr(a.t) && isStr(b.t)) return { c: `(${c}?${a.c}:${b.c})`, t: a.t === 'cstr' && b.t === 'cstr' ? 'cstr' : 'str' };
        this.err(e.line, '?: işlecinin iki kolu uyumlu türde olmalı');
        return this.bad();
      }
      case 'cast': {
        const r = this.ex(e.e);
        if (isStr(e.ty)) {
          if (!isStr(r.t)) this.err(e.line, "String'e dönüştürme için String(...) kullanın");
          return { c: r.c, t: 'str' };
        }
        if (!isNum(e.ty) || !isNum(r.t)) {
          this.err(e.line, 'bu tür dönüşümü desteklenmiyor');
          return this.bad();
        }
        return { c: this.conv(r.t, e.ty, r.c), t: e.ty };
      }
      case 'comma': {
        const rs = e.es.map((x) => this.ex(x));
        return { c: `(${rs.map((r) => r.c).join(',')})`, t: rs[rs.length - 1].t };
      }
      case 'sizeof': {
        let t: Ty;
        if (e.ty !== undefined) t = e.ty;
        else {
          const saveE = this.errs.length;
          t = this.ex(e.e!).t;
          this.errs.length = saveE;
        }
        return { c: String(this.sizeOf(t)), t: this.SZ };
      }
      case 'idx': {
        const b = this.ex(e.a);
        const i = this.num(this.ex(e.i), e.line, 'indeks');
        if (isArr(b.t)) return { c: `$.aget(${b.c},${this.conv(i.t, 'i32', i.c)})`, t: b.t.arr };
        if (b.t === 'str') return { c: `$.sch(${b.c},${i.c})`, t: 'char' };
        this.err(e.line, 'dizi olmayan değer indekslenemiyor');
        return this.bad();
      }
      case 'call':
        return this.call(e.name, e.args, e.line);
      case 'method':
        return this.method(e.obj, e.name, e.args, e.line);
    }
  }

  private sizeOf(t: Ty): number {
    if (isArr(t)) return t.n * this.sizeOf(t.arr);
    switch (t) {
      case 'bool': case 'char': case 'i8': case 'u8': return 1;
      case 'i16': case 'u16': return 2;
      case 'f64': return 8;
      case 'str': return 6;
      default: return 4;
    }
  }

  private call(name: string, args: Expr[], line: number): R {
    const INT = this.INT;
    const user = this.funcs.get(name);
    if (user) {
      if (args.length !== user.params.length) {
        this.err(line, `${name}() ${user.params.length} argüman bekler, ${args.length} verildi`);
        args.forEach((a) => this.ex(a));
        return { c: '0', t: user.ret };
      }
      const a = args.map((e, i) => {
        const r = this.ex(e);
        const pt = user.params[i];
        if (isArr(pt)) {
          if (!isArr(r.t) || !sameTy(r.t.arr, pt.arr)) this.err(e.line, `${name}() ${i + 1}. argüman ${this.tn(pt)} (aynı türde dizi) olmalı`);
          return r.c;
        }
        return this.asn(pt, r, e.line);
      });
      return { c: `(yield* f_${name}(${a.join(',')}))`, t: user.ret };
    }
    const need = (lo: number, hi = lo): boolean => {
      if (args.length >= lo && args.length <= hi) return true;
      this.err(line, `${name}() ${lo === hi ? lo : `${lo}-${hi}`} argüman bekler, ${args.length} verildi`);
      args.forEach((a) => this.ex(a));
      return false;
    };
    const nums = (): R[] => args.map((a) => this.num(this.ex(a), a.line, `${name}()`));
    const S = Object.prototype.hasOwnProperty.call(SIMPLE, name) ? SIMPLE[name] : undefined;
    if (S) {
      if (!need(S[0], S[1])) return this.bad();
      const rs = nums();
      return { c: `$.${name}(${rs.map((r) => r.c).join(',')})`, t: S[2] === 'v' ? 'void' : S[2] === 'i' ? INT : S[2] };
    }
    if (CLS.has(name)) {
      if (!need(1)) return this.bad();
      return { c: `$.cls("${name}",${nums()[0].c})`, t: INT };
    }
    if (Object.prototype.hasOwnProperty.call(MATH1, name)) {
      if (!need(1)) return this.bad();
      return { c: this.fr(this.FD as string, `${MATH1[name]}(${nums()[0].c})`), t: this.FD };
    }
    if (Object.prototype.hasOwnProperty.call(MATH2, name)) {
      if (!need(2)) return this.bad();
      const rs = nums();
      return { c: this.fr(this.FD as string, `${MATH2[name]}(${rs[0].c},${rs[1].c})`), t: this.FD };
    }
    if (Object.prototype.hasOwnProperty.call(NOOP_FN, name)) return this.noop(NOOP_FN[name], args);
    switch (name) {
      case 'attachInterrupt': {
        if (!need(3)) return this.bad();
        const fa = args[1];
        const f = fa.k === 'id' ? this.funcs.get(fa.name) : undefined;
        if (!f || fa.k !== 'id') {
          args.forEach((a) => (a.k === 'id' && this.funcs.has(a.name) ? 0 : this.ex(a)));
          this.err(line, "attachInterrupt(): ikinci argüman 'void kesme()' biçiminde tanımlı bir fonksiyonun adı olmalı");
          return this.bad();
        }
        if (f.ret !== 'void' || f.params.length) this.err(line, `attachInterrupt(): '${fa.name}' kesme işlevi 'void ${fa.name}()' biçiminde (parametresiz, dönüş yok) olmalı`);
        const [p, , m] = args;
        return { c: `$.attachInterrupt(${this.num(this.ex(p), p.line, name).c},f_${fa.name},${this.num(this.ex(m), m.line, name).c})`, t: 'void' };
      }
      case 'SPISettings': {
        if (!need(3)) return this.bad();
        const rs = nums();
        return { c: `$.spiSet(${rs.map((r) => r.c).join(',')})`, t: INT };
      }
      case 'delay':
      case 'delayMicroseconds': {
        if (!need(1)) return this.bad();
        const r = nums()[0];
        return { c: `(yield* $.${name === 'delay' ? 'delay' : 'delayUs'}(${this.conv(r.t, 'u32', r.c)}))`, t: 'void' };
      }
      case 'abs': {
        if (!need(1)) return this.bad();
        const r = nums()[0];
        if (isFlt(r.t)) return { c: `Math.abs(${r.c})`, t: r.t };
        const P = this.promote(r.t as string);
        return { c: wrap(P, `Math.abs(${r.c})`), t: P };
      }
      case 'min':
      case 'max': {
        if (!need(2)) return this.bad();
        const [a, b] = nums();
        const T = this.common(a.t, b.t);
        return { c: `Math.${name}(${this.conv(a.t, T, a.c)},${this.conv(b.t, T, b.c)})`, t: T };
      }
      case 'constrain': {
        if (!need(3)) return this.bad();
        const [x, a, b] = nums();
        const T = this.common(this.common(x.t, a.t), b.t);
        return { c: `$.constrain(${this.conv(x.t, T, x.c)},${this.conv(a.t, T, a.c)},${this.conv(b.t, T, b.c)})`, t: T };
      }
      case 'sq': {
        if (!need(1)) return this.bad();
        const r = nums()[0];
        return this.binop('*', r, r, line);
      }
      case 'round': {
        if (!need(1)) return this.bad();
        return { c: `$.round(${nums()[0].c})`, t: 'i32' };
      }
      case 'bitSet':
      case 'bitClear':
      case 'bitWrite': {
        if (!need(name === 'bitWrite' ? 3 : 2)) return this.bad();
        const [x, n, b] = args;
        const one: Expr = { k: 'num', v: 1, ty: 'u32', line };
        const mask: Expr = { k: 'bin', op: '<<', l: one, r: n, line };
        const setE: Expr = { k: 'bin', op: '|', l: x, r: mask, line };
        const clrE: Expr = { k: 'bin', op: '&', l: x, r: { k: 'un', op: '~', e: mask, line }, line };
        const rhs: Expr = name === 'bitSet' ? setE : name === 'bitClear' ? clrE : { k: 'cond', c: b, a: setE, b: clrE, line };
        return this.ex({ k: 'asg', op: '=', l: x, r: rhs, line });
      }
      case 'String': {
        if (!need(0, 2)) return this.bad();
        if (!args.length) return { c: '""', t: 'str' };
        const rs = args.map((a) => this.ex(a));
        return { c: this.fmtArg(rs[0], rs[1], line), t: 'str' };
      }
      case 'F': {
        if (!need(1)) return this.bad();
        const r = this.ex(args[0]);
        if (r.t !== 'cstr') this.err(line, 'F() bir metin sabiti bekler');
        return { c: r.c, t: 'cstr' };
      }
    }
    args.forEach((a) => this.ex(a));
    this.err(line, `'${name}' fonksiyonu tanımlı değil veya desteklenmiyor`);
    return this.bad();
  }

  private noop(label: string, args: Expr[]): R {
    const cs = args.map((a) => (a.k === 'id' && this.funcs.has(a.name) ? '0' : this.ex(a).c));
    return { c: `$.noop(${JSON.stringify(label)}${cs.length ? ',' + cs.join(',') : ''})`, t: this.INT };
  }

  private method(obj: Expr, name: string, args: Expr[], line: number): R {
    if (obj.k === 'id' && !this.look(obj.name)) {
      if (obj.name === 'Serial') return this.serial(name, args, line);
      if (obj.name === 'Wire' || obj.name === 'SPI') return this.bus(obj.name, name, args, line);
      if (Object.prototype.hasOwnProperty.call(NOOP_OBJ, obj.name)) return this.noop(NOOP_OBJ[obj.name], args);
      this.err(line, `'${obj.name}' tanımlı değil`);
      return this.bad();
    }
    if (obj.k === 'id') {
      const s = this.look(obj.name)!;
      if (typeof s.ty === 'string' && s.ty.startsWith('obj:')) return this.noop(s.ty.slice(4), args);
    }
    return this.strMethod(obj, name, args, line);
  }

  /** Wire (I2C master) and SPI (master): transaction-level, see core/mcu/bus.ts */
  private bus(obj: 'Wire' | 'SPI', name: string, args: Expr[], line: number): R {
    const INT = this.INT;
    const label = `${obj}.${name}()`;
    const nums = (): string[] => args.map((a) => this.num(this.ex(a), a.line, label).c);
    const cnt = (lo: number, hi = lo): boolean => {
      if (args.length >= lo && args.length <= hi) return true;
      this.err(line, `${label} ${lo === hi ? lo : `${lo}-${hi}`} argüman bekler, ${args.length} verildi`);
      args.forEach((a) => this.ex(a));
      return false;
    };
    const call = (fn: string, ret: Ty, lo: number, hi = lo): R => {
      if (!cnt(lo, hi)) return this.bad();
      return { c: `$.${fn}(${nums().join(',')})`, t: ret };
    };
    if (obj === 'Wire') {
      switch (name) {
        case 'begin': if (!cnt(0, 3)) return this.bad(); return { c: `$.wBegin([${nums().join(',')}])`, t: 'void' };
        case 'end': return call('wEnd0', 'void', 0);
        case 'setClock': return call('wClock', 'void', 1);
        case 'setSDA': return call('wSda', 'void', 1);
        case 'setSCL': return call('wScl', 'void', 1);
        case 'beginTransmission': return call('wBeginTx', 'void', 1);
        case 'endTransmission': return call('wEndTx', 'u8', 0, 1);
        case 'requestFrom': return call('wRequest', 'u8', 2, 3);
        case 'available': return call('wAvail', INT, 0);
        case 'read': return call('wRead', INT, 0);
        case 'peek': return call('wPeek', INT, 0);
        case 'write': {
          if (!cnt(1, 2)) return this.bad();
          const r = this.ex(args[0]);
          if (isStr(r.t)) return { c: `$.wWriteS(${r.c})`, t: INT };
          if (isArr(r.t)) return { c: `$.wWriteA(${r.c},${args[1] ? this.num(this.ex(args[1]), line, label).c : '-1'})`, t: INT };
          if (!isNum(r.t)) this.err(line, 'Wire.write() sayı, dizi veya metin bekler');
          if (args.length === 2) this.err(line, 'Wire.write(değer, uzunluk) yalnızca dizi/metin ile kullanılır');
          return { c: `$.wWrite(${r.c})`, t: INT };
        }
      }
    } else {
      switch (name) {
        case 'begin': if (!cnt(0, 4)) return this.bad(); return { c: `$.sBegin([${nums().join(',')}])`, t: 'void' };
        case 'end': return call('sEnd', 'void', 0);
        case 'beginTransaction': return call('sTxBegin', 'void', 1);
        case 'endTransaction': return call('sTxEnd', 'void', 0);
        case 'setClockDivider': return call('sDiv', 'void', 1);
        case 'setDataMode': return call('sMode', 'void', 1);
        case 'setBitOrder': return call('sOrder', 'void', 1);
        case 'usingInterrupt': return call('sNoop', 'void', 1);
        case 'transfer16': return call('sXfer16', 'u16', 1);
        case 'transfer': {
          if (!cnt(1, 2)) return this.bad();
          const r = this.ex(args[0]);
          if (isArr(r.t)) {
            if (args.length !== 2) this.err(line, 'SPI.transfer(dizi, uzunluk) 2 argüman bekler');
            return { c: `$.sXferA(${r.c},${args[1] ? this.num(this.ex(args[1]), line, label).c : '0'})`, t: 'void' };
          }
          if (!isNum(r.t)) this.err(line, 'SPI.transfer() bayt veya dizi bekler');
          if (args.length === 2) this.err(line, 'SPI.transfer(değer, 2. argüman) desteklenmiyor');
          return { c: `$.sXfer(${r.c})`, t: 'u8' };
        }
      }
    }
    return this.noop(`${obj}.${name}`, args);
  }

  private serial(name: string, args: Expr[], line: number): R {
    const INT = this.INT;
    const cnt = (lo: number, hi = lo): boolean => {
      if (args.length >= lo && args.length <= hi) return true;
      this.err(line, `Serial.${name}() ${lo === hi ? lo : `${lo}-${hi}`} argüman bekler, ${args.length} verildi`);
      return false;
    };
    const ev = (): R[] => args.map((a) => this.ex(a));
    switch (name) {
      case 'begin':
      case 'end':
      case 'flush':
      case 'setTimeout':
        cnt(0, 2);
        ev();
        return { c: '0', t: 'void' };
      case 'print':
      case 'println': {
        if (!cnt(name === 'print' ? 1 : 0, 2)) return this.bad();
        const nl = name === 'println';
        if (!args.length) return { c: '$.out("",true)', t: INT };
        const rs = ev();
        return { c: `$.out(${this.fmtArg(rs[0], rs[1], line)},${nl})`, t: INT };
      }
      case 'write': {
        if (!cnt(1, 2)) return this.bad();
        const r = this.ex(args[0]);
        if (isStr(r.t)) return { c: `$.out(${r.c},false)`, t: INT };
        if (!isNum(r.t)) this.err(line, 'Serial.write() sayı veya metin bekler');
        return { c: `$.out(String.fromCharCode(${r.c}&255),false)`, t: INT };
      }
      case 'available':
      case 'availableForWrite':
        cnt(0);
        return { c: name === 'available' ? '$.avail()' : '63', t: INT };
      case 'read':
        cnt(0);
        return { c: '$.read()', t: INT };
      case 'peek':
        cnt(0);
        return { c: '$.peek()', t: INT };
      case 'readString':
        cnt(0);
        return { c: '$.readString()', t: 'str' };
      case 'readStringUntil': {
        if (!cnt(1)) return this.bad();
        return { c: `$.readUntil(${ev()[0].c})`, t: 'str' };
      }
      case 'parseInt':
        cnt(0, 1);
        ev();
        return { c: '$.parseInt()', t: 'i32' };
      case 'parseFloat':
        cnt(0, 1);
        ev();
        return { c: '$.parseFloat()', t: this.FD };
      case 'printf': {
        if (this.spec.family === 'avr') {
          this.err(line, 'Serial.printf bu kartta (AVR) yok: yalnızca esp32/rp2040');
          return this.bad();
        }
        if (!args.length) {
          this.err(line, 'Serial.printf() en az 1 argüman bekler');
          return this.bad();
        }
        const rs = ev();
        if (!isStr(rs[0].t)) this.err(line, 'Serial.printf() ilk argüman metin olmalı');
        return { c: `$.printf(${rs[0].c},[${rs.slice(1).map((r) => r.c).join(',')}])`, t: INT };
      }
    }
    this.err(line, `Serial.${name}() desteklenmiyor`);
    ev();
    return this.bad();
  }

  private strMethod(obj: Expr, name: string, args: Expr[], line: number): R {
    const INT = this.INT;
    const o = this.ex(obj);
    if (o.t === 'cstr') {
      this.err(line, `metin sabitinin .${name}() yöntemi yok: String kullanın`);
      return this.bad();
    }
    if (o.t !== 'str') {
      this.err(line, `.${name}() bu türde kullanılamaz`);
      return this.bad();
    }
    const cnt = (lo: number, hi = lo): boolean => {
      if (args.length >= lo && args.length <= hi) return true;
      this.err(line, `String.${name}() ${lo === hi ? lo : `${lo}-${hi}`} argüman bekler, ${args.length} verildi`);
      return false;
    };
    const rs = (): R[] => args.map((a) => this.ex(a));
    const arg = (r: R): string => this.toS(r, line);
    switch (name) {
      case 'length':
        cnt(0);
        return { c: `${o.c}.length`, t: this.SZ };
      case 'toInt':
        cnt(0);
        return { c: `$.toInt(${o.c})`, t: 'i32' };
      case 'toFloat':
        cnt(0);
        return { c: this.fr(this.FD as string, `$.toFloat(${o.c})`), t: this.FD };
      case 'charAt': {
        if (!cnt(1)) return this.bad();
        return { c: `$.sch(${o.c},${rs()[0].c})`, t: 'char' };
      }
      case 'substring': {
        if (!cnt(1, 2)) return this.bad();
        return { c: `$.sub(${o.c},${rs().map((r) => r.c).join(',')})`, t: 'str' };
      }
      case 'indexOf':
      case 'lastIndexOf': {
        if (!cnt(1, 2)) return this.bad();
        const r = rs();
        return { c: `$.${name === 'indexOf' ? 'indexOf' : 'lastIndexOf'}(${o.c},${arg(r[0])}${r[1] ? ',' + r[1].c : ''})`, t: INT };
      }
      case 'equals':
      case 'startsWith':
      case 'endsWith':
      case 'equalsIgnoreCase': {
        if (!cnt(1)) return this.bad();
        const a = arg(rs()[0]);
        const js = name === 'equals' ? `${o.c}===${a}` : name === 'startsWith' ? `${o.c}.startsWith(${a})` : name === 'endsWith' ? `${o.c}.endsWith(${a})` : `${o.c}.toLowerCase()===${a}.toLowerCase()`;
        return { c: `(${js}?1:0)`, t: 'bool' };
      }
      case 'compareTo': {
        if (!cnt(1)) return this.bad();
        return { c: `$.cmp(${o.c},${arg(rs()[0])})`, t: INT };
      }
      case 'reserve':
        cnt(1);
        rs();
        return { c: '0', t: 'void' };
      case 'toUpperCase':
      case 'toLowerCase':
      case 'trim':
      case 'replace':
      case 'concat': {
        if (!cnt(name === 'replace' ? 2 : name === 'concat' ? 1 : 0)) return this.bad();
        const lv = this.lval(obj);
        if (!lv) return this.bad();
        const r = rs();
        const val =
          name === 'toUpperCase' ? `${lv.get}.toUpperCase()` : name === 'toLowerCase' ? `${lv.get}.toLowerCase()` : name === 'trim' ? `${lv.get}.trim()` : name === 'concat' ? `${lv.get}+${arg(r[0])}` : `${lv.get}.split(${arg(r[0])}).join(${arg(r[1])})`;
        return { c: `(${lv.init ? lv.init + ',' : ''}${lv.set(val)},0)`, t: 'void' };
      }
    }
    this.err(line, `String.${name}() desteklenmiyor`);
    rs();
    return this.bad();
  }
}
