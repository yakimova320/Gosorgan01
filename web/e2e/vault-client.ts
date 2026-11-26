import type { APIRequestContext, APIResponse } from '@playwright/test';
import {
  createDocumentKey,
  decryptDeep,
  formatKeysHeader,
  formatNewKeyHeader,
  generateRecoverySecret,
  KEYS_HEADER,
  NEW_KEY_HEADER,
  newRawKey,
  parseRecoverySecret,
  unwrapDocumentKey,
  unwrapMasterKey,
  wrapMasterKey,
} from '@jasno/shared';

/*
 * E01 (#163): то, что делает браузер с ключами, — для подготовки данных через API в тестах.
 * Ключ архива пользователя: token → кабинет, мастер-ключ, секрет восстановления (только в памяти теста).
 * Запросы-действия получают новый ключ документа и повторяются с ключами после 428 KEYS_REQUIRED,
 * JSON-ответы расшифровываются. Так тесты, которые раньше слали письма в API открытым текстом,
 * работают с сервером, где ENCRYPTION_REQUIRED=true.
 */

export interface Vault {
  cabinetId: string;
  master: Uint8Array;
  secret: string;
}

const vaults = new Map<string, Vault>();
const API = () => process.env.JASNO_E2E_API_URL ?? 'http://127.0.0.1:3100';

export function vaultFor(token: string): Vault | undefined {
  return vaults.get(token);
}

/** Ключ архива по кабинету: после входа через сайт у пользователя новый токен. */
export function vaultForCabinet(cabinetId: string): Vault | undefined {
  return [...vaults.values()].find((v) => v.cabinetId === cabinetId);
}

export function rememberVault(token: string, v: Vault) {
  vaults.set(token, v);
}

async function getJson<T>(request: APIRequestContext, path: string, token: string): Promise<T> {
  const res = await request.get(`${API()}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok()) throw new Error(`${path}: ${res.status()}`);
  return (await res.json()) as T;
}

/** Ключ архива по токену: уже известный, либо новый (если у кабинета его ещё нет). */
export async function ensureVault(request: APIRequestContext, token: string): Promise<Vault> {
  const known = vaults.get(token);
  if (known) return known;
  const v = await getJson<{ cabinetId: string; wrappedMaster: string | null }>(request, '/crypto/vault', token);
  if (v.wrappedMaster) throw new Error('ключ архива создан не тестом: секрет неизвестен');
  const secret = await generateRecoverySecret();
  const master = newRawKey();
  const res = await request.post(`${API()}/crypto/vault`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { wrappedMaster: await wrapMasterKey(master, (await parseRecoverySecret(secret))!, v.cabinetId) },
  });
  if (res.status() !== 201) throw new Error(`POST /crypto/vault: ${res.status()}`);
  const vault = { cabinetId: v.cabinetId, master, secret };
  vaults.set(token, vault);
  return vault;
}

/** Ключ архива, созданный в браузере: мастер-ключ из секрета, который показал экран. */
export async function adoptVault(request: APIRequestContext, token: string, secret: string): Promise<Vault> {
  const v = await getJson<{ cabinetId: string; wrappedMaster: string }>(request, '/crypto/vault', token);
  const master = await unwrapMasterKey(v.wrappedMaster, (await parseRecoverySecret(secret))!, v.cabinetId);
  const vault = { cabinetId: v.cabinetId, master, secret };
  vaults.set(token, vault);
  return vault;
}

async function keysFor(request: APIRequestContext, token: string, v: Vault, ids: string[]) {
  const { keys } = await getJson<{ keys: { keyId: string; wrapped: string }[] }>(request, '/crypto/keys', token);
  const out = [];
  for (const id of ids) {
    const w = keys.find((k) => k.keyId === id);
    if (w) out.push({ keyId: id, raw: await unwrapDocumentKey(v.master, w.wrapped, v.cabinetId, id) });
  }
  return out;
}

type Options = { headers?: Record<string, string>; [k: string]: unknown };

function tokenOf(options?: Options): string | null {
  const h = options?.headers ?? {};
  const value = h.Authorization ?? h.authorization;
  return value?.startsWith('Bearer ') ? value.slice(7) : null;
}

/** Ответ с расшифрованным json(). */
function decrypting(res: APIResponse, v: Vault, request: APIRequestContext, token: string): APIResponse {
  return new Proxy(res, {
    get(target, prop, receiver) {
      if (prop === 'json')
        return async () => {
          const data = (await target.json()) as unknown;
          const ids = new Set<string>();
          JSON.stringify(data, (_k, x) => {
            if (typeof x === 'string' && x.startsWith('jx1.')) ids.add(x.split('.')[2]!);
            return x;
          });
          if (ids.size === 0) return data;
          const keys = new Map((await keysFor(request, token, v, [...ids])).map((k) => [k.keyId, k.raw]));
          return decryptDeep(data, v.cabinetId, (id) => keys.get(id) ?? null);
        };
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'fetch', 'head']);

/** request с ключами: запросы к API с токеном пользователя ведут себя как браузер с открытым архивом. */
export function withVaultKeys(request: APIRequestContext): APIRequestContext {
  return new Proxy(request, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof prop !== 'string' || !METHODS.has(prop) || typeof value !== 'function') return value;
      const call = value as (url: string, options?: Options) => Promise<APIResponse>;
      return async (url: string, options?: Options) => {
        const token = tokenOf(options);
        const isApi = typeof url === 'string' && url.startsWith(API()) && !url.includes('/crypto/');
        if (!token || !isApi) return call.call(target, url, options);
        const method = prop === 'fetch' ? String(options?.method ?? 'GET').toLowerCase() : prop;
        const mutating = method !== 'get' && method !== 'head';
        let v = vaults.get(token);
        if (!v && mutating) {
          try {
            v = await ensureVault(target, token);
          } catch {
            return call.call(target, url, options);
          }
        }
        if (!v) return call.call(target, url, options);
        const headers: Record<string, string> = { ...(options?.headers ?? {}) };
        if (mutating) headers[NEW_KEY_HEADER] = formatNewKeyHeader(await createDocumentKey(v.master, v.cabinetId));
        const sent: { keyId: string; raw: Uint8Array }[] = [];
        let res = await call.call(target, url, { ...options, headers });
        for (let i = 0; i < 3 && res.status() === 428; i++) {
          const err = (await res.json().catch(() => null)) as { details?: { keyIds?: string[] } } | null;
          const ids = (err?.details?.keyIds ?? []).filter((id) => !sent.some((k) => k.keyId === id));
          const more = await keysFor(target, token, v, ids);
          if (more.length === 0) break;
          sent.push(...more);
          headers[KEYS_HEADER] = formatKeysHeader(sent);
          res = await call.call(target, url, { ...options, headers });
        }
        return decrypting(res, v, target, token);
      };
    },
  });
}
