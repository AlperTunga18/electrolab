import type { Category, ComponentDef, ParamDef, PinDef, Rating } from './types';

/**
 * Factories for catalog parts. They build full ComponentDefs from datasheet-style figures.
 * RULES: every number typed into a catalog file is from memory/typical datasheet values and is flagged
 * `verified: false` until compared against the manufacturer datasheet. Never invent URLs: the datasheet
 * link is always a SEARCH by part number.
 */

const VT = 0.025852;
export const datasheetSearch = (mpn: string): string => `https://www.alldatasheet.com/view.jsp?Searchword=${encodeURIComponent(mpn)}`;

const sig = (x: number, d = 3): number => Number(x.toPrecision(d));

const num = (key: string, label: string, unit: string, def: number, o: Partial<ParamDef> = {}): ParamDef => ({
  key, label, unit, type: 'number', default: def, si: o.si ?? unit !== '', ...o,
});
const rating = (label: string, unit: string, quantity: Rating['quantity'], paramKey: string): Rating => ({ key: paramKey, label, unit, quantity, paramKey });

interface Common {
  mpn: string;
  mfr?: string;
  /** display name; defaults to mpn */
  name?: string;
  desc: string;
  pkg?: string;
  specs?: Record<string, string>;
  tags?: string[];
  missing?: string[];
  /** type id override (default: slug of mpn) */
  id?: string;
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function base(c: Common, category: Category, prefix: string, model: ComponentDef['model'], like?: string): Pick<ComponentDef, 'type' | 'name' | 'nameEn' | 'category' | 'prefix' | 'model' | 'description' | 'dataSource' | 'verified' | 'manufacturer' | 'mpn' | 'package' | 'specs' | 'tags' | 'datasheetUrl' | 'visual'> {
  return {
    type: c.id ?? slug(c.mpn), name: c.name ?? c.mpn, nameEn: c.name ?? c.mpn, category, prefix, model,
    description: c.desc, dataSource: 'manufacturer', verified: false,
    manufacturer: c.mfr, mpn: c.mpn, package: c.pkg, specs: c.specs, tags: c.tags,
    datasheetUrl: datasheetSearch(c.mpn), visual: like ? { like } : undefined,
  };
}

const pin = (id: string, label: string, x: number, z: number, y = 0.2): PinDef => ({ id, label, x, z, y });

// ---------------------------------------------------------------- pin layouts
export type Layout = 'dip' | 'sip' | 'axial2' | 'sot3';

/** DIP-style: numbered pins, left column down, right column up. rowGap in cm. */
export function dipPins(labels: string[], rowGap = 3): PinDef[] {
  const n = labels.length, half = n / 2, pitch = 0.5;
  return labels.map((l, i) => {
    const left = i < half;
    const k = left ? i : n - 1 - i;
    return pin(String(i + 1), `${i + 1} ${l}`, left ? -rowGap / 2 : rowGap / 2, (k - (half - 1) / 2) * pitch);
  });
}

/** Single row along x, pitch 0.5. */
export function sipPins(labels: string[], pitch = 0.5): PinDef[] {
  const n = labels.length;
  return labels.map((l, i) => pin(String(i + 1), `${i + 1} ${l}`, (i - (n - 1) / 2) * pitch, 0));
}

const uniq = (labels: string[]): string[] => {
  const seen = new Map<string, number>();
  return labels.map((l) => {
    const id = l.replace(/[^A-Za-z0-9_+\-./]/g, '');
    const k = (seen.get(id) ?? 0) + 1;
    seen.set(id, k);
    return k === 1 ? id : `${id}_${k}`;
  });
}

/** Two header rows (dev boards). Pin ids are the labels (duplicates get _2, _3). */
export function dualRowPins(left: string[], right: string[], gap: number): PinDef[] {
  const ids = uniq([...left, ...right]);
  const pitch = 0.5, out: PinDef[] = [];
  left.forEach((l, i) => out.push(pin(ids[i], l, -gap / 2, (i - (left.length - 1) / 2) * pitch)));
  right.forEach((l, i) => out.push(pin(ids[left.length + i], l, gap / 2, (i - (right.length - 1) / 2) * pitch)));
  return out;
}

/** Single header row with label ids. */
export function rowPins(labels: string[], pitch = 0.5): PinDef[] {
  const ids = uniq(labels);
  return labels.map((l, i) => pin(ids[i], l, (i - (labels.length - 1) / 2) * pitch, 0));
}

function sizeOf(pins: PinDef[], h: number, padX = 0.5, padZ = 0.5): ComponentDef['size'] {
  const xs = pins.map((p) => p.x), zs = pins.map((p) => p.z);
  return { w: Math.max(...xs) - Math.min(...xs) + padX * 2, d: Math.max(...zs) - Math.min(...zs) + padZ * 2, h };
}

const two = (a: string, b: string, x: number): PinDef[] => [pin(a, a, -x, 0), pin(b, b, x, 0)];
const three = (a: string, b: string, c: string): PinDef[] => [pin(a, a, -0.5, 0), pin(b, b, 0, 0), pin(c, c, 0.5, 0)];

// ---------------------------------------------------------------- diodes
export function diodePart(o: Common & { vf: number; ifTest: number; n?: number; ifmax: number; vrmax: number; schottky?: boolean }): ComponentDef {
  const n = o.n ?? (o.schottky ? 1.05 : 1.7);
  const is = sig(o.ifTest / (Math.exp(o.vf / (n * VT)) - 1));
  return {
    ...base(o, 'semiconductor', 'D', 'diode', 'diode'),
    pins: [pin('A', 'A', -1, 0), pin('K', 'K', 1, 0)],
    params: [num('is', 'Is (türetilmiş)', 'A', is, { min: 1e-18 }), num('n', 'n (idealite)', '', n, { min: 1, max: 3, si: false }),
      num('ifmax', 'Maks. ileri akım', 'A', o.ifmax, { min: 1e-3 }), num('vrmax', 'Maks. ters gerilim', 'V', o.vrmax, { min: 1 })],
    ratings: [rating('Maks. ileri akım', 'A', 'current', 'ifmax'), rating('Maks. ters gerilim', 'V', 'reverseVoltage', 'vrmax')],
    missing: o.missing ?? ['Rs', 'kapasite', 'toparlanma süresi', 'SPICE modeli'],
    size: { w: 2.2, d: 0.5, h: 0.5 },
    simModel: 'partial', simNote: `Shockley modeli; Is, "Vf=${o.vf} V @ ${o.ifTest} A" tipik değerinden türetildi (Rs, kapasite, toparlanma yok).`,
    specs: { 'Vf (tipik)': `${o.vf} V @ ${o.ifTest} A`, 'Maks. ileri akım': `${o.ifmax} A`, 'Maks. ters gerilim': `${o.vrmax} V`, ...o.specs },
  };
}

export function zenerPart(o: Common & { vz: number; pmax: number; tvs?: boolean }): ComponentDef {
  return {
    ...base(o, 'semiconductor', 'D', 'zener', 'zener'),
    pins: [pin('A', 'A', -1, 0), pin('K', 'K', 1, 0)],
    params: [num('vz', o.tvs ? 'Vbr (kırılma)' : 'Zener gerilimi', 'V', o.vz, { min: 1 }), num('pmax', 'Maks. güç', 'W', o.pmax, { min: 0.01 })],
    ratings: [rating('Maks. güç', 'W', 'power', 'pmax')],
    missing: o.missing ?? ['dinamik empedans', 'sıcaklık katsayısı', 'SPICE modeli'],
    size: { w: 2.2, d: 0.5, h: 0.5 },
    simModel: 'partial', simNote: 'Kırılma, 1 mA noktasında Vz olacak şekilde modellenir; dinamik empedans/sıcaklık yok.' + (o.tvs ? ' TVS tek yönlü diyot olarak yaklaşıklanmıştır (darbe gücü/kıskaç gerilimi yok).' : ''),
    specs: { [o.tvs ? 'Vbr' : 'Vz']: `${o.vz} V`, 'Maks. güç': `${o.pmax} W`, ...o.specs },
  };
}

export function ledPart(o: Common & { color: 'red' | 'yellow' | 'green' | 'blue' | 'white' | 'orange' | 'ir' | 'uv'; ifmax?: number }): ComponentDef {
  return {
    ...base(o, 'semiconductor', 'D', 'led', 'led'),
    pins: [pin('A', 'A (+)', -0.5, 0), pin('K', 'K (−)', 0.5, 0)],
    params: [{ key: 'color', label: 'Renk', unit: '', type: 'select', default: o.color, options: [{ value: o.color, label: o.color }] }, num('ifmax', 'Maks. ileri akım', 'A', o.ifmax ?? 0.03, { min: 1e-3 })],
    ratings: [rating('Maks. ileri akım', 'A', 'current', 'ifmax')],
    missing: o.missing ?? ['ışık şiddeti', 'ters gerilim sınırı', 'SPICE modeli'],
    size: { w: 0.8, d: 0.8, h: 1.2 },
    simModel: 'partial', simNote: 'Renge göre tipik Vf (20 mA) ile Shockley modeli; ışık çıkışı akımla orantılı çizilir.',
    specs: { Renk: o.color, 'Maks. ileri akım': `${(o.ifmax ?? 0.03) * 1000} mA`, ...o.specs },
  };
}

export function bridgePart(o: Common & { vf: number; ifTest: number; ifmax: number; vrmax: number }): ComponentDef {
  const n = 1.7;
  const is = sig(o.ifTest / (Math.exp(o.vf / (n * VT)) - 1));
  const pins = [pin('AC1', '~', -1, -0.75), pin('AC2', '~', 1, -0.75), pin('P', '+', -1, 0.75), pin('N', '−', 1, 0.75)];
  return {
    ...base(o, 'semiconductor', 'BR', 'bridge'),
    pins,
    params: [num('is', 'Is (türetilmiş)', 'A', is, { min: 1e-18 }), num('n', 'n', '', n, { si: false }), num('ifmax', 'Maks. ileri akım (toplam)', 'A', o.ifmax, { min: 0.01 }), num('vrmax', 'Maks. ters gerilim', 'V', o.vrmax, { min: 1 })],
    ratings: [rating('Maks. ters gerilim', 'V', 'reverseVoltage', 'vrmax')],
    missing: o.missing ?? ['Rs', 'SPICE modeli'],
    size: { w: 3, d: 2.5, h: 1.4 },
    simModel: 'partial', simNote: '4 ayrı diyot olarak modellenir (Shockley).',
    visual: { kind: 'box', color: '#1f2937', h: 1.2 },
    specs: { 'Maks. akım': `${o.ifmax} A`, 'Maks. ters gerilim': `${o.vrmax} V`, ...o.specs },
  };
}

// ---------------------------------------------------------------- transistors
export function bjtPart(o: Common & { pol: 'npn' | 'pnp'; bf: number; icmax: number; pmax: number; vceo: number; darlington?: boolean; power?: boolean }): ComponentDef {
  return {
    ...base(o, 'semiconductor', 'Q', o.pol, o.pol),
    pins: three('C', 'B', 'E'),
    params: [num('bf', 'βF (tipik)', '', o.bf, { min: 10, max: 5000, si: false }), num('is', 'Is', 'A', o.darlington ? 1e-22 : 1.8e-14, { min: 1e-30 }),
      num('icmax', 'Maks. kolektör akımı', 'A', o.icmax, { min: 1e-3 }), num('pmax', 'Maks. güç', 'W', o.pmax, { min: 0.01 }), num('vceo', 'Vceo', 'V', o.vceo, { min: 1 })],
    ratings: [rating('Maks. kolektör akımı', 'A', 'current', 'icmax'), rating('Maks. güç', 'W', 'power', 'pmax'), rating('Vceo', 'V', 'vce', 'vceo')],
    missing: o.missing ?? ['Early gerilimi', 'kapasiteler', 'ısıl direnç', 'SPICE modeli'],
    size: o.power ? { w: 1.6, d: 2.2, h: 2.2 } : { w: 1.4, d: 1.2, h: 1.4 },
    visual: o.power ? { kind: 'to220', like: undefined } : { like: o.pol },
    simModel: 'partial', simNote: 'Ebers-Moll; βF tipik değer, Early etkisi ve kapasite yok.' + (o.darlington ? ' Darlington: Vbe≈1.3 V tek jonksiyon ile yaklaşıklanmıştır.' : ''),
    specs: { 'Ic maks.': `${o.icmax} A`, Vceo: `${o.vceo} V`, 'Ptot': `${o.pmax} W`, 'hFE (tipik)': String(o.bf), ...o.specs },
  };
}

export function mosPart(o: Omit<Common, 'id'> & { pol: 'n' | 'p'; vds: number; id: number; rds: number; vgsTest: number; vth: number; vgsmax: number; small?: boolean }): ComponentDef {
  const k = sig(1 / (2 * o.rds * Math.max(o.vgsTest - o.vth, 0.1)));
  return {
    ...base({ ...o, id: undefined }, 'semiconductor', 'Q', o.pol === 'n' ? 'nmos' : 'pmos', undefined),
    pins: three('G', 'D', 'S'),
    params: [num('vth', o.pol === 'n' ? 'VGS(th) (tipik)' : '|VGS(th)| (tipik)', 'V', o.vth, { min: 0.2, max: 8 }), num('k', 'K (türetilmiş)', 'A/V²', k, { min: 1e-3 }),
      num('lambda', 'λ', '1/V', 0.01, { min: 0, max: 0.2, si: false }), num('vgsmax', 'Maks. |VGS|', 'V', o.vgsmax, { min: 1 }),
      num('vdsmax', 'Maks. |VDS|', 'V', o.vds, { min: 1 }), num('idmax', 'Maks. |ID|', 'A', o.id, { min: 0.01 })],
    ratings: [rating('Maks. |VGS|', 'V', 'voltage', 'vgsmax'), rating('Maks. |VDS|', 'V', 'vds', 'vdsmax'), rating('Maks. |ID|', 'A', 'current', 'idmax')],
    missing: o.missing ?? ['Qg (gate charge)', 'kapasiteler', 'SOA', 'ısıl direnç', 'SPICE modeli'],
    size: o.small ? { w: 1.2, d: 1.2, h: 0.8 } : { w: 1.6, d: 2.2, h: 2.2 },
    visual: { kind: o.small ? 'smd' : 'to220' },
    simModel: 'partial', simNote: `Level-1 modeli; K, "RDS(on)=${o.rds} Ω @ VGS=${o.vgsTest} V" ve tipik Vth'ten türetildi. Gate yükü, kapasite, SOA, ısıl model yok.`,
    specs: { [o.pol === 'n' ? 'VDS' : '|VDS|']: `${o.vds} V`, ID: `${o.id} A`, [`RDS(on) @ ${o.vgsTest} V`]: `${o.rds * 1000} mΩ`, 'VGS(th)': `${o.vth} V`, 'VGS maks.': `±${o.vgsmax} V`, ...o.specs },
  };
}

// ---------------------------------------------------------------- passives
export function resistorPart(o: Common & { r: number; tol: number; pmax: number; family: 'carbon' | 'metal' | 'wirewound' | 'smd' | 'power' | 'ntc' | 'ptc' | 'ldr' | 'fuse' }): ComponentDef {
  const partial = o.family === 'ntc' || o.family === 'ptc' || o.family === 'ldr';
  return {
    ...base(o, 'passive', o.family === 'fuse' ? 'F' : 'R', 'resistor', 'resistor'),
    pins: two('1', '2', o.family === 'smd' ? 0.5 : 1),
    params: [num('r', partial ? 'Direnç (25 °C / referans)' : 'Direnç', 'Ω', o.r, { min: 1e-3 }), num('tol', 'Tolerans', '%', o.tol, { min: 0, max: 50, si: false }), num('pmax', 'Anma gücü', 'W', o.pmax, { min: 0.01 })],
    ratings: [rating('Anma gücü', 'W', 'power', 'pmax')],
    missing: o.missing ?? ['sıcaklık katsayısı', 'ısıl direnç', 'darbe dayanımı'],
    size: o.family === 'smd' ? { w: 1.4, d: 0.8, h: 0.3 } : { w: 2.4, d: 0.6, h: 0.6 },
    simModel: partial ? 'partial' : 'full',
    simNote: partial ? 'Sabit direnç olarak çözülür; sıcaklık/ışık bağımlılığı modellenmez.' : undefined,
    specs: { Direnç: `${o.r} Ω`, Tolerans: `±${o.tol} %`, Güç: `${o.pmax} W`, ...o.specs },
  };
}

export function capacitorPart(o: Common & { c: number; vmax: number; kind: 'ceramic' | 'electrolytic' | 'tantalum' | 'film' | 'supercap' }): ComponentDef {
  const polar = o.kind === 'electrolytic' || o.kind === 'tantalum' || o.kind === 'supercap';
  return {
    ...base(o, 'passive', 'C', 'capacitor', polar ? 'capacitor_el' : 'capacitor'),
    pins: [pin('1', polar ? '+' : '1', -0.5, 0), pin('2', polar ? '−' : '2', 0.5, 0)],
    params: [num('c', 'Kapasite', 'F', o.c, { min: 1e-15 }), num('vmax', 'Anma gerilimi', 'V', o.vmax, { min: 0.5 }), num('v0', 'Başlangıç gerilimi', 'V', 0), num('esr', 'ESR (seri direnç; 0 = ideal)', 'Ω', 0, { min: 0 })],
    ratings: [rating('Anma gerilimi', 'V', 'voltage', 'vmax')],
    missing: o.missing ?? ['ESR', 'sızıntı akımı', 'ripple akımı', 'ömür'],
    size: polar ? { w: 1.4, d: 1.4, h: 2 } : { w: 1.2, d: 0.4, h: 1.2 },
    simModel: 'partial', simNote: 'İdeal kapasite (ESR parametresi 0 = ideal; ESR artışı arızası genel/doğrulanmamış bir ESR kullanır); sızıntı, ripple/ömür modeli yok.' + (polar ? ' Ters polarite aşım uyarısı verir (yalnızca elektrolitik tip).' : ''),
    specs: { Kapasite: `${o.c} F`, 'Anma gerilimi': `${o.vmax} V`, Tip: o.kind, ...o.specs },
  };
}

export function inductorPart(o: Common & { l: number; imax: number }): ComponentDef {
  return {
    ...base(o, 'passive', 'L', 'inductor', 'inductor'),
    pins: two('1', '2', 1),
    params: [num('l', 'Endüktans', 'H', o.l, { min: 1e-12 }), num('imax', 'Maks. akım', 'A', o.imax, { min: 1e-3 }),
      // Isat is NOT invented for catalog parts: 0 = unknown (EKSİK), no saturation modelled
      num('isat', 'Doyma akımı Isat (0 = bilinmiyor/doymaz)', 'A', 0, { min: 0 }), num('droppct', 'Isat’taki L düşüşü', '%', 30, { min: 1, max: 90, si: false })],
    ratings: [rating('Maks. akım', 'A', 'current', 'imax')],
    missing: o.missing ?? ['DCR', 'doyma akımı (EKSİK)', 'SRF'],
    size: { w: 2, d: 1, h: 1 },
    simModel: 'partial', simNote: 'İdeal endüktans; DCR ve SRF yok. Doyma modeli Isat girilirse çalışır (katalogda Isat verisi yok, 0 = doymaz).',
    specs: { Endüktans: `${o.l} H`, 'Maks. akım': `${o.imax} A`, ...o.specs },
  };
}

export function potPart(o: Common & { r: number; pmax: number; trimmer?: boolean }): ComponentDef {
  return {
    ...base(o, 'passive', 'RV', 'pot', 'pot'),
    pins: [pin('A', 'A', -1, 0), pin('W', 'W', 0, 0), pin('B', 'B', 1, 0)],
    params: [num('r', 'Toplam direnç', 'Ω', o.r, { min: 1 }), num('pos', 'Konum (0..1)', '', 0.5, { min: 0, max: 1, si: false }), num('pmax', 'Anma gücü', 'W', o.pmax, { min: 0.01 })],
    ratings: [rating('Anma gücü', 'W', 'power', 'pmax')],
    missing: o.missing ?? ['log eğri', 'wiper direnci'],
    size: { w: 2.2, d: 1.8, h: 1.6 },
    simModel: 'partial', simNote: 'Lineer eğri; wiper direnci yok.',
    specs: { Direnç: `${o.r} Ω`, Güç: `${o.pmax} W`, ...o.specs },
  };
}

// ---------------------------------------------------------------- sources
export function batteryPart(o: Common & { v: number; ilimit: number }): ComponentDef {
  return {
    ...base(o, 'power', 'BT', 'vsource', 'dc_supply'),
    pins: [pin('P', '+', -0.5, 0), pin('N', '−', 0.5, 0)],
    params: [{ key: 'wave', label: 'Dalga', unit: '', type: 'select', default: 'dc', options: [{ value: 'dc', label: 'DC' }] }, num('v', 'Gerilim (nominal)', 'V', o.v), num('ilimit', 'Maks. sürekli akım (uyarı)', 'A', o.ilimit, { min: 1e-3 })],
    ratings: [rating('Maks. akım', 'A', 'current', 'ilimit')],
    missing: o.missing ?? ['iç direnç', 'deşarj eğrisi', 'kapasite (Ah)', 'kısa devre davranışı'],
    size: { w: 2, d: 1.2, h: 1.2 },
    simModel: 'partial', simNote: 'İdeal sabit gerilim kaynağı; iç direnç ve deşarj modeli yok. Gerçek pil kısa devresi çok tehlikelidir (Li-ion termal kaçak).',
    specs: { 'Nominal gerilim': `${o.v} V`, 'Maks. akım': `${o.ilimit} A`, ...o.specs },
  };
}

// ---------------------------------------------------------------- library-only parts (no solver model)
export interface ModuleOpts extends Common {
  category: Category;
  prefix: string;
  pins: PinDef[];
  w?: number; d?: number; h: number;
  color: string;
  kind?: 'ic' | 'board' | 'box' | 'cyl';
  simNote?: string;
}

/** Part with pinout and datasheet info but NO electrical model. The solver ignores it (open circuit) and says so. */
export function modulePart(o: ModuleOpts): ComponentDef {
  const size = sizeOf(o.pins, o.h, 0.6, 0.6);
  if (o.w) size.w = o.w;
  if (o.d) size.d = o.d;
  return {
    ...base(o, o.category, o.prefix, 'none'),
    pins: o.pins, params: [], ratings: [],
    missing: o.missing ?? ['elektriksel model', 'SPICE modeli', 'ısıl veri'],
    size,
    visual: { kind: o.kind ?? 'box', color: o.color, h: o.h },
    simModel: 'none', simNote: o.simNote ?? 'Elektriksel model yok: çözücü bu parçayı devreden bağımsız (açık devre) sayar ve uyarı verir.',
  };
}

export const icPart = (o: Omit<ModuleOpts, 'category' | 'prefix' | 'color' | 'h' | 'pins'> & { pins: string[]; wide?: boolean; category?: Category }): ComponentDef =>
  modulePart({ ...o, category: o.category ?? 'ic', prefix: 'U', pins: dipPins(o.pins, o.wide ? 4.5 : 3), h: 0.9, color: '#18181b', kind: 'ic' });

export const sipIcPart = (o: Omit<ModuleOpts, 'category' | 'prefix' | 'color' | 'h' | 'pins'> & { pins: string[]; category?: Category; h?: number }): ComponentDef =>
  modulePart({ ...o, category: o.category ?? 'ic', prefix: 'U', pins: sipPins(o.pins), h: o.h ?? 2, color: '#18181b', kind: 'box', specs: o.specs });

export const boardPart = (o: Omit<ModuleOpts, 'pins' | 'prefix' | 'kind' | 'h'> & { left: string[]; right: string[]; gap: number; color?: string }): ComponentDef =>
  modulePart({ ...o, prefix: 'U', pins: dualRowPins(o.left, o.right, o.gap), h: 0.6, color: o.color ?? '#0f766e', kind: 'board' });

export const moduleBoard = (o: Omit<ModuleOpts, 'pins' | 'kind'> & { labels: string[]; h?: number }): ComponentDef =>
  modulePart({ ...o, pins: rowPins(o.labels), h: o.h ?? 0.6, kind: 'board' });
