/** Local-only storage of user 3D models (IndexedDB). No network. */
export const MAX_MODEL_BYTES = 2 * 1024 * 1024;

/** null = ok, otherwise a Turkish error message. */
export function checkModelFile(name: string, size: number): string | null {
  const n = name.toLowerCase();
  if (n.endsWith('.step') || n.endsWith('.stp')) return 'STEP dosyaları desteklenmiyor. Modeli .glb veya .gltf olarak dışa aktarın.';
  if (!n.endsWith('.glb') && !n.endsWith('.gltf')) return 'Yalnızca .glb / .gltf dosyaları desteklenir (STEP desteklenmiyor).';
  if (size > MAX_MODEL_BYTES) return `Dosya çok büyük (${(size / 1048576).toFixed(2)} MB). Sınır 2 MB; modeli sadeleştirip tekrar deneyin.`;
  if (size === 0) return 'Dosya boş.';
  return null;
}

const DB = 'electrolab.models3d';
const STORE = 'glb';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') { rej(new Error('Bu tarayıcıda IndexedDB yok')); return; }
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error ?? new Error('IndexedDB açılamadı'));
  });
}

async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const q = f(db.transaction(STORE, mode).objectStore(STORE));
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error ?? new Error('IndexedDB hatası'));
  });
}

export const saveModel = (id: string, data: Blob): Promise<IDBValidKey> => tx('readwrite', (s) => s.put(data, id));
export const loadModel = (id: string): Promise<Blob | undefined> => tx<Blob | undefined>('readonly', (s) => s.get(id));
export const deleteModel = (id: string): Promise<undefined> => tx('readwrite', (s) => s.delete(id));
