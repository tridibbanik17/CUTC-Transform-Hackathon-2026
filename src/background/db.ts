// ============================================================
// IndexedDB schema for local session data
// Database: lms-rag-session
// Stores: history, preferences, adapters
// Note: NO vector store or document metadata — those live on Backboard.io
// ============================================================

import type { HistoryEntry, PreferenceRecord, AdapterStateRecord } from '@/types';

const DB_NAME = 'lms-rag-session';
const DB_VERSION = 1;

let dbInstance: IDBDatabase | null = null;

/**
 * Open (or get cached) the IndexedDB database instance.
 * Creates object stores on first open or version upgrade.
 */
export function openDatabase(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Session history: query/answer pairs keyed by auto-generated id
      if (!db.objectStoreNames.contains('history')) {
        const historyStore = db.createObjectStore('history', { keyPath: 'id' });
        historyStore.createIndex('byCourseSession', ['courseId', 'sessionId'], {
          unique: false,
        });
      }

      // User preferences: dismissed prompts, privacy notice state
      if (!db.objectStoreNames.contains('preferences')) {
        db.createObjectStore('preferences', { keyPath: 'key' });
      }

      // Adapter state: last detected course per adapter
      if (!db.objectStoreNames.contains('adapters')) {
        db.createObjectStore('adapters', { keyPath: 'name' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject(new Error(`Failed to open database: ${(event.target as IDBOpenDBRequest).error?.message}`));
    };
  });
}

// --- History Operations ---

export async function addHistoryEntry(entry: HistoryEntry): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('history', 'readwrite');
    tx.objectStore('history').put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getHistoryByCourseSession(
  courseId: string,
  sessionId: string
): Promise<HistoryEntry[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('history', 'readonly');
    const store = tx.objectStore('history');
    const index = store.index('byCourseSession');
    const request = index.getAll([courseId, sessionId]);
    request.onsuccess = () => resolve(request.result as HistoryEntry[]);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete a single history entry by its id.
 */
export async function deleteHistoryEntry(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('history', 'readwrite');
    tx.objectStore('history').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearHistory(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('history', 'readwrite');
    tx.objectStore('history').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Preferences Operations ---

export async function setPreference(record: PreferenceRecord): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('preferences', 'readwrite');
    tx.objectStore('preferences').put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPreference(key: string): Promise<PreferenceRecord | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('preferences', 'readonly');
    const request = tx.objectStore('preferences').get(key);
    request.onsuccess = () => resolve(request.result as PreferenceRecord | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function removePreference(key: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('preferences', 'readwrite');
    tx.objectStore('preferences').delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Adapter State Operations ---

export async function setAdapterState(record: AdapterStateRecord): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('adapters', 'readwrite');
    tx.objectStore('adapters').put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAdapterState(name: string): Promise<AdapterStateRecord | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('adapters', 'readonly');
    const request = tx.objectStore('adapters').get(name);
    request.onsuccess = () => resolve(request.result as AdapterStateRecord | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllAdapterStates(): Promise<AdapterStateRecord[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('adapters', 'readonly');
    const request = tx.objectStore('adapters').getAll();
    request.onsuccess = () => resolve(request.result as AdapterStateRecord[]);
    request.onerror = () => reject(request.error);
  });
}
