/** Recursive-descent parser for the supported Arduino C++ subset. Types are resolved here (int width depends on the board). */
import { CompileError, type Tok } from './lexer';

/** 'bool','char','i8','u8','i16','u16','i32','u32','f32','f64','str','cstr','void','obj:Servo' or a 1-D array */
export type Ty = string | { arr: Ty; n: number };

export type Expr =
  | { k: 'num'; v: number; ty: Ty; line: number }
  | { k: 'str'; v: string; line: number }
  | { k: 'chr'; v: number; line: number }
  | { k: 'id'; name: string; line: number }
  | { k: 'un'; op: string; e: Expr; line: number }
  | { k: 'bin'; op: string; l: Expr; r: Expr; line: number }
  | { k: 'asg'; op: string; l: Expr; r: Expr; line: number }
  | { k: 'inc'; op: '++' | '--'; pre: boolean; e: Expr; line: number }
  | { k: 'cond'; c: Expr; a: Expr; b: Expr; line: number }
  | { k: 'call'; name: string; args: Expr[]; line: number }
  | { k: 'method'; obj: Expr; name: string; args: Expr[]; line: number }
  | { k: 'idx'; a: Expr; i: Expr; line: number }
  | { k: 'cast'; ty: Ty; e: Expr; line: number }
  | { k: 'comma'; es: Expr[]; line: number }
  | { k: 'sizeof'; ty?: Ty; e?: Expr; line: number };

export interface Var {
  name: string;
  arr: null | 'auto' | Expr;
  init: null | Expr | Expr[];
  line: number;
}

export type Stmt =
  | { k: 'decl'; ty: Ty; isConst: boolean; isStatic: boolean; vars: Var[]; line: number }
  | { k: 'expr'; e: Expr; line: number }
  | { k: 'if'; c: Expr; t: Stmt; f: Stmt | null; line: number }
  | { k: 'for'; init: Stmt | null; c: Expr | null; u: Expr | null; body: Stmt; line: number }
  | { k: 'while'; c: Expr; body: Stmt; line: number }
  | { k: 'do'; body: Stmt; c: Expr; line: number }
  | { k: 'switch'; e: Expr; cases: { test: Expr | null; body: Stmt[]; line: number }[]; line: number }
  | { k: 'break'; line: number }
  | { k: 'continue'; line: number }
  | { k: 'return'; e: Expr | null; line: number }
  | { k: 'block'; body: Stmt[]; line: number }
  | { k: 'empty'; line: number };

export interface Func {
  k: 'func';
  name: string;
  ret: Ty;
  params: { ty: Ty; name: string }[];
  body: Stmt[] | null;
  line: number;
}
export type Top = Func | Extract<Stmt, { k: 'decl' }>;

export interface Opts {
  intBits: 16 | 32;
  family: string;
}

const UNSUP: Record<string, string> = {
  struct: 'struct desteklenmiyor: yalnızca temel türler, String ve 1 boyutlu diziler var',
  class: 'class (sınıf) desteklenmiyor',
  union: 'union desteklenmiyor',
  enum: 'enum desteklenmiyor: #define veya const kullanın',
  typedef: 'typedef desteklenmiyor',
  template: 'şablon (template) desteklenmiyor',
  namespace: 'namespace desteklenmiyor',
  using: 'using desteklenmiyor',
  new: 'new (dinamik bellek) desteklenmiyor',
  delete: 'delete (dinamik bellek) desteklenmiyor',
  goto: 'goto desteklenmiyor',
  try: 'istisna (try/catch/throw) desteklenmiyor',
  catch: 'istisna (try/catch/throw) desteklenmiyor',
  throw: 'istisna (try/catch/throw) desteklenmiyor',
  operator: 'operatör aşırı yükleme desteklenmiyor',
  virtual: 'virtual desteklenmiyor',
  friend: 'friend desteklenmiyor',
  this: 'this desteklenmiyor',
  auto: 'auto desteklenmiyor: türü açıkça yazın',
  nullptr: 'nullptr/işaretçi desteklenmiyor',
};

export function prescan(toks: Tok[]): { line: number; message: string }[] {
  const out: { line: number; message: string }[] = [];
  for (const t of toks) if (t.t === 'id' && Object.prototype.hasOwnProperty.call(UNSUP, t.s)) out.push({ line: t.line, message: UNSUP[t.s] });
  return out;
}

