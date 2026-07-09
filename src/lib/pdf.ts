// Costruzione del PDF dalle pagine scansionate (jsPDF) e miniatura.
import { jsPDF } from 'jspdf';

function imgSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// Ogni pagina del PDF ha le stesse proporzioni dell'immagine scansionata.
export async function buildPdf(pages: string[]): Promise<Blob> {
  let doc: jsPDF | null = null;

  for (const url of pages) {
    const { w, h } = await imgSize(url);
    const orientation = w >= h ? 'landscape' : 'portrait';
    const format: [number, number] = [w, h];

    if (!doc) {
      doc = new jsPDF({ unit: 'px', format, orientation, compress: true });
    } else {
      doc.addPage(format, orientation);
    }
    // 'NONE' = nessuna ricompressione: mantiene la qualità dell'immagine
    doc.addImage(url, 'JPEG', 0, 0, w, h, undefined, 'NONE');
  }

  if (!doc) throw new Error('Nessuna pagina da salvare.');
  return doc.output('blob');
}

// Miniatura (prima pagina) per l'archivio.
export function makeThumb(dataUrl: string, maxW = 320): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('no ctx'));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
        'image/jpeg',
        0.7
      );
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
