import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { deleteDoc, getDoc } from '../lib/db';
import { downloadBlob, sharePdf } from '../lib/share';
import type { ScanDoc } from '../lib/types';
import './Preview.css';

export default function Preview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<ScanDoc | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getDoc(id).then((d) => setDoc(d ?? null));
  }, [id]);

  useEffect(() => {
    if (!doc) return;
    const u = URL.createObjectURL(doc.pdf);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [doc]);

  async function onDelete() {
    if (!doc) return;
    if (!confirm(`Eliminare "${doc.name}"?`)) return;
    await deleteDoc(doc.id);
    navigate('/archive');
  }

  if (!doc) {
    return (
      <div className="screen scan-center">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="topbar">
        <button className="back-btn" onClick={() => navigate('/archive')}>‹</button>
        <h1>{doc.name}</h1>
        <button className="icon-btn" onClick={() => sharePdf(doc.name, doc.pdf)}>📤</button>
      </div>

      <div className="prev-frame">
        {url && <iframe title={doc.name} src={url} />}
      </div>

      <div className="prev-actions">
        <button className="btn" onClick={() => url && downloadBlob(doc.pdf, `${doc.name}.pdf`)}>
          ⬇️ Scarica
        </button>
        <button className="btn btn-primary" onClick={() => sharePdf(doc.name, doc.pdf)}>
          📤 Condividi
        </button>
        <button className="btn btn-danger" onClick={onDelete}>🗑</button>
      </div>
    </div>
  );
}
