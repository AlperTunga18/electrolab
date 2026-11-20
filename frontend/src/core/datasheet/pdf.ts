/**
 * Extract plain text from a user-chosen local PDF (ArrayBuffer). pdfjs-dist is imported lazily so it
 * stays out of the main bundle; no network access is involved (the file never leaves the browser).
 */
export async function pdfToText(file: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(file) }).promise;
  const pages: string[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      // rebuild lines: break on end-of-line markers or a change of baseline
      let out = '';
      let lastY: number | null = null;
      for (const it of content.items) {
        if (!('str' in it)) continue;
        const y = it.transform[5] as number;
        if (lastY !== null && Math.abs(y - lastY) > 2) out += '\n';
        else if (out && !out.endsWith('\n') && !out.endsWith(' ')) out += ' ';
        out += it.str;
        if (it.hasEOL) out += '\n';
        lastY = y;
      }
      pages.push(out);
    }
  } finally {
    await doc.destroy();
  }
  return pages.join('\n');
}
