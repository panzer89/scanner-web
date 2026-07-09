import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  applyFilter,
  defaultCorners,
  detectCorners,
  extractPaper,
  loadScanner,
  type Corners,
} from '../lib/scanner';
import { buildPdf, makeThumb } from '../lib/pdf';
import { saveDoc } from '../lib/db';
import type { Filter } from '../lib/types';
import './Scanner.css';

type Stage = 'loading' | 'camera' | 'busy' | 'adjust' | 'filter';
type CornerKey = keyof Corners;
const CORNER_ORDER: CornerKey[] = [
  'topLeftCorner',
  'topRightCorner',
  'bottomRightCorner',
  'bottomLeftCorner',
];

function defaultName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `Scansione ${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}${p(d.getMinutes())}`;
}

export default function Scanner() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('loading');
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [corners, setCorners] = useState<Corners | null>(null);
  const [filter, setFilter] = useState<Filter>('color');
  const [filteredUrl, setFilteredUrl] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const camInputRef = useRef<HTMLInputElement>(null);
  const galInputRef = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<HTMLCanvasElement | null>(null); // foto a piena risoluzione
  const deskewRef = useRef<HTMLCanvasElement | null>(null); // risultato raddrizzato
  const dragging = useRef<CornerKey | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadScanner()
      .then(() => setStage('camera'))
      .catch(() => setError('Motore di scansione non caricato. Ricarica la pagina.'));
  }, []);

  function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setStage('busy');
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d')!.drawImage(img, 0, 0);
      URL.revokeObjectURL(img.src);
      sourceRef.current = c;
      setCapturedUrl(c.toDataURL('image/jpeg', 0.95));
      // Il rilevamento è pesante: lo lanciamo dopo un tick per mostrare il "busy"
      setTimeout(() => {
        const detected = detectCorners(c) || defaultCorners(c.width, c.height);
        setCorners(detected);
        setStage('adjust');
      }, 30);
    };
    img.onerror = () => {
      setError('Immagine non valida.');
      setStage('camera');
    };
    img.src = URL.createObjectURL(file);
  }

  // --- Trascinamento angoli ---
  function pointerMove(e: PointerEvent) {
    const key = dragging.current;
    const frame = frameRef.current;
    const src = sourceRef.current;
    if (!key || !frame || !src) return;
    const rect = frame.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * src.width;
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)) * src.height;
    setCorners((prev) => (prev ? { ...prev, [key]: { x, y } } : prev));
  }
  function pointerUp() {
    dragging.current = null;
    window.removeEventListener('pointermove', pointerMove);
    window.removeEventListener('pointerup', pointerUp);
  }
  function startDrag(key: CornerKey) {
    dragging.current = key;
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp);
  }

  function confirmCrop() {
    if (!sourceRef.current || !corners) return;
    const result = extractPaper(sourceRef.current, corners);
    deskewRef.current = result;
    updateFilter('color');
    setStage('filter');
  }

  function updateFilter(f: Filter) {
    setFilter(f);
    if (!deskewRef.current) return;
    const out = applyFilter(deskewRef.current, f);
    setFilteredUrl(out.toDataURL('image/jpeg', 0.95));
  }

  function resetToCamera() {
    setCapturedUrl(null);
    setCorners(null);
    setFilteredUrl(null);
    deskewRef.current = null;
    sourceRef.current = null;
    setStage('camera');
  }

  function addPage() {
    if (!filteredUrl) return;
    setPages((p) => [...p, filteredUrl]);
    resetToCamera();
  }

  function finish() {
    if (pages.length === 0) return;
    setName(defaultName());
    setNaming(true);
  }

  async function doSave() {
    try {
      setSaving(true);
      const pdf = await buildPdf(pages);
      const thumb = await makeThumb(pages[0]);
      await saveDoc({
        id: `${Date.now()}_${Math.floor(Math.random() * 1e5)}`,
        name: name.trim() || 'Documento senza nome',
        createdAt: Date.now(),
        pageCount: pages.length,
        pdf,
        thumb,
        size: pdf.size,
      });
      navigate('/archive');
    } catch (err) {
      console.error(err);
      alert('Errore nella creazione del PDF.');
      setSaving(false);
      setNaming(false);
    }
  }

  function pct(key: CornerKey): { left: string; top: string } {
    const src = sourceRef.current;
    const c = corners?.[key];
    if (!src || !c) return { left: '0%', top: '0%' };
    return { left: `${(c.x / src.width) * 100}%`, top: `${(c.y / src.height) * 100}%` };
  }

  function polygonPoints(): string {
    const src = sourceRef.current;
    if (!src || !corners) return '';
    return CORNER_ORDER.map((k) => {
      const c = corners[k];
      return `${(c.x / src.width) * 100},${(c.y / src.height) * 100}`;
    }).join(' ');
  }

  // --- Render ---
  if (stage === 'loading' || stage === 'busy') {
    return (
      <div className="screen scan-center">
        <div className="spinner" />
        <p className="muted">{stage === 'busy' ? 'Elaboro la foto…' : 'Avvio dello scanner…'}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="screen scan-center">
        <p style={{ textAlign: 'center', padding: '0 24px' }}>{error}</p>
        <button className="btn btn-primary" onClick={() => navigate('/')}>Torna alla Home</button>
      </div>
    );
  }

  return (
    <div className="screen scan">
      <input
        ref={camInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={onPickFile}
      />
      <input ref={galInputRef} type="file" accept="image/*" hidden onChange={onPickFile} />

      {/* STAGE CAMERA */}
      {stage === 'camera' && (
        <>
          <div className="scan-topbar">
            <button className="back-btn" onClick={() => navigate('/')}>✕</button>
            <span>Nuova scansione</span>
          </div>
          <div className="scan-placeholder" onClick={() => camInputRef.current?.click()}>
            <div className="scan-ph-icon">📷</div>
            <p>Tocca per scattare la foto<br />del documento</p>
            <p className="muted" style={{ fontSize: 13 }}>Usa la fotocamera del telefono (alta qualità)</p>
          </div>
          {pages.length > 0 && (
            <div className="scan-pagestrip">
              {pages.map((p, i) => (
                <img key={i} src={p} alt={`pagina ${i + 1}`} />
              ))}
            </div>
          )}
          <div className="scan-controls">
            <button className="scan-side" onClick={() => galInputRef.current?.click()}>
              🖼️<span>Galleria</span>
            </button>
            <button
              className="scan-shutter"
              onClick={() => camInputRef.current?.click()}
              aria-label="Scatta"
            />
            <button className="scan-side" disabled={pages.length === 0} onClick={finish}>
              ✅<span>Fine ({pages.length})</span>
            </button>
          </div>
        </>
      )}

      {/* STAGE ADJUST */}
      {stage === 'adjust' && capturedUrl && (
        <>
          <div className="scan-topbar">
            <button className="back-btn" onClick={resetToCamera}>✕</button>
            <span>Sistema gli angoli</span>
          </div>
          <div className="scan-editor">
            <div className="scan-frame" ref={frameRef}>
              <img src={capturedUrl} alt="scatto" className="scan-shot" />
              <svg className="scan-overlay" viewBox="0 0 100 100" preserveAspectRatio="none">
                <polygon points={polygonPoints()} />
              </svg>
              {CORNER_ORDER.map((k) => (
                <div
                  key={k}
                  className="scan-handle"
                  style={pct(k)}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    startDrag(k);
                  }}
                />
              ))}
            </div>
          </div>
          <div className="scan-actions">
            <button className="btn" onClick={resetToCamera}>Rifai</button>
            <button className="btn btn-primary" onClick={confirmCrop}>Continua ▸</button>
          </div>
        </>
      )}

      {/* STAGE FILTER */}
      {stage === 'filter' && filteredUrl && (
        <>
          <div className="scan-topbar">
            <button className="back-btn" onClick={() => setStage('adjust')}>‹</button>
            <span>Migliora</span>
          </div>
          <div className="scan-editor">
            <img src={filteredUrl} alt="risultato" className="scan-result" />
          </div>
          <div className="scan-filters">
            {(['color', 'enhance', 'bw'] as Filter[]).map((f) => (
              <button
                key={f}
                className={`filter-chip ${filter === f ? 'active' : ''}`}
                onClick={() => updateFilter(f)}
              >
                {f === 'color' ? 'Colore' : f === 'enhance' ? 'Migliora' : 'B/N'}
              </button>
            ))}
          </div>
          <div className="scan-actions">
            <button className="btn" onClick={resetToCamera}>Rifai</button>
            <button className="btn btn-primary" onClick={addPage}>+ Aggiungi pagina</button>
          </div>
        </>
      )}

      {/* Modale nome */}
      {naming && (
        <div className="scan-modal">
          <div className="scan-modal-box">
            <h3>Nome del documento</h3>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <div className="scan-actions">
              <button className="btn" onClick={() => setNaming(false)} disabled={saving}>Annulla</button>
              <button className="btn btn-primary" onClick={doSave} disabled={saving}>
                {saving ? 'Salvo…' : '📄 Crea PDF'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
