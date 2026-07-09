import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  clearConfig,
  getConfig,
  parseConfig,
  saveConfig,
  syncNow,
  testConnection,
  uploadAllLocal,
} from '../lib/cloud';
import './Cloud.css';

export default function Cloud() {
  const navigate = useNavigate();
  const [config, setConfig] = useState(getConfig());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function connect() {
    setMsg(null);
    const parsed = parseConfig(text);
    if (!parsed) {
      setMsg('❌ Non riesco a leggere le chiavi. Incolla tutto il blocco "firebaseConfig".');
      return;
    }
    try {
      setBusy(true);
      saveConfig(parsed);
      await testConnection();
      setConfig(parsed);
      setText('');
      setMsg('✅ Connesso! Ora puoi sincronizzare.');
    } catch (e) {
      console.error(e);
      clearConfig();
      setMsg(
        '❌ Connessione fallita. Controlla le chiavi e che in Firebase siano attivi Firestore e l\'accesso Anonimo.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setMsg(null);
    try {
      setBusy(true);
      const r = await syncNow();
      setMsg(`✅ Sincronizzato: ${r.uploaded} caricati, ${r.downloaded} scaricati.`);
    } catch (e) {
      console.error(e);
      setMsg('❌ Sincronizzazione fallita. Riprova o ricontrolla le impostazioni Firebase.');
    } finally {
      setBusy(false);
    }
  }

  async function uploadAll() {
    setMsg(null);
    try {
      setBusy(true);
      const n = await uploadAllLocal();
      setMsg(`✅ Caricate ${n} scansioni sul cloud.`);
    } catch (e) {
      console.error(e);
      setMsg('❌ Caricamento fallito. Riprova o ricontrolla le impostazioni Firebase.');
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    if (!confirm('Scollegare il cloud da questo dispositivo? I documenti locali restano.')) return;
    clearConfig();
    setConfig(null);
    setMsg(null);
  }

  return (
    <div className="screen">
      <div className="topbar">
        <button className="prev-back" onClick={() => navigate('/')}>‹ Indietro</button>
        <h1 className="prev-title">Cloud</h1>
      </div>

      <div className="content cloud">
        {config ? (
          <>
            <div className="card cloud-status">
              <div className="cloud-ok">☁️ Connesso</div>
              <div className="muted">Progetto: {config.projectId}</div>
            </div>
            <button className="btn btn-primary btn-block" disabled={busy} onClick={sync}>
              {busy ? 'Attendi…' : '🔄 Sincronizza ora'}
            </button>
            <button className="btn btn-block" disabled={busy} onClick={uploadAll}>
              ⬆️ Carica tutto sul cloud
            </button>
            <button className="btn btn-block" disabled={busy} onClick={disconnect}>
              Scollega cloud
            </button>
            <p className="muted cloud-hint">
              Le nuove scansioni vengono caricate in automatico. Usa "Sincronizza" per
              allineare i dispositivi (carica e scarica ciò che manca).
            </p>
          </>
        ) : (
          <>
            <p className="cloud-intro">
              Incolla qui la configurazione del <b>tuo</b> progetto Firebase. Le chiavi
              restano solo su questo telefono.
            </p>
            <textarea
              className="cloud-textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'const firebaseConfig = {\n  apiKey: "...",\n  authDomain: "...",\n  projectId: "...",\n  appId: "..."\n};'}
              rows={9}
            />
            <button className="btn btn-primary btn-block" disabled={busy || !text.trim()} onClick={connect}>
              {busy ? 'Collego…' : 'Connetti'}
            </button>
          </>
        )}

        {msg && <p className="cloud-msg">{msg}</p>}

        <button className="btn btn-block cloud-guide-btn" onClick={() => navigate('/guida')}>
          📖 Come attivare il cloud (istruzioni)
        </button>
      </div>
    </div>
  );
}
