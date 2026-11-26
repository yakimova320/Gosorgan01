import {
  collectKeyIds,
  createDocumentKey,
  CryptoIntegrityError,
  decryptBytes,
  decryptDeep,
  generateRecoverySecret,
  importKey,
  isEncryptedBytes,
  bytesKeyId,
  newRawKey,
  parseRecoverySecret,
  unwrapDocumentKey,
  unwrapMasterKey,
  wrapMasterKey,
  formatNewKeyHeader,
  NEW_KEY_HEADER,
  type NewKey,
} from '@jasno/shared';
import { API_URL } from '../api/config';
import { deviceMaster, forgetDevice, rememberDevice } from './device';

/*
 * E01 (#163): ключи архива в браузере. Только в памяти этого модуля — не в Redux, не в localStorage,
 * не в журнале. Секрет восстановления живёт только на экране, где его показывают или вводят.
 * Выход, истёкшая сессия, удаление аккаунта: lock() стирает мастер-ключ и все ключи документов.
 *
 * Сервер видит только зашифрованные записи ключей (GET /crypto/vault, GET /crypto/keys).
 * Ключ документа уходит на сервер лишь в запросе-действии, который сервер отклонил с 428 KEYS_REQUIRED
 * (загрузка, объяснение, перевод, черновик, вопрос к архиву), — см. store/baseQuery.ts.
 */

export type VaultStatus = 'unknown' | 'loading' | 'none' | 'locked' | 'unlocked' | 'error';

interface State {
  status: VaultStatus;
  cabinetId: string | null;
  /** Сколько писем и дел ещё не зашифровано (загружены до E01) */
  legacy: number;
}

let state: State = { status: 'unknown', cabinetId: null, legacy: 0 };
let master: CryptoKey | null = null;
let masterRaw: Uint8Array<ArrayBuffer> | null = null;
let wrapped = new Map<string, string>();
let opened = new Map<string, Uint8Array<ArrayBuffer>>();
let getToken: () => string | null = () => null;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export const keyring = {
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  snapshot(): State {
    return state;
  },
  configure(options: { getToken: () => string | null }) {
    getToken = options.getToken;
  },
  get unlocked(): boolean {
    return state.status === 'unlocked' && master !== null;
  },
  get cabinetId(): string | null {
    return state.cabinetId;
  },
};

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) throw Object.assign(new Error('crypto request failed'), { status: res.status, data });
  return data as T;
}

/** Стереть всё из памяти. Запись «устройство разблокировано» остаётся (forget — отдельно). */
export function lockKeyring(): void {
  master = null;
  masterRaw?.fill(0);
  masterRaw = null;
  for (const k of opened.values()) k.fill(0);
  opened = new Map();
  wrapped = new Map();
  set({ status: 'unknown', cabinetId: null, legacy: 0 });
}

/** Удаление аккаунта: и память, и запись устройства. */
export async function forgetKeyring(): Promise<void> {
  const id = state.cabinetId;
  lockKeyring();
  if (id) await forgetDevice(id);
}

async function useMaster(cabinetId: string, raw: Uint8Array<ArrayBuffer>) {
  masterRaw = raw;
  master = await importKey(raw);
  set({ status: 'unlocked', cabinetId });
  await refreshKeys();
}

async function refreshKeys(): Promise<void> {
  const r = await call<{ keys: { keyId: string; wrapped: string }[]; legacy: number }>('/crypto/keys');
  wrapped = new Map(r.keys.map((k) => [k.keyId, k.wrapped]));
  set({ legacy: r.legacy });
}

/** Узнать состояние ключа архива; на разблокированном устройстве — открыть сразу. */
export async function initKeyring(): Promise<VaultStatus> {
  if (state.status === 'loading' || state.status === 'unlocked') return state.status;
  set({ status: 'loading' });
  try {
    const v = await call<{ cabinetId: string; wrappedMaster: string | null }>('/crypto/vault');
    set({ cabinetId: v.cabinetId });
    if (!v.wrappedMaster) {
      set({ status: 'none' });
      return 'none';
    }
    const raw = await deviceMaster(v.cabinetId);
    if (raw) {
      await useMaster(v.cabinetId, raw);
      return 'unlocked';
    }
    set({ status: 'locked' });
    return 'locked';
  } catch {
    set({ status: 'error' });
    return 'error';
  }
}

/** Новый секрет восстановления для экрана создания (ещё нигде не сохранён). */
export const newRecoverySecret = generateRecoverySecret;

