import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as pdfjsLib from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { deleteDoc, getDoc } from '../lib/db';
import { isConfigured, uploadOne } from '../lib/cloud';
import { downloadBlob, sharePdf } from '../lib/share';
import type { ScanDoc } from '../lib/types';
import './Preview.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker;

export default function Preview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<ScanDoc | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [cloudState, setCloudState] = useState<'idle' | 'busy' | 'done'>('idle');

  useEffect(() => {
    if (!id) return;
    getDoc(id).then((d) => setDoc(d ?? null));
  }, [id]);

  // Disegna ogni pagina del PDF come immagine (affidabile su tutti i browser)
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const buf = await doc.pdf.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        const targetWidth = Math.min(
          1400,
          Math.floor((window.innerWidth || 800) * (window.devicePixelRatio || 1))
        );
        const urls: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = targetWidth / base.width;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          const ctx = canvas.getContext('2d')!;
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          urls.push(canvas.toDataURL('image/jpeg', 0.9));
          if (cancelled) return;
        }
        if (!cancelled) setImages(urls);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc]);

  async function onDelete() {
    if (!doc) return;
    if (!confirm(`Eliminare "${doc.name}"?`)) return;
    await deleteDoc(doc.id);
    navigate('/archive');
  }

  async function onUploadCloud() {
    if (!doc) return;
    try {
      setCloudState('busy');
      await uploadOne(doc);
      setCloudState('done');
    } catch (e) {
      console.error(e);
      setCloudState('idle');
      alert('Caricamento sul cloud fallito. Controlla le impostazioni Cloud.');
    }
  }

  return (
    <div className="screen">
      <div className="topbar">
        <button className="prev-back" onClick={() => navigate('/archive')}>
          ‹ Indietro
        </button>
        <h1 className="prev-title">{doc?.name ?? 'Anteprima'}</h1>
      </div>

      <div className="prev-pages">
        {loading ? (
          <div className="prev-loading">
            <div className="spinner" />
            <p className="muted">Carico l'anteprima…</p>
          </div>
        ) : images.length === 0 ? (
          <p className="muted" style={{ textAlign: 'center', marginTop: 40 }}>
            Impossibile mostrare l'anteprima.
          </p>
        ) : (
          images.map((src, i) => <img key={i} src={src} alt={`pagina ${i + 1}`} className="prev-page" />)
        )}
      </div>

      {doc && (
        <div className="prev-actions">
          <button className="btn" onClick={() => downloadBlob(doc.pdf, `${doc.name}.pdf`)}>
            ⬇️ Scarica
          </button>
          {isConfigured() && (
            <button className="btn" disabled={cloudState === 'busy'} onClick={onUploadCloud}>
              {cloudState === 'busy' ? '☁️…' : cloudState === 'done' ? '☁️✅' : '☁️ Cloud'}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => sharePdf(doc.name, doc.pdf)}>
            📤 Invia
          </button>
          <button className="btn btn-danger" onClick={onDelete}>🗑</button>
        </div>
      )}
    </div>
  );
}
