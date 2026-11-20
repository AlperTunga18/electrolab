import type { Wire } from './types';

/**
 * Drop T-junction wires whose host wire no longer exists (repeated, because a tap can host another tap).
 * Removing a host wire removes everything that was branched off it.
 */
export function pruneTaps(wires: Wire[]): Wire[] {
  let cur = wires;
  for (;;) {
    const ids = new Set(cur.map((w) => w.id));
    const next = cur.filter((w) => !w.tap || ids.has(w.tap.wire));
    if (next.length === cur.length) return cur;
    cur = next;
  }
}
