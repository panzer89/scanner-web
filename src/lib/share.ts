// Condivisione e download del PDF.

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// Usa la condivisione nativa del telefono (foglio di condivisione) se disponibile,
// altrimenti scarica il file.
export async function sharePdf(name: string, pdf: Blob): Promise<void> {
  const filename = `${name || 'documento'}.pdf`;
  const file = new File([pdf], filename, { type: 'application/pdf' });

  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
  };

  if (nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      // se l'utente annulla o fallisce, ripieghiamo sul download
      if ((e as Error).name === 'AbortError') return;
    }
  }
  downloadBlob(pdf, filename);
}
