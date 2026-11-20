/**
 * Generic S-expression reader (the open textual structure KiCad files use: parentheses, bare atoms, double-quoted strings).
 * Written from the generic grammar only. Quoted strings are always strings (escapes \\ \" \n \r \t; any other \x keeps x);
 * a bare atom that looks like a decimal number becomes a number, otherwise a string. No comment syntax. Iterative (explicit
 * stack, no recursion) so deeply nested garbage cannot overflow the call stack; depth is capped.
 */
export type SExpr = string | number | SList;
export interface SList extends Array<SExpr> {}

export class SexprError extends Error {
  constructor(message: string, readonly pos: number) { super(message); this.name = 'SexprError'; }
}

export const MAX_DEPTH = 512;
const NUM = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const ESC: Record<string, string> = { n: '\n', r: '\r', t: '\t' };

/** Parses all top-level forms. Throws SexprError (with the character position) on unbalanced parentheses or an unterminated string. */
export function parseSexpr(text: string): SExpr[] {
  const top: SExpr[] = [];
  const stack: SList[] = [];
  const push = (v: SExpr): void => { (stack.length ? stack[stack.length - 1] : top).push(v); };
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    if (c === '(') {
      if (stack.length >= MAX_DEPTH) throw new SexprError(`İç içe derinlik sınırı (${MAX_DEPTH}) aşıldı`, i);
      const l: SList = [];
      push(l); stack.push(l); i++; continue;
    }
    if (c === ')') {
      if (!stack.length) throw new SexprError('Fazladan kapanış parantezi', i);
      stack.pop(); i++; continue;
    }
    if (c === '"') {
      const start = i++;
      let s = '';
      for (;;) {
        if (i >= n) throw new SexprError('Kapanmamış metin (")', start);
        const ch = text[i];
        if (ch === '"') { i++; break; }
        if (ch === '\\') {
          if (i + 1 >= n) throw new SexprError('Kapanmamış metin (")', start);
          const e = text[i + 1];
          s += ESC[e] ?? e; i += 2; continue;
        }
        s += ch; i++;
      }
      push(s); continue;
    }
    const start = i;
    while (i < n && !' \t\r\n()"'.includes(text[i])) i++;
    const a = text.slice(start, i);
    push(NUM.test(a) ? Number(a) : a);
  }
  if (stack.length) throw new SexprError(`${stack.length} parantez kapatılmamış`, n);
  return top;
}

export type SexprResult = { ok: true; value: SExpr[] } | { ok: false; error: string; pos: number };

/** Non-throwing variant of parseSexpr. */
export function tryParseSexpr(text: string): SexprResult {
  try { return { ok: true, value: parseSexpr(text) }; }
  catch (e) { return e instanceof SexprError ? { ok: false, error: e.message, pos: e.pos } : { ok: false, error: String((e as Error)?.message ?? e), pos: 0 }; }
}

export const isList = (x: SExpr | undefined): x is SList => Array.isArray(x);
/** first element of a list when it is an atom (the form's name), else ''. */
export const headOf = (l: SList): string => (typeof l[0] === 'string' ? l[0] : '');
/** direct child lists of `l` whose head is `name` */
export const kids = (l: SList, name: string): SList[] => l.filter((x): x is SList => isList(x) && headOf(x) === name);
export const kid = (l: SList, name: string): SList | undefined => kids(l, name)[0];
/** number at position `i` of the list (the head is position 0), or undefined */
export const numAt = (l: SList | undefined, i: number): number | undefined => (l && typeof l[i] === 'number' ? (l[i] as number) : undefined);
/** string/number atom at position `i` as a string, or undefined */
export const strAt = (l: SList | undefined, i: number): string | undefined => (l && (typeof l[i] === 'string' || typeof l[i] === 'number') ? String(l[i]) : undefined);
