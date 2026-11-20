import type { PlacedComponent } from '../circuit/types';
import { alignComponents, distributeComponents, marqueeSelect, type AlignMode } from '../circuit/selection';
import type { Layout, SchRot } from './layout';
import { rotatePoint } from './symbols';

/** Group operations on schematic positions (px, Y down). Each returns a layout PATCH containing only the touched ids. */
const GRID = 10;
const snap = (v: number) => Math.round(v / GRID) * GRID;

export function translateSch(layout: Layout, ids: string[], dx: number, dy: number): Layout {
  const out: Layout = {};
  for (const id of ids) { const l = layout[id]; if (l) out[id] = { ...l, x: l.x + dx, y: l.y + dy }; }
  return out;
}

/** rigid clockwise quarter turn about the (grid-snapped) centre of the group's bounding box; each part rot+1 */
export function rotateSchGroup(layout: Layout, ids: string[]): Layout {
  const g = ids.filter((id) => layout[id]);
  if (!g.length) return {};
  const xs = g.map((id) => layout[id].x), ys = g.map((id) => layout[id].y);
  const cx = snap((Math.min(...xs) + Math.max(...xs)) / 2), cy = snap((Math.min(...ys) + Math.max(...ys)) / 2);
  const out: Layout = {};
  for (const id of g) {
    const l = layout[id];
    const r = rotatePoint(l.x - cx, l.y - cy, 1);
    out[id] = { x: cx + r.x, y: cy + r.y, rot: ((l.rot + 1) & 3) as SchRot };
  }
  return out;
}

// align/distribute reuse the 3D helpers by mapping schematic (x, y) to board (x, z); 'top' = smallest y, as on screen
const asComps = (layout: Layout, ids: string[]): PlacedComponent[] =>
  ids.filter((id) => layout[id]).map((id) => ({ id, type: '', ref: id, x: layout[id].x, z: layout[id].y, rot: 0, params: {} }));
const back = (layout: Layout, comps: PlacedComponent[]): Layout => {
  const out: Layout = {};
  for (const c of comps) { const l = layout[c.id]; if (l && (l.x !== c.x || l.y !== c.z)) out[c.id] = { ...l, x: c.x, y: c.z }; }
  return out;
};

export function alignSch(layout: Layout, ids: string[], mode: AlignMode): Layout {
  const cs = asComps(layout, ids);
  return back(layout, alignComponents(cs, cs.map((c) => c.id), mode, GRID));
}

export function distributeSch(layout: Layout, ids: string[], axis: 'x' | 'y'): Layout {
  const cs = asComps(layout, ids);
  return back(layout, distributeComponents(cs, cs.map((c) => c.id), axis === 'x' ? 'x' : 'z', GRID));
}

/** parts whose schematic position lies inside the (any-corner-order) rectangle */
export function marqueeSch(layout: Layout, a: { x: number; y: number }, b: { x: number; y: number }): string[] {
  return marqueeSelect(Object.entries(layout).map(([id, l]) => ({ id, x: l.x, z: l.y })), { x: a.x, z: a.y }, { x: b.x, z: b.y });
}
