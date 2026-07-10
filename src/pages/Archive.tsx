import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteDoc, listDocs } from '../lib/db';
import { deleteCloudDoc, isConfigured, uploadOne } from '../lib/cloud';
import { downloadBlob, sharePdf } from '../lib/share';
import type { ScanDoc, SortKey } from '../lib/types';
import './Archive.css';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'date_desc', label: 'Più recenti' },
  { key: 'date_asc', label: 'Meno recenti' },
  { key: 'name_asc', label: 'Nome A-Z' },
  { key: 'name_desc', label: 'Nome Z-A' },
];

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtSize(b: number): string {
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Archive() {
  const navigate = useNavigate();
  const isDesktop = useMemo(() => window.matchMedia('(pointer: fine)').matches, []);

  const [docs, setDocs] = useState<ScanDoc[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>(
    () => (localStorage.getItem('arch_sort') as SortKey) || 'date_desc'
  );

  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  useEffect(() => {
    localStorage.setItem('arch_sort', sort);
  }, [sort]);

  async function reload() {
    const list = await listDocs();
    setDocs(list);
  }

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    const map: Record<string, string> = {};
    docs.forEach((d) => {
      if (d.thumb) map[d.id] = URL.createObjectURL(d.thumb);
    });
    setThumbs(map);
    return () => Object.values(map).forEach((u) => URL.revokeObjectURL(u));
  }, [docs]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = docs.filter((d) => d.name.toLowerCase().includes(q));
    return list.sort((a, b) => {
      switch (sort) {
        case 'date_asc':
          return a.createdAt - b.createdAt;
        case 'name_asc':
          return a.name.localeCompare(b.name);
        case 'name_desc':
          return b.name.localeCompare(a.name);
        default:
          return b.createdAt - a.createdAt;
      }
    });
  }, [docs, query, sort]);

  const showCheckbox = isDesktop || selectionMode;
  const showRowActions = !selectionMode;

  // --- Selezione ---
  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    if (!isDesktop) setSelectionMode(false);
  }

  function toggleSelectAll() {
    if (selected.size === visible.length) {
      clearSelection();
    } else {
      setSelected(new Set(visible.map((d) => d.id)));
      if (!isDesktop) setSelectionMode(true);
    }
  }

  // Long-press (solo touch) per entrare in modalità selezione
  function onRowPointerDown(d: ScanDoc) {
    if (isDesktop || selectionMode) return;
    longPressed.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      setSelectionMode(true);
      setSelected(new Set([d.id]));
      if (navigator.vibrate) navigator.vibrate(30);
    }, 500);
  }
  function cancelPress() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  function onRowClick(d: ScanDoc) {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    if (selectionMode) {
      toggle(d.id);
      return;
    }
    navigate(`/doc/${d.id}`);
  }

  const chosen = () => docs.filter((d) => selected.has(d.id));

  // Costruisce i File PDF in modo sincrono (i Blob sono già in memoria):
  // fondamentale su iOS, dove condivisione/scaricamento devono avvenire
  // dentro il gesto dell'utente, senza attese asincrone prima.
  function toFiles(list: ScanDoc[]): File[] {
    return list.map((d) => new File([d.pdf], `${d.name || 'documento'}.pdf`, { type: 'application/pdf' }));
  }

  function canShareFiles(files: File[]): boolean {
    const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean };
    return !!(nav.canShare && nav.canShare({ files }));
  }

  function downloadSelected() {
    const list = chosen();
    if (list.length === 0) return;
    // Desktop (o singolo file): scarica direttamente
    if (isDesktop || list.length === 1) {
      list.forEach((d) => downloadBlob(d.pdf, `${d.name}.pdf`));
      return;
    }
    // Telefono con più file: usa il foglio di condivisione ("Salva su File")
    const files = toFiles(list);
    if (canShareFiles(files)) {
      navigator.share({ files }).catch(() => {});
    } else {
      list.forEach((d) => downloadBlob(d.pdf, `${d.name}.pdf`));
    }
  }

  function sendSelected() {
    const list = chosen();
    if (list.length === 0) return;
    const files = toFiles(list);
    if (canShareFiles(files)) {
      navigator.share({ files }).catch(() => {});
    } else {
      // desktop o condivisione non disponibile: scarica i file
      list.forEach((d) => downloadBlob(d.pdf, `${d.name}.pdf`));
    }
  }

  async function deleteSelected() {
    const list = chosen();
    if (list.length === 0) return;
    if (!confirm(`Eliminare ${list.length} document${list.length === 1 ? 'o' : 'i'}?`)) return;
    try {
      setBusy(true);
      for (const d of list) {
        await deleteDoc(d.id);
        deleteCloudDoc(d.id);
      }
      clearSelection();
      await reload();
    } finally {
      setBusy(false);
    }
  }

  // --- Azioni singole (fuori selezione) ---
  async function onDelete(doc: ScanDoc, e: MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Eliminare "${doc.name}"?`)) return;
    await deleteDoc(doc.id);
    deleteCloudDoc(doc.id);
    reload();
  }
  async function onShare(doc: ScanDoc, e: MouseEvent) {
    e.stopPropagation();
    await sharePdf(doc.name, doc.pdf);
  }
  async function onUploadOne(doc: ScanDoc, e: MouseEvent) {
    e.stopPropagation();
    try {
      setUploadingId(doc.id);
      await uploadOne(doc);
      await reload();
    } catch (err) {
      console.error(err);
      alert('Caricamento sul cloud fallito. Controlla le impostazioni Cloud.');
    } finally {
      setUploadingId(null);
    }
  }

  return (
    <div className="screen">
      {selected.size > 0 ? (
        <div className="topbar sel-topbar">
          <button className="back-btn" onClick={clearSelection}>✕</button>
          <h1>{selected.size} selezionat{selected.size === 1 ? 'o' : 'i'}</h1>
          <button className="sel-link" onClick={toggleSelectAll}>
            {selected.size === visible.length ? 'Nessuno' : 'Tutti'}
          </button>
          <button className="icon-btn" disabled={busy} onClick={downloadSelected} aria-label="Scarica">⬇️</button>
          <button className="icon-btn" disabled={busy} onClick={sendSelected} aria-label="Invia">📤</button>
          <button className="icon-btn" disabled={busy} onClick={deleteSelected} aria-label="Elimina">🗑</button>
        </div>
      ) : (
        <div className="topbar">
          <button className="back-btn" onClick={() => navigate('/')}>‹</button>
          <h1>Archivio</h1>
          {!isDesktop && docs.length > 0 && (
            <button className="sel-link" onClick={() => setSelectionMode((v) => !v)}>
              {selectionMode ? 'Annulla' : 'Seleziona'}
            </button>
          )}
        </div>
      )}

      <div className="arch-search">
        <span>🔍</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cerca per nome…"
        />
      </div>

      <div className="arch-sorts">
        {SORTS.map((s) => (
          <button
            key={s.key}
            className={`chip ${sort === s.key ? 'active' : ''}`}
            onClick={() => setSort(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="content arch-list">
        {visible.length === 0 ? (
          <div className="arch-empty">
            <div style={{ fontSize: 48 }}>🗂️</div>
            <p className="muted">
              {docs.length === 0 ? 'Nessun documento ancora.' : 'Nessun risultato.'}
            </p>
          </div>
        ) : (
          visible.map((d) => {
            const sel = selected.has(d.id);
            return (
              <div
                key={d.id}
                className={`arch-row ${sel ? 'selected' : ''}`}
                onClick={() => onRowClick(d)}
                onPointerDown={() => onRowPointerDown(d)}
                onPointerUp={cancelPress}
                onPointerLeave={cancelPress}
                onPointerMove={cancelPress}
              >
                {showCheckbox && (
                  <div
                    className={`arch-check ${sel ? 'on' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(d.id);
                    }}
                  >
                    {sel ? '✓' : ''}
                  </div>
                )}
                {thumbs[d.id] ? (
                  <img className="arch-thumb" src={thumbs[d.id]} alt="" />
                ) : (
                  <div className="arch-thumb arch-thumb-empty">📄</div>
                )}
                <div className="arch-info">
                  <div className="arch-name">{d.name}</div>
                  <div className="arch-meta muted">
                    {fmtDate(d.createdAt)} · {d.pageCount} pag. · {fmtSize(d.size)}
                  </div>
                </div>
                {showRowActions && (
                  <>
                    {isConfigured() && !d.synced && (
                      <button
                        className="icon-btn"
                        disabled={uploadingId === d.id}
                        onClick={(e) => onUploadOne(d, e)}
                        aria-label="Carica sul cloud"
                      >
                        {uploadingId === d.id ? '☁️…' : '☁️⬆️'}
                      </button>
                    )}
                    <button className="icon-btn" onClick={(e) => onShare(d, e)}>📤</button>
                    <button className="icon-btn" onClick={(e) => onDelete(d, e)}>🗑</button>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
