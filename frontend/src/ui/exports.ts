import type { Circuit } from '../core/circuit/types';
import { schematicSvg } from '../core/schematic/svg';
import { erc } from '../core/schematic/erc';
import { runDrc } from '../core/pcb/drc';
import { ensureDesign } from '../core/pcb/design';
import { buildReportPdf } from '../core/export/report';
import { exportFabrication, bomForFab, makeZip, pickAndPlaceCsv } from '../core/pcb/gerber';
import { kicadNetlist, kicadPcb, kicadProject } from '../core/export/kicad';
import { download } from '../store/persist';

export function downloadBytes(name: string, bytes: Uint8Array, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** SVG string -> PNG data URL (for the PDF report) */
export function svgToPng(svg: string, scale = 2): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = (img.naturalWidth || 800) * scale; c.height = (img.naturalHeight || 600) * scale;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG görüntüye çevrilemedi')); };
    img.src = url;
  });
}

export const downloadSchematicSvg = (circuit: Circuit, title: string): void => download(`${title}-sema.svg`, schematicSvg(circuit, { title, showNets: true }), 'image/svg+xml');

export async function downloadReportPdf(circuit: Circuit, title: string): Promise<void> {
  let schematicPng: string | undefined;
  try { schematicPng = await svgToPng(schematicSvg(circuit, { title })); } catch { /* report works without the image */ }
  const ercLines = erc(circuit).map((i) => `[${i.severity}] ${i.message}`);
  const drcLines = circuit.pcb ? runDrc(circuit, ensureDesign(circuit)).map((i) => `[${i.severity}] ${i.code}: ${i.message}`) : undefined;
  downloadBytes(`${title}-rapor.pdf`, buildReportPdf(circuit, { title, schematicPng, ercLines, drcLines }), 'application/pdf');
}

export function downloadFabrication(circuit: Circuit, title: string): string[] {
  const design = ensureDesign(circuit);
  const fab = exportFabrication(circuit, design, { name: title.replace(/[^A-Za-z0-9_-]+/g, '_') || 'electrolab' });
  const files = [
    ...fab.files,
    { name: `${title}-pick-and-place.csv`, content: pickAndPlaceCsv(circuit, design) },
    { name: `${title}-BOM.csv`, content: bomForFab(circuit) },
  ];
  downloadBytes(`${title}-uretim.zip`, makeZip(files.map((f) => ({ name: f.name, data: f.content }))), 'application/zip');
  return fab.warnings;
}

export function downloadKicad(circuit: Circuit, title: string): void {
  const design = ensureDesign(circuit);
  download(`${title}.net`, kicadNetlist(circuit, design), 'text/plain');
  download(`${title}.kicad_pcb`, kicadPcb(circuit, design), 'text/plain');
  download(`${title}.kicad_pro`, kicadProject(circuit, design), 'application/json');
}
