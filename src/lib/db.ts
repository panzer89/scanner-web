// Archivio locale dei documenti, salvato nel browser con IndexedDB.
import { openDB, type IDBPDatabase } from 'idb';
import type { ScanDoc } from './types';

const DB_NAME = 'scanapp';
const STORE = 'docs';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function listDocs(): Promise<ScanDoc[]> {
  const db = await getDB();
  return (await db.getAll(STORE)) as ScanDoc[];
}

export async function getDoc(id: string): Promise<ScanDoc | undefined> {
  const db = await getDB();
  return (await db.get(STORE, id)) as ScanDoc | undefined;
}

export async function saveDoc(doc: ScanDoc): Promise<void> {
  const db = await getDB();
  await db.put(STORE, doc);
}

export async function deleteDoc(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, id);
}

export async function renameDoc(id: string, name: string): Promise<void> {
  const doc = await getDoc(id);
  if (doc) {
    doc.name = name;
    await saveDoc(doc);
  }
}

export async function markSynced(id: string, synced = true): Promise<void> {
  const doc = await getDoc(id);
  if (doc) {
    doc.synced = synced;
    await saveDoc(doc);
  }
}
