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
import { autoUpload } from '../lib/cloud';
import type { Filter, ScanDoc } from '../lib/types';
import './Scanner.css';

type Stage = 'loading' | 'camera' | 'busy' | 'adjust' | 'filter' | 'review';
type Mode = 'live' | 'photo';
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

function scaleCorners(c: Corners, k: number): Corners {
  return {
    topLeftCorner: { x: c.topLeftCorner.x * k, y: c.topLeftCorner.y * k },
    topRightCorner: { x: c.topRightCorner.x * k, y: c.topRightCorner.y * k },
    bottomRightCorner: { x: c.bottomRightCorner.x * k, y: c.bottomRightCorner.y * k },
    bottomLeftCorner: { x: c.bottomLeftCorner.x * k, y: c.bottomLeftCorner.y * k },
  };
}

export default function Scanner() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('loading');
  const [mode, setMode] = useState<Mode>(
    () => (localStorage.getItem('scan_mode') as Mode) || 'live'
  );
  const [error, setError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [corners, setCorners] = useState<Corners | null>(null);
  const [liveCorners, setLiveCorners] = useState<Corners | null>(null);
  const [frameSize, setFrameSize] = useState<{ w: number; h: number } | null>(null);
  const [filter, setFilter] = useState<Filter>(
    () => (localStorage.getItem('scan_filter') as Filter) || 'color'
  );
  const [filteredUrl, setFilteredUrl] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [autoCapture, setAutoCapture] = useState<boolean>(
    () => localStorage.getItem('scan_auto') === '1'
  );

  const camInputRef = useRef<HTMLInputElement>(null);
  const galInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  const deskewRef = useRef<HTMLCanvasElement | null>(null);
  const dragging = useRef<CornerKey | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const autoCaptureRef = useRef(autoCapture);
  const lastLiveRef = useRef<Corners | null>(null);
  const stableRef = useRef(0);

  useEffect(() => {
    loadScanner()
      .then(() => setStage('camera'))
      .catch(() => setError('Motore di scansione non caricato. Ricarica la pagina.'));
  }, []);

  // Ricorda l'ultima modalità scelta (Live / Foto)
  useEffect(() => {
    localStorage.setItem('scan_mode', mode);
  }, [mode]);

  // Ricorda e tiene aggiornato l'auto-scatto
  useEffect(() => {
    autoCaptureRef.current = autoCapture;
    localStorage.setItem('scan_auto', autoCapture ? '1' : '0');
  }, [autoCapture]);

  // Modalità Live: avvia la fotocamera e il rilevamento continuo dei bordi
  useEffect(() => {
    if (stage !== 'camera' || mode !== 'live') return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const detCanvas = document.createElement('canvas');
    setLiveError(null);
    stableRef.current = 0;
    lastLiveRef.current = null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
          audio: false,
        });
        streamRef.current = stream;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        v.onloadedmetadata = () => setFrameSize({ w: v.videoWidth, h: v.videoHeight });
        await v.play().catch(() => {});

        timer = setInterval(() => {
          const vid = videoRef.current;
          if (!vid || !vid.videoWidth) return;
          const maxD = 480;
          const s = Math.min(1, maxD / Math.max(vid.videoWidth, vid.videoHeight));
          detCanvas.width = Math.round(vid.videoWidth * s);
          detCanvas.height = Math.round(vid.videoHeight * s);
          detCanvas.getContext('2d')!.drawImage(vid, 0, 0, detCanvas.width, detCanvas.height);
          const c = detectCorners(detCanvas, 640);
          setLiveCorners(c ? scaleCorners(c, 1 / s) : null);

          // Auto-scatto: se i bordi restano fermi per ~1s
          if (autoCaptureRef.current) {
            if (c) {
              const last = lastLiveRef.current;
              if (last) {
                const move = CORNER_ORDER.reduce(
                  (sum, k) => sum + Math.hypot(c[k].x - last[k].x, c[k].y - last[k].y),
                  0
                );
                const diag = Math.hypot(detCanvas.width, detCanvas.height);
                if (move < diag * 0.03) stableRef.current += 1;
                else stableRef.current = 0;
              }
              lastLiveRef.current = c;
              if (stableRef.current >= 5) {
                stableRef.current = 0;
                captureLive();
              }
            } else {
              stableRef.current = 0;
              lastLiveRef.current = null;
            }
          }
        }, 240);
      } catch {
        setLiveError('Fotocamera non disponibile. Usa la modalità Foto.');
      }
    })();

    return () => {
      if (timer) clearInterval(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setLiveCorners(null);
    };
  }, [stage, mode]);

  function loadIntoSource(c: HTMLCanvasElement, presetCorners?: Corners | null) {
    sourceRef.current = c;
    setCapturedUrl(c.toDataURL('image/jpeg', 0.95));
    const detected = detectCorners(c) || presetCorners || defaultCorners(c.width, c.height);
    setCorners(detected);
    setStage('adjust');
  }

  function captureLive() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    loadIntoSource(c, liveCorners);
  }

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
      setTimeout(() => loadIntoSource(c), 30);
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
    updateFilter(filter); // riusa l'ultimo filtro scelto
    setStage('filter');
  }

  function updateFilter(f: Filter) {
    setFilter(f);
    localStorage.setItem('scan_filter', f);
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
    setStage('review');
  }

  function movePage(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= pages.length) return;
    setPages((p) => {
      const next = [...p];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function removePageAt(i: number) {
    setPages((p) => p.filter((_, idx) => idx !== i));
  }

  async function doSave() {
    try {
      setSaving(true);
      const pdf = await buildPdf(pages);
      const thumb = await makeThumb(pages[0]);
      const newDoc: ScanDoc = {
        id: `${Date.now()}_${Math.floor(Math.random() * 1e5)}`,
        name: name.trim() || 'Documento senza nome',
        createdAt: Date.now(),
        pageCount: pages.length,
        pdf,
        thumb,
        size: pdf.size,
      };
      await saveDoc(newDoc);
      autoUpload(newDoc); // caricamento cloud in background (se attivo)
      navigate('/archive');
    } catch (err) {
      console.error(err);
      alert('Errore nella creazione del PDF.');
      setSaving(false);
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

  function livePolygon(): string {
    if (!liveCorners) return '';
    return CORNER_ORDER.map((k) => `${liveCorners[k].x},${liveCorners[k].y}`).join(' ');
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
      <input ref={camInputRef} type="file" accept="image/*" capture="environment" hidden onChange={onPickFile} />
      <input ref={galInputRef} type="file" accept="image/*" hidden onChange={onPickFile} />

      {stage === 'camera' && (
        <>
          <div className="scan-topbar">
            <button className="back-btn" onClick={() => navigate('/')}>✕</button>
            <div className="scan-modes">
              <button className={mode === 'live' ? 'active' : ''} onClick={() => setMode('live')}>Live</button>
              <button className={mode === 'photo' ? 'active' : ''} onClick={() => setMode('photo')}>Foto</button>
            </div>
            <span style={{ flex: 1 }} />
            {mode === 'live' && (
              <button
                className={`scan-auto ${autoCapture ? 'active' : ''}`}
                onClick={() => setAutoCapture((v) => !v)}
              >
                ⚡ Auto
              </button>
            )}
          </div>

          {mode === 'live' ? (
            <div className="scan-live-wrap">
              <video ref={videoRef} playsInline muted className="scan-live-video" />
              {frameSize && (
                <svg
                  className="scan-live-overlay"
                  viewBox={`0 0 ${frameSize.w} ${frameSize.h}`}
                  preserveAspectRatio="xMidYMid meet"
                >
                  <polygon points={livePolygon()} />
                </svg>
              )}
              {liveError && (
                <div className="scan-live-msg">
                  <p>{liveError}</p>
                  <button className="btn btn-primary" onClick={() => setMode('photo')}>Passa a Foto</button>
                </div>
              )}
            </div>
          ) : (
            <div className="scan-placeholder" onClick={() => camInputRef.current?.click()}>
              <div className="scan-ph-icon">📷</div>
              <p>Tocca per scattare la foto<br />del documento</p>
              <p className="muted" style={{ fontSize: 13 }}>Fotocamera del telefono (massima qualità)</p>
            </div>
          )}

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
              onClick={() => (mode === 'live' ? captureLive() : camInputRef.current?.click())}
              aria-label="Scatta"
            />
            <button className="scan-side" disabled={pages.length === 0} onClick={finish}>
              ✅<span>Fine ({pages.length})</span>
            </button>
          </div>
        </>
      )}

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

      {stage === 'review' && (
        <>
          <div className="scan-topbar">
            <button className="back-btn" onClick={() => setStage('camera')}>‹</button>
            <span>Rivedi e salva</span>
          </div>
          <div className="scan-review">
            <input
              className="scan-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome del documento"
            />
            <div className="scan-review-list">
              {pages.map((p, i) => (
                <div key={i} className="scan-review-item">
                  <img src={p} alt={`pagina ${i + 1}`} />
                  <span className="scan-review-num">Pagina {i + 1}</span>
                  <div className="scan-review-acts">
                    <button onClick={() => movePage(i, -1)} disabled={i === 0}>▲</button>
                    <button onClick={() => movePage(i, 1)} disabled={i === pages.length - 1}>▼</button>
                    <button onClick={() => removePageAt(i)}>🗑</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="scan-actions">
            <button className="btn" onClick={() => setStage('camera')}>+ Altra pagina</button>
            <button
              className="btn btn-primary"
              disabled={saving || pages.length === 0}
              onClick={doSave}
            >
              {saving ? 'Salvo…' : '📄 Crea PDF'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
