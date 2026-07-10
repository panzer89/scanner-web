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
export async function shareBlob(filename: string, blob: Blob, mime: string): Promise<void> {
  const file = new File([blob], filename, { type: mime });

  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
  };

  if (nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      // se l'utente annulla o fallisce, ripieghiamo sul download
      if ((e as Error).name === 'AbortError') return;
    }
  }
  downloadBlob(blob, filename);
}

export function sharePdf(name: string, pdf: Blob): Promise<void> {
  return shareBlob(`${name || 'documento'}.pdf`, pdf, 'application/pdf');
}
