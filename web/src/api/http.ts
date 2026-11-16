import { API_URL, REQUEST_TIMEOUT_MS } from './config';
import { ApiClientError, messageFor } from './errors';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

let unauthorizedHandler: (() => void) | null = null;

/** Вызывается, когда сервер отклонил токен сессии (истекла или завершена). Ставит SessionProvider. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

interface RequestOptions {
  body?: unknown;
  form?: FormData;
  token?: string | null;
  timeoutMs?: number;
}

/**
 * Один запрос к API. Ошибки всегда превращаются в ApiClientError с кодом:
 * ответ сервера { code, message }, или NETWORK, TIMEOUT, BAD_RESPONSE.
 * Ответ 204 возвращает undefined и не разбирается как JSON.
 */
export async function request<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body, signal: controller.signal });
  } catch (e) {
    const code = e instanceof DOMException && e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
    throw new ApiClientError(code, messageFor(code));
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 204) return undefined as T;

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiClientError('BAD_RESPONSE', messageFor('BAD_RESPONSE'), res.status);
    }
  }

  if (!res.ok) {
    const err = (data ?? {}) as { code?: string; message?: string; details?: unknown };
    const code = err.code ?? 'INTERNAL_ERROR';
    if (res.status === 401 && code === 'UNAUTHORIZED' && options.token) unauthorizedHandler?.();
    throw new ApiClientError(code, err.message ?? messageFor(code), res.status, err.details);
  }
  return data as T;
}
