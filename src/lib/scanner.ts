// Motore di scansione: usa OpenCV (globale `cv`) e jscanify (globale `jscanify`),
// caricati via <script> in index.html. Fa rilevamento del foglio,
// raddrizzamento (correzione prospettica) e filtri "documento".
import type { Filter } from './types';

// I due motori sono globali sul window.
declare global {
  interface Window {
    cv: any;
    jscanify: any;
  }
}

export type Point = { x: number; y: number };
export type Corners = {
  topLeftCorner: Point;
  topRightCorner: Point;
  bottomRightCorner: Point;
  bottomLeftCorner: Point;
};

let scanner: any = null;
let readyPromise: Promise<void> | null = null;

// Aspetta che OpenCV abbia finito di inizializzarsi (il WASM è asincrono).
export function loadScanner(): Promise<void> {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const cv = window.cv;
      if (cv && cv.Mat && window.jscanify) {
        scanner = new window.jscanify();
        resolve();
        return;
      }
      // OpenCV a volte espone onRuntimeInitialized: lo agganciamo se c'è
      if (cv && typeof cv.then !== 'function' && cv.Mat === undefined && 'onRuntimeInitialized' in cv) {
        cv.onRuntimeInitialized = () => {
          if (window.jscanify) scanner = new window.jscanify();
          resolve();
        };
        return;
      }
      if (Date.now() - start > 30000) {
        reject(new Error('OpenCV non si è caricato in tempo.'));
        return;
      }
      setTimeout(check, 60);
    };
    check();
  });
  return readyPromise;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Riduce una canvas mantenendo le proporzioni (per un rilevamento più rapido/robusto).
function downscale(source: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(source.width * scale);
  c.height = Math.round(source.height * scale);
  c.getContext('2d')!.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

// Rileva automaticamente i 4 angoli del foglio in una canvas.
// Il rilevamento gira su una copia ridotta (più affidabile), poi riporta
// gli angoli alle coordinate-pixel dell'immagine originale. Ritorna null se fallisce.
export function detectCorners(source: HTMLCanvasElement): Corners | null {
  const cv = window.cv;
  if (!cv || !scanner) return null;

  const maxDim = 1200;
  const scale = Math.min(1, maxDim / Math.max(source.width, source.height));
  const work = scale < 1 ? downscale(source, scale) : source;
  const inv = 1 / scale;

  let mat: any = null;
  let contour: any = null;
  try {
    mat = cv.imread(work);
    contour = scanner.findPaperContour(mat);
    if (!contour) return null;
    const c = scanner.getCornerPoints(contour);
    if (!c || !c.topLeftCorner) return null;
    // Scarta rilevamenti degeneri (foglio troppo piccolo)
    const area =
      dist(c.topLeftCorner, c.topRightCorner) *
      dist(c.topLeftCorner, c.bottomLeftCorner);
    if (area < work.width * work.height * 0.05) return null;
    // Riporta gli angoli alla scala originale
    return {
      topLeftCorner: { x: c.topLeftCorner.x * inv, y: c.topLeftCorner.y * inv },
      topRightCorner: { x: c.topRightCorner.x * inv, y: c.topRightCorner.y * inv },
      bottomRightCorner: { x: c.bottomRightCorner.x * inv, y: c.bottomRightCorner.y * inv },
      bottomLeftCorner: { x: c.bottomLeftCorner.x * inv, y: c.bottomLeftCorner.y * inv },
    };
  } catch {
    return null;
  } finally {
    if (contour && typeof contour.delete === 'function') {
      try { contour.delete(); } catch { /* ignore */ }
    }
    if (mat) mat.delete();
  }
}

// Angoli di default: leggero margine interno all'immagine (se il rilevamento fallisce).
export function defaultCorners(w: number, h: number): Corners {
  const mx = w * 0.08;
  const my = h * 0.08;
  return {
    topLeftCorner: { x: mx, y: my },
    topRightCorner: { x: w - mx, y: my },
    bottomRightCorner: { x: w - mx, y: h - my },
    bottomLeftCorner: { x: mx, y: h - my },
  };
}

// Ritaglia e raddrizza il foglio secondo gli angoli dati.
export function extractPaper(
  source: HTMLCanvasElement,
  corners: Corners
): HTMLCanvasElement {
  const widthTop = dist(corners.topLeftCorner, corners.topRightCorner);
  const widthBottom = dist(corners.bottomLeftCorner, corners.bottomRightCorner);
  const heightLeft = dist(corners.topLeftCorner, corners.bottomLeftCorner);
  const heightRight = dist(corners.topRightCorner, corners.bottomRightCorner);

  let outW = Math.round(Math.max(widthTop, widthBottom));
  let outH = Math.round(Math.max(heightLeft, heightRight));

  // Limitiamo la dimensione massima (alta qualità, PDF ancora gestibile)
  const MAX = 2400;
  const scale = Math.min(1, MAX / Math.max(outW, outH));
  outW = Math.max(1, Math.round(outW * scale));
  outH = Math.max(1, Math.round(outH * scale));

  return scanner.extractPaper(source, outW, outH, corners) as HTMLCanvasElement;
}

// Applica un filtro "documento" alla canvas e ritorna una nuova canvas.
export function applyFilter(input: HTMLCanvasElement, filter: Filter): HTMLCanvasElement {
  const cv = window.cv;
  if (filter === 'color' || !cv) return input;

  const src = cv.imread(input);
  const gray = new cv.Mat();
  const dst = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    if (filter === 'bw') {
      // Bianco/nero nitido tipo documento scansionato
      cv.adaptiveThreshold(
        gray,
        dst,
        255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv.THRESH_BINARY,
        15,
        10
      );
    } else {
      // "Migliora": scala di grigi con più contrasto e luminosità
      cv.convertScaleAbs(gray, dst, 1.25, 15);
    }
    const out = document.createElement('canvas');
    cv.imshow(out, dst);
    return out;
  } finally {
    src.delete();
    gray.delete();
    dst.delete();
  }
}