const QUAL = new Set(['const', 'static', 'volatile', 'extern', 'inline', 'register']);
const TW = new Set(['unsigned', 'signed', 'long', 'short', 'int', 'char', 'float', 'double', 'void', 'bool', 'boolean', 'byte', 'word', 'size_t', 'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t', 'String', 'Servo']);
const NO_FCAST = new Set(['void', 'String', 'Servo']);
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);
const PREC: Record<string, number> = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };

export class Parser {
  private p = 0;
  constructor(private toks: Tok[], private o: Opts) {}

  private get t(): Tok {
    return this.toks[this.p];
  }
  private peek(k = 0): Tok {
    return this.toks[Math.min(this.p + k, this.toks.length - 1)];
  }
  private fail(t: Tok, msg: string): never {
    throw new CompileError(t.line, msg);
  }
  private show(t: Tok): string {
    return t.t === 'eof' ? 'dosya sonu' : t.s;
  }
  private isOp(s: string, k = 0): boolean {
    const t = this.peek(k);
    return t.t === 'op' && t.s === s;
  }
  private isId(s: string, k = 0): boolean {
    const t = this.peek(k);
    return t.t === 'id' && t.s === s;
  }
  private accept(s: string): boolean {
    if (this.isOp(s)) {
      this.p++;
      return true;
    }
    return false;
  }
  private expect(s: string): void {
    if (!this.accept(s)) this.fail(this.t, `'${s}' bekleniyor, '${this.show(this.t)}' bulundu`);
  }
  private ident(): string {
    const t = this.t;
    if (t.t !== 'id') this.fail(t, `tanımlayıcı bekleniyor, '${this.show(t)}' bulundu`);
    this.p++;
    return t.s;
  }
  private isTypeTok(t: Tok): boolean {
    return t.t === 'id' && (QUAL.has(t.s) || TW.has(t.s));
  }

  // ---------- types ----------
  private parseType(): { ty: Ty; isConst: boolean; isStatic: boolean } {
    const t0 = this.t;
    let isConst = false;
    let isStatic = false;
    const w: string[] = [];
    while (this.t.t === 'id') {
      const s = this.t.s;
      if (QUAL.has(s)) {
        if (s === 'const') isConst = true;
        if (s === 'static') isStatic = true;
      } else if (TW.has(s)) w.push(s);
      else break;
      this.p++;
    }
    if (!w.length) this.fail(t0, 'tür bekleniyor');
    const cnt = (x: string): number => w.filter((y) => y === x).length;
    const ib = this.o.intBits;
    const avr = this.o.family === 'avr';
    let ty: Ty;
    if (w.includes('String')) ty = 'str';
    else if (w.includes('Servo')) ty = 'obj:Servo';
    else if (w.includes('void')) ty = 'void';
    else if (w.includes('bool') || w.includes('boolean')) ty = 'bool';
    else if (w.includes('float')) ty = 'f32';
    else if (w.includes('double')) {
      if (cnt('long')) this.fail(t0, 'long double desteklenmiyor');
      ty = avr ? 'f32' : 'f64';
    } else if (w.includes('byte') || w.includes('uint8_t')) ty = 'u8';
    else if (w.includes('int8_t')) ty = 'i8';
    else if (w.includes('uint16_t') || w.includes('word')) ty = 'u16';
    else if (w.includes('int16_t')) ty = 'i16';
    else if (w.includes('uint32_t')) ty = 'u32';
    else if (w.includes('int32_t')) ty = 'i32';
    else if (w.includes('size_t')) ty = avr ? 'u16' : 'u32';
    else {
      const uns = cnt('unsigned') > 0;
      if (cnt('long') >= 2) this.fail(t0, '64 bit tamsayı (long long) desteklenmiyor');
      if (w.includes('char')) ty = uns ? 'u8' : cnt('signed') ? 'i8' : 'char';
      else {
        const bits = cnt('short') ? 16 : cnt('long') ? 32 : ib;
        ty = `${uns ? 'u' : 'i'}${bits}`;
      }
    }
    return { ty, isConst, isStatic };
  }

  private noPtr(): void {
    if (this.isOp('*')) this.fail(this.t, 'işaretçi (pointer) desteklenmiyor');
    if (this.isOp('&')) this.fail(this.t, 'referans (&) desteklenmiyor');
  }

