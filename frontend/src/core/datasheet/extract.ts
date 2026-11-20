import type { ComponentDef } from '../../library/types';
import { bjtPart, diodePart, mosPart } from '../../library/factories';

/**
 * Heuristic datasheet text extraction. Nothing is guessed: a field exists only when a line of the
 * pasted text matched, and every field carries that verbatim line as `quote` so the user can verify.
 * Values are SI base units (V, A, Ω, W, °C) except hFE (dimensionless).
 */

export type FieldKey = 'mpn' | 'package' | 'pol' | 'vmax' | 'imax' | 'rdson' | 'vgstest' | 'vgsth' | 'vgsmax' | 'hfe' | 'vf' | 'vftest' | 'ptot' | 'tjmax';
export type PartKind = 'mosfet' | 'bjt' | 'diode' | 'led' | 'unknown';

export interface ExtractedField {
  key: FieldKey;
  label: string;
  value: number | string;
  unit: string;
  /** verbatim source line */
  quote: string;
  confidence: 'high' | 'low';
  /** symbol the value was found under (e.g. VDSS, VCEO, VRRM) */
  symbol?: string;
}

export interface Extraction {
  kind: PartKind;
  fields: ExtractedField[];
  /** Turkish labels of fields not found (UI shows EKSİK) */
  missing: string[];
  notes: string[];
}

const LABELS: Record<FieldKey, string> = {
  mpn: 'Model no (MPN)', package: 'Paket', pol: 'Polarite / kanal', vmax: 'Maks. gerilim (VDS / VCEO / VR)', imax: 'Maks. akım (ID / IC / IF)',
  rdson: 'RDS(on)', vgstest: 'RDS(on) test VGS', vgsth: 'VGS(th)', vgsmax: 'Maks. |VGS|', hfe: 'hFE', vf: 'Vf', vftest: 'Vf test akımı (IF)', ptot: 'Ptot', tjmax: 'Tj maks.',
};

const RELEVANT: Record<PartKind, FieldKey[]> = {
  mosfet: ['mpn', 'package', 'pol', 'vmax', 'imax', 'rdson', 'vgstest', 'vgsth', 'vgsmax', 'ptot', 'tjmax'],
  bjt: ['mpn', 'package', 'pol', 'vmax', 'imax', 'hfe', 'ptot', 'tjmax'],
  diode: ['mpn', 'package', 'vmax', 'imax', 'vf', 'vftest', 'ptot', 'tjmax'],
  led: ['mpn', 'package', 'imax', 'vf', 'vftest', 'ptot', 'tjmax'],
  unknown: ['mpn', 'package', 'vmax', 'imax', 'rdson', 'vgsth', 'hfe', 'vf', 'ptot', 'tjmax'],
};

const PREFIX: Record<string, number> = { p: 1e-12, n: 1e-9, 'µ': 1e-6, u: 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6 };
const START = String.raw`^\s*(?:[|•*-]\s*)?`;

/** Text cleanup so unit parsing is uniform (the quote always uses the original line). */
function normalize(line: string): string {
  return line
    .replace(/ /g, ' ')
    .replace(/[µμ]/g, 'µ')
    .replace(/[ΩΩ]/g, 'Ω')
    .replace(/(?<=[\dpnµumkKM\s])ohms?\b/gi, 'Ω')
    .replace(/[−–—]/g, '-')
    .replace(/\b0,(\d+)/g, '0.$1')
    .replace(/(\d),(\d{3})(?!\d)/g, '$1$2')
    .replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2');
}

/** Remove test conditions such as "VGS = 10V", "TC = 25°C", except the field's own symbols. */
function stripConditions(seg: string, own: string[]): string {
  return seg.replace(/\b([A-Za-z][A-Za-z()]{0,7})\s*[=@]\s*\d+(?:\.\d+)?\s*[pnµumkM]?[A-Za-z°]{0,2}/g, (m, sym: string) => (own.includes(sym.toUpperCase()) ? m : ' '));
}

/** Numbers of a column group ending in a unit: "2.0 4.0 V" -> [2, 4]; "-55 to + 175 °C" -> [55, 175]. Scaled by SI prefix. */
function groupQty(seg: string, unit: string): number[] | null {
  const re = new RegExp(String.raw`(?<![A-Za-z0-9.])((?:\d+(?:\.\d+)?[\s,;/+-]*(?:to\s+)?)+?)\s*([pnµumkKM]?)(?:${unit})(?![A-Za-z]|\s*/)`, 'u');
  const m = re.exec(seg);
  if (!m) return null;
  const scale = m[2] ? PREFIX[m[2]] ?? 1 : 1;
  const nums = (m[1].match(/\d+(?:\.\d+)?/g) ?? []).map((x) => Number(x) * scale);
  return nums.length ? nums : null;
}