/** Создать ключ архива: мастер-ключ в браузере, на сервер — только запись под секретом. */
export async function setupVault(secret: string): Promise<void> {
  const cabinetId = state.cabinetId;
  const bytes = await parseRecoverySecret(secret);
  if (!cabinetId || !bytes) throw new Error('setup');
  const raw = newRawKey();
  await call('/crypto/vault', 'POST', { wrappedMaster: await wrapMasterKey(raw, bytes, cabinetId) });
  bytes.fill(0);
  await rememberDevice(cabinetId, raw);
  await useMaster(cabinetId, raw);
}

/** Открыть архив секретом (новое устройство). false: секрет неверный или с опечаткой. */
export async function unlockVault(secret: string): Promise<boolean> {
  const bytes = await parseRecoverySecret(secret);
  if (!bytes) return false;
  try {
    const v = await call<{ cabinetId: string; wrappedMaster: string | null }>('/crypto/vault');
    if (!v.wrappedMaster) return false;
    const raw = await unwrapMasterKey(v.wrappedMaster, bytes, v.cabinetId);
    await rememberDevice(v.cabinetId, raw);
    await useMaster(v.cabinetId, raw);
    return true;
  } catch (e) {
    if (e instanceof CryptoIntegrityError) return false;
    throw e;
  } finally {
    bytes.fill(0);
  }
}

/** Ключ нового документа для запроса (x-jasno-new-key). null: архив не открыт. */
export async function newDocumentKey(): Promise<NewKey | null> {
  if (!master || !state.cabinetId) return null;
  const k = await createDocumentKey(master, state.cabinetId);
  wrapped.set(k.keyId, k.wrapped);
  opened.set(k.keyId, k.raw);
  return k;
}

/** Открытые ключи документов. Неизвестный keyId: список ключей перечитывается один раз. */
export async function documentKeys(keyIds: Iterable<string>): Promise<{ keyId: string; raw: Uint8Array }[]> {
  if (!master || !state.cabinetId) return [];
  const ids = [...new Set(keyIds)];
  if (ids.some((id) => !opened.has(id) && !wrapped.has(id))) await refreshKeys();
  const out: { keyId: string; raw: Uint8Array }[] = [];
  for (const id of ids) {
    let raw = opened.get(id);
    const w = wrapped.get(id);
    if (!raw && w) {
      raw = await unwrapDocumentKey(master, w, state.cabinetId, id);
      opened.set(id, raw);
    }
    if (raw) out.push({ keyId: id, raw });
  }
  return out;
}

/**
 * Расшифровать ответ сервера. Без открытого архива шифротекст остаётся как есть.
 * Подмена данных: CryptoIntegrityError.
 */
export async function decryptResponse<T>(data: T): Promise<T> {
  const ids = collectKeyIds(data);
  if (ids.size === 0 || !keyring.unlocked || !state.cabinetId) return data;
  const keys = new Map((await documentKeys(ids)).map((k) => [k.keyId, k.raw]));
  return decryptDeep(data, state.cabinetId, (id) => keys.get(id) ?? null);
}

/** Оригинал письма: JXB1 расшифровывается, файл до шифрования возвращается как есть. */
export async function decryptFile(data: Uint8Array): Promise<Uint8Array> {
  if (!isEncryptedBytes(data)) return data;
  const keyId = bytesKeyId(data);
  const [key] = keyId && state.cabinetId ? await documentKeys([keyId]) : [];
  if (!key || !state.cabinetId) throw new CryptoIntegrityError('Нет ключа письма');
  return decryptBytes(key.raw, state.cabinetId, data);
}

/**
 * Письма и дела, загруженные до шифрования: по одному за запрос (POST /crypto/legacy), новым ключом.
 * Возвращает, сколько осталось (0 — всё зашифровано).
 */
export async function encryptLegacy(): Promise<number> {
  let remaining = state.legacy;
  for (let guard = 0; remaining > 0 && guard < 500; guard++) {
    const key = await newDocumentKey();
    if (!key) break;
    const token = getToken();
    const res = await fetch(`${API_URL}/crypto/legacy`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        [NEW_KEY_HEADER]: formatNewKeyHeader(key),
      },
    });
    if (!res.ok) break;
    remaining = ((await res.json()) as { remaining: number }).remaining;
    set({ legacy: remaining });
  }
  return remaining;
}
