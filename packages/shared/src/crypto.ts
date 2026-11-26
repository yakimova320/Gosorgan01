/*
 * E01 (#163): шифрование писем. Только Web Crypto (AES-256-GCM, HKDF-SHA-256), своих алгоритмов нет.
 * Один код для браузера и сервера: в Node 22 есть тот же globalThis.crypto.subtle.
 *
 * Ключи:
 * - секрет восстановления: 32 случайных байта + 2 байта контрольной суммы, создаётся в браузере,
 *   показывается только пользователю (base32 группами по 4 знака);
 * - мастер-ключ: случайный AES-256-GCM в браузере. На сервере только зашифрованным ключом из секрета
 *   (HKDF с солью) — строка jxm1;
 * - ключ документа (письмо, дело): случайный AES-256-GCM, зашифрован мастер-ключом — строка jxk1.
 *   Открытым уходит на сервер только на время запроса-действия (заголовок x-jasno-keys).
 *
 * Шифротекст: строка jx1.<t|j>.<keyId>.<iv>.<ct> (t — текст, j — JSON) или двоичный файл JXB1.
 * Каждое шифрование — новый IV 12 байт. AAD = версия + кабинет + документ (keyId).
 * Подмена байта или перенос в чужой кабинет или документ: CryptoIntegrityError.
 */

export const CRYPTO_VERSION = 1;
/** Ключи документов на время запроса: keyId:base64url,keyId:base64url */
export const KEYS_HEADER = 'x-jasno-keys';
/** Новый ключ документа: keyId:сырой ключ:ключ, зашифрованный мастер-ключом (jxk1) */
export const NEW_KEY_HEADER = 'x-jasno-new-key';
/** Ответ с двоичным шифротекстом (оригинал письма): расшифровывает браузер */
export const ENCRYPTED_FILE_HEADER = 'x-jasno-encrypted';

const ENVELOPE = 'jx1';
const MASTER = 'jxm1';
const WRAPPED = 'jxk1';
const FILE_MAGIC = [0x4a, 0x58, 0x42, 0x31]; // JXB1
const IV_BYTES = 12;
const SECRET_BYTES = 32;
const CHECK_BYTES = 2;

export class CryptoIntegrityError extends Error {
  constructor(message = 'Проверка целостности не пройдена') {
    super(message);
    this.name = 'CryptoIntegrityError';
  }
}

type Bytes = Uint8Array<ArrayBuffer>;

const subtle = (): SubtleCrypto => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('Web Crypto недоступен');
  return s;
};

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

export function randomBytes(n: number): Bytes {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function newKeyId(): string {
  return globalThis.crypto.randomUUID();
}

// ---------- base64url ----------

export function toB64(data: Uint8Array): string {
  let s = '';
  for (let i = 0; i < data.length; i += 0x8000)
    s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64(s: string): Bytes {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new CryptoIntegrityError('Неверная запись base64url');
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const KEY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isKeyId = (s: string): boolean => KEY_ID.test(s);

const aad = (...parts: string[]) => enc.encode(['jasno', `v${CRYPTO_VERSION}`, ...parts].join('|'));

// ---------- ключи ----------

export type KeyInput = CryptoKey | Uint8Array;

/** Новый случайный ключ AES-256-GCM (мастер-ключ или ключ документа), сырые 32 байта. */
export function newRawKey(): Bytes {
  return randomBytes(32);
}

export async function importKey(raw: Uint8Array, extractable = false): Promise<CryptoKey> {
  if (raw.length !== 32) throw new CryptoIntegrityError('Неверная длина ключа');
  return subtle().importKey('raw', new Uint8Array(raw), { name: 'AES-GCM' }, extractable, [
    'encrypt',
    'decrypt',
  ]);
}

const asKey = (k: KeyInput) => (k instanceof Uint8Array ? importKey(k) : Promise.resolve(k));

async function seal(key: KeyInput, data: Uint8Array, ad: Uint8Array): Promise<{ iv: Bytes; ct: Bytes }> {
  const iv = randomBytes(IV_BYTES);
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: new Uint8Array(ad) },
    await asKey(key),
    new Uint8Array(data),
  );
  return { iv, ct: new Uint8Array(ct) };
}

async function open(key: KeyInput, iv: Uint8Array, ct: Uint8Array, ad: Uint8Array): Promise<Bytes> {
  if (iv.length !== IV_BYTES) throw new CryptoIntegrityError();
  try {
    const pt = await subtle().decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv), additionalData: new Uint8Array(ad) },
      await asKey(key),
      new Uint8Array(ct),
    );
    return new Uint8Array(pt);
  } catch {
    throw new CryptoIntegrityError();
  }
}

