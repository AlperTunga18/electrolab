import type { PlacedComponent } from '../circuit/types';

/** A worked calculation: formulas, steps with the actual numbers, result and the references it relies on. */
export interface Calc {
  title: string;
  steps: string[];
  result: string;
  sources: string[];
  values?: Record<string, number>;
}

export interface Finding {
  id: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  fix?: string;
  comps: string[];
}

export type Block =
  | { t: 'p'; text: string }
  | { t: 'warn'; text: string }
  | { t: 'list'; items: string[] }
  | { t: 'calc'; calc: Calc }
  | { t: 'finding'; f: Finding }
  | { t: 'code'; code: string; comp?: string }
  | { t: 'table'; head: string[]; rows: string[][] };

export interface Answer {
  intent: string;
  title: string;
  blocks: Block[];
  /** de-duplicated references (formulas, standards, simulator results) */
  sources: string[];
}

export const refOf = (c: PlacedComponent | undefined): string => c?.ref ?? '?';

export const SRC = {
  ohm: 'Ohm kanunu: V = I·R',
  kcl: 'Kirchhoff akım yasası (KCL)',
  kvl: 'Kirchhoff gerilim yasası (KVL)',
  power: 'Güç: P = V·I = I²·R',
  sim: 'ElectroLab DC çözücüsü (MNA, genel modeller)',
  thermal: 'Isıl model: Tj = Tamb + P·Rθ (Rθ paket sınıfından tahmin)',
  ipc2221: 'IPC-2221 (iz akım taşıma ve boşluk)',
  ripple: 'Filtre kondansatörü: C ≈ I / (f_ripple · ΔV)',
  wire: 'Bakır özdirenç ρ = 0.0172 Ω·mm²/m; akım yoğunluğu kuralı (iç kablolama için tipik 3–6 A/mm²)',
  e24: 'E24 standart direnç serisi',
  library: 'ElectroLab kütüphanesi (elle girilmiş tipik değerler, datasheet ile doğrulanmamış)',
};
