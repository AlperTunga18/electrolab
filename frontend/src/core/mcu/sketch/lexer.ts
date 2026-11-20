/** Arduino-subset lexer + tiny preprocessor (#define NAME value, #ifdef/#ifndef/#else/#endif, #include). */

export class CompileError extends Error {
  constructor(public line: number, message: string) {
    super(message);
  }
}

export interface Tok {
  t: 'num' | 'id' | 'str' | 'chr' | 'op' | 'eof';
  s: string;
  line: number;
  n?: number;
  /** float literal */
  fl?: boolean;
  /** lower-case literal suffix (u, l, ul, f ...) */
  suf?: string;
  /** hex/binary/octal literal */
  nd?: boolean;
}

export interface LexOut {
  toks: Tok[];
  warns: { line: number; message: string }[];
}

const OPS3 = ['<<=', '>>='];
const OPS2 = ['++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '->', '::'];
const OPS1 = '+-*/%=<>!&|^~?:;,.()[]{}';

const IGNORED_INCLUDES = new Set(['arduino.h', 'math.h', 'stdint.h', 'stdlib.h', 'stdio.h', 'string.h', 'stdbool.h', 'inttypes.h', 'avr/pgmspace.h', 'cmath', 'cstdint', 'wire.h', 'spi.h']);
const NOMODEL_INCLUDES = new Set(['wifi.h', 'servo.h']);

/** replace comments by blanks (newlines kept) */
function strip(src: string): string {
  let o = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') o += '\n';
        i++;
      }
      i += 2;
      o += ' ';
    } else if (c === '"' || c === "'") {
      o += c;
      i++;
      while (i < n && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\' && i + 1 < n && src[i + 1] !== '\n') o += src[i++];
        o += src[i++];
      }
      if (i < n && src[i] === c) {
        o += c;
        i++;
      }
    } else {
      o += c;
      i++;
    }
  }
  return o;
}

const SIMPLE_ESC: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };

function esc(text: string, i: number, line: number): [string, number] {
  const c = text[i + 1];
  if (c !== undefined && c in SIMPLE_ESC) return [SIMPLE_ESC[c], i + 2];
  if (c === 'x') {
    const m = /^[0-9a-fA-F]{1,2}/.exec(text.slice(i + 2, i + 4));
    if (m) return [String.fromCharCode(parseInt(m[0], 16)), i + 2 + m[0].length];
  } else if (c !== undefined && /[0-7]/.test(c)) {
    const m = /^[0-7]{1,3}/.exec(text.slice(i + 1, i + 4))!;
    return [String.fromCharCode(parseInt(m[0], 8)), i + 1 + m[0].length];
  }
  throw new CompileError(line, `Geçersiz kaçış dizisi '\\${c ?? ''}'`);
}

const NUM_RE = /0[xX][0-9a-fA-F]+|0[bB][01]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const SUF_RE = /[uUlLfF]*/y;

function scan(text: string, line0: number): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let line = line0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /\w/.test(text[j])) j++;
      out.push({ t: 'id', s: text.slice(i, j), line });
      i = j;
      continue;
    }
    if (/\d/.test(c) || (c === '.' && /\d/.test(text[i + 1] ?? ''))) {
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(text)!;
      let j = i + m[0].length;
      SUF_RE.lastIndex = j;
      const suf = SUF_RE.exec(text)![0].toLowerCase();
      j += suf.length;
      const s = m[0];
      const hex = /^0[xX]/.test(s);
      const bin = /^0[bB]/.test(s);
      let fl = !hex && !bin && /[.eE]/.test(s);
      if (!hex && !bin && suf.includes('f')) fl = true;
      let v: number;
      let nd = hex || bin;
      if (hex) v = parseInt(s, 16);
      else if (bin) v = parseInt(s.slice(2), 2);
      else if (!fl && /^0\d+$/.test(s)) {
        if (/[89]/.test(s)) throw new CompileError(line, `Geçersiz sekizlik sabit '${s}'`);
        v = parseInt(s, 8);
        nd = true;
      } else v = Number(s);
      if (/[A-Za-z_]/.test(text[j] ?? '')) throw new CompileError(line, `Geçersiz sayı sabiti '${text.slice(i, j + 1)}'`);
      out.push({ t: 'num', s, line, n: v, fl, suf, nd });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      for (;;) {
        if (j >= n || text[j] === '\n') throw new CompileError(line, c === '"' ? 'Kapanmamış dizgi (")' : "Kapanmamış karakter sabiti (')");
        const d = text[j];
        if (d === c) break;
        if (d === '\\') {
          const [ch, nj] = esc(text, j, line);
          s += ch;
          j = nj;
        } else {
          s += d;
          j++;
        }
      }
      if (c === "'") {
        if ([...s].length !== 1) throw new CompileError(line, "Geçersiz karakter sabiti: tek karakter olmalı");
        out.push({ t: 'chr', s, line, n: s.codePointAt(0)! });
      } else out.push({ t: 'str', s, line });
      i = j + 1;
      continue;
    }
    const three = text.slice(i, i + 3);
    const two = text.slice(i, i + 2);
    if (OPS3.includes(three)) {
      out.push({ t: 'op', s: three, line });
      i += 3;
    } else if (OPS2.includes(two)) {
      out.push({ t: 'op', s: two, line });
      i += 2;
    } else if (OPS1.includes(c)) {
      out.push({ t: 'op', s: c, line });
      i++;
    } else throw new CompileError(line, `Geçersiz karakter '${c}'`);
  }
  return out;
}

