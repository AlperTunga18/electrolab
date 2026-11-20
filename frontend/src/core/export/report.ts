import { jsPDF } from 'jspdf';
import type { Circuit } from '../circuit/types';
import { buildNets } from '../circuit/nets';
import { getDef } from '../../library/components';
import { solveDCOnce, SimError, type CompResult } from '../sim/mna';
import { formatSI } from '../units';
import { partValue } from './kicad';

export interface ReportOptions {
  title: string;
  /** PNG data URL of the schematic */
  schematicPng?: string;
  /** PNG data URL of the PCB view */
  pcbPng?: string;
  drcLines?: string[];
  ercLines?: string[];
  date?: Date;
}

/**
 * jsPDF's built-in fonts (WinAnsi) lack Turkish glyphs (s-cedilla, g-breve, dotless i, dotted I) and Greek letters, so every
 * string written to the PDF is transliterated to plain ASCII-ish text first.
 */
export function asciiTr(s: string): string {
  const map: Record<string, string> = {
    'ş': 's', 'Ş': 'S', 'ğ': 'g', 'Ğ': 'G', 'ı': 'i', 'İ': 'I', 'ö': 'o', 'Ö': 'O', 'ü': 'u', 'Ü': 'U', 'ç': 'c', 'Ç': 'C',
    'Ω': 'ohm', 'Ω': 'ohm', 'µ': 'u', 'μ': 'u', '−': '-', '–': '-', '—': '-', '’': "'", '“': '"', '”': '"', '→': '->', '≈': '~',
  };
  return s.replace(/[^\x00-\x7F°]/g, (ch) => map[ch] ?? '?');
}

const SOURCES = new Set(['vsource', 'isource']);

