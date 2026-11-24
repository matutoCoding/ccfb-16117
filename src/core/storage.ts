// IndexedDB 封装：项目库 / 设置库，全部 Promise 化，无第三方依赖

const DB_NAME = 'terrazzo-studio-db';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_SETTINGS = 'settings';
const SETTINGS_KEY = 'app-settings';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const storage = {
  async listProjects(): Promise<unknown[]> {
    return tx(STORE_PROJECTS, 'readonly', (s) => s.getAll());
  },
  async putProject<T>(project: T): Promise<IDBValidKey> {
    return tx(STORE_PROJECTS, 'readwrite', (s) => s.put(project));
  },
  async deleteProject(id: string): Promise<void> {
    await tx(STORE_PROJECTS, 'readwrite', (s) => s.delete(id));
  },
  async loadSettings<T>(): Promise<T | undefined> {
    return tx(STORE_SETTINGS, 'readonly', (s) => s.get(SETTINGS_KEY));
  },
  async saveSettings<T>(settings: T): Promise<IDBValidKey> {
    return tx(STORE_SETTINGS, 'readwrite', (s) => s.put(settings, SETTINGS_KEY));
  },
};