const fix = (n: number): number => Number(n.toPrecision(12));

interface Spec {
  key: FieldKey;
  unit: string;
  labels: RegExp[];
  qty: string;
  own: string[];
  exclude?: RegExp;
  pick: (nums: number[]) => { v: number; low: boolean; note?: string };
}

const lastPick = (nums: number[]) => ({ v: nums[nums.length - 1], low: nums.length > 1 });
const thresholdPick = (nums: number[]) =>
  nums.length === 1 ? { v: nums[0], low: false }
    : nums.length === 2 ? { v: (nums[0] + nums[1]) / 2, low: true, note: `VGS(th): min ${nums[0]} / maks ${nums[1]} verilmiş; orta değer kullanıldı (tipik değer yok).` }
      : { v: nums[1], low: true, note: 'VGS(th): üç sütundan ortadaki (tipik) alındı.' };

const SPECS: Spec[] = [
  {
    key: 'vmax', unit: 'V', qty: 'V(?:dc|DC)?', own: ['VDSS', 'VDS', 'VCEO', 'VCE0', 'VRRM', 'VRWM', 'VR'],
    labels: [new RegExp(START + String.raw`(V\(BR\)DSS|V\(BR\)CEO|VDSS|VDS|VCEO|VCE0|VRRM|VRWM|VR)(?![A-Za-z0-9])`), /(Drain[- ]to[- ]Source Voltage|Collector[- ]Emitter Voltage|Reverse Voltage|Drenaj[- ]kaynak gerilimi|Kollektör[- ]emiter gerilimi|Ters gerilim)/i],
    pick: lastPick,
  },
  {
    key: 'imax', unit: 'A', qty: 'A(?:dc|DC)?', own: ['ID', 'IC', 'IF', 'IO'],
    labels: [new RegExp(START + String.raw`(?:(ID|IC|IF|IO)(?![A-Za-z0-9])|(IF\(AV\)))`), /(Continuous Drain Current|Collector Current|Forward Current|Sürekli drenaj akımı|Kollektör akımı|İleri akım)/i],
    pick: lastPick,
  },
  {
    key: 'rdson', unit: 'Ω', qty: 'Ω', own: ['RDS(ON)', 'RDSON'],
    labels: [/R\s?DS\s?\(\s*on\s*\)|\bRDSon\b|On-?Resistance|Açık direnç|İletim direnci/i],
    pick: lastPick,
  },
  {
    key: 'vgsth', unit: 'V', qty: 'V(?:dc|DC)?', own: ['VGS(TH)', 'VTH'],
    labels: [/VGS\s?\(\s*th\s*\)|\bVth\b|Gate Threshold Voltage|Eşik gerilimi/i],
    pick: thresholdPick,
  },
  {
    key: 'vf', unit: 'V', qty: 'V(?:dc|DC)?', own: ['VF'],
    labels: [new RegExp(START + String.raw`VF(?![A-Za-z0-9])`), /Forward Voltage(?: Drop)?|İleri gerilim/i],
    exclude: /Diode Forward|Body Diode|Source[- ]Drain|\bVSD\b/i,
    pick: lastPick,
  },
  {
    key: 'ptot', unit: 'W', qty: 'W', own: ['PTOT', 'PD', 'PC'],
    labels: [new RegExp(START + String.raw`(?:Ptot|PTOT|PD|PC)(?![A-Za-z0-9])`), /(?:Device|Power)\s+Dissipation|Güç kaybı|Güç harcaması/i],
    pick: lastPick,
  },
  {
    key: 'tjmax', unit: '°C', qty: '°\\s?C', own: ['TJ', 'TJMAX'],
    labels: [new RegExp(START + String.raw`(?:TJMAX|Tjmax|TJ|Tj)(?![A-Za-z0-9])`), /Junction Temperature|Operating Junction|Maximum Junction|Bağlantı sıcaklığı/i],
    pick: lastPick,
  },
];

