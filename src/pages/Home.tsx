import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listDocs } from '../lib/db';
import { isConfigured } from '../lib/cloud';
import './Home.css';

export default function Home() {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);

  useEffect(() => {
    listDocs().then((d) => setCount(d.length));
  }, []);

  return (
    <div className="screen home">
      <div className="home-header">
        <div className="home-logo">📄</div>
        <h1>ScanApp</h1>
        <p className="muted">Scansiona, salva e condividi i tuoi documenti</p>
      </div>

      <div className="home-choices">
        <button className="home-card home-card-primary" onClick={() => navigate('/scan')}>
          <span className="home-card-icon">📷</span>
          <span className="home-card-title">Scanner</span>
          <span className="home-card-desc">Scatta e crea un PDF</span>
        </button>

        <button className="home-card" onClick={() => navigate('/archive')}>
          <span className="home-card-icon">🗂️</span>
          <span className="home-card-title">Cartella</span>
          <span className="home-card-desc">
            {count > 0
              ? `${count} document${count === 1 ? 'o' : 'i'}`
              : 'Il tuo archivio'}
          </span>
        </button>
      </div>

      <button className="home-cloud" onClick={() => navigate('/cloud')}>
        ☁️ Cloud {isConfigured() ? '· connesso' : '· non attivo'}
      </button>

      <p className="muted home-footer">
        {isConfigured() ? 'Sincronizzato sul tuo cloud' : 'Modalità locale · i file restano sul telefono'}
      </p>
    </div>
  );
}
