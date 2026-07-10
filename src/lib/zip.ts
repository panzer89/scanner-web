// Crea un unico file .zip dai PDF selezionati (per scaricare/inviare più file insieme).
import JSZip from 'jszip';
import type { ScanDoc } from './types';

export async function zipDocs(docs: ScanDoc[]): Promise<Blob> {
  const zip = new JSZip();
  const used = new Set<string>();
  for (const d of docs) {
    const base = d.name?.trim() || 'documento';
    let fname = `${base}.pdf`;
    let i = 1;
    while (used.has(fname)) {
      fname = `${base} (${i++}).pdf`;
    }
    used.add(fname);
    zip.file(fname, d.pdf);
  }
  return zip.generateAsync({ type: 'blob' });
}
