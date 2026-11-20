const PREFIXES: [number, string][] = [
  [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'],
];

/** SI formatting: 4700 -> "4.7 kΩ" */
export function formatSI(value: number, unit = '', digits = 3): string {
  if (!Number.isFinite(value)) return `${value}${unit ? ' ' + unit : ''}`;
  if (Math.abs(value) < 1e-13) return `0 ${unit}`.trim();
  const abs = Math.abs(value);
  let [scale, prefix] = PREFIXES[PREFIXES.length - 1];
  for (const [s, p] of PREFIXES) {
    if (abs >= s * 0.9995) { scale = s; prefix = p; break; }
  }
  const n = value / scale;
  const txt = Number(n.toPrecision(digits)).toString();
  return `${txt} ${prefix}${unit}`.trim();
}

const PARSE: Record<string, number> = {
  G: 1e9, M: 1e6, k: 1e3, K: 1e3, m: 1e-3, u: 1e-6, 'µ': 1e-6, n: 1e-9, p: 1e-12,
};

/** Parses "4.7k", "100n", "1e-6", "10 mV" -> number (unit letters after prefix ignored). */
export function parseSI(text: string): number | null {
  const m = /^\s*([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s*([GMkKmuµnp]?)/.exec(text);
  if (!m) return null;
  const base = parseFloat(m[1]);
  const mult = m[2] ? PARSE[m[2]] : 1;
  return base * mult;
}