const PKG_RE = /\b(TO-?\d{2,3}[A-Z]{0,3}|SOT-?\d{2,3}[A-Z]?|DO-\d{2,3}[A-Z]{0,2}|SOD-\d{2,3}|SMA|SMB|SMC|D2PAK|D-?PAK|SOIC-\d{1,2}|SO-\d{1,2}|DIP-\d{1,2}|TSSOP-\d{1,2}|QFN-\d{1,3}|DFN-\d{1,3}|LFPAK\d*)\b/;
const MPN_SHAPE = /^(?:[A-Z]{1,5}\d{1,5}[A-Z]{0,3}\d{0,3}|\d[A-Z]{1,2}\d{3,5}[A-Z]?)$/;
const NOT_MPN = /^(?:TO|SOT|DO|SOD|SMA|SMB|SMC|TSSOP|SOIC|DIP|QFN|DFN|LFPAK|SC|PD|RS|IEC|ISO|REV|AN|DS)\d/;
const MPN_LABEL = /(?:Part\s*(?:Number|No\.?)|MPN|Parça\s*(?:No|numarası)|Model\s*No|Ürün kodu)\s*[:=]\s*([A-Z0-9][A-Za-z0-9\-./]{2,24})/i;

const clip = (s: string): string => (s.trim().length > 220 ? `${s.trim().slice(0, 217)}...` : s.trim());