export function buildReportPdf(circuit: Circuit, opts: ReportOptions): Uint8Array {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const PW = 210, PH = 297, M = 15, CW = PW - 2 * M;
  let y = M;

  const ensure = (h: number): void => {
    if (y + h > PH - M) { doc.addPage(); y = M; }
  };
  const text = (s: string, x: number, size = 9, bold = false): void => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.text(asciiTr(s), x, y);
  };
  const para = (s: string, size = 9, bold = false): void => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(asciiTr(s), CW) as string[];
    for (const l of lines) { ensure(size * 0.5); doc.text(l, M, y); y += size * 0.45 + 0.8; }
  };
  const heading = (s: string): void => {
    ensure(14);
    y += 4;
    text(s, M, 13, true);
    y += 2;
    doc.setDrawColor(150); doc.line(M, y, PW - M, y);
    y += 6;
  };
  const table = (head: string[], widths: number[], rows: string[][]): void => {
    const lh = 4.6;
    const rowOut = (cells: string[], bold: boolean): void => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(8.5);
      const wrapped = cells.map((c, i) => doc.splitTextToSize(asciiTr(c), widths[i] - 2) as string[]);
      const h = Math.max(...wrapped.map((w) => w.length)) * lh;
      ensure(h + 1);
      let x = M;
      wrapped.forEach((w, i) => { doc.text(w, x + 1, y); x += widths[i]; });
      y += h;
      doc.setDrawColor(210); doc.line(M, y - lh + 1.5, PW - M, y - lh + 1.5);
    };
    rowOut(head, true);
    for (const r of rows) rowOut(r, false);
    y += 2;
  };
  const image = (png: string, label: string): void => {
    try {
      const props = doc.getImageProperties(png);
      const h = Math.min(CW * props.height / props.width, PH - 2 * M - 12);
      const w = h * props.width / props.height;
      ensure(h + 10);
      text(label, M, 10, true); y += 3;
      doc.addImage(png, 'PNG', M, y, w, h);
      y += h + 4;
    } catch {
      para(`${label}: gorsel eklenemedi.`);
    }
  };

  // --- title block
  text(opts.title || 'Devre raporu', M, 20, true); y += 9;
  text('ElectroLab 3D', M, 12); y += 6;
  text((opts.date ?? new Date()).toISOString().slice(0, 16).replace('T', ' '), M, 9); y += 6;
  para('Uyari: Bu rapor sanal bir simulasyonun ciktisidir. Gercek devre, guvenlik veya uretim dogrulamasi yerine gecmez; ' +
    'degerler genel modellere dayanir, gercek bilesenlerle birebir ayni olmayabilir. Yuksek gerilim ve akimla calismadan once ' +
    'her zaman veri sayfalarini ve guvenlik kurallarini kontrol edin.');
  y += 2;

  if (opts.schematicPng) { heading('Sematik'); image(opts.schematicPng, 'Sematik'); }
  if (opts.pcbPng) { heading('PCB'); image(opts.pcbPng, 'PCB'); }

  const parts = [...circuit.components]
    .filter((c) => getDef(c.type).model !== 'ground')
    .sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));

  // --- BOM
  heading('Malzeme listesi (BOM)');
  table(['Ref', 'Tur', 'Deger', 'Uretici/MPN'], [18, 55, 55, 52], parts.map((c) => {
    const def = getDef(c.type);
    const mpn = [def.manufacturer, def.mpn].filter(Boolean).join(' ');
    return [c.ref, def.name, partValue(c), mpn || 'EKSİK'];
  }));

  // --- nets
  const nets = buildNets(circuit);
  heading('Baglantilar (net)');
  const pinsByNet = new Map<number, string[]>();
  for (const c of parts) for (const p of getDef(c.type).pins) {
    const n = nets.pinNet.get(`${c.id}:${p.id}`);
    if (n !== undefined) (pinsByNet.get(n) ?? pinsByNet.set(n, []).get(n)!).push(`${c.ref}.${p.id}`);
  }
  table(['Net', 'Pinler'], [30, 150], [...pinsByNet.entries()].sort((a, b) => a[0] - b[0]).map(([n, l]) => [nets.names[n], l.join(', ')]));

  // --- DC
  heading('DC calisma noktasi');
  let results: Record<string, CompResult> | null = null;
  try {
    const sol = solveDCOnce(circuit);
    results = sol.results;
    table(['Net', 'Gerilim'], [30, 150], sol.sim.netVoltages().map((v, i) => [nets.names[i], formatSI(v, 'V')]));
    table(['Ref', 'V', 'I', 'P (emilen)'], [30, 50, 50, 50], parts.filter((c) => results![c.id]).map((c) => {
      const r = results![c.id];
      return [c.ref, formatSI(r.v, 'V'), formatSI(r.i, 'A'), formatSI(r.p, 'W')];
    }));
  } catch (e) {
    para(e instanceof SimError || e instanceof Error ? `Simulasyon hatasi: ${e.message}` : 'Simulasyon hatasi.');
  }

  // --- ERC / DRC
  heading('ERC');
  if (opts.ercLines?.length) for (const l of opts.ercLines) para('- ' + l); else para('Kayit yok.');
  heading('DRC');
  if (opts.drcLines?.length) for (const l of opts.drcLines) para('- ' + l); else para('Kayit yok.');

  // --- totals
  heading('Guc ve akim ozeti');
  if (results) {
    let pAbs = 0, iSrc = 0, pSrc = 0;
    for (const c of parts) {
      const r = results[c.id];
      if (!r) continue;
      if (SOURCES.has(getDef(c.type).model)) {
        if (r.p < 0) { iSrc += Math.abs(r.i); pSrc += -r.p; }
      } else if (r.p > 0) pAbs += r.p;
    }
    para(`Kaynak olmayan parcalarin toplam sogurdugu guc: ${formatSI(pAbs, 'W')}`);
    para(`Kaynaklarin verdigi toplam guc: ${formatSI(pSrc, 'W')}`);
    para(`Kaynak akimi toplami: ${formatSI(iSrc, 'A')}`);
  } else para('DC cozum yok, toplamlar hesaplanamadi.');

  // --- page numbers
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(`${i} / ${total}`, PW / 2, PH - 7, { align: 'center' });
  }
  return new Uint8Array(doc.output('arraybuffer'));
}
