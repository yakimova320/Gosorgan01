import type { BaseQueryFn } from '@reduxjs/toolkit/query';
import { API_URL, REQUEST_TIMEOUT_MS } from '../api/config';
import { apiError, type ApiError } from '../api/errors';
import { sessionExpired, type SessionState } from './session';
import { t } from '../i18n';
import {
  CryptoIntegrityError,
  formatKeysHeader,
  formatNewKeyHeader,
  KEYS_HEADER,
  NEW_KEY_HEADER,
} from '@jasno/shared';
import { decryptFile, decryptResponse, documentKeys, keyring, newDocumentKey } from '../crypto/keyring';

/** E01: сколько раз запрос повторяется с ключами документов после 428 KEYS_REQUIRED. */
const KEY_RETRIES = 3;


/*
 * E02 (#165): расшифрованные байты файлов, выданных как blob:-адрес. Нужны для «Скачать оригинал»:
 * CSP (connect-src 'self') не даёт прочитать blob: через fetch. Живут, пока экран не вызовет releaseFile.
 */
const fileBytes = new Map<string, Uint8Array>();

export function fileBytesOf(url: string): Uint8Array | undefined {
  return fileBytes.get(url);
}

export function releaseFile(url: string) {
  fileBytes.delete(url);
  URL.revokeObjectURL(url);
}

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface RequestArgs {
  method?: Method;
  path: string;
  body?: unknown;
  form?: FormData;
  /** false: запрос без токена (вход, регистрация) */
  auth?: boolean;
  timeoutMs?: number;
  /**
   * B11: двоичный ответ (оригинал письма). Успех: временный адрес blob: в браузере (строка);
   * освобождает его тот, кто вызвал (URL.revokeObjectURL). Ошибка разбирается как обычно.
   */
  binary?: boolean;
}

/* Незавершённые запросы. При смене пользователя их отменяет abortAllRequests(). */
const inFlight = new Set<AbortController>();

export function abortAllRequests(): void {
  for (const c of inFlight) c.abort('session-changed');
  inFlight.clear();
}

/**
 * E01 (#163) шифрование:
 * - запрос-действие (не GET) с открытым архивом несёт новый ключ документа (x-jasno-new-key):
 *   он нужен серверу, только если запрос создаёт письмо или дело;
 * - сервер ответил 428 KEYS_REQUIRED { keyIds }: запрос повторяется с ключами именно этих документов
 *   (x-jasno-keys). Ключи нужны только для действий (загрузка, объяснение, перевод, черновик, архив);
 *   просмотр (GET) сервер отдаёт шифротекстом;
 * - ответ расшифровывается здесь, в кэш RTK Query попадает уже открытый текст (память страницы);
 *   подмена шифротекста: ошибка INTEGRITY_FAILED.
 *
 * Один запрос к API для RTK Query. Ошибка всегда объект ApiError:
 * ответ сервера { code, message }, или NETWORK, TIMEOUT, BAD_RESPONSE, CANCELLED.
 * Ответ 204 возвращает undefined и не разбирается как JSON.
 * 401 UNAUTHORIZED завершает сессию, только если запрос шёл с текущим токеном:
 * запоздалый ответ старой сессии не трогает новую. 401 INVALID_CREDENTIALS сессию не завершает.
 */
export const apiBaseQuery: BaseQueryFn<RequestArgs, unknown, ApiError> = async (
  args,
  api,
) => {
  const token =
    args.auth === false
      ? null
      : (api.getState() as { session: SessionState }).session.token;
  const headers: Record<string, string> = {
    Accept: args.binary ? '*/*' : 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (args.form) body = args.form;
  else if (args.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(args.body);
  }
  const method = args.method ?? 'GET';
  if (token && method !== 'GET' && keyring.unlocked) {
    const fresh = await newDocumentKey();
    if (fresh) headers[NEW_KEY_HEADER] = formatNewKeyHeader(fresh);
  }

  const controller = new AbortController();
  inFlight.add(controller);
  const onOuterAbort = () => controller.abort('cancelled');
  api.signal.addEventListener('abort', onOuterAbort);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort('timeout');
  }, args.timeoutMs ?? REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    const sent = new Map<string, Uint8Array>();
    for (let attempt = 0; ; attempt++) {
      res = await fetch(`${API_URL}${args.path}`, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      if (res.status !== 428 || attempt >= KEY_RETRIES || !keyring.unlocked) break;
      const err = (await res.clone().json().catch(() => null)) as {
        code?: string;
        details?: { keyIds?: string[] };
      } | null;
      if (err?.code !== 'KEYS_REQUIRED') break;
      const wanted = (err.details?.keyIds ?? []).filter((id) => !sent.has(id));
      const found = await documentKeys(wanted);
      if (found.length === 0) break;
      for (const k of found) sent.set(k.keyId, k.raw);
      headers[KEYS_HEADER] = formatKeysHeader([...sent].map(([keyId, raw]) => ({ keyId, raw })));
    }
  } catch {
    if (timedOut) return { error: apiError('TIMEOUT') };
    if (controller.signal.aborted)
      return { error: apiError('CANCELLED', undefined, t('Запрос отменён')) };
    return { error: apiError('NETWORK') };
  } finally {
    clearTimeout(timer);
    inFlight.delete(controller);
    api.signal.removeEventListener('abort', onOuterAbort);
  }

  if (res.status === 204) return { data: undefined };
  if (args.binary && res.ok) {
    try {
      const blob = await res.blob();
      const bytes = await decryptFile(new Uint8Array(await blob.arrayBuffer()));
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: blob.type }));
      fileBytes.set(url, bytes);
      return { data: url };
    } catch (e) {
      if (e instanceof CryptoIntegrityError)
        return { error: apiError('INTEGRITY_FAILED', 422) };
      return { error: apiError('NETWORK') };
    }
  }

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      return { error: apiError('BAD_RESPONSE', res.status) };
    }
  }

  if (!res.ok) {
    const err = (data ?? {}) as {
      code?: string;
      message?: string;
      details?: unknown;
    };
    const code = err.code ?? 'INTERNAL_ERROR';
    if (res.status === 401 && code === 'UNAUTHORIZED' && token) {
      const current = (api.getState() as { session: SessionState }).session
        .token;
      if (current === token) api.dispatch(sessionExpired());
    }
    return { error: apiError(code, res.status, err.message, err.details) };
  }
  try {
    return { data: await decryptResponse(data) };
  } catch (e) {
    if (e instanceof CryptoIntegrityError) return { error: apiError('INTEGRITY_FAILED', 422) };
    throw e;
  }
};
