import { getDef } from '../../library/components';
import type { ComponentDef } from '../../library/types';
import type { SpiceKind, SpiceModel } from './parse';

const BASE: Record<SpiceKind, string> = { D: 'diode', NPN: 'npn', PNP: 'pnp', NMOS: 'nmos_std', PMOS: 'pmos' };

/** User part from a parsed .MODEL card. Not verified; params outside the mapped set keep the base defaults. */
export function buildUserPart(m: SpiceModel, opts: { wOverL?: number; now?: number } = {}): ComponentDef {
  const base = getDef(BASE[m.kind]);
  const mapped = { ...m.mapped };
  if (m.kind === 'NMOS' || m.kind === 'PMOS') {
    const wl = opts.wOverL && opts.wOverL > 0 ? opts.wOverL : 1;
    if ('k' in mapped) mapped.k *= wl;
  }
  const params = base.params.map((p) => (p.key in mapped ? { ...p, default: mapped[p.key] } : p));
  const ignoredTxt = m.ignored.length ? `Yok sayılan: ${m.ignored.map((i) => i.name).join(', ')}` : 'Yok sayılan parametre yok';
  return {
    ...base,
    type: `user_spice_${m.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${(opts.now ?? Date.now()).toString(36)}`,
    name: m.name, nameEn: m.name, mpn: m.name, manufacturer: undefined, datasheetUrl: undefined,
    params, userMade: true, dataSource: 'generic-model', verified: false, tags: ['kullanıcı', 'spice'],
    description: `SPICE içe aktarma (.MODEL ${m.name} ${m.kind}). Doğrulanmadı.`,
    specs: { Kaynak: 'SPICE içe aktarma', 'Eşlenen': Object.keys(mapped).join(', ') || '—', 'Yok sayılan': String(m.ignored.length) },
    missing: ['kullanıcı tarafından içe aktarıldı — doğrulanmadı', ignoredTxt],
    simNote: `SPICE içe aktarma: yalnızca simülatörün kullandığı parametreler eşlendi (${Object.keys(mapped).join(', ') || 'yok'}). ${ignoredTxt}.`,
    visual: { ...(base.visual ?? {}), like: base.visual?.like ?? base.type },
  };
}