/** predef: object-like macros known to the target (name -> value text) */
export function lex(src: string, predef: Record<string, string> = {}): LexOut {
  const text = strip(src);
  const lines = text.split('\n');
  const macros = new Map<string, Tok[]>();
  const warns: LexOut['warns'] = [];
  for (const [k, v] of Object.entries(predef)) macros.set(k, scan(v, 1));
  const stack: { par: boolean; act: boolean; taken: boolean }[] = [];
  let active = true;
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*#\s*(\w*)\s*(.*)$/.exec(lines[i]);
    if (!m) {
      if (!active) lines[i] = '';
      continue;
    }
    lines[i] = '';
    const ln = i + 1;
    const d = m[1];
    const rest = m[2].trim();
    if (d === 'ifdef' || d === 'ifndef') {
      const c = macros.has(rest.split(/\s+/)[0]) === (d === 'ifdef');
      stack.push({ par: active, act: c, taken: c });
      active = active && c;
    } else if (d === 'else') {
      const top = stack[stack.length - 1];
      if (!top) throw new CompileError(ln, '#else için eşleşen #ifdef yok');
      top.act = !top.taken;
      top.taken = true;
      active = top.par && top.act;
    } else if (d === 'endif') {
      const top = stack.pop();
      if (!top) throw new CompileError(ln, '#endif için eşleşen #ifdef yok');
      active = top.par;
    } else if (!active) {
      continue;
    } else if (d === 'if' || d === 'elif') {
      throw new CompileError(ln, `#${d} ön işlemci yönergesi desteklenmiyor: #ifdef/#ifndef kullanın`);
    } else if (d === 'define') {
      const dm = /^([A-Za-z_]\w*)(\()?\s*(.*)$/.exec(rest);
      if (!dm) throw new CompileError(ln, '#define: makro adı bekleniyor');
      if (dm[2]) throw new CompileError(ln, 'Fonksiyon benzeri makro desteklenmiyor: yalnızca #define AD değer');
      macros.set(dm[1], scan(dm[3], ln));
    } else if (d === 'undef') {
      macros.delete(rest);
    } else if (d === 'include') {
      const im = /^[<"]([^>"]+)[>"]/.exec(rest);
      if (!im) throw new CompileError(ln, '#include: dosya adı bekleniyor');
      const f = im[1].toLowerCase();
      if (NOMODEL_INCLUDES.has(f)) warns.push({ line: ln, message: `${im[1]}: WiFi/Servo modeli yok, ilgili çağrılar yok sayılır` });
      else if (!IGNORED_INCLUDES.has(f)) warns.push({ line: ln, message: `${im[1]}: bu kütüphane desteklenmiyor, #include yok sayıldı` });
    } else if (d === 'pragma' || d === 'line' || d === '') {
      // ignored
    } else throw new CompileError(ln, `#${d} ön işlemci yönergesi desteklenmiyor`);
  }
  if (stack.length) throw new CompileError(lines.length, "#ifdef/#ifndef için '#endif' eksik");
  const raw = scan(lines.join('\n'), 1);
  const toks: Tok[] = [];
  const emit = (t: Tok, act: string[], line: number): void => {
    const body = t.t === 'id' && !act.includes(t.s) && act.length < 16 ? macros.get(t.s) : undefined;
    if (body) for (const b of body) emit({ ...b, line }, [...act, t.s], line);
    else toks.push(t);
  };
  for (const t of raw) emit(t, [], t.line);
  toks.push({ t: 'eof', s: '', line: lines.length });
  return { toks, warns };
}
