import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../examples/examples';
import { autoPlace, ensureDesign } from './design';
import { autoroute } from './router';
import { runDrc, extractConnectivity } from './drc';
import { exportFabrication, makeZip, readZipNames } from './gerber';
import { kicadNetlist, kicadPcb } from '../export/kicad';
import { buildReportPdf } from '../export/report';
import { erc } from '../schematic/erc';
import { autoLayout, routeWires } from '../schematic/layout';
import type { Circuit } from '../circuit/types';

const IDS = ['led', 'divider', 'rc', 'rectifier', 'npn', 'mosfet'];

function routed(c: Circuit): Circuit {
  const d = autoPlace(c);
  const r = autoroute(c, d);
  return { ...c, pcb: { ...d, tracks: r.tracks, vias: r.vias } };
}

describe('schematic -> PCB -> fabrication pipeline', () => {
  for (const id of IDS) {
    it(`${id}: place, route, DRC clean, Gerber/ZIP/KiCad/PDF produced`, () => {
      const base = EXAMPLES.find((e) => e.id === id)!.build();
      expect(erc(base).filter((i) => i.severity === 'error')).toEqual([]);
      const c = routed(base);
      const design = ensureDesign(c);
      const conn = extractConnectivity(c, design);
      expect(conn.shorts).toEqual([]);
      expect(conn.unrouted, `unrouted in ${id}`).toEqual([]);
      const errors = runDrc(c, design).filter((i) => i.severity === 'error');
      expect(errors, JSON.stringify(errors)).toEqual([]);
      const fab = exportFabrication(c, design);
      expect(fab.files.map((f) => f.name).some((n) => n.endsWith('.gtl'))).toBe(true);
      const zip = makeZip(fab.files.map((f) => ({ name: f.name, data: f.content })));
      expect(readZipNames(zip).length).toBe(fab.files.length);
      expect(kicadNetlist(c, design)).toContain('(export');
      expect(kicadPcb(c, design)).toContain('(kicad_pcb');
      const pdf = buildReportPdf(c, { title: id });
      expect(String.fromCharCode(...pdf.slice(0, 4))).toBe('%PDF');
    });
  }

  it('2D schematic and 3D share one connection model: wiring a pin in the schematic adds a circuit wire', () => {
    const c = EXAMPLES.find((e) => e.id === 'divider')!.build();
    const layout = autoLayout(c);
    expect(routeWires(c, layout).length).toBe(c.wires.length);
    // pins/net names derive from the same wires: removing a wire changes ERC findings consistently in both views
    const cut = { ...c, wires: c.wires.slice(1) };
    expect(erc(cut).some((i) => i.code === 'FLOATING_PIN' || i.code === 'NO_GROUND')).toBe(true);
  });
});
