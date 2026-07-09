// Cloud "porta le tue chiavi": l'utente incolla la config del SUO progetto
// Firebase (salvata solo in localStorage) e le scansioni vanno nel SUO Firestore.
// I PDF vengono spezzati in blocchi per rispettare il limite di 1MB per documento.
import { initializeApp, getApps, deleteApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc as fsDoc,
  getDoc as fsGetDoc,
  getDocs,
  setDoc,
  deleteDoc as fsDeleteDoc,
  type Firestore,
} from 'firebase/firestore';
import { listDocs as idbList, saveDoc as idbSave } from './db';
import type { ScanDoc } from './types';

export type FbConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
};

const CONFIG_KEY = 'fb_config';
const COL = 'documents';
const APP_NAME = 'scanapp';

// --- Configurazione (in localStorage, solo su questo dispositivo) ---

export function getConfig(): FbConfig | null {
  const raw = localStorage.getItem(CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FbConfig;
  } catch {
    return null;
  }
}

export function isConfigured(): boolean {
  return !!getConfig();
}

export function saveConfig(c: FbConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  reset();
}

export function clearConfig(): void {
  localStorage.removeItem(CONFIG_KEY);
  reset();
}

// Estrae la config sia da JSON puro sia dallo snippet "const firebaseConfig = {...}"
export function parseConfig(text: string): FbConfig | null {
  const pick = (k: string): string | undefined => {
    const m = text.match(new RegExp(`${k}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`));
    return m ? m[1] : undefined;
  };
  const apiKey = pick('apiKey');
  const projectId = pick('projectId');
  const appId = pick('appId');
  if (!apiKey || !projectId || !appId) return null;
  return {
    apiKey,
    authDomain: pick('authDomain') || `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket: pick('storageBucket'),
    messagingSenderId: pick('messagingSenderId'),
    appId,
  };
}

// --- Connessione Firebase (inizializzata su richiesta) ---

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let signedIn = false;

function reset(): void {
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) deleteApp(existing).catch(() => {});
  app = null;
  db = null;
  auth = null;
  signedIn = false;
}

async function ensure(): Promise<Firestore> {
  const cfg = getConfig();
  if (!cfg) throw new Error('Cloud non configurato');
  if (!app) {
    app = getApps().find((a) => a.name === APP_NAME) || initializeApp(cfg, APP_NAME);
    db = getFirestore(app);
    auth = getAuth(app);
  }
  if (!signedIn) {
    await signInAnonymously(auth!);
    signedIn = true;
  }
  return db!;
}

// Prova la connessione: accede in anonimo e legge la collezione.
export async function testConnection(): Promise<void> {
  const database = await ensure();
  await getDocs(collection(database, COL));
}

// --- Conversioni Blob <-> base64 ---

async function blobToB64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    s += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(s);
}

function b64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

// --- Upload / download di un documento ---

const CHUNK_CHARS = 400000; // ~400 KB per blocco (limite Firestore: 1 MB/doc)

export async function uploadDoc(d: ScanDoc): Promise<void> {
  const database = await ensure();
  const pdfB64 = await blobToB64(d.pdf);
  const thumbB64 = d.thumb ? await blobToB64(d.thumb) : '';
  const chunks: string[] = [];
  for (let i = 0; i < pdfB64.length; i += CHUNK_CHARS) {
    chunks.push(pdfB64.slice(i, i + CHUNK_CHARS));
  }
  await setDoc(fsDoc(database, COL, d.id), {
    name: d.name,
    createdAt: d.createdAt,
    pageCount: d.pageCount,
    size: d.size,
    thumb: thumbB64,
    chunkCount: chunks.length,
    updatedAt: Date.now(),
  });
  for (let i = 0; i < chunks.length; i++) {
    await setDoc(fsDoc(database, COL, d.id, 'chunks', String(i)), { data: chunks[i] });
  }
}

type CloudMeta = {
  id: string;
  name: string;
  createdAt: number;
  pageCount: number;
  size: number;
  chunkCount: number;
};

export async function listCloudMeta(): Promise<CloudMeta[]> {
  const database = await ensure();
  const snap = await getDocs(collection(database, COL));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CloudMeta, 'id'>) }));
}

export async function downloadDoc(id: string): Promise<ScanDoc | null> {
  const database = await ensure();
  const main = await fsGetDoc(fsDoc(database, COL, id));
  if (!main.exists()) return null;
  const m = main.data() as { name: string; createdAt: number; pageCount: number; size: number; thumb: string; chunkCount: number };
  const chunkSnap = await getDocs(collection(database, COL, id, 'chunks'));
  const parts: string[] = new Array(m.chunkCount).fill('');
  chunkSnap.docs.forEach((cd) => {
    parts[Number(cd.id)] = (cd.data() as { data: string }).data;
  });
  const pdf = b64ToBlob(parts.join(''), 'application/pdf');
  const thumb = m.thumb ? b64ToBlob(m.thumb, 'image/jpeg') : pdf;
  return { id, name: m.name, createdAt: m.createdAt, pageCount: m.pageCount, size: m.size, pdf, thumb };
}

export async function deleteCloudDoc(id: string): Promise<void> {
  if (!isConfigured()) return;
  try {
    const database = await ensure();
    const chunks = await getDocs(collection(database, COL, id, 'chunks'));
    await Promise.all(chunks.docs.map((c) => fsDeleteDoc(c.ref)));
    await fsDeleteDoc(fsDoc(database, COL, id));
  } catch (e) {
    console.warn('Eliminazione cloud fallita', e);
  }
}

// Carica in automatico un nuovo documento (silenzioso se il cloud non è attivo).
export async function autoUpload(d: ScanDoc): Promise<void> {
  if (!isConfigured()) return;
  try {
    await uploadDoc(d);
  } catch (e) {
    console.warn('Auto-upload cloud fallito', e);
  }
}

// Carica sul cloud TUTTE le scansioni locali (utile se ne avevi già prima di attivare il cloud).
export async function uploadAllLocal(): Promise<number> {
  await ensure();
  const local = await idbList();
  for (const d of local) {
    await uploadDoc(d);
  }
  return local.length;
}

// Sincronizzazione a due vie (per id): carica i locali mancanti, scarica i cloud mancanti.
export async function syncNow(): Promise<{ uploaded: number; downloaded: number }> {
  await ensure();
  const local = await idbList();
  const cloud = await listCloudMeta();
  const cloudIds = new Set(cloud.map((c) => c.id));
  const localIds = new Set(local.map((l) => l.id));
  let uploaded = 0;
  let downloaded = 0;
  for (const l of local) {
    if (!cloudIds.has(l.id)) {
      await uploadDoc(l);
      uploaded++;
    }
  }
  for (const c of cloud) {
    if (!localIds.has(c.id)) {
      const d = await downloadDoc(c.id);
      if (d) {
        await idbSave(d);
        downloaded++;
      }
    }
  }
  return { uploaded, downloaded };
}
