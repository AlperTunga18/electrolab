import type { HeatsinkSize, PlacedComponent } from '../circuit/types';
import type { ComponentDef } from '../../library/types';

/**
 * Lumped thermal model per part:  Cth · dTj/dt = P − (Tj − Tamb) / Rθja,   Rθja = Rθjc + Rθcs + Rθsa(/fan).
 * Rθ and Cth are ESTIMATED from package class and rated power (the library has no per-part thermal data yet).
 * They are good for trends (heatsink/fan effect, order of magnitude) — NOT for qualifying a real design.
 */

export const HEATSINKS: Record<HeatsinkSize, { rsa: number; cth: number; label: string }> = {
  none: { rsa: 0, cth: 0, label: 'Yok' },
  small: { rsa: 22, cth: 3, label: 'Küçük klips (~22 K/W)' },
  medium: { rsa: 8, cth: 10, label: 'Orta (~8 K/W)' },
  large: { rsa: 3, cth: 40, label: 'Büyük (~3 K/W)' },
};
const R_CS = 0.5; // case-to-sink with paste, K/W
const FAN_FACTOR = 0.4; // forced air multiplies the convection resistance

export type PackageClass = 'to220' | 'to3' | 'to247' | 'to263' | 'to92' | 'sot23' | 'smd' | 'axial' | 'led' | 'dip' | 'box' | 'other';

export interface ThermalSpec {
  tjmax: number;
  rthJC: number;
  rthJAfree: number;
  cth: number;
  pkg: PackageClass;
  heatsinkable: boolean;
  basis: string;
}

export function packageClass(def: ComponentDef): PackageClass {
  const p = (def.package ?? '').toLowerCase();
  if (/to-?220/.test(p) || def.visual?.kind === 'to220') return 'to220';
  if (/to-?247/.test(p)) return 'to247';
  if (/to-?3\b|to-?3p?$/.test(p)) return 'to3';
  if (/to-?263|d2pak/.test(p)) return 'to263';
  if (/to-?92/.test(p)) return 'to92';
  if (/sot/.test(p) || def.visual?.kind === 'smd') return 'sot23';
  if (/\b(0402|0603|0805|1206|2010|2512)\b|smd|smb|sma|smc|do-214/.test(p)) return 'smd';
  if (/dip/.test(p)) return 'dip';
  if (def.model === 'led') return 'led';
  if (def.model === 'bridge') return 'box';
  if (def.model === 'nmos' || def.model === 'pmos') return 'to220';
  if (def.model === 'npn' || def.model === 'pnp') return 'to92';
  if (def.model === 'resistor' && def.size.h < 0.4) return 'smd';
  return 'axial';
}

const RTH_FREE: Record<PackageClass, number> = { to220: 62, to3: 35, to247: 40, to263: 50, to92: 200, sot23: 250, smd: 80, axial: 75, led: 300, dip: 80, box: 35, other: 100 };
const CTH: Record<PackageClass, number> = { to220: 1.0, to3: 5, to247: 2, to263: 0.8, to92: 0.08, sot23: 0.03, smd: 0.01, axial: 0.05, led: 0.02, dip: 0.05, box: 1.0, other: 0.1 };
const POWER_PKG = new Set<PackageClass>(['to220', 'to3', 'to247', 'to263']);

const numParam = (c: PlacedComponent, k: string): number | null => {
  const v = c.params[k];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
};

