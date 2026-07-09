import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './CloudGuide.css';

const RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}`;

export default function CloudGuide() {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  async function copyRules() {
    try {
      await navigator.clipboard.writeText(RULES);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="screen">
      <div className="topbar">
        <button className="prev-back" onClick={() => navigate('/cloud')}>‹ Indietro</button>
        <h1 className="prev-title">Come attivare il cloud</h1>
      </div>

      <div className="content guide">
        <p className="guide-intro">
          Serve un <b>tuo</b> progetto Firebase (gratis, senza carta). Sono 6 fasi da
          1-2 minuti. Se ti blocchi, chiedi pure aiuto.
        </p>

        <div className="guide-step">
          <h3>A · Crea il progetto</h3>
          <ol>
            <li>Vai su <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer">console.firebase.google.com</a> (accedi con Google)</li>
            <li>Tocca <b>Crea un progetto</b></li>
            <li>Nome: <b>scanapp</b> → Continua</li>
            <li>Google Analytics: <b>disattivalo</b> → <b>Crea progetto</b></li>
          </ol>
        </div>

        <div className="guide-step">
          <h3>B · Aggiungi l'app web e copia le chiavi</h3>
          <ol>
            <li>Tocca l'icona <b>{'</>'}</b> (Web)</li>
            <li>Nickname: <b>scanapp</b> → <b>Registra app</b> (niente Hosting)</li>
            <li>Compare un blocco <code>firebaseConfig = {'{...}'}</code> → <b>copialo tutto</b></li>
            <li><b>Continua alla console</b></li>
          </ol>
        </div>

        <div className="guide-step">
          <h3>C · Attiva il database (Firestore)</h3>
          <ol>
            <li>Menu a sinistra → <b>Build → Firestore Database</b></li>
            <li><b>Crea database</b></li>
            <li>Posizione: <b>eur3 (Europe)</b> → Avanti</li>
            <li>Scegli <b>Avvia in modalità produzione</b> → <b>Attiva</b></li>
          </ol>
        </div>

        <div className="guide-step">
          <h3>D · Regole di sicurezza</h3>
          <ol>
            <li>Dentro Firestore apri la scheda <b>Regole (Rules)</b></li>
            <li>Cancella tutto e incolla queste regole:</li>
          </ol>
          <pre className="guide-code">{RULES}</pre>
          <button className="btn btn-block" onClick={copyRules}>
            {copied ? '✅ Copiato' : '📋 Copia le regole'}
          </button>
          <ol start={3}>
            <li>Tocca <b>Pubblica</b></li>
          </ol>
        </div>

        <div className="guide-step">
          <h3>E · Attiva l'accesso Anonimo</h3>
          <ol>
            <li>Menu → <b>Build → Authentication</b> → <b>Inizia</b></li>
            <li>Scheda <b>Sign-in method</b></li>
            <li>Trova <b>Anonimo (Anonymous)</b> → attivalo → <b>Salva</b></li>
          </ol>
        </div>

        <div className="guide-step">
          <h3>F · Incolla nell'app 🎉</h3>
          <ol>
            <li>Torna qui → <b>Cloud</b></li>
            <li><b>Incolla</b> il blocco firebaseConfig della Fase B</li>
            <li><b>Connetti</b> → se ✅ tocca <b>Sincronizza</b> o <b>Carica tutto</b></li>
          </ol>
        </div>

        <button className="btn btn-primary btn-block guide-back" onClick={() => navigate('/cloud')}>
          Ho fatto, torna al Cloud
        </button>
      </div>
    </div>
  );
}
