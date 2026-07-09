import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteDoc, listDocs } from '../lib/db';
import { sharePdf } from '../lib/share';
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
  const [docs, setDocs] = useState<ScanDoc[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>(
    () => (localStorage.getItem('arch_sort') as SortKey) || 'date_desc'
  );

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

  // Crea gli URL delle miniature e li libera quando cambia la lista
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

  async function onDelete(doc: ScanDoc, e: MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Eliminare "${doc.name}"?`)) return;
    await deleteDoc(doc.id);
    reload();
  }

  async function onShare(doc: ScanDoc, e: MouseEvent) {
    e.stopPropagation();
    await sharePdf(doc.name, doc.pdf);
  }

  return (
    <div className="screen">
      <div className="topbar">
        <button className="back-btn" onClick={() => navigate('/')}>‹</button>
        <h1>Archivio</h1>
      </div>

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
          visible.map((d) => (
            <div key={d.id} className="arch-row" onClick={() => navigate(`/doc/${d.id}`)}>
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
              <button className="icon-btn" onClick={(e) => onShare(d, e)}>📤</button>
              <button className="icon-btn" onClick={(e) => onDelete(d, e)}>🗑</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
