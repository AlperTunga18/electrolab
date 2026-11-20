import { COMPONENTS } from './components';
import type { Category, ComponentDef } from './types';

export type SimFilter = 'all' | 'full' | 'partial' | 'none';

export const simOf = (c: ComponentDef): 'full' | 'partial' | 'none' => c.simModel ?? 'full';

const haystack = (c: ComponentDef): string =>
  [c.name, c.nameEn, c.type, c.mpn, c.manufacturer, c.package, c.category, c.description, ...(c.tags ?? []), ...Object.values(c.specs ?? {})]
    .filter(Boolean).join(' ').toLowerCase();

/** All whitespace-separated tokens must occur somewhere in the part's text. */
export function searchParts(q: string, cat: Category | 'all' = 'all', sim: SimFilter = 'all'): ComponentDef[] {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  return COMPONENTS.filter((c) => (cat === 'all' || c.category === cat) && (sim === 'all' || simOf(c) === sim) && tokens.every((t) => haystack(c).includes(t)));
}

export const categoriesInUse = (): Category[] => Array.from(new Set(COMPONENTS.map((c) => c.category)));