export function extractDatasheet(text: string): Extraction {
  const lines = text.split(/\r?\n/);
  const norm = lines.map(normalize);
  const found = new Map<FieldKey, ExtractedField>();
  const lineOf = new Map<FieldKey, number>();
  const notes: string[] = [];
  const add = (f: Omit<ExtractedField, 'label'>, line: number) => { if (!found.has(f.key)) { found.set(f.key, { ...f, label: LABELS[f.key] }); lineOf.set(f.key, line); } };

  // ---- quantity fields
  for (const spec of SPECS) {
    for (let i = 0; i < lines.length && !found.has(spec.key); i++) {
      const n = norm[i];
      if (!n.trim() || (spec.exclude && spec.exclude.test(n))) continue;
      for (const re of spec.labels) {
        const m = re.exec(n);
        if (!m) continue;
        const seg = stripConditions(n.slice(m.index + m[0].length), spec.own);
        const nums = groupQty(seg, spec.qty);
        if (!nums) continue;
        const p = spec.pick(nums);
        const symbol = m[1] ?? m[2];
        add({ key: spec.key, value: fix(p.v), unit: spec.unit, quote: clip(lines[i]), confidence: p.low ? 'low' : 'high', symbol: symbol && /^[A-Z]/.test(symbol) ? symbol : undefined }, i);
        if (p.note) notes.push(p.note);
        else if (p.low) notes.push(`${LABELS[spec.key]}: satırda birden fazla sütun var; sonuncusu (maks.) alındı. Alıntıyı kontrol edin.`);
        break;
      }
    }
  }

  // ---- RDS(on) test VGS: same line, else the next line
  if (lineOf.has('rdson')) {
    let i = lineOf.get('rdson')!;
    const hasVgs = (k: number) => [k, k + 1].some((j) => j < lines.length && /\bVGS\s*[=@]\s*\d/i.test(norm[j]));
    if (!hasVgs(i)) {
      // prefer the table row that states its VGS test condition over a features-list line
      const spec = SPECS.find((s) => s.key === 'rdson')!;
      for (let k = 0; k < lines.length; k++) {
        const m = spec.labels[0].exec(norm[k]);
        if (!m || !hasVgs(k)) continue;
        const nums = groupQty(stripConditions(norm[k].slice(m.index + m[0].length), spec.own), spec.qty);
        if (!nums) continue;
        const p = spec.pick(nums);
        found.set('rdson', { key: 'rdson', label: LABELS.rdson, value: fix(p.v), unit: 'Ω', quote: clip(lines[k]), confidence: p.low ? 'low' : 'high' });
        i = k;
        break;
      }
    }
    for (const j of [i, i + 1]) {
      const m = j < lines.length ? /\bVGS\s*[=@]\s*(\d+(?:\.\d+)?)\s*V/i.exec(norm[j]) : null;
      if (m) { add({ key: 'vgstest', value: Number(m[1]), unit: 'V', quote: clip(lines[j]), confidence: j === i ? 'high' : 'low' }, j); break; }
    }
  }

  // ---- diode Vf test current
  if (lineOf.has('vf')) {
    const i = lineOf.get('vf')!;
    for (const j of [i, i + 1]) {
      const m = j < lines.length ? /\bIF\s*[=@]\s*(\d+(?:\.\d+)?)\s*([mµun]?)A/i.exec(norm[j]) : null;
      if (m) { add({ key: 'vftest', value: fix(Number(m[1]) * (m[2] ? PREFIX[m[2].toLowerCase()] ?? 1 : 1)), unit: 'A', quote: clip(lines[j]), confidence: j === i ? 'high' : 'low' }, j); break; }
    }
  }

  // ---- VGS max (needs an explicit ± to avoid confusing it with test conditions)
  for (let i = 0; i < lines.length && !found.has('vgsmax'); i++) {
    const m = /\bVGSS?\b\s*(?:Gate[- ]to[- ]Source Voltage\s*)?±\s*(\d+(?:\.\d+)?)\s*V/i.exec(norm[i]) ?? /Gate[- ]to[- ]Source Voltage[^\d]{0,12}±\s*(\d+(?:\.\d+)?)\s*V/i.exec(norm[i]);
    if (m) add({ key: 'vgsmax', value: Number(m[1]), unit: 'V', quote: clip(lines[i]), confidence: 'high' }, i);
  }

  // ---- hFE: unitless columns after stripping test conditions
  for (let i = 0; i < lines.length && !found.has('hfe'); i++) {
    const m = /\bhFE\b|DC Current Gain|Akım kazancı/i.exec(norm[i]);
    if (!m) continue;
    const seg = stripConditions(norm[i].slice(m.index + m[0].length), ['HFE']).replace(/\((?:Notes?|Not)\s*\d+\)|\(\d\)/gi, ' ');
    const nums = (seg.match(/(?<![\w.])\d+(?:\.\d+)?(?![\w.]|\s*[A-Za-zΩµ°%])/g) ?? []).map(Number);
    if (!nums.length) continue;
    const v = nums.length === 1 ? nums[0] : nums.length === 2 ? nums[0] : nums[1];
    add({ key: 'hfe', value: v, unit: '', quote: clip(lines[i]), confidence: nums.length === 1 ? 'high' : 'low' }, i);
    if (nums.length === 2) notes.push(`hFE: min ${nums[0]} / maks ${nums[1]} verilmiş; garanti edilen min değer alındı.`);
    else if (nums.length > 2) notes.push('hFE: üç sütundan ortadaki (tipik) alındı.');
  }

  // ---- package
  for (let i = 0; i < lines.length && !found.has('package'); i++) {
    const lab = /(?:Package|Paket|Kılıf|Case)\b\s*[:=]?\s*/i.exec(lines[i]);
    if (lab) { const m = PKG_RE.exec(lines[i].slice(lab.index + lab[0].length)); if (m) add({ key: 'package', value: m[1], unit: '', quote: clip(lines[i]), confidence: 'high' }, i); }
  }
  if (!found.has('package')) {
    for (let i = 0; i < lines.length; i++) { const m = PKG_RE.exec(lines[i]); if (m) { add({ key: 'package', value: m[1], unit: '', quote: clip(lines[i]), confidence: 'low' }, i); break; } }
  }

  // ---- MPN: explicit label, else a part-number-shaped token on one of the first lines
  for (let i = 0; i < lines.length; i++) {
    const m = MPN_LABEL.exec(lines[i]);
    if (m) { add({ key: 'mpn', value: m[1].toUpperCase(), unit: '', quote: clip(lines[i]), confidence: 'high' }, i); break; }
  }
  if (!found.has('mpn')) {
    const head = lines.map((l, i) => [l, i] as const).filter(([l]) => l.trim()).slice(0, 8);
    for (const [l, i] of head) {
      const tok = l.split(/[\s,;:/()|]+/).find((t) => MPN_SHAPE.test(t) && !NOT_MPN.test(t) && !PKG_RE.test(t) && /\d/.test(t) && /[A-Z]/.test(t));
      if (tok) { add({ key: 'mpn', value: tok, unit: '', quote: clip(l), confidence: 'low' }, i); break; }
    }
  }

  // ---- kind
  const sym = found.get('vmax')?.symbol ?? '';
  let kind: PartKind = 'unknown';
  if (found.has('rdson') || found.has('vgsth') || /^V(?:\(BR\))?DS/.test(sym) || /MOSFET/i.test(text)) kind = 'mosfet';
  else if (found.has('hfe') || /^V(?:\(BR\))?CE/.test(sym) || /\b(?:NPN|PNP)\b/.test(text)) kind = 'bjt';
  else if (found.has('vf') || /^VR/.test(sym)) kind = /\bLED\b|light[- ]emitting|ışık yayan/i.test(text) ? 'led' : 'diode';

  // ---- polarity (only when unambiguous)
  const polFind = (re: RegExp): number => lines.findIndex((l) => re.test(l));
  const setPol = (i: number, value: string) => add({ key: 'pol', value, unit: '', quote: clip(lines[i]), confidence: 'high' }, i);
  if (kind === 'mosfet') {
    const n = polFind(/\bN-?\s?(?:Channel|Kanal)/i), p = polFind(/\bP-?\s?(?:Channel|Kanal)/i);
    if (n >= 0 && p < 0) setPol(n, 'n'); else if (p >= 0 && n < 0) setPol(p, 'p');
    else if (n >= 0 && p >= 0) notes.push('Hem N hem P kanal ifadesi var; polarite belirlenemedi.');
  } else if (kind === 'bjt') {
    const n = polFind(/\bNPN\b/), p = polFind(/\bPNP\b/);
    if (n >= 0 && p < 0) setPol(n, 'npn'); else if (p >= 0 && n < 0) setPol(p, 'pnp');
    else if (n >= 0 && p >= 0) notes.push('Hem NPN hem PNP ifadesi var; polarite belirlenemedi.');
  }

  const relevant = RELEVANT[kind];
  const fields = relevant.map((k) => found.get(k)).filter((f): f is ExtractedField => !!f);
  const missing = relevant.filter((k) => !found.has(k)).map((k) => LABELS[k]);
  if (kind === 'unknown') notes.push('Parça türü (MOSFET / BJT / diyot) belirlenemedi.');
  if (fields.length) notes.push('Değerler otomatik çıkarıldı; “alıntı” sütunuyla datasheet’i karşılaştırın. Doğrulanmadan kullanmayın.');
  return { kind, fields, missing, notes };
}

