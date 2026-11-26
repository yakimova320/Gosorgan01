/*
 * E01 (#163): «это устройство разблокировано». В IndexedDB лежит неизвлекаемый ключ устройства
 * (CryptoKey с extractable: false — его байты не может прочитать ни сайт, ни скрипт на странице)
 * и мастер-ключ, зашифрованный этим ключом. Открытого мастер-ключа и секрета восстановления в хранилище
 * браузера нет. «Забыть устройство» и удаление аккаунта удаляют запись.
 */

const DB = 'jasno-device';
const STORE = 'vault';

interface DeviceRecord {
  cabinetId: string;
  deviceKey: CryptoKey;
  iv: Uint8Array<ArrayBuffer>;
  wrapped: ArrayBuffer;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'cabinetId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  }).finally(() => db.close()) as Promise<T | null>;
}

const aad = (cabinetId: string) => new TextEncoder().encode(`jasno|v1|${cabinetId}|device`);

export async function rememberDevice(cabinetId: string, master: Uint8Array): Promise<void> {
  const deviceKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(cabinetId) },
    deviceKey,
    new Uint8Array(master),
  );
  await tx('readwrite', (s) => s.put({ cabinetId, deviceKey, iv, wrapped } satisfies DeviceRecord));
}

/** Мастер-ключ с этого устройства; null: устройство не разблокировано или запись испорчена. */
export async function deviceMaster(cabinetId: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const rec = (await tx('readonly', (s) => s.get(cabinetId))) as DeviceRecord | null;
  if (!rec) return null;
  try {
    const raw = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: rec.iv, additionalData: aad(cabinetId) },
      rec.deviceKey,
      rec.wrapped,
    );
    return new Uint8Array(raw);
  } catch {
    return null;
  }
}

export async function forgetDevice(cabinetId: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(cabinetId));
}