  // ---------- program ----------
  parseProgram(): Top[] {
    const out: Top[] = [];
    while (this.t.t !== 'eof') {
      if (this.accept(';')) continue;
      const t = this.t;
      if (!this.isTypeTok(t)) {
        if (t.t === 'id' && this.peek(1).t === 'id') this.fail(t, `Bilinmeyen tür '${t.s}': bu sınıf/kütüphane desteklenmiyor`);
        this.fail(t, `Fonksiyon veya değişken bildirimi bekleniyor, '${this.show(t)}' bulundu`);
      }
      const save = this.p;
      const { ty } = this.parseType();
      this.noPtr();
      const nameTok = this.t;
      const name = this.ident();
      if (this.isOp('(')) out.push(this.parseFunc(ty, name, nameTok.line));
      else {
        this.p = save;
        out.push(this.parseDecl(false));
      }
    }
    return out;
  }

  private parseFunc(ret: Ty, name: string, line: number): Func {
    this.expect('(');
    const params: Func['params'] = [];
    if (this.isId('void') && this.isOp(')', 1)) this.p++;
    if (!this.isOp(')')) {
      do {
        const { ty } = this.parseType();
        this.noPtr();
        let pname = '';
        if (this.t.t === 'id') pname = this.ident();
        let pty: Ty = ty;
        if (this.accept('[')) {
          if (!this.isOp(']')) this.parseTernary();
          this.expect(']');
          pty = { arr: ty, n: 0 };
        }
        if (this.isOp('=')) this.fail(this.t, 'varsayılan argüman desteklenmiyor');
        if (ty === 'void') this.fail(this.t, 'void türünde parametre olamaz');
        params.push({ ty: pty, name: pname });
      } while (this.accept(','));
    }
    this.expect(')');
    if (this.accept(';')) return { k: 'func', name, ret, params, body: null, line };
    return { k: 'func', name, ret, params, body: this.parseBlockBody(), line };
  }

  // ---------- statements ----------
  private parseBlockBody(): Stmt[] {
    this.expect('{');
    const body: Stmt[] = [];
    while (!this.isOp('}')) {
      if (this.t.t === 'eof') this.fail(this.t, "kapanmamış blok: '}' eksik");
      body.push(this.stmt());
    }
    this.p++;
    return body;
  }

  private parseDecl(forInit: boolean): Extract<Stmt, { k: 'decl' }> {
    const line = this.t.line;
    const { ty, isConst, isStatic } = this.parseType();
    const vars: Var[] = [];
    do {
      this.noPtr();
      const vline = this.t.line;
      const name = this.ident();
      let arr: Var['arr'] = null;
      if (this.accept('[')) {
        if (this.accept(']')) arr = 'auto';
        else {
          arr = this.parseTernary();
          this.expect(']');
        }
        if (this.isOp('[')) this.fail(this.t, 'çok boyutlu dizi desteklenmiyor');
      }
      let init: Var['init'] = null;
      if (this.accept('=')) {
        if (this.isOp('{')) {
          if (arr === null) this.fail(this.t, 'süslü parantez başlatıcı yalnızca dizilerde desteklenir');
          this.p++;
          const items: Expr[] = [];
          while (!this.isOp('}')) {
            if (this.isOp('{')) this.fail(this.t, 'çok boyutlu dizi desteklenmiyor');
            items.push(this.parseAssign());
            if (!this.accept(',')) break;
          }
          this.expect('}');
          init = items;
        } else init = this.parseAssign();
      } else if (this.isOp('(') && arr === null) {
        this.p++;
        init = this.parseAssign();
        this.expect(')');
      }
      vars.push({ name, arr, init, line: vline });
    } while (this.accept(','));
    if (!forInit) this.expect(';');
    return { k: 'decl', ty, isConst, isStatic, vars, line };
  }

