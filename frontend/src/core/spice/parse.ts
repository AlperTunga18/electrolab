/**
 * Local SPICE .MODEL / .SUBCKT card parser (no network). Numeric values only; expressions are reported, never evaluated.
 * Only parameters that src/core/sim/mna.ts really uses are mapped:
 *   diode: is, n   |   BJT: is, bf   |   MOSFET level-1: vth (|Vto|), k (Kp/2 * W/L), lambda.
 * Everything else is listed in `ignored` (no silent drops). .SUBCKT bodies are NOT simulated.
 */

export type SpiceKind = 'D' | 'NPN' | 'PNP' | 'NMOS' | 'PMOS';

export interface IgnoredParam { name: string; raw: string; reason: string }
export interface SpiceModel {
  name: string;
  kind: SpiceKind;
  /** all numeric params as written (lower-case keys) */
  params: Record<string, number>;
  /** simulator param keys derived from the card (mos 'k' assumes W/L = 1, see toPart) */
  mapped: Record<string, number>;
  ignored: IgnoredParam[];
  warnings: string[];
}
export interface SpiceSubckt { name: string; pins: string[]; message: string }
export interface SpiceParse { models: SpiceModel[]; subckts: SpiceSubckt[]; unsupported: string[]; warnings: string[] }

const SI: [string, number][] = [['meg', 1e6], ['mil', 25.4e-6], ['t', 1e12], ['g', 1e9], ['k', 1e3], ['m', 1e-3], ['u', 1e-6], ['µ', 1e-6], ['n', 1e-9], ['p', 1e-12], ['f', 1e-15]];

/** Parse a SPICE number with optional SI suffix and trailing unit letters (10pF, 1.5meg, 2mil, 1e-14). null if not a plain number. */
export function parseSpiceNumber(raw: string): number | null {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-zµ]*)$/i.exec(raw.trim());
  if (!m) return null;
  const base = Number(m[1]);
  const suf = m[2].toLowerCase();
  if (!suf) return base;
  for (const [s, mult] of SI) if (suf.startsWith(s)) return base * mult;
  // pure unit letters such as "v", "a", "ohm", "f" handled above ('f' = femto is SPICE convention)
  return /^(v|a|s|h|ohm|hz|w)$/.test(suf) ? base : null;
}

const KINDS: Record<string, SpiceKind> = { d: 'D', npn: 'NPN', pnp: 'PNP', nmos: 'NMOS', pmos: 'PMOS' };

/** Joined logical lines: '+' continuation, '*' full-line and ';' / '$' inline comments removed. */
function logicalLines(text: string): string[] {
  const out: string[] = [];
  for (const rawLine of text.replace(/\r/g, '').split('\n')) {
    let line = rawLine.replace(/\s[;$].*$/, '').replace(/^\s*[;$].*$/, '');
    if (/^\s*\*/.test(line)) continue;
    if (!line.trim()) continue;
    if (/^\s*\+/.test(line) && out.length) out[out.length - 1] += ' ' + line.replace(/^\s*\+/, '');
    else out.push(line.trim());
    line = '';
  }
  return out;
}

function mapParams(kind: SpiceKind, p: Record<string, number>, raws: Record<string, string>, bad: IgnoredParam[]): { mapped: Record<string, number>; ignored: IgnoredParam[]; warnings: string[] } {
  const mapped: Record<string, number> = {};
  const used = new Set<string>();
  const warnings: string[] = [];
  const take = (spice: string, key: string, f: (v: number) => number = (v) => v) => { if (spice in p) { mapped[key] = f(p[spice]); used.add(spice); } };
  if (kind === 'D') { take('is', 'is'); take('n', 'n'); }
  else if (kind === 'NPN' || kind === 'PNP') { take('is', 'is'); take('bf', 'bf'); }
  else {
    take('vto', 'vth', Math.abs); take('kp', 'k', (v) => v / 2); take('lambda', 'lambda');
    if ('level' in p) {
      used.add('level');
      if (p.level !== 1) warnings.push(`LEVEL=${p.level}: simülatör yalnızca seviye-1 kullanır; Vto/Kp/Lambda yine de seviye-1 olarak eşlendi, sonuçlar modelin kastettiği davranıştan farklı olabilir.`);
    }
    if ('kp' in p) warnings.push('k = Kp/2 (W/L = 1 varsayıldı); gerçek W/L ile ölçekleyin.');
  }
  const ignored: IgnoredParam[] = [...bad];
  for (const k of Object.keys(p)) if (!used.has(k)) ignored.push({ name: k, raw: raws[k] ?? String(p[k]), reason: 'simülatör bu parametreyi kullanmıyor' });
  return { mapped, ignored, warnings };
}

export function parseSpice(text: string): SpiceParse {
  const res: SpiceParse = { models: [], subckts: [], unsupported: [], warnings: [] };
  for (const line of logicalLines(text)) {
    const low = line.toLowerCase();
    if (low.startsWith('.subckt')) {
      const toks = line.replace(/[()]/g, ' ').split(/\s+/).slice(1).filter(Boolean);
      const name = toks[0] ?? '?';
      const pins = toks.slice(1).filter((t) => !t.includes('='));
      res.subckts.push({ name, pins, message: `alt devre: desteklenmiyor (${name}; pinler: ${pins.join(' ') || '—'})` });
      continue;
    }
    if (!low.startsWith('.model')) continue;
    const norm = line.replace(/[(),]/g, ' ').replace(/\s*=\s*/g, '=').trim().split(/\s+/);
    const name = norm[1];
    const typeTok = (norm[2] ?? '').toLowerCase();
    if (!name || !typeTok) { res.warnings.push(`Bozuk .MODEL satırı: ${line.slice(0, 60)}`); continue; }
    const kind = KINDS[typeTok];
    if (!kind) { res.unsupported.push(`${name} (${norm[2]}): desteklenmeyen model türü`); continue; }
    const params: Record<string, number> = {};
    const raws: Record<string, string> = {};
    const bad: IgnoredParam[] = [];
    for (const tok of norm.slice(3)) {
      const eq = tok.indexOf('=');
      if (eq < 1) { bad.push({ name: tok, raw: tok, reason: 'anahtar=değer biçiminde değil' }); continue; }
      const key = tok.slice(0, eq).toLowerCase();
      const rawVal = tok.slice(eq + 1);
      raws[key] = rawVal;
      const v = parseSpiceNumber(rawVal);
      if (v === null) bad.push({ name: key, raw: rawVal, reason: 'sayısal değil / ifade (değerlendirilmez)' });
      else params[key] = v;
    }
    const { mapped, ignored, warnings } = mapParams(kind, params, raws, bad);
    res.models.push({ name, kind, params, mapped, ignored, warnings });
  }
  if (!res.models.length && !res.subckts.length) res.warnings.push('Metinde .MODEL veya .SUBCKT bulunamadı.');
  return res;
}