// ---------------------------------------------------------------- library mapping
export type LibraryResult = { ok: true; def: ComponentDef; warnings: string[] } | { ok: false; missing: string[] };

/** Maps extracted fields to a library part ONLY when every required field was found; never fills gaps. */
export function toLibraryPart(fields: ExtractedField[]): LibraryResult {
  const f = (k: FieldKey): ExtractedField | undefined => fields.find((x) => x.key === k);
  const num = (k: FieldKey): number | undefined => { const v = f(k)?.value; return typeof v === 'number' ? v : undefined; };
  const str = (k: FieldKey): string | undefined => { const v = f(k)?.value; return typeof v === 'string' ? v : undefined; };
  const sym = f('vmax')?.symbol ?? '';
  const need = (keys: FieldKey[]): string[] => keys.filter((k) => f(k) === undefined).map((k) => LABELS[k]);
  const finish = (def: ComponentDef): LibraryResult => ({
    ok: true, warnings: def.model === 'diode' ? ['LED ise renk datasheet metninden çıkarılamaz; parça genel diyot modeliyle eklenir.'] : [],
    def: {
      ...def, type: `user_${(def.mpn ?? 'part').toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, userMade: true, dataSource: 'manufacturer', verified: false,
      tags: [...(def.tags ?? []), 'kullanıcı', 'datasheet-içe-aktarım'], missing: [...def.missing, 'datasheet metninden otomatik çıkarıldı — doğrulanmadı'],
      description: `${def.description} (Datasheet metninden içe aktarıldı.)`,
    },
  });

  if (/^V(?:\(BR\))?DS/.test(sym) || f('rdson') || f('vgsth')) {
    const miss = need(['mpn', 'pol', 'vmax', 'imax', 'rdson', 'vgstest', 'vgsth', 'vgsmax']);
    if (miss.length) return { ok: false, missing: miss };
    const pol = str('pol') === 'p' ? 'p' : 'n';
    return finish(mosPart({ mpn: str('mpn')!, pkg: str('package'), desc: `${pol === 'n' ? 'N' : 'P'}-kanal MOSFET.`, pol, vds: num('vmax')!, id: num('imax')!, rds: num('rdson')!, vgsTest: num('vgstest')!, vth: num('vgsth')!, vgsmax: num('vgsmax')!, tags: ['mosfet'] }));
  }
  if (/^V(?:\(BR\))?CE/.test(sym) || f('hfe')) {
    const miss = need(['mpn', 'pol', 'vmax', 'imax', 'hfe', 'ptot']);
    if (miss.length) return { ok: false, missing: miss };
    const pol = str('pol') === 'pnp' ? 'pnp' : 'npn';
    return finish(bjtPart({ mpn: str('mpn')!, pkg: str('package'), desc: `${pol.toUpperCase()} transistör.`, pol, bf: num('hfe')!, icmax: num('imax')!, pmax: num('ptot')!, vceo: num('vmax')!, tags: [pol] }));
  }
  if (/^VR/.test(sym) || f('vf')) {
    const miss = need(['mpn', 'vmax', 'imax', 'vf', 'vftest']);
    if (miss.length) return { ok: false, missing: miss };
    return finish(diodePart({ mpn: str('mpn')!, pkg: str('package'), desc: 'Diyot.', vf: num('vf')!, ifTest: num('vftest')!, ifmax: num('imax')!, vrmax: num('vmax')!, tags: ['diode'] }));
  }
  return { ok: false, missing: ['Parça türü (MOSFET / BJT / diyot) belirlenemedi'] };
}