  private stmt(): Stmt {
    const t = this.t;
    const line = t.line;
    if (t.t === 'op') {
      if (t.s === '{') return { k: 'block', body: this.parseBlockBody(), line };
      if (t.s === ';') {
        this.p++;
        return { k: 'empty', line };
      }
    }
    if (t.t === 'id') {
      switch (t.s) {
        case 'if': {
          this.p++;
          this.expect('(');
          const c = this.parseExprComma();
          this.expect(')');
          const th = this.stmt();
          let f: Stmt | null = null;
          if (this.isId('else')) {
            this.p++;
            f = this.stmt();
          }
          return { k: 'if', c, t: th, f, line };
        }
        case 'for': {
          this.p++;
          this.expect('(');
          let init: Stmt | null = null;
          if (!this.isOp(';')) {
            if (this.isTypeTok(this.t)) init = this.parseDecl(true);
            else init = { k: 'expr', e: this.parseExprComma(), line };
          }
          this.expect(';');
          const c = this.isOp(';') ? null : this.parseExprComma();
          this.expect(';');
          const u = this.isOp(')') ? null : this.parseExprComma();
          this.expect(')');
          return { k: 'for', init, c, u, body: this.stmt(), line };
        }
        case 'while': {
          this.p++;
          this.expect('(');
          const c = this.parseExprComma();
          this.expect(')');
          return { k: 'while', c, body: this.stmt(), line };
        }
        case 'do': {
          this.p++;
          const body = this.stmt();
          if (!this.isId('while')) this.fail(this.t, "do ... while: 'while' bekleniyor");
          this.p++;
          this.expect('(');
          const c = this.parseExprComma();
          this.expect(')');
          this.expect(';');
          return { k: 'do', body, c, line };
        }
        case 'switch': {
          this.p++;
          this.expect('(');
          const e = this.parseExprComma();
          this.expect(')');
          this.expect('{');
          const cases: { test: Expr | null; body: Stmt[]; line: number }[] = [];
          let cur: (typeof cases)[number] | null = null;
          while (!this.isOp('}')) {
            if (this.t.t === 'eof') this.fail(this.t, "kapanmamış switch: '}' eksik");
            if (this.isId('case')) {
              const cl = this.t.line;
              this.p++;
              const test = this.parseTernary();
              this.expect(':');
              cur = { test, body: [], line: cl };
              cases.push(cur);
            } else if (this.isId('default')) {
              const cl = this.t.line;
              this.p++;
              this.expect(':');
              cur = { test: null, body: [], line: cl };
              cases.push(cur);
            } else {
              if (!cur) this.fail(this.t, 'switch içinde ilk case/default etiketinden önce ifade olamaz');
              cur.body.push(this.stmt());
            }
          }
          this.p++;
          return { k: 'switch', e, cases, line };
        }
        case 'case':
        case 'default':
          this.fail(t, `'${t.s}' yalnızca switch içinde kullanılabilir`);
          break;
        case 'break':
          this.p++;
          this.expect(';');
          return { k: 'break', line };
        case 'continue':
          this.p++;
          this.expect(';');
          return { k: 'continue', line };
        case 'return': {
          this.p++;
          const e = this.isOp(';') ? null : this.parseExprComma();
          this.expect(';');
          return { k: 'return', e, line };
        }
        default:
          break;
      }
      if (this.isTypeTok(t)) return this.parseDecl(false);
      if (this.peek(1).t === 'id' && !UNSUP[t.s]) this.fail(t, `Bilinmeyen tür '${t.s}': bu sınıf/kütüphane desteklenmiyor`);
    }
    const e = this.parseExprComma();
    this.expect(';');
    return { k: 'expr', e, line };
  }

  // ---------- expressions ----------
  private parseExprComma(): Expr {
    const line = this.t.line;
    const e = this.parseAssign();
    if (!this.isOp(',')) return e;
    const es = [e];
    while (this.accept(',')) es.push(this.parseAssign());
    return { k: 'comma', es, line };
  }

  private parseAssign(): Expr {
    const l = this.parseTernary();
    const t = this.t;
    if (t.t === 'op' && ASSIGN.has(t.s)) {
      if (l.k !== 'id' && l.k !== 'idx') this.fail(t, 'atama hedefi bir değişken veya dizi elemanı olmalı');
      this.p++;
      return { k: 'asg', op: t.s, l, r: this.parseAssign(), line: t.line };
    }
    return l;
  }

  private parseTernary(): Expr {
    const c = this.parseBin(1);
    if (this.isOp('?')) {
      const line = this.t.line;
      this.p++;
      const a = this.parseAssign();
      this.expect(':');
      const b = this.parseAssign();
      return { k: 'cond', c, a, b, line };
    }
    return c;
  }

  private parseBin(min: number): Expr {
    let l = this.parseUnary();
    for (;;) {
      const t = this.t;
      const pr = t.t === 'op' ? PREC[t.s] : undefined;
      if (!pr || pr < min) return l;
      this.p++;
      const r = this.parseBin(pr + 1);
      l = { k: 'bin', op: t.s, l, r, line: t.line };
    }
  }