/** null = part is not thermally modelled (sources, capacitors, inductors, switches, library-only parts). */
export function thermalSpec(def: ComponentDef, comp: PlacedComponent): ThermalSpec | null {
  const pkg = packageClass(def);
  const pmax = numParam(comp, 'pmax');
  const isTvs = def.simNote?.includes('TVS') ?? false;
  switch (def.model) {
    case 'resistor': case 'pot': {
      const tj = def.model === 'pot' ? 120 : 155;
      const r = pmax ? (tj - 25) / pmax : RTH_FREE[pkg];
      return { tjmax: tj, rthJC: r * 0.3, rthJAfree: r, cth: pmax && pmax >= 5 ? 1.5 : CTH[pkg], pkg, heatsinkable: false, basis: pmax ? `Rθ = (Tmax−25)/Pnom = ${r.toFixed(0)} K/W` : 'paket sınıfı tahmini' };
    }
    case 'zener': case 'diode': case 'bridge': {
      const r = def.model === 'zener' && !isTvs && pmax ? (150 - 25) / pmax : RTH_FREE[pkg];
      return { tjmax: 150, rthJC: r * 0.3, rthJAfree: r, cth: CTH[pkg], pkg, heatsinkable: false, basis: 'paket sınıfı / anma gücü tahmini' };
    }
    case 'led': return { tjmax: 100, rthJC: 90, rthJAfree: RTH_FREE.led, cth: CTH.led, pkg, heatsinkable: false, basis: 'tipik 5 mm LED tahmini' };
    case 'npn': case 'pnp': {
      if (POWER_PKG.has(pkg)) {
        const jc = pmax ? (150 - 25) / pmax : 1.5;
        return { tjmax: 150, rthJC: jc, rthJAfree: RTH_FREE[pkg], cth: CTH[pkg], pkg, heatsinkable: true, basis: pmax ? `Rθjc = (150−25)/Ptot = ${jc.toFixed(2)} K/W` : 'paket sınıfı tahmini' };
      }
      const r = pmax ? (150 - 25) / pmax : RTH_FREE[pkg];
      return { tjmax: 150, rthJC: r * 0.3, rthJAfree: r, cth: CTH[pkg], pkg, heatsinkable: false, basis: 'Rθ = (150−25)/Ptot' };
    }
    case 'nmos': case 'pmos': {
      const power = POWER_PKG.has(pkg);
      return { tjmax: power ? 175 : 150, rthJC: power ? 1.4 : 75, rthJAfree: RTH_FREE[pkg], cth: CTH[pkg], pkg, heatsinkable: power, basis: 'paket sınıfı tahmini (Rθjc≈1.4 K/W TO-220)' };
    }
    case 'motor': {
      const imax = numParam(comp, 'imax') ?? 0.5, r = numParam(comp, 'r') ?? 3;
      const prated = imax * imax * r;
      return { tjmax: 130, rthJC: (130 - 25) / prated * 0.3, rthJAfree: (130 - 25) / prated, cth: 15, pkg: 'other', heatsinkable: false, basis: 'sargı ısınması: Rθ = (130−25)/(Isürekli²·R) (tahmini)' };
    }
    default: return null;
  }
}

export function effectiveRth(spec: ThermalSpec, comp: PlacedComponent): { rth: number; cth: number } {
  const th = comp.thermal;
  if (!spec.heatsinkable || !th) {
    const fan = th?.fan ? FAN_FACTOR : 1;
    return { rth: spec.rthJAfree * fan, cth: spec.cth };
  }
  const hs = HEATSINKS[th.heatsink];
  if (th.heatsink === 'none') return { rth: spec.rthJAfree * (th.fan ? FAN_FACTOR : 1), cth: spec.cth };
  const rsa = hs.rsa * (th.fan ? FAN_FACTOR : 1);
  return { rth: spec.rthJC + R_CS + rsa, cth: spec.cth + hs.cth };
}

/** Exact solution of the first-order thermal RC for constant power over dt. */
export function stepThermal(T: number, P: number, Tamb: number, rth: number, cth: number, dt: number): number {
  const tInf = Tamb + P * rth;
  return tInf + (T - tInf) * Math.exp(-dt / (rth * cth));
}

export const steadyT = (P: number, Tamb: number, rth: number): number => Tamb + P * rth;

/** 0 = ambient, 1 = junction limit. */
export const thermalFraction = (T: number, Tamb: number, tjmax: number): number => (T - Tamb) / Math.max(tjmax - Tamb, 1);

export type ThermalClass = 'cold' | 'normal' | 'high' | 'critical' | 'damage';
export function thermalClass(T: number, Tamb: number, tjmax: number): ThermalClass {
  if (T >= tjmax) return 'damage';
  const f = thermalFraction(T, Tamb, tjmax);
  if (T - Tamb < 5) return 'cold';
  if (f < 0.5) return 'normal';
  if (f < 0.85) return 'high';
  return 'critical';
}

export const CLASS_LABEL: Record<ThermalClass, string> = { cold: 'Soğuk', normal: 'Normal', high: 'Yüksek', critical: 'Kritik', damage: 'Termal hasar' };

/** blue → cyan → green → yellow → red → white. */
export function thermalColor(T: number, Tamb: number, tjmax: number): string {
  if (T >= tjmax) return '#ffffff';
  const f = Math.min(Math.max(thermalFraction(T, Tamb, tjmax), 0), 1);
  const stops: [number, [number, number, number]][] = [[0, [59, 130, 246]], [0.25, [34, 211, 238]], [0.45, [34, 197, 94]], [0.65, [234, 179, 8]], [0.9, [239, 68, 68]], [1, [255, 120, 120]]];
  for (let i = 1; i < stops.length; i++) {
    if (f <= stops[i][0]) {
      const [f0, c0] = stops[i - 1], [f1, c1] = stops[i];
      const u = (f - f0) / (f1 - f0);
      const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * u));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return '#ef4444';
}

/** Rough time (in real thermal seconds) until Tj reaches the limit at constant power, as a wide range (model is approximate). */
export function etaToLimit(T: number, P: number, Tamb: number, rth: number, cth: number, tjmax: number): { low: number; high: number } | null {
  const tInf = Tamb + P * rth;
  if (T >= tjmax) return { low: 0, high: 0 };
  if (tInf <= tjmax) return null;
  const t = rth * cth * Math.log((tInf - T) / (tInf - tjmax));
  return { low: t * 0.5, high: t * 2 };
}
