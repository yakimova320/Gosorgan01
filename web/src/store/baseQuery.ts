import type { BaseQueryFn } from '@reduxjs/toolkit/query';
import { API_URL, REQUEST_TIMEOUT_MS } from '../api/config';
import { apiError, type ApiError } from '../api/errors';
import { sessionExpired, type SessionState } from './session';
import { t } from '../i18n';

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
    res = await fetch(`${API_URL}${args.path}`, {
      method: args.method ?? 'GET',
      headers,
      body,
      signal: controller.signal,
    });
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
      return { data: URL.createObjectURL(await res.blob()) };
    } catch {
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
  return { data };
};