  private parseUnary(): Expr {
    const t = this.t;
    const line = t.line;
    if (t.t === 'op') {
      if (t.s === '!' || t.s === '~' || t.s === '-' || t.s === '+') {
        this.p++;
        return { k: 'un', op: t.s, e: this.parseUnary(), line };
      }
      if (t.s === '++' || t.s === '--') {
        this.p++;
        return { k: 'inc', op: t.s, pre: true, e: this.parseUnary(), line };
      }
      if (t.s === '*') this.fail(t, 'işaretçi (pointer) kullanımı desteklenmiyor');
      if (t.s === '&') this.fail(t, '& adres operatörü / referans desteklenmiyor');
      if (t.s === '(' && this.isTypeTok(this.peek(1))) {
        this.p++;
        const { ty } = this.parseType();
        this.noPtr();
        this.expect(')');
        return { k: 'cast', ty, e: this.parseUnary(), line };
      }
    }
    if (t.t === 'id' && t.s === 'sizeof') {
      this.p++;
      this.expect('(');
      let r: Expr;
      if (this.isTypeTok(this.t)) {
        const { ty } = this.parseType();
        this.noPtr();
        r = { k: 'sizeof', ty, line };
      } else r = { k: 'sizeof', e: this.parseExprComma(), line };
      this.expect(')');
      return r;
    }
    return this.parsePostfix();
  }

  private args(): Expr[] {
    this.expect('(');
    const a: Expr[] = [];
    if (!this.isOp(')')) {
      do a.push(this.parseAssign());
      while (this.accept(','));
    }
    this.expect(')');
    return a;
  }

  private parsePostfix(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      const t = this.t;
      if (t.t !== 'op') return e;
      if (t.s === '[') {
        this.p++;
        const i = this.parseExprComma();
        this.expect(']');
        e = { k: 'idx', a: e, i, line: t.line };
      } else if (t.s === '(') {
        if (e.k !== 'id') this.fail(t, 'yalnızca adıyla fonksiyon çağrılabilir');
        e = { k: 'call', name: e.name, args: this.args(), line: t.line };
      } else if (t.s === '.') {
        this.p++;
        const name = this.ident();
        if (!this.isOp('(')) this.fail(t, 'üye (alan) erişimi desteklenmiyor');
        e = { k: 'method', obj: e, name, args: this.args(), line: t.line };
      } else if (t.s === '++' || t.s === '--') {
        this.p++;
        e = { k: 'inc', op: t.s, pre: false, e, line: t.line };
      } else if (t.s === '->') this.fail(t, '-> işleci (işaretçi) desteklenmiyor');
      else if (t.s === '::') this.fail(t, ':: (ad alanı) desteklenmiyor');
      else return e;
    }
  }

  private litType(t: Tok): Ty {
    const suf = t.suf ?? '';
    if (t.fl) return suf.includes('f') || this.o.family === 'avr' ? 'f32' : 'f64';
    const v = t.n!;
    const ib = this.o.intBits;
    const u = suf.includes('u');
    const l = suf.includes('l');
    const maxI = ib === 16 ? 32767 : 2147483647;
    const maxU = ib === 16 ? 65535 : 4294967295;
    if (!l) {
      if (!u && v <= maxI) return `i${ib}`;
      if ((u || t.nd) && v <= maxU) return `u${ib}`;
    }
    if (!u && v <= 2147483647) return 'i32';
    if (v <= 4294967295) return 'u32';
    return this.fail(t, 'sabit çok büyük (64 bit tamsayı desteklenmiyor)');
  }

  private parsePrimary(): Expr {
    const t = this.t;
    const line = t.line;
    switch (t.t) {
      case 'num':
        this.p++;
        return { k: 'num', v: t.n!, ty: this.litType(t), line };
      case 'chr':
        this.p++;
        return { k: 'chr', v: t.n!, line };
      case 'str': {
        this.p++;
        let s = t.s;
        while (this.t.t === 'str') s += this.toks[this.p++].s;
        return { k: 'str', v: s, line };
      }
      case 'id':
        if (TW.has(t.s) && !NO_FCAST.has(t.s) && this.isOp('(', 1)) {
          const { ty } = this.parseType();
          this.expect('(');
          const e = this.parseAssign();
          this.expect(')');
          return { k: 'cast', ty, e, line };
        }
        this.p++;
        return { k: 'id', name: t.s, line };
      case 'op':
        if (t.s === '(') {
          this.p++;
          const e = this.parseExprComma();
          this.expect(')');
          return e;
        }
        if (t.s === '[') this.fail(t, 'lambda ifadeleri desteklenmiyor');
        if (t.s === '{') this.fail(t, "süslü parantez ifadesi burada desteklenmiyor");
        break;
      default:
        break;
    }
    return this.fail(t, `beklenmeyen simge '${this.show(t)}'`);
  }
}
