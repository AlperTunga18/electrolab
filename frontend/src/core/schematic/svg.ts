import type { Circuit, PlacedComponent } from '../circuit/types';
import { buildNets } from '../circuit/nets';
import { getDef, hasDef } from '../../library/components';
import { formatSI } from '../units';
import { autoLayout } from './layout';
import { routeAllWires } from './wiring';
import type { Layout } from './layout';
import { rotatePoint, symbolBounds, symbolFor } from './symbols';

export interface SvgOpts { layout?: Layout; showNets?: boolean; title?: string }

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const f = (n: number): string => String(Math.round(n * 100) / 100);

/** short value label, same keys as the lab labels */
function valueText(c: PlacedComponent): string {
  const def = getDef(c.type);
  const p = c.params;
  const num = (k: string): number | null => (typeof p[k] === 'number' ? (p[k] as number) : null);
  switch (def.model) {
    case 'resistor': case 'pot': { const v = num('r'); return v === null ? '' : formatSI(v, 'Ω'); }
    case 'capacitor': { const v = num('c'); return v === null ? '' : formatSI(v, 'F'); }
    case 'inductor': { const v = num('l'); return v === null ? '' : formatSI(v, 'H'); }
    case 'vsource': {
      const wave = String(p.wave ?? 'dc');
      if (wave !== 'dc') {
        const a = num('amp'), fr = num('freq');
        return [a === null ? '' : formatSI(a, 'V'), fr === null ? '' : formatSI(fr, 'Hz')].filter(Boolean).join(' ');
      }
      const v = num('v'); return v === null ? '' : formatSI(v, 'V');
    }
    case 'zener': { const v = num('vz'); return v === null ? (def.mpn ?? '') : formatSI(v, 'V'); }
    case 'isource': { const v = num('i'); return v === null ? '' : formatSI(v, 'A'); }
    case 'eload': { const v = num('i'); return v === null ? '' : formatSI(v, 'A'); }
    case 'switch': return p.closed ? 'kapalı' : 'açık';
    case 'diode': case 'led': case 'npn': case 'pnp': case 'nmos': case 'pmos': case 'bridge':
      return def.mpn ?? def.type;
    default: return '';
  }
}

