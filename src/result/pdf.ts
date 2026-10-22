import { jsPDF } from 'jspdf';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import 'svg2pdf.js';

const A4_MM = { w: 210, h: 297 };

export async function scorePdf(musicXml: string): Promise<Blob> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1100px;background:#fff;';
  document.body.append(host);
  try {
    const osmd = new OpenSheetMusicDisplay(host, {
      backend: 'svg',
      autoResize: false,
      pageFormat: 'A4_P',
      pageBackgroundColor: '#FFFFFF',
      drawTitle: true,
      drawComposer: true,
      drawPartNames: false,
      disableCursor: true,
    });
    await osmd.load(musicXml);
    osmd.render();
    const pages = [...host.querySelectorAll('svg')];
    if (pages.length === 0) throw new Error('OSMD rendered no pages');
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    for (const [i, svg] of pages.entries()) {
      normalizeText(svg);
      if (i > 0) pdf.addPage('a4', 'portrait');
      await pdf.svg(svg, { x: 0, y: 0, width: A4_MM.w, height: A4_MM.h });
    }
    return pdf.output('blob');
  } finally {
    host.remove();
  }
}

// svg2pdf drops OSMD's tempo text, the only one set as font-size "14pt" in font-family "times".
function normalizeText(svg: SVGSVGElement): void {
  for (const text of svg.querySelectorAll('text')) {
    const size = text.getAttribute('font-size');
    if (size?.endsWith('pt')) text.setAttribute('font-size', `${(parseFloat(size) * 4) / 3}px`);
    if (text.getAttribute('font-family') === 'times') text.setAttribute('font-family', 'Times New Roman');
  }
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'score';
}