// ---------- секрет восстановления ----------

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford, без I L O U

function base32(data: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of data) {
    value = ((value << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function unbase32(s: string): Bytes | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s) {
    const v = B32.indexOf(ch);
    if (v < 0) return null;
    value = ((value << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

async function checksum(data: Uint8Array): Promise<Bytes> {
  const h = new Uint8Array(await subtle().digest('SHA-256', new Uint8Array(data)));
  return h.slice(0, CHECK_BYTES);
}

/** Новый секрет восстановления: строка вида ABCD-EFGH-… (55 знаков base32 с контрольной суммой). */
export async function generateRecoverySecret(): Promise<string> {
  const secret = randomBytes(SECRET_BYTES);
  const full = new Uint8Array(SECRET_BYTES + CHECK_BYTES);
  full.set(secret);
  full.set(await checksum(secret), SECRET_BYTES);
  return base32(full).match(/.{1,4}/g)!.join('-');
}

/** Секрет из ввода человека: регистр, пробелы и дефисы не важны, O→0, I и L→1. Опечатка: null. */
export async function parseRecoverySecret(input: string): Promise<Bytes | null> {
  const s = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  const full = unbase32(s);
  if (!full || full.length !== SECRET_BYTES + CHECK_BYTES) return null;
  const secret = full.slice(0, SECRET_BYTES);
  const check = await checksum(secret);
  if (check.some((b, i) => b !== full[SECRET_BYTES + i])) return null;
  return secret;
}

async function recoveryKey(secret: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', new Uint8Array(secret), 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(salt), info: enc.encode('jasno recovery v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Мастер-ключ, зашифрованный секретом восстановления: jxm1.<salt>.<iv>.<ct>. Только это видит сервер. */
export async function wrapMasterKey(
  masterRaw: Uint8Array,
  secret: Uint8Array,
  cabinetId: string,
): Promise<string> {
  const salt = randomBytes(16);
  const { iv, ct } = await seal(await recoveryKey(secret, salt), masterRaw, aad(cabinetId, 'master'));
  return [MASTER, toB64(salt), toB64(iv), toB64(ct)].join('.');
}

/** Неверный секрет или подменённая запись: CryptoIntegrityError. */
export async function unwrapMasterKey(
  wrapped: string,
  secret: Uint8Array,
  cabinetId: string,
): Promise<Bytes> {
  const [tag, salt, iv, ct] = wrapped.split('.');
  if (tag !== MASTER || !salt || !iv || !ct) throw new CryptoIntegrityError();
  return open(await recoveryKey(secret, fromB64(salt)), fromB64(iv), fromB64(ct), aad(cabinetId, 'master'));
}

/** Ключ документа, зашифрованный мастер-ключом: jxk1.<iv>.<ct>. */
export async function wrapDocumentKey(
  master: KeyInput,
  docRaw: Uint8Array,
  cabinetId: string,
  keyId: string,
): Promise<string> {
  const { iv, ct } = await seal(master, docRaw, aad(cabinetId, keyId, 'dek'));
  return [WRAPPED, toB64(iv), toB64(ct)].join('.');
}

export async function unwrapDocumentKey(
  master: KeyInput,
  wrapped: string,
  cabinetId: string,
  keyId: string,
): Promise<Bytes> {
  const [tag, iv, ct] = wrapped.split('.');
  if (tag !== WRAPPED || !iv || !ct) throw new CryptoIntegrityError();
  return open(master, fromB64(iv), fromB64(ct), aad(cabinetId, keyId, 'dek'));
}

/** Проверка записи jxk1 без расшифровки (сервер принимает новый ключ). */
export function isWrappedKey(s: string): boolean {
  return /^jxk1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{64}$/.test(s);
}

export function isWrappedMaster(s: string): boolean {
  return /^jxm1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{64}$/.test(s);
}

// ---------- шифротекст полей ----------

export interface CryptoScope {
  cabinetId: string;
  keyId: string;
}

const ENVELOPE_RE = /^jx1\.([tj])\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]+)$/;

export function isEnvelope(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith(`${ENVELOPE}.`) && ENVELOPE_RE.test(v);
}

export function envelopeKeyId(v: string): string | null {
  return ENVELOPE_RE.exec(v)?.[2] ?? null;
}

export async function encryptText(key: KeyInput, scope: CryptoScope, text: string): Promise<string> {
  const { iv, ct } = await seal(key, enc.encode(text), aad(scope.cabinetId, scope.keyId));
  return [ENVELOPE, 't', scope.keyId, toB64(iv), toB64(ct)].join('.');
}

export async function encryptJson(key: KeyInput, scope: CryptoScope, value: unknown): Promise<string> {
  const { iv, ct } = await seal(key, enc.encode(JSON.stringify(value)), aad(scope.cabinetId, scope.keyId));
  return [ENVELOPE, 'j', scope.keyId, toB64(iv), toB64(ct)].join('.');
}

/** Текст (t) или значение JSON (j). Чужой кабинет, подмена, другой ключ: CryptoIntegrityError. */
export async function decryptEnvelope(key: KeyInput, cabinetId: string, envelope: string): Promise<unknown> {
  const m = ENVELOPE_RE.exec(envelope);
  if (!m) throw new CryptoIntegrityError('Неверная запись шифротекста');
  const [, type, keyId, iv, ct] = m as unknown as [string, 't' | 'j', string, string, string];
  const pt = await open(key, fromB64(iv), fromB64(ct), aad(cabinetId, keyId));
  let text: string;
  try {
    text = dec.decode(pt);
  } catch {
    throw new CryptoIntegrityError();
  }
  return type === 'j' ? JSON.parse(text) : text;
}

// ---------- файлы ----------

/** JXB1 | длина keyId (1 байт) | keyId | IV 12 | шифротекст с меткой GCM */
export async function encryptBytes(key: KeyInput, scope: CryptoScope, data: Uint8Array): Promise<Bytes> {
  const id = enc.encode(scope.keyId);
  const { iv, ct } = await seal(key, data, aad(scope.cabinetId, scope.keyId, 'file'));
  const out = new Uint8Array(4 + 1 + id.length + IV_BYTES + ct.length);
  out.set(FILE_MAGIC, 0);
  out[4] = id.length;
  out.set(id, 5);
  out.set(iv, 5 + id.length);
  out.set(ct, 5 + id.length + IV_BYTES);
  return out;
}

export function isEncryptedBytes(data: Uint8Array): boolean {
  return data.length > 5 && FILE_MAGIC.every((b, i) => data[i] === b);
}

export function bytesKeyId(data: Uint8Array): string | null {
  if (!isEncryptedBytes(data)) return null;
  const len = data[4]!;
  try {
    const id = dec.decode(data.subarray(5, 5 + len));
    return isKeyId(id) ? id : null;
  } catch {
    return null;
  }
}

export async function decryptBytes(key: KeyInput, cabinetId: string, data: Uint8Array): Promise<Bytes> {
  const keyId = bytesKeyId(data);
  if (!keyId) throw new CryptoIntegrityError('Неверный файл');
  const start = 5 + data[4]!;
  return open(
    key,
    data.subarray(start, start + IV_BYTES),
    data.subarray(start + IV_BYTES),
    aad(cabinetId, keyId, 'file'),
  );
}

// ---------- обход ответов ----------

/** keyId всех шифротекстов в объекте (вложенные массивы и объекты). */
export function collectKeyIds(value: unknown, into = new Set<string>()): Set<string> {
  if (isEnvelope(value)) {
    const id = envelopeKeyId(value);
    if (id) into.add(id);
  } else if (Array.isArray(value)) for (const v of value) collectKeyIds(v, into);
  else if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof Uint8Array))
    for (const v of Object.values(value)) collectKeyIds(v, into);
  return into;
}

/**
 * Копия объекта, где каждый шифротекст заменён открытым значением.
 * key(keyId) — ключ документа; null: шифротекст остаётся как есть.
 * Подмена документа: у объекта с полем keyId (письмо, дело) каждый шифротекст в его собственных полях
 * должен быть зашифрован именно этим ключом. Чужой шифротекст (из другого письма) — CryptoIntegrityError.
 */
export async function decryptDeep<T>(
  value: T,
  cabinetId: string,
  key: (keyId: string) => KeyInput | null,
): Promise<T> {
  const walk = async (v: unknown): Promise<unknown> => {
    if (isEnvelope(v)) {
      const k = key(envelopeKeyId(v)!);
      return k ? decryptEnvelope(k, cabinetId, v) : v;
    }
    if (Array.isArray(v)) return Promise.all(v.map(walk));
    if (v && typeof v === 'object' && !(v instanceof Date) && !(v instanceof Uint8Array)) {
      const own = (v as { keyId?: unknown }).keyId;
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (typeof own === 'string' && isEnvelope(x) && envelopeKeyId(x) !== own)
          throw new CryptoIntegrityError('Шифротекст другого документа');
        out[k] = await walk(x);
      }
      return out;
    }
    return v;
  };
  return (await walk(value)) as T;
}

// ---------- заголовки запроса ----------

export function formatKeysHeader(keys: { keyId: string; raw: Uint8Array }[]): string {
  return keys.map((k) => `${k.keyId}:${toB64(k.raw)}`).join(',');
}

/** null: заголовок испорчен. */
export function parseKeysHeader(header: string): Map<string, Bytes> | null {
  const out = new Map<string, Bytes>();
  for (const part of header.split(',')) {
    const [id, raw] = part.trim().split(':');
    if (!id || !raw || !isKeyId(id)) return null;
    try {
      const bytes = fromB64(raw);
      if (bytes.length !== 32) return null;
      out.set(id, bytes);
    } catch {
      return null;
    }
  }
  return out;
}

export interface NewKey {
  keyId: string;
  raw: Bytes;
  wrapped: string;
}

export function formatNewKeyHeader(k: NewKey): string {
  return `${k.keyId}:${toB64(k.raw)}:${k.wrapped}`;
}

export function parseNewKeyHeader(header: string): NewKey | null {
  const [keyId, raw, wrapped] = header.trim().split(':');
  if (!keyId || !raw || !wrapped || !isKeyId(keyId) || !isWrappedKey(wrapped)) return null;
  try {
    const bytes = fromB64(raw);
    return bytes.length === 32 ? { keyId, raw: bytes, wrapped } : null;
  } catch {
    return null;
  }
}

/** Новый ключ документа для запроса: сырой ключ и его запись под мастер-ключом. */
export async function createDocumentKey(master: KeyInput, cabinetId: string): Promise<NewKey> {
  const keyId = newKeyId();
  const raw = newRawKey();
  return { keyId, raw, wrapped: await wrapDocumentKey(master, raw, cabinetId, keyId) };
}