/** standalone SVG of the schematic (white background, black lines) */
export function schematicSvg(circuit: Circuit, opts: SvgOpts = {}): string {
  const comps = circuit.components.filter((c) => hasDef(c.type));
  const sub: Circuit = { ...circuit, components: comps };
  const layout = opts.layout ?? autoLayout(sub);
  const { routes, dots } = routeAllWires(sub, layout);
  const title = opts.title ?? 'Devre şeması';
  const date = new Date().toISOString().slice(0, 10);

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const c of comps) {
    const l = layout[c.id]; if (!l) continue;
    const b = symbolBounds(symbolFor(getDef(c.type)), l.rot);
    grow(l.x + b.x0 - 20, l.y + b.y0 - 24); grow(l.x + b.x1 + 40, l.y + b.y1 + 24);
  }
  for (const r of routes) for (const p of r.pts) grow(p[0], p[1]);
  if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = 200; y1 = 100; }
  const M = 30;
  const TW = 220, TH = 54;
  x0 -= M; y0 -= M; x1 += M; y1 += M;
  // title block bottom right, below the content
  y1 += TH + 10;
  x1 = Math.max(x1, x0 + TW + 2 * M);
  const W = x1 - x0, H = y1 - y0;

  const o: string[] = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x0)} ${f(y0)} ${f(W)} ${f(H)}" width="${f(W)}" height="${f(H)}" font-family="Arial, Helvetica, sans-serif">`);
  o.push(`<rect x="${f(x0)}" y="${f(y0)}" width="${f(W)}" height="${f(H)}" fill="#ffffff"/>`);

  o.push('<g fill="none" stroke="#000000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">');
  for (const r of routes) o.push(`<polyline points="${r.pts.map((p) => `${f(p[0])},${f(p[1])}`).join(' ')}"/>`);
  o.push('</g>');
  for (const d of dots) o.push(`<circle cx="${f(d[0])}" cy="${f(d[1])}" r="3" fill="#000000"/>`);

  for (const c of comps) {
    const l = layout[c.id]; if (!l) continue;
    const def = getDef(c.type);
    const sym = symbolFor(def);
    o.push(`<g transform="translate(${f(l.x)} ${f(l.y)}) rotate(${l.rot * 90})" fill="none" stroke="#000000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">`);
    for (const s of sym.shapes) {
      if (s.t === 'path') o.push(`<path d="${esc(s.d)}"${s.fill ? ' fill="#000000"' : ''}/>`);
      else if (s.t === 'circle') o.push(`<circle cx="${f(s.cx)}" cy="${f(s.cy)}" r="${f(s.r)}"${s.fill ? ' fill="#000000"' : ''}/>`);
      else if (s.t === 'rect') o.push(`<rect x="${f(s.x)}" y="${f(s.y)}" width="${f(s.w)}" height="${f(s.h)}"/>`);
    }
    o.push('</g>');
    // texts stay upright: place them in world space
    const txt = (x: number, y: number, s: string, size: number, anchor?: string, weight?: string) => {
      const q = rotatePoint(x, y, l.rot);
      const a = anchor ?? (q.x > 5 ? 'start' : q.x < -5 ? 'end' : 'middle');
      o.push(`<text x="${f(l.x + q.x)}" y="${f(l.y + q.y)}" font-size="${size}" text-anchor="${a}" fill="#000000"${weight ? ` font-weight="${weight}"` : ''}>${esc(s)}</text>`);
    };
    for (const s of sym.shapes) if (s.t === 'text') {
      // inside-symbol text: keep the author's anchor only when unrotated
      txt(s.x, s.y, s.text, 9, l.rot === 0 ? (s.anchor ?? 'middle') : 'middle');
    }
    if (def.model !== 'ground') {
      txt(sym.ref.x, sym.ref.y, c.ref, 11, undefined, 'bold');
      const v = valueText(c);
      if (v) txt(sym.value.x, sym.value.y, v, 10);
    }
  }

  if (opts.showNets) {
    const nets = buildNets(sub);
    const done = new Set<number>();
    for (const w of circuit.wires) {
      const n = nets.pinNet.get(`${w.a.comp}:${w.a.pin}`);
      if (n === undefined || done.has(n)) continue;
      const r = routes.find((q) => q.wireId === w.id);
      if (!r) continue;
      done.add(n);
      let best = 0, bi = 0;
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const len = Math.abs(r.pts[i + 1][0] - r.pts[i][0]) + Math.abs(r.pts[i + 1][1] - r.pts[i][1]);
        if (len > best) { best = len; bi = i; }
      }
      const a = r.pts[bi], b = r.pts[bi + 1] ?? a;
      o.push(`<text x="${f((a[0] + b[0]) / 2)}" y="${f((a[1] + b[1]) / 2 - 3)}" font-size="8" text-anchor="middle" fill="#555555">${esc(nets.names[n] ?? `N${n}`)}</text>`);
    }
  }

  const tx = x1 - TW - 10, ty = y1 - TH - 10;
  o.push(`<rect x="${f(tx)}" y="${f(ty)}" width="${TW}" height="${TH}" fill="none" stroke="#000000" stroke-width="1"/>`);
  o.push(`<line x1="${f(tx)}" y1="${f(ty + 30)}" x2="${f(tx + TW)}" y2="${f(ty + 30)}" stroke="#000000" stroke-width="1"/>`);
  o.push(`<text x="${f(tx + 8)}" y="${f(ty + 20)}" font-size="14" font-weight="bold" fill="#000000">${esc(title)}</text>`);
  o.push(`<text x="${f(tx + 8)}" y="${f(ty + 46)}" font-size="10" fill="#000000">${esc(date)}</text>`);
  o.push(`<text x="${f(tx + TW - 8)}" y="${f(ty + 46)}" font-size="10" text-anchor="end" fill="#000000">ElektroLab</text>`);
  o.push('</svg>');
  return o.join('\n');
}
